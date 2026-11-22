/**
 * The relationship graph: characters are nodes, and every pair that has dated is one edge (`relationships`, one row
 * per unordered pair, the lower id first). It's how a pairing grows past one date: the stage they've reached, how
 * strong the tie is, a running chemistry and trust that carry into their next date, what each has told the other,
 * their inside jokes, and the plans they made in their morning-after texts (docs/relationship-graph.md).
 *
 * Built like the rest of the show's state, and like a social graph should be:
 *  - **Derived, never edited.** An edge is recomputed from the dates it's made of (`refreshRelationship`), whenever
 *    one is stored, airs, changes visibility or goes away. Same dates, same edge; nothing drifts, nothing to repair.
 *    $0 and deterministic: it only reads what the engine decided and what was said.
 *  - **Undirected edge, directed knowledge.** The pair is one edge, but what A knows about B isn't what B knows
 *    about A, and each side's wish for another date is its own (and private).
 *  - **Layered visibility.** The public layer reads only dates that aired publicly (never a spoiler, never a
 *    private date). The owner layer adds that owner's own dates and the afterglow's plans. The prompt layer is what
 *    a character may bring into a date: public history plus the dates of whoever set this one up. User ids stay
 *    on the server.
 *  - **Tie strength** (Granovetter): how often they've met, how recently, how warm it runs and whether it's mutual.
 *  - **Blocks win.** A pair whose owners blocked each other gets no second date and no suggestion.
 */
import type { Db } from "./db";
import { SHOW_ID } from "./show-id";
import type { DateHistory, SideOutcome, VariableArc } from "./engine";
import type { Turn } from "./conversation";
import type { AfterglowLine } from "./afterglow";
import type { MetVia } from "./game";
import { contentWords, tokens } from "./quality";
import { ENDING_LABELS, endingLabel, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { checkFields } from "./safety";
import { venueFor } from "./places";
import { overnightDatesOn } from "./overnight-shared";
import { socialHook } from "./social/hook";
import {
  isStage,
  shownStageOf,
  STAGE_LABELS,
  STAGE_LINES,
  stageName,
  stageOf,
  stagesV2On,
  stageSteps,
  type BaseStage,
  type Stage,
  type StageDate,
  type StageMarks,
} from "./relationship-stages";

export { STAGE_LABELS, stageOf, type BaseStage, type Stage, type StageMarks };

type Env = Record<string, string | undefined>;
import { venue as venueOf, type PlaceId, type VenueId } from "./venues";
import { escapeRegExp } from "./text";

/** The canonical (sorted) key for a pair: one unordered pair is one edge. */
export const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

/** Which end of the edge: "lo" is the lower id, "hi" the higher. */
export type End = "lo" | "hi";

/** One date between the pair, as the edge records it. `creator` is server-only (never in a view). */
export type HistoryItem = {
  episode_id: string;
  at: string;
  aired_at: string | null;
  ending: Ending;
  venue: PlaceId | null;
  /** Whether each end wanted another date (lo, hi). PRIVATE: owners and the engine only. */
  wants: [boolean, boolean] | null;
  /** The engine's final chemistry and trust that night, 0..100. */
  chemistry: number | null;
  trust: number | null;
  /** Aired, public, and not hidden by reports: the only dates the public layer reads. */
  public: boolean;
  /** A private date: its creator's alone, even from the other character's owner. Missing on edges stored before it existed (then treated as private). */
  private?: boolean;
  creator: string;
  /** A two-agent date's other agent (episodes.partner_performer): it performed the date too, so it's theirs as much as the creator's. */
  performer?: string;
  /** The date this one was the second date of (the plan they made), when it was. */
  followup_of: string | null;
  /** Which date this was for the couple (2, 3, ...) when it followed another; absent on a first date. */
  date_number?: number;
  /**
   * How this date came about (DateSetup.met_via; data plan Tier 2): absent on dates booked before it was recorded.
   * Server-side: viewRelationship never shows it (a "match" or "proposal" is its owners' business).
   */
  met_via?: MetVia;
  /** The roleplay they played that night (its title; lib/date-roleplays.ts): its lines were in character, never facts. */
  roleplay?: string;
  /** An overnight date (setup.overnight, lib/overnight.ts): one that ended in another date is the pair's overnight milestone. */
  overnight?: true;
};

/** Something one of them said about themselves on a date. `about` is the end that said it. */
export type Fact = { text: string; about: End; episode_id: string };
/** A phrase both of them used and came back to: in their texts the morning after, or on a later date. */
export type Joke = { phrase: string; episode_ids: string[] };
/** A plan made after a date (its morning-after texts, or their texts before the next one), and whether a later date kept it. */
export type Plan = { text: string; by: End; episode_id: string; status: "open" | "kept" | "missed"; kept_in: string | null };
/** A text between dates (couple_texts), as the graph reads it: which end sent it, and when. */
export type RelText = { who: End; text: string; at: string };

/** The dates of one layer as the shown stage reads them (lib/relationship-stages.ts): when each aired, and the overnight ones. */
export const stageDates = (items: readonly Pick<HistoryItem, "ending" | "at" | "aired_at" | "overnight">[], env: Env = process.env): StageDate[] => {
  const nights = overnightDatesOn(env);
  return items.map((h) => ({ ending: h.ending, at: h.aired_at ?? h.at, ...(h.overnight && nights ? { overnight: true } : {}) }));
};

/** The numbers an edge is ranked and shown by, for one layer of its history. */
export type Summary = {
  dates: number;
  second_dates: number;
  /** Dates after which both wanted another. PRIVATE layer only (0 in the public summary). */
  mutual_yes: number;
  last_ending: Ending | null;
  first_at: string | null;
  last_at: string | null;
  /** Running chemistry and trust across their dates (the latest weighs most), 0..100; null before any. */
  chemistry: number | null;
  trust: number | null;
  /** The BASE stage, from the endings alone: the one every rule reads (suggestions, one partner, arcs, overnight). */
  stage: BaseStage | null;
  /** The stage as it is SHOWN and told (lib/relationship-stages.ts): the base stage when RELATIONSHIP_STAGES_V2=0. */
  shown: Stage | null;
  /** 0..1, as of `last_at` (recency is applied again at read time by `tieNow`). */
  tie: number;
};

export type Relationship = {
  lo: string;
  hi: string;
  all: Summary;
  public: Summary;
  history: HistoryItem[];
  facts: Fact[];
  jokes: Joke[];
  plans: Plan[];
  /** What happened to them besides their dates, on the public record: a finale's engagement or wedding, a feud in the house. */
  marks: StageMarks;
};

/* ------------------------------------------------- the pure core ------------------------------------------------- */

/** One stored date between the pair, as `refreshRelationship` loads it. */
export type RelEpisode = {
  id: string;
  created_at: string | Date;
  revealed_at: string | Date | null;
  visibility: string;
  hidden: boolean;
  creator_id: string;
  /** A two-agent date's other agent, or null. */
  partner_performer?: string | null;
  character_a: string;
  character_b: string;
  ending: Ending;
  sides: [SideOutcome, SideOutcome] | null;
  box_score: { chemistry?: VariableArc; trust?: VariableArc } | null;
  transcript: Turn[] | null;
  afterglow: AfterglowLine[] | null;
  venue: PlaceId | null;
  followup_of: string | null;
  date_number?: number | null;
  met_via?: MetVia | null;
  /** The title of the roleplay the date played (setup.roleplay), or null. */
  roleplay?: string | null;
  /** setup.overnight: an overnight date (lib/overnight.ts). */
  overnight?: boolean | null;
};

const iso = (d: string | Date | null): string | null => (d === null ? null : new Date(d).toISOString());
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

/** The weight the newest date gets in the running chemistry/trust (an exponential moving average). */
export const RUNNING_WEIGHT = 0.5;
/** Recency half-life for tie strength, in days. */
export const TIE_HALF_LIFE_DAYS = 21;
export const FACTS_KEPT = 6;
export const JOKES_KEPT = 5;
export const PLANS_KEPT = 6;
export const HISTORY_KEPT = 30;

/**
 * Tie strength, 0..1: frequency (how often they've met), recency (halving every TIE_HALF_LIFE_DAYS), intensity (the
 * running chemistry) and reciprocity (how often it was mutual; second dates stand in for it on the public layer).
 */
export function tieStrength(s: Pick<Summary, "dates" | "second_dates" | "mutual_yes" | "chemistry" | "last_at">, now: Date, usePublicReciprocity = false): number {
  if (!s.dates || !s.last_at) return 0;
  const frequency = 1 - Math.exp(-s.dates / 3);
  const days = Math.max(0, (now.getTime() - new Date(s.last_at).getTime()) / 86_400_000);
  const recency = Math.pow(0.5, days / TIE_HALF_LIFE_DAYS);
  const intensity = (s.chemistry ?? 50) / 100;
  const reciprocity = (usePublicReciprocity ? s.second_dates : s.mutual_yes) / s.dates;
  return round(clamp(0.3 * frequency + 0.25 * recency + 0.25 * intensity + 0.2 * reciprocity, 0, 1), 3);
}

/** The summary of one layer of a pair's history (oldest first). `marks`: the pair's finale marks and feud, for the shown stage. */
export function summarize(items: HistoryItem[], publicLayer: boolean, marks: StageMarks = {}, env: Env = process.env): Summary {
  let chemistry: number | null = null;
  let trust: number | null = null;
  for (const it of items) {
    if (it.chemistry !== null) chemistry = chemistry === null ? it.chemistry : chemistry + RUNNING_WEIGHT * (it.chemistry - chemistry);
    if (it.trust !== null) trust = trust === null ? it.trust : trust + RUNNING_WEIGHT * (it.trust - trust);
  }
  const last = items[items.length - 1];
  const s: Summary = {
    dates: items.length,
    second_dates: items.filter((i) => i.ending === "second_date").length,
    mutual_yes: publicLayer ? 0 : items.filter((i) => i.wants?.[0] && i.wants?.[1]).length,
    last_ending: last?.ending ?? null,
    first_at: items[0]?.at ?? null,
    last_at: last ? (publicLayer ? (last.aired_at ?? last.at) : last.at) : null,
    chemistry: chemistry === null ? null : round(chemistry),
    trust: trust === null ? null : round(trust),
    stage: stageOf(items.map((i) => i.ending)),
    shown: shownStageOf(stageDates(items, env), marks, env),
    tie: 0,
  };
  s.tie = s.last_at ? tieStrength(s, new Date(s.last_at), publicLayer) : 0;
  return s;
}

/** Tie strength as of now (recency keeps decaying after the last date). */
export function tieNow(s: Summary, now = new Date(), publicLayer = false): number {
  return tieStrength(s, now, publicLayer);
}

/* --------------------------------------- what they learn about each other --------------------------------------- */

/** A line where the speaker tells something about themselves: their life, work, people, likes. Not a question. */
const SELF_DISCLOSURE = new RegExp(
  [
    // Who they are: "I'm a cartographer", "I'm from Leeds" (not "I'm a bit", "I'm going to").
    String.raw`\bi(?:'m| am) (?:an? (?!bit\b|little\b|lot\b|fan of you\b)|from\b|allergic\b|terrified of\b|obsessed with\b)`,
    // Their life: work, history, habits, likes.
    String.raw`\bi(?:'ve| have) (?:been|never|always|got an?|an? )`,
    String.raw`\bi (?:work|worked|used to|grew up|live|lived|love|hate|can't stand|never|always|spend|spent|make|build|paint|teach|run|write|play|named|collect|keep)\b`,
    String.raw`\b(?:every|most) (?:morning|day|night|week|weekend|summer|winter)s?\b`,
    String.raw`\bmy (?:job|work|family|mum|mom|dad|sister|brother|grand\w*|dog|cat|studio|shop|place|flat|apartment|neighbou?r|boss|friend|knee|back|hands|ex|hives?|bees?|bus|route|stall|kitchen|garden|boat|van)\b`,
  ].join("|"),
  "i",
);
const FACT_MAX = 160;

/** The sentences of a line that disclose something about the speaker (long enough to say something, not questions), joined; "" if none. */
function selfSentences(line: string): string {
  return line
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => s.trim().length >= 28 && SELF_DISCLOSURE.test(s) && !/\?["'’”)]*$/.test(s.trim()))
    .join(" ")
    .trim();
}

function factsFrom(transcript: Turn[], end: (side: "a" | "b") => End, episodeId: string): Fact[] {
  const out: Fact[] = [];
  for (const side of ["a", "b"] as const) {
    // A fact is the sentences where they tell something about themselves, never the question that came with them.
    const lines = transcript
      .filter((t) => t.side === side)
      .map((t) => ({ text: selfSentences(t.dialogue), interest: t.interest ?? 0 }))
      .filter((l) => l.text.length >= 20 && l.text.length <= FACT_MAX && checkFields({ line: l.text }).ok)
      .sort((x, y) => y.interest - x.interest)
      .slice(0, 2);
    for (const l of lines) if (!out.some((f) => f.text === l.text)) out.push({ text: l.text, about: end(side), episode_id: episodeId });
  }
  return out;
}

/** Adjacent content-word pairs ("sugar packets"), the shape most inside jokes take. */
function bigrams(text: string): Set<string> {
  const ws = tokens(text);
  const out = new Set<string>();
  for (let i = 0; i + 1 < ws.length; i++) {
    const [x, y] = [ws[i], ws[i + 1]];
    if (contentWords(x, 4).length && contentWords(y, 4).length) out.add(`${x} ${y}`);
  }
  return out;
}

/** "i'll", "don't", "it's": a contraction, never part of a joke. A possessive ("sponge's fault") can be. */
const isContraction = (w: string): boolean =>
  w.includes("'") && (!w.endsWith("'s") || /^(it|that|there|here|what|who|where|let|he|she|how|why|when)'s$/.test(w));

/** Everyday words two people share without it being a joke between them (single-word phrases only). */
const COMMON_WORDS = new Set(
  "because somewhere something anything everything nothing everyone someone anyone minutes another tonight morning already whatever together sometimes usually thought through different perfect without instead between against probably actually exactly anyway further whether outside inside forever weekend evening honest proper course monday tuesday wednesday thursday friday saturday sunday".split(" "),
);

/** Stock two-word phrases anyone says ("next week", "good luck"): never an inside joke on their own. */
const COMMON_PHRASES = new Set(["good luck", "next week", "last week", "next time", "last time", "right now", "last night", "good night", "thank you", "fair enough", "no idea", "good morning", "next weekend", "this weekend"]);

/**
 * Inside jokes: a phrase (two content words, or one long one) BOTH of them said on a date, that comes back later —
 * in that morning's texts or on a later date. Names and the venue's own words never count.
 */
function findJokes(dates: { id: string; transcript: Turn[]; afterglow: AfterglowLine[]; venue: PlaceId | null }[], names: string[]): Joke[] {
  const banned = new Set(names.flatMap((n) => tokens(n)));
  // Not a name, not a contraction ("i'll bring"), and a single word must be a thing, not filler ("checking", "honestly").
  const okPhrase = (p: string) => {
    const ws = p.split(" ");
    if (ws.some((w) => banned.has(w) || isContraction(w))) return false;
    if (ws.length > 1) return !COMMON_PHRASES.has(p);
    return !/(ing|ly|ed)$/.test(p) && !COMMON_WORDS.has(p);
  };
  const found = new Map<string, Set<string>>();
  dates.forEach((d, i) => {
    const venueWords = new Set(contentWords(venueOf(d.venue).prompt, 4));
    const said = (side: "a" | "b") => d.transcript.filter((t) => t.side === side).map((t) => t.dialogue).join(" \n ");
    const [aText, bText] = [said("a"), said("b")];
    const shared = [
      ...[...bigrams(aText)].filter((g) => bigrams(bText).has(g)),
      ...contentWords(aText, 7).filter((w) => contentWords(bText, 7).includes(w)),
    ].filter((p) => okPhrase(p) && !p.split(" ").every((w) => venueWords.has(w)));
    if (!shared.length) return;
    const later = [d.afterglow.map((l) => l.text).join(" "), ...dates.slice(i + 1).map((x) => x.transcript.map((t) => t.dialogue).join(" "))]
      .join(" \n ")
      .toLowerCase();
    for (const p of new Set(shared)) {
      if (!new RegExp(`\\b${escapeRegExp(p)}\\b`).test(later)) continue;
      found.set(p, new Set([...(found.get(p) ?? []), d.id]));
    }
  });
  return [...found.entries()]
    .map(([phrase, ids]) => ({ phrase, episode_ids: [...ids] }))
    // Two-word phrases first (they're the jokes), then the most-repeated, then newest.
    .sort((x, y) => Number(y.phrase.includes(" ")) - Number(x.phrase.includes(" ")) || y.episode_ids.length - x.episode_ids.length)
    .filter((j, i, all) => !all.slice(0, i).some((k) => k.phrase.includes(j.phrase) || j.phrase.includes(k.phrase)))
    .slice(0, JOKES_KEPT);
}

/** A text that makes a plan: a time, a place or a promise for next time. */
const PLAN =
  /\b(let's|lets|let us|next time|meet me|see you|i'll bring|i will bring|i'll show|i'll take|i'll cook|bring the|you bring|pick you up|tomorrow|tonight|this weekend|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|coffee|dinner|lunch|breakfast|brunch|drinks|a walk|works for me|you're on|it's a date|deal)\b/i;
const PLAN_MAX = 200;
/** On a date with no afterglow, how many of its last lines can hold a plan. */
const CLOSING_LINES = 4;

/** Words that mean a plan was kept when a later date mentions them: the plan's own content words. */
const planWords = (text: string) => [...new Set(contentWords(text, 4))].filter((w) => !["bring", "next", "time", "meet", "works", "deal"].includes(w));

/** True when a text reads like a plan (a time, a place, a promise): one sent between dates updates the couple's plans. */
export const textMakesPlan = (text: string): boolean => PLAN.test(text.slice(0, PLAN_MAX));

/**
 * Each side's plan after one date. From the morning after: its most concrete plan-like text, the one with the most to
 * it (a place, a thing to bring), not a bare "Tuesday then." that only confirms it (ties go to the later text). Their
 * texts before the next date come later and settle it (run 5: "Thursday" and "the 12:03 platform" were agreed by text),
 * so a side's latest plan-like text with something to it wins over its morning after.
 */
function plansFrom(morningAfter: AfterglowLine[], textsAfter: RelText[], end: (side: "a" | "b") => End, episodeId: string): Plan[] {
  const score = (t: string) => planWords(t.slice(0, PLAN_MAX)).length + (venueForPlan([{ text: t.slice(0, PLAN_MAX) }]) ? 3 : 0);
  const plannable = (t: string) => textMakesPlan(t) && checkFields({ line: t.slice(0, PLAN_MAX) }).ok;
  const out: Plan[] = [];
  for (const side of ["a", "b"] as const) {
    const by = end(side);
    const texted = textsAfter.filter((t) => t.who === by && plannable(t.text) && score(t.text) > 0).at(-1)?.text;
    const lines = morningAfter.filter((l) => l.side === side && plannable(l.text));
    const text = texted ?? lines.reduce<AfterglowLine | null>((best, l) => (!best || score(l.text) >= score(best.text) ? l : best), null)?.text;
    if (text) out.push({ text: text.slice(0, PLAN_MAX), by, episode_id: episodeId, status: "open", kept_in: null });
  }
  return out;
}

/** Marks each plan kept (a later date picked up its words) or missed (later dates, none did); else open. */
function settlePlans(plans: Plan[], dates: { id: string; transcript: Turn[] }[]): Plan[] {
  return plans.map((p) => {
    const after = dates.slice(dates.findIndex((d) => d.id === p.episode_id) + 1);
    if (!after.length) return p;
    const words = planWords(p.text);
    const need = Math.min(2, words.length);
    const keptIn = after.find((d) => {
      const said = new Set(contentWords(d.transcript.map((t) => t.dialogue).join(" "), 4));
      return need > 0 && words.filter((w) => said.has(w)).length >= need;
    });
    return keptIn ? { ...p, status: "kept", kept_in: keptIn.id } : { ...p, status: "missed" };
  });
}

/**
 * Rebuilds a pair's edge from every stored date between them (any order in; oldest first out). Pure: the same
 * dates (and texts) always give the same edge. `names` (lo, hi) keep the characters' own names out of the inside
 * jokes. `texts` are their texts between dates (couple_texts): a plan they make by text counts for the date before it.
 */
export function computeRelationship(
  lo: string,
  hi: string,
  eps: RelEpisode[],
  names: [string, string] = ["", ""],
  texts: RelText[] = [],
  marks: StageMarks = {},
  env: Env = process.env,
): Relationship {
  const sorted = [...eps].sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime() || x.id.localeCompare(y.id));
  const history: HistoryItem[] = sorted.map((e) => {
    const loIsA = e.character_a === lo;
    const wants = e.sides ? ((loIsA ? [e.sides[0].wants_another, e.sides[1].wants_another] : [e.sides[1].wants_another, e.sides[0].wants_another]) as [boolean, boolean]) : null;
    return {
      episode_id: e.id,
      at: iso(e.created_at)!,
      aired_at: iso(e.revealed_at),
      ending: e.ending,
      venue: e.venue,
      wants,
      chemistry: e.box_score?.chemistry?.final ?? null,
      trust: e.box_score?.trust?.final ?? null,
      public: e.revealed_at !== null && e.visibility === "public" && !e.hidden,
      private: e.visibility === "private",
      creator: e.creator_id,
      ...(e.partner_performer ? { performer: e.partner_performer } : {}),
      followup_of: e.followup_of,
      // #1098: the number the date was written with, any date's (the timeline names it by that); none when unstored.
      ...(e.date_number != null ? { date_number: e.date_number } : {}),
      ...(e.met_via ? { met_via: e.met_via } : {}),
      ...(e.roleplay ? { roleplay: e.roleplay } : {}),
      ...(e.overnight ? { overnight: true as const } : {}),
    };
  });
  const endOf = (e: RelEpisode) => (side: "a" | "b"): End => ((side === "a") === (e.character_a === lo) ? "lo" : "hi");
  const dates = sorted.map((e) => ({ id: e.id, transcript: e.transcript ?? [], afterglow: e.afterglow ?? [], venue: e.venue }));

  // A roleplay's lines are their roles talking (a spy's cover story isn't a thing they told each other), so it gives no facts.
  const facts = sorted.filter((e) => !e.roleplay).flatMap((e) => factsFrom(e.transcript ?? [], endOf(e), e.id));
  // Newest first, at most FACTS_KEPT about each of them.
  const keptFacts = (["lo", "hi"] as const).flatMap((about) => facts.filter((f) => f.about === about).reverse().slice(0, FACTS_KEPT));
  // A date with no afterglow (a self-performed one has none) still makes plans out loud: its closing lines count.
  // Not a roleplay's: its closing lines are still in character (a morning after's texts are their own again).
  const closing = (e: RelEpisode): AfterglowLine[] => (e.roleplay ? [] : (e.transcript ?? []).slice(-CLOSING_LINES).map((t) => ({ side: t.side, text: t.dialogue })));
  // What they texted after each date and before the next one (texts before their first date, a match's chat, aren't after any).
  const ms = (at: string | Date) => new Date(at).getTime();
  const byTime = [...texts].sort((x, y) => ms(x.at) - ms(y.at));
  const textsAfter = (i: number) => byTime.filter((t) => ms(t.at) > ms(sorted[i].created_at) && (i + 1 >= sorted.length || ms(t.at) < ms(sorted[i + 1].created_at)));
  const plans = settlePlans(sorted.flatMap((e, i) => plansFrom(e.afterglow?.length ? e.afterglow : closing(e), textsAfter(i), endOf(e), e.id)), dates)
    .reverse()
    .slice(0, PLANS_KEPT);

  return {
    lo,
    hi,
    all: summarize(history, false, marks, env),
    public: summarize(history.filter((h) => h.public), true, marks, env),
    history: history.slice(-HISTORY_KEPT),
    facts: keptFacts,
    jokes: findJokes(dates, names),
    plans,
    marks,
  };
}

/* ---------------------------------------------------- storage ---------------------------------------------------- */

const REL_EPISODES = `
  select e.id, e.created_at, e.revealed_at, e.visibility, e.creator_id, e.partner_performer, e.character_a, e.character_b, e.ending,
         e.sides, e.box_score, e.transcript, e.afterglow, e.setup->>'venue' as venue, e.followup_of,
         (e.setup->>'date_number')::int as date_number, e.setup->>'met_via' as met_via, e.setup->'roleplay'->>'title' as roleplay,
         (e.setup->>'overnight') = 'true' as overnight,
         (select count(*)::int from reports r where r.episode_id = e.id) >= $3 as hidden
    from episodes e
   where e.status = 'ready' and e.varies_episode_id is null and e.show_id = '${SHOW_ID}'
     and ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))`;

/** A pair's stored stages, as read before a refresh: the base ones, the shown ones, and (only when a shown one is missing) its dates. */
type StoredStages = {
  stage: BaseStage | null;
  public_stage: BaseStage | null;
  shown_stage: Stage | null;
  public_shown_stage: Stage | null;
  history: HistoryItem[] | null;
};
const STORED_STAGES = `select stage, public_stage, shown_stage, public_shown_stage,
         case when shown_stage is null or public_shown_stage is null then detail->'history' end as history
    from relationships where character_a = $1 and character_b = $2`;

/**
 * The stage a stored row shows on one layer. A row from before the shown stage was stored (or refreshed while the
 * switch was off) says what its own dates say, so the first refresh after it logs and announces only what a new date
 * changed, never the new rules themselves.
 */
function shownBefore(row: StoredStages | undefined, layer: "all" | "public", marks: StageMarks, env: Env): Stage | null {
  if (!row) return null;
  const base = layer === "all" ? row.stage : row.public_stage;
  if (!stagesV2On(env)) return base;
  const stored = layer === "all" ? row.shown_stage : row.public_shown_stage;
  if (stored && isStage(stored)) return stored;
  if (!base) return null;
  const items = (row.history ?? []).filter((h) => layer === "all" || h.public);
  return items.length ? shownStageOf(stageDates(items, env), marks, env) : base;
}

/** Where a pair stands in the stored row right now, both readings on both layers (lib/relationship-events.ts reads it before an airing). */
export async function storedStages(
  db: Db,
  x: string,
  y: string,
  env: Env = process.env,
): Promise<{ stage: BaseStage | null; public_stage: BaseStage | null; shown: Stage | null; public_shown: Stage | null }> {
  const [lo, hi] = pairKey(x, y);
  const [row, marks] = await Promise.all([db.query<StoredStages>(STORED_STAGES, [lo, hi]).then((q) => q.rows[0]), loadStageMarks(db, [[lo, hi]], env).then((m) => m.get(`${lo}|${hi}`) ?? {})]);
  return { stage: row?.stage ?? null, public_stage: row?.public_stage ?? null, shown: shownBefore(row, "all", marks, env), public_shown: shownBefore(row, "public", marks, env) };
}

/**
 * What happened to each pair besides their dates (lib/relationship-stages.ts StageMarks), from the public record: a
 * finale's engagement or wedding (relationship_events), and whether their latest confrontation that /house still
 * shows (a model's or a template's scene with lines left) did not clear the air. Keyed "lo|hi". Nothing is read when
 * the switch is off.
 */
export async function loadStageMarks(db: Db, pairs: readonly (readonly [string, string])[], env: Env = process.env): Promise<Map<string, StageMarks>> {
  const out = new Map<string, StageMarks>();
  if (!stagesV2On(env) || !pairs.length) return out;
  const los = pairs.map((p) => p[0]);
  const his = pairs.map((p) => p[1]);
  const feuds = env.HOUSE_SCENES?.trim() !== "0" && env.CONFRONTATIONS?.trim() !== "0";
  const [finale, scenes] = await Promise.all([
    db
      .query<{ lo: string; hi: string; kind: "engaged" | "married"; at: string | Date }>(
        `select character_a as lo, character_b as hi, kind, max(at) as at from relationship_events
          where kind in ('engaged', 'married') and layer = 'public' and (character_a, character_b) in (select * from unnest($1::text[], $2::text[]))
          group by character_a, character_b, kind`,
        [los, his],
      )
      .catch(() => ({ rows: [] })),
    feuds
      ? db
          .query<{ lo: string; hi: string; outcome: string | null }>(
            `select distinct on (lo, hi) lo, hi, outcome from (
               select least(s.result->>'a', s.result->>'b') as lo, greatest(s.result->>'a', s.result->>'b') as hi, s.result->>'outcome' as outcome, s.day, s.created_at
                 from house_scenes s
                where s.kind = 'confrontation' and s.source in ('model', 'template') and jsonb_array_length(s.lines) > 0 and s.result is not null
             ) c
              where (lo, hi) in (select * from unnest($1::text[], $2::text[]))
              order by lo, hi, day desc, created_at desc`,
            [los, his],
          )
          .catch(() => ({ rows: [] }))
      : { rows: [] as { lo: string; hi: string; outcome: string | null }[] },
  ]);
  const at = (key: string) => out.get(key) ?? out.set(key, {}).get(key)!;
  for (const r of finale.rows) at(`${r.lo}|${r.hi}`)[r.kind === "engaged" ? "engaged_at" : "married_at"] = new Date(r.at).toISOString();
  for (const r of scenes.rows) if (r.outcome && r.outcome !== "cleared_the_air") at(`${r.lo}|${r.hi}`).feud = true;
  return out;
}

/**
 * Recomputes and stores one pair's edge from its dates; deletes it when no date between them is left. Idempotent.
 * Call it whenever a date between them is stored, airs, changes visibility or is removed.
 */
export async function refreshRelationship(db: Db, x: string, y: string, env: Env = process.env): Promise<Relationship | null> {
  if (x === y) return null;
  const [lo, hi] = pairKey(x, y);
  const [{ rows }, nameRows, textRows, beforeRows, allMarks] = await Promise.all([
    db.query<RelEpisode>(REL_EPISODES, [lo, hi, REPORT_HIDE_THRESHOLD]),
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[lo, hi]]),
    // Their texts between dates, for the plans: only the start of each (a plan is at most PLAN_MAX characters), newest 2000.
    db.query<{ who: End; text: string; created_at: string | Date }>(
      `select who, left(text, ${PLAN_MAX}) as text, created_at from couple_texts where character_lo = $1 and character_hi = $2 order by created_at desc limit 2000`,
      [lo, hi],
    ),
    // The stages before this refresh, so a change is appended to the pair's timeline (relationship_events).
    db.query<StoredStages>(STORED_STAGES, [lo, hi]),
    loadStageMarks(db, [[lo, hi]], env),
  ]);
  const marks = allMarks.get(`${lo}|${hi}`) ?? {};
  const prior = beforeRows.rows[0];
  const before = { stage: prior?.stage ?? null, public_stage: prior?.public_stage ?? null, shown: shownBefore(prior, "all", marks, env), public_shown: shownBefore(prior, "public", marks, env) };
  if (!rows.length) {
    await db.query(`delete from relationships where character_a = $1 and character_b = $2`, [lo, hi]);
    await logStageEvents(db, lo, hi, before, { stage: null, public_stage: null, shown: null, public_shown: null }, { all: null, public: null }, env);
    await socialDated(db, lo, hi, env);
    return null;
  }
  const name = (id: string) => nameRows.rows.find((r) => r.id === id)?.name ?? "";
  const texts = textRows.rows.map((t) => ({ who: t.who, text: t.text, at: new Date(t.created_at).toISOString() }));
  const rel = computeRelationship(lo, hi, rows, [name(lo), name(hi)], texts, marks, env);
  const a = rel.all;
  const p = rel.public;
  // Off, the shown columns are emptied: nothing reads them, and the hourly backfill fills them again when it is back on.
  const on = stagesV2On(env);
  await db.query(
    `insert into relationships
       (character_a, character_b, dates, second_dates, last_ending, mutual_yes, chemistry, trust, stage, tie_strength, first_at, last_at,
        public_dates, public_second_dates, public_last_ending, public_stage, public_tie, public_last_at, detail, shown_stage, public_shown_stage,
        computed_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, now(), now())
     on conflict (character_a, character_b) do update set
       dates = excluded.dates, second_dates = excluded.second_dates, last_ending = excluded.last_ending,
       mutual_yes = excluded.mutual_yes, chemistry = excluded.chemistry, trust = excluded.trust, stage = excluded.stage,
       tie_strength = excluded.tie_strength, first_at = excluded.first_at, last_at = excluded.last_at,
       public_dates = excluded.public_dates, public_second_dates = excluded.public_second_dates,
       public_last_ending = excluded.public_last_ending, public_stage = excluded.public_stage, public_tie = excluded.public_tie,
       public_last_at = excluded.public_last_at, detail = excluded.detail, shown_stage = excluded.shown_stage,
       public_shown_stage = excluded.public_shown_stage, computed_at = now(), updated_at = now()`,
    [
      lo, hi, a.dates, a.second_dates, a.last_ending, a.mutual_yes, a.chemistry, a.trust, a.stage, a.tie, a.first_at, a.last_at,
      p.dates, p.second_dates, p.last_ending, p.stage, p.tie, p.last_at,
      JSON.stringify({ history: rel.history, facts: rel.facts, jokes: rel.jokes, plans: rel.plans, ...(Object.keys(marks).length ? { marks } : {}) }),
      on ? a.shown : null, on ? p.shown : null,
    ],
  );
  const newest = rel.history[rel.history.length - 1]?.episode_id ?? null;
  const newestPublic = [...rel.history].reverse().find((h) => h.public)?.episode_id ?? null;
  await logStageEvents(db, lo, hi, before, { stage: a.stage, public_stage: p.stage, shown: a.shown, public_shown: p.shown }, { all: newest, public: newestPublic }, env);
  await socialDated(db, lo, hi, env);
  return rel;
}

/**
 * The pair's `dated` tie in the social network (lib/social/derive.ts), from the row just stored: written, changed, or
 * gone with their last public date. Best effort, after the response when there is one.
 */
const socialDated = (db: Db, lo: string, hi: string, env: Env): Promise<void> =>
  socialHook("dated", (d, deadline) => d.deriveDatedPair(db, lo, hi, { deadline, env }), { key: `dated:${lo}|${hi}`, env });

type LayerStages = { stage: BaseStage | null; public_stage: BaseStage | null; shown: Stage | null; public_shown: Stage | null };

/**
 * The pair's timeline (relationship_events): one row per layer whose stage changed in this refresh — first met,
 * became exes, rekindled — so a stage is a history, not just its latest value. A row keeps both readings: the base
 * stage (from_stage, to_stage, as always) and the shown one (from_shown, to_shown; null with the switch off), and is
 * written when either moved, so a reader of either skips the rows where its own didn't. Best effort: a failed append
 * never breaks a refresh. The 'all' layer can reflect private dates, so like the edge's own all-dates columns it's for
 * owners and the engine, never a public page.
 */
async function logStageEvents(db: Db, lo: string, hi: string, before: LayerStages, after: LayerStages, episodes: { all: string | null; public: string | null }, env: Env): Promise<void> {
  const on = stagesV2On(env);
  const layers = [
    { layer: "all", from: before.stage, to: after.stage, fromShown: before.shown, toShown: after.shown, episode: episodes.all },
    { layer: "public", from: before.public_stage, to: after.public_stage, fromShown: before.public_shown, toShown: after.public_shown, episode: episodes.public },
  ] as const;
  for (const c of layers) {
    if (c.from === c.to && (!on || c.fromShown === c.toShown)) continue;
    await db
      .query(`insert into relationship_events (character_a, character_b, layer, from_stage, to_stage, from_shown, to_shown, episode_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
        lo, hi, c.layer, c.from, c.to, on ? c.fromShown : null, on ? c.toShown : null, c.episode,
      ])
      .catch(() => {});
  }
}

/**
 * The stage a relationship_events row moved from and to, as SQL over alias `r`: the shown reading when the switch is
 * on (a row from before it, or written while it was off, has only the base one), else the base one. A reader adds
 * `${from} is distinct from ${to}`: a row where only the other reading moved is not its news.
 */
export const eventStageSql = (alias: string, env: Env = process.env): { from: string; to: string } =>
  stagesV2On(env)
    ? { from: `coalesce(${alias}.from_shown, ${alias}.from_stage)`, to: `coalesce(${alias}.to_shown, ${alias}.to_stage)` }
    : { from: `${alias}.from_stage`, to: `${alias}.to_stage` };

/**
 * The backfill: fills the shown stage of rows that have none (every row when this ships; rows refreshed while the
 * switch was off), from the pairs' own dates under the same rules as a refresh. Stage columns only: no event row, no
 * notice, nothing else of the edge recomputed, and nothing a date or a finale didn't give (an engagement is a finale's
 * row, and there are none to find). Idempotent, `limit` pairs a call; the hourly job calls it until none are left.
 */
export async function backfillShownStages(db: Db, opts: { limit?: number; env?: Env } = {}): Promise<number> {
  const env = opts.env ?? process.env;
  if (!stagesV2On(env)) return 0;
  const { rows: pairs } = await db.query<{ lo: string; hi: string; stage: BaseStage | null; public_stage: BaseStage | null; dates: number; public_dates: number }>(
    `select character_a as lo, character_b as hi, stage, public_stage, dates, public_dates from relationships
      where (stage is not null and shown_stage is null) or (public_stage is not null and public_shown_stage is null)
      order by character_a, character_b limit $1`,
    [opts.limit ?? 2000],
  );
  if (!pairs.length) return 0;
  const los = pairs.map((p) => p.lo);
  const his = pairs.map((p) => p.hi);
  const [eps, marks] = await Promise.all([
    db.query<{ lo: string; hi: string; id: string; created_at: string | Date; revealed_at: string | Date | null; visibility: string; ending: Ending; overnight: boolean | null; hidden: boolean }>(
      `select least(e.character_a, e.character_b) as lo, greatest(e.character_a, e.character_b) as hi, e.id, e.created_at, e.revealed_at, e.visibility, e.ending,
              (e.setup->>'overnight') = 'true' as overnight,
              (select count(*)::int from reports r where r.episode_id = e.id) >= $3 as hidden
         from episodes e
        where e.status = 'ready' and e.varies_episode_id is null and e.ending is not null
          and (least(e.character_a, e.character_b), greatest(e.character_a, e.character_b)) in (select * from unnest($1::text[], $2::text[]))`,
      [los, his, REPORT_HIDE_THRESHOLD],
    ),
    loadStageMarks(db, pairs.map((p) => [p.lo, p.hi] as const), env),
  ]);
  const byPair = new Map<string, typeof eps.rows>();
  for (const e of eps.rows) byPair.set(`${e.lo}|${e.hi}`, [...(byPair.get(`${e.lo}|${e.hi}`) ?? []), e]);
  const shown: (string | null)[] = [];
  const publicShown: (string | null)[] = [];
  for (const p of pairs) {
    const key = `${p.lo}|${p.hi}`;
    const items = (byPair.get(key) ?? [])
      .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime() || x.id.localeCompare(y.id))
      .map((e) => ({ ending: e.ending, at: iso(e.created_at)!, aired_at: iso(e.revealed_at), ...(e.overnight ? { overnight: true as const } : {}), public: e.revealed_at !== null && e.visibility === "public" && !e.hidden }));
    const m = marks.get(key) ?? {};
    // A stale row (its dates are gone, or no longer public, and nothing refreshed it) is read from what it stores: its
    // base stage, and one date that ended badly "didn't click". Never left empty, to be picked up again and again.
    const stale = (stage: BaseStage | null, count: number): Stage | null => (stage === "bad_blood" && count === 1 ? "didnt_click" : stage);
    shown.push(shownStageOf(stageDates(items, env), m, env) ?? stale(p.stage, p.dates));
    publicShown.push(shownStageOf(stageDates(items.filter((i) => i.public), env), m, env) ?? stale(p.public_stage, p.public_dates));
  }
  await db.query(
    `update relationships r set shown_stage = coalesce(r.shown_stage, v.shown), public_shown_stage = coalesce(r.public_shown_stage, v.public_shown)
       from (select * from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as t(lo, hi, shown, public_shown)) v
      where r.character_a = v.lo and r.character_b = v.hi`,
    [los, his, shown, publicShown],
  );
  return pairs.length;
}

/** Refreshes the edge of the pair in one date (after it airs, changes visibility, or is reported or moderated). */
export async function refreshEpisodePair(db: Db, episodeId: string): Promise<void> {
  const r = (await db.query<{ character_a: string; character_b: string }>(`select character_a, character_b from episodes where id = $1`, [episodeId])).rows[0];
  if (r) await refreshRelationship(db, r.character_a, r.character_b);
  // The social network: the date's venue and its group night count only while it is public (lib/social/derive.ts).
  if (r) await socialHook("date", (d, deadline) => d.onDate(db, episodeId, { deadline }), { key: `date:${episodeId}` });
}

type RelRow = {
  character_a: string;
  character_b: string;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  mutual_yes: number;
  chemistry: number | null;
  trust: number | null;
  stage: BaseStage | null;
  tie_strength: number;
  first_at: Date | string | null;
  last_at: Date | string | null;
  public_dates: number;
  public_second_dates: number;
  public_last_ending: Ending | null;
  public_stage: BaseStage | null;
  public_tie: number;
  public_last_at: Date | string | null;
  detail: { history: HistoryItem[]; facts: Fact[]; jokes: Joke[]; plans: Plan[]; marks?: StageMarks } | null;
  computed_at: Date | string | null;
  shown_stage: Stage | null;
  public_shown_stage: Stage | null;
};

function fromRow(r: RelRow, env: Env = process.env): Relationship {
  const d = r.detail ?? { history: [], facts: [], jokes: [], plans: [] };
  const marks = d.marks ?? {};
  // The stored shown stage, or (a row the backfill hasn't reached) what its own dates say.
  const shown = (layer: "all" | "public") =>
    shownBefore({ stage: r.stage, public_stage: r.public_stage, shown_stage: r.shown_stage, public_shown_stage: r.public_shown_stage, history: d.history }, layer, marks, env);
  return {
    lo: r.character_a,
    hi: r.character_b,
    all: {
      dates: r.dates, second_dates: r.second_dates, mutual_yes: r.mutual_yes, last_ending: r.last_ending,
      first_at: iso(r.first_at), last_at: iso(r.last_at), chemistry: r.chemistry, trust: r.trust, stage: r.stage, shown: shown("all"), tie: r.tie_strength,
    },
    public: {
      dates: r.public_dates, second_dates: r.public_second_dates, mutual_yes: 0, last_ending: r.public_last_ending,
      first_at: d.history.find((h) => h.public)?.at ?? null, last_at: iso(r.public_last_at), chemistry: summarize(d.history.filter((h) => h.public), true).chemistry,
      trust: summarize(d.history.filter((h) => h.public), true).trust, stage: r.public_stage, shown: shown("public"), tie: r.public_tie,
    },
    history: d.history,
    facts: d.facts,
    jokes: d.jokes,
    plans: d.plans,
    marks,
  };
}

const REL_COLUMNS = `character_a, character_b, dates, second_dates, last_ending, mutual_yes, chemistry, trust, stage, tie_strength, first_at,
  last_at, public_dates, public_second_dates, public_last_ending, public_stage, public_tie, public_last_at, detail, computed_at,
  shown_stage, public_shown_stage`;

/**
 * SQL: the stored edge in `r` still counts a date as public that no longer is (made private, not aired, or gone),
 * because whatever changed the date never refreshed the edge (2026-11-21: dates made private by hand stayed on public
 * boards, with their stage and date count). Read beside the edge, so a reader refreshes it before anyone sees it
 * (loadRelationship, relationshipsOf), and the hourly job sweeps the rest (healStaleRelationships).
 */
const stalePublicSql = (r: string) => `(${r}.public_dates > 0 and exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(${r}.detail->'history') = 'array' then ${r}.detail->'history' else '[]'::jsonb end) sh
      left join episodes se on se.id = sh->>'episode_id'
     where (sh->>'public')::boolean and (se.id is null or se.visibility <> 'public' or se.revealed_at is null)))`;

/** Stale edges one relationshipsOf read refreshes, one at a time; any more are left out of what it returns until the sweep. */
const STALE_REFRESHED_PER_READ = 3;

/** One pair's edge, or null when they've never dated. Rows from before the graph was derived heal on first read, as does a stale one (stalePublicSql). */
export async function loadRelationship(db: Db, x: string, y: string): Promise<Relationship | null> {
  const [lo, hi] = pairKey(x, y);
  const r = (
    await db.query<RelRow & { stale: boolean }>(`select ${REL_COLUMNS}, ${stalePublicSql("r")} as stale from relationships r where character_a = $1 and character_b = $2`, [lo, hi])
  ).rows[0];
  if (!r) return null;
  if (!r.computed_at || r.stale) return refreshRelationship(db, lo, hi);
  return fromRow(r);
}

/**
 * The hourly sweep (app/api/jobs/lobby): refreshes up to `limit` stale edges (stalePublicSql) that nobody has read since,
 * so the Constellation, the boards and the sitemap's couples let go of a date made private by hand. How many it refreshed.
 */
export async function healStaleRelationships(db: Db, limit = 50): Promise<number> {
  const { rows } = await db.query<{ character_a: string; character_b: string }>(
    `select r.character_a, r.character_b from relationships r where ${stalePublicSql("r")} limit $1`,
    [limit],
  );
  let healed = 0;
  for (const r of rows) if (await refreshRelationship(db, r.character_a, r.character_b).then(() => true, () => false)) healed++;
  return healed;
}

/** Heals up to `limit` edges stored before they were derived (no detail yet). Cheap to call on a listing or a cron. */
export async function healRelationships(db: Db, limit = 25): Promise<number> {
  const { rows } = await db.query<{ character_a: string; character_b: string }>(
    `select character_a, character_b from relationships where computed_at is null limit $1`,
    [limit],
  );
  for (const r of rows) await refreshRelationship(db, r.character_a, r.character_b).catch(() => null);
  return rows.length;
}

/**
 * Every edge of one character, strongest tie first. A stale one (stalePublicSql) is refreshed before it's returned, one
 * at a time and a few a read, so a page never shows a date that went private; past that many, it's left out for now.
 */
export async function relationshipsOf(db: Db, characterId: string): Promise<Relationship[]> {
  await healRelationships(db, 10);
  const { rows } = await db.query<RelRow & { stale: boolean }>(
    `select ${REL_COLUMNS}, ${stalePublicSql("r")} as stale from relationships r where $1 in (character_a, character_b) order by tie_strength desc, last_at desc nulls last`,
    [characterId],
  );
  const out: Relationship[] = [];
  let refreshed = 0;
  for (const r of rows) {
    if (!r.stale) out.push(fromRow(r));
    else if (refreshed++ < STALE_REFRESHED_PER_READ) {
      const rel = await refreshRelationship(db, r.character_a, r.character_b).catch(() => null);
      if (rel) out.push(rel);
    }
  }
  return out;
}

/**
 * Stored pairs as they are, never refreshed or healed: `rest` is the statement after `from relationships` (a where, an
 * order, a limit). The social network's derivations read the graph this way (lib/social/derive.ts).
 */
export async function storedRelationships(db: Db, rest: string, params: readonly unknown[] = [], env: Env = process.env): Promise<Relationship[]> {
  const { rows } = await db.query<RelRow>(`select ${REL_COLUMNS} from relationships ${rest}`, [...params]);
  return rows.map((r) => fromRow(r, env));
}

/* ----------------------------------------------------- layers ----------------------------------------------------- */

/** The creator id for a date nobody owns (a house room): only the public record is usable. */
export const PUBLIC_ONLY = "";

/** Who's looking: an owner of either character (and which user), or anyone else. */
export type Viewer = { userId: string | null; owner: boolean };

/**
 * The dates a viewer may see: public ones for everyone. An owner of either character also sees the pair's unaired and
 * unlisted dates whoever booked them, so they never wait for the other owner to air one, and their own private dates.
 * Another owner's private date stays that owner's alone, unless it was a two-agent date they performed too (`performer`).
 * Prompts stay stricter: `usableFor` only lets a date's creator (or its other performer) bring in their own unaired dates.
 */
export const visibleTo = (h: Pick<HistoryItem, "public" | "private" | "creator" | "performer">, v: Viewer): boolean =>
  h.public || (v.owner && v.userId !== null && (h.creator === v.userId || h.performer === v.userId || h.private === false));

/** The dates a character may bring into a new date set up by `creatorId`: the public record plus that creator's own. */
export const usableFor = (h: Pick<HistoryItem, "public" | "creator" | "performer">, creatorId: string): boolean =>
  h.public || h.creator === creatorId || (h.performer !== undefined && h.performer === creatorId);

export type RelationshipView = {
  /** The stage as it is shown (lib/relationship-stages.ts): one of the base seven with RELATIONSHIP_STAGES_V2=0. A rule reads the endings, never this. */
  stage: Stage | null;
  stage_label: string | null;
  /** One line on what made it so ("Six dates in a row have ended in another: they're official."); null with the switch off. */
  stage_line: string | null;
  dates: number;
  /** Dates that ended in a second date (the engine's ending). */
  second_dates: number;
  /** Follow-up dates that took place (#520: one first date plus its second date is 1, not 2). */
  second_dates_had: number;
  first_at: string | null;
  last_at: string | null;
  tie: number;
  chemistry: number | null;
  trust: number | null;
  timeline: { episode_id: string; at: string; ending: Ending; ending_label: string; led_to?: string; venue: string; aired: boolean; second_date_of: string | null; date_number: number | null; roleplay: string | null; became?: string }[];
  jokes: string[];
  /** What each has told the other, by character id. */
  told: Record<string, string[]>;
  /** Owners only: their plans from the morning-after texts, and whether they've kept them. */
  plans?: { text: string; by: string; status: Plan["status"]; episode_id: string }[];
  /** Owners only: dates after which both wanted another. */
  mutual_yes?: number;
};

/**
 * A date's ending as the couple's timeline tells it. The ending is the date's own verdict, but whether they meet again
 * is the morning after's (both wanted another): a "just friends" date that led to another date was friends *for now*,
 * and a later date that ended wanting more names the date after it: "Date 3 → A fourth date", not a second one.
 * `dateNumber` is the date's place in the timeline the viewer sees (its "Date N"); a follow-up without one is "another date".
 */
export function timelineLabel(h: Pick<HistoryItem, "ending">, ledToAnother: boolean, isFollowUp: boolean, dateNumber?: number | null): string {
  if (h.ending === "friends" && ledToAnother) return "Friends, for now";
  if (h.ending === "second_date" && dateNumber && dateNumber > 1) return endingLabel(h.ending, dateNumber);
  if (h.ending === "second_date" && isFollowUp) return "Another date";
  return ENDING_LABELS[h.ending];
}

/**
 * #1254 (three agents read "Date 2: A third date" as an off-by-one): a happy ending's label names the date it led to,
 * so beside "Date N" it reads as that outcome: "a third date" (null for an ending that isn't one more date).
 */
export function ledTo(label: string): string | null {
  return /\bdate$/i.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : null;
}

/** A timeline label as the outcome beside "Date N": "wants a third date", or the label itself ("Just friends"). */
export const outcomeText = (label: string): string => {
  const next = ledTo(label);
  return next ? `wants ${next}` : label;
};

/** Stages a date's own ending already says: the timeline adds no word for them. */
const QUIET_STEPS: ReadonlySet<Stage> = new Set(["just_met", "sparks", "friends"]);

/**
 * The shown stage of what a viewer sees of an edge, counting only dates that have aired (an owner's view also counts
 * unaired ones: get_relationships says which is which).
 */
export function airedStage(rel: Relationship, v: Viewer, env: Env = process.env): Stage | null {
  return shownStageOf(stageDates(rel.history.filter((h) => visibleTo(h, v) && h.aired_at !== null), env), rel.marks, env);
}

/** What a viewer sees of an edge. Spectators get the public layer only; an owner gets all the pair's dates and the plans. */
export function viewRelationship(rel: Relationship, v: Viewer, now = new Date(), env: Env = process.env): RelationshipView | null {
  const seen = rel.history.filter((h) => visibleTo(h, v));
  if (!seen.length) return null;
  const ids = new Set(seen.map((h) => h.episode_id));
  const publicOnly = !v.owner;
  const s = summarize(seen, publicOnly, rel.marks, env);
  // The stage after each date the viewer sees, so a date that changed where they stand says so ("Going steady").
  const steps = stagesV2On(env) ? stageSteps(stageDates(seen, env), rel.marks).steps : null;
  const idOf = (end: End) => (end === "lo" ? rel.lo : rel.hi);
  const told: Record<string, string[]> = { [rel.lo]: [], [rel.hi]: [] };
  for (const f of rel.facts.filter((f) => ids.has(f.episode_id))) told[idOf(f.about)].push(f.text);
  const ledOn = new Set(seen.flatMap((h) => (h.followup_of && ids.has(h.followup_of) ? [h.followup_of] : [])));
  const numbers = new Map<string, number>();
  return {
    stage: s.shown,
    stage_label: s.shown ? STAGE_LABELS[s.shown] : null,
    stage_line: steps && s.shown ? STAGE_LINES[s.shown] : null,
    dates: s.dates,
    second_dates: s.second_dates,
    second_dates_had: seen.filter((h) => h.followup_of && (ids.has(h.followup_of) || (h.date_number ?? 2) > 1)).length,
    first_at: s.first_at,
    last_at: s.last_at,
    tie: tieNow(s, now, publicOnly),
    chemistry: s.chemistry,
    trust: s.trust,
    // The couple page lists these as "Date 1", "Date 2"...: a happy ending on Date 3 reads "A fourth date". #1098 (the
    // 2026-10-31-1329 run: the recap said "A second date", get_relationships "A third date"): an owner sees unlisted and
    // private dates too, so their position isn't the number the date was written with (lib/date-number.ts counts public
    // dates). The date's own stored number names it wherever it's read.
    timeline: seen.map((h, i) => {
      // Without a stored one (older dates), counted as lib/date-number.ts does: a follow-up is its date's plus one, any
      // other 1 + the earlier public dates.
      const n = h.date_number ?? (h.followup_of && numbers.has(h.followup_of) ? numbers.get(h.followup_of)! + 1 : 1 + seen.slice(0, i).filter((x) => x.public).length);
      numbers.set(h.episode_id, n);
      const label = timelineLabel(h, ledOn.has(h.episode_id), Boolean(h.followup_of && ids.has(h.followup_of)), n);
      const next = ledTo(label);
      return {
        episode_id: h.episode_id,
        at: h.aired_at ?? h.at,
        ending: h.ending,
        ending_label: label,
        ...(next ? { led_to: next } : {}),
        venue: venueOf(h.venue).name,
        aired: h.aired_at !== null,
        second_date_of: h.followup_of && ids.has(h.followup_of) ? h.followup_of : null,
        date_number: n > 1 ? n : null,
        // The roleplay it played (its title): billing, like the venue, on the date's own page from the start.
        roleplay: h.roleplay ?? null,
        // Where this date left them, when it moved them somewhere worth a word (a first date, sparks and friends say it in their ending).
        ...(steps && i > 0 && steps[i] !== steps[i - 1] && !QUIET_STEPS.has(steps[i]) ? { became: stageName(steps[i]) } : {}),
      };
    }),
    jokes: rel.jokes.filter((j) => j.episode_ids.some((id) => ids.has(id))).map((j) => j.phrase),
    told,
    ...(v.owner
      ? {
          plans: rel.plans.filter((p) => ids.has(p.episode_id)).map((p) => ({ text: p.text, by: idOf(p.by), status: p.status, episode_id: p.episode_id })),
          mutual_yes: s.mutual_yes,
        }
      : {}),
  };
}

/* ----------------------------------------------- into the next date ----------------------------------------------- */

/** The engine's view of the pair: every date between them (the engine is internal; no text leaves it). */
export function engineHistory(rel: Relationship | null): DateHistory | undefined {
  if (!rel || !rel.all.dates) return undefined;
  return {
    dates: rel.all.dates,
    last_ending: rel.all.last_ending,
    ...(rel.all.chemistry !== null ? { chemistry: rel.all.chemistry } : {}),
    ...(rel.all.trust !== null ? { trust: rel.all.trust } : {}),
  };
}

const FEELING = (chemistry: number | null): string | null =>
  chemistry === null ? null : chemistry >= 65 ? "It's been warm between you, and getting warmer." : chemistry >= 45 ? "It's been easy between you, if not electric." : "It's been bumpy between you.";

/**
 * What one character brings about the other into a date set up by `creatorId` (its own side only): where they
 * stand, what the other has told it, their inside jokes, and the plan they made, when tonight is that plan.
 */
export function pairContext(rel: Relationship | null, selfId: string, creatorId: string, followupOf: string | null): Record<string, unknown> | null {
  if (!rel) return null;
  const usable = rel.history.filter((h) => usableFor(h, creatorId));
  if (!usable.length) return null;
  const ids = new Set(usable.map((h) => h.episode_id));
  const me: End = selfId === rel.lo ? "lo" : "hi";
  const s = summarize(usable, false, rel.marks);
  const told = rel.facts.filter((f) => f.about !== me && ids.has(f.episode_id)).map((f) => f.text).slice(0, 4);
  const jokes = rel.jokes.filter((j) => j.episode_ids.some((id) => ids.has(id))).map((j) => j.phrase);
  const plan = followupOf && ids.has(followupOf) ? rel.plans.filter((p) => p.episode_id === followupOf) : [];
  const feeling = FEELING(s.chemistry);
  const played = [...new Set(usable.flatMap((h) => (h.roleplay ? [h.roleplay] : [])))].slice(-4);
  return {
    // The shown stage in plain words ("Keeping it casual", "Official"): the public record's own, PG, and never the engine's input.
    ...(s.shown ? { where_you_stand_now: stageName(s.shown) } : {}),
    times_together: s.dates,
    ...(feeling ? { how_its_been: feeling } : {}),
    ...(told.length ? { things_they_have_told_you: told } : {}),
    ...(jokes.length ? { your_inside_jokes: jokes } : {}),
    ...(plan.length ? { tonight_is_the_plan_you_made: plan.map((p) => `${p.by === me ? "You" : "They"}: “${p.text}”`) } : {}),
    // Games they played together, remembered as games: a nod to one is fine, but who they really are is the rest of this.
    ...(played.length ? { roleplays_you_have_played: played } : {}),
  };
}

/** Words both of them already know (their facts, jokes and plans): never "profile reading" when said on a date. */
export function pairSharedWords(rel: Relationship | null, creatorId: string): string {
  if (!rel) return "";
  const ids = new Set(rel.history.filter((h) => usableFor(h, creatorId)).map((h) => h.episode_id));
  return [
    ...rel.facts.filter((f) => ids.has(f.episode_id)).map((f) => f.text),
    ...rel.jokes.filter((j) => j.episode_ids.some((id) => ids.has(id))).map((j) => j.phrase),
    ...rel.plans.filter((p) => ids.has(p.episode_id)).map((p) => p.text),
  ].join(" ");
}

/** Where a plan points, when it names a kind of place we have: "coffee" → the corner café. Else null (lib/places.ts). */
export function venueForPlan(plans: { text: string }[]): VenueId | null {
  return venueFor(plans.map((p) => p.text).join(" "));
}
