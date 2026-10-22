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
import type { DateHistory, SideOutcome, VariableArc } from "./engine";
import type { Turn } from "./conversation";
import type { AfterglowLine } from "./afterglow";
import { contentWords, tokens } from "./quality";
import { ENDING_LABELS, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { checkFields } from "./safety";
import { venueFor } from "./places";
import { venue as venueOf, type PlaceId, type VenueId } from "./venues";

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
};

/** Something one of them said about themselves on a date. `about` is the end that said it. */
export type Fact = { text: string; about: End; episode_id: string };
/** A phrase both of them used and came back to: in their texts the morning after, or on a later date. */
export type Joke = { phrase: string; episode_ids: string[] };
/** A plan made after a date (its morning-after texts, or their texts before the next one), and whether a later date kept it. */
export type Plan = { text: string; by: End; episode_id: string; status: "open" | "kept" | "missed"; kept_in: string | null };
/** A text between dates (couple_texts), as the graph reads it: which end sent it, and when. */
export type RelText = { who: End; text: string; at: string };

export type Stage = "just_met" | "sparks" | "dating" | "going_steady" | "friends" | "exes" | "bad_blood";
export const STAGE_LABELS: Record<Stage, string> = {
  just_met: "👋 Just met",
  sparks: "✨ Sparks",
  dating: "💞 Dating",
  going_steady: "💍 Going steady",
  friends: "🤝 Friends",
  exes: "💔 Exes",
  bad_blood: "🔥 Bad blood",
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
  stage: Stage | null;
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
 * Where a pair stands, from its endings (oldest first). Second dates in a row climb sparks → dating → going steady;
 * a friendly ending is friends; a disaster after something real is exes, and before it bad blood.
 */
export function stageOf(endings: Ending[]): Stage | null {
  if (!endings.length) return null;
  const last = endings[endings.length - 1];
  let streak = 0;
  for (let i = endings.length - 1; i >= 0 && endings[i] === "second_date"; i--) streak++;
  if (last === "second_date") return streak >= 4 ? "going_steady" : streak >= 2 ? "dating" : "sparks";
  if (last === "friends") return endings.length === 1 ? "just_met" : "friends";
  return endings.includes("second_date") ? "exes" : "bad_blood";
}

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

/** The summary of one layer of a pair's history (oldest first). */
export function summarize(items: HistoryItem[], publicLayer: boolean): Summary {
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
      if (!new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(later)) continue;
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
export function computeRelationship(lo: string, hi: string, eps: RelEpisode[], names: [string, string] = ["", ""], texts: RelText[] = []): Relationship {
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
      ...(e.followup_of ? { date_number: e.date_number ?? 2 } : {}),
    };
  });
  const endOf = (e: RelEpisode) => (side: "a" | "b"): End => ((side === "a") === (e.character_a === lo) ? "lo" : "hi");
  const dates = sorted.map((e) => ({ id: e.id, transcript: e.transcript ?? [], afterglow: e.afterglow ?? [], venue: e.venue }));

  const facts = sorted.flatMap((e) => factsFrom(e.transcript ?? [], endOf(e), e.id));
  // Newest first, at most FACTS_KEPT about each of them.
  const keptFacts = (["lo", "hi"] as const).flatMap((about) => facts.filter((f) => f.about === about).reverse().slice(0, FACTS_KEPT));
  // A date with no afterglow (a self-performed one has none) still makes plans out loud: its closing lines count.
  const closing = (e: RelEpisode): AfterglowLine[] => (e.transcript ?? []).slice(-CLOSING_LINES).map((t) => ({ side: t.side, text: t.dialogue }));
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
    all: summarize(history, false),
    public: summarize(history.filter((h) => h.public), true),
    history: history.slice(-HISTORY_KEPT),
    facts: keptFacts,
    jokes: findJokes(dates, names),
    plans,
  };
}

/* ---------------------------------------------------- storage ---------------------------------------------------- */

const REL_EPISODES = `
  select e.id, e.created_at, e.revealed_at, e.visibility, e.creator_id, e.partner_performer, e.character_a, e.character_b, e.ending,
         e.sides, e.box_score, e.transcript, e.afterglow, e.setup->>'venue' as venue, e.followup_of,
         (e.setup->>'date_number')::int as date_number,
         (select count(*)::int from reports r where r.episode_id = e.id) >= $3 as hidden
    from episodes e
   where e.status = 'ready' and e.varies_episode_id is null
     and ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))`;

/**
 * Recomputes and stores one pair's edge from its dates; deletes it when no date between them is left. Idempotent.
 * Call it whenever a date between them is stored, airs, changes visibility or is removed.
 */
export async function refreshRelationship(db: Db, x: string, y: string): Promise<Relationship | null> {
  if (x === y) return null;
  const [lo, hi] = pairKey(x, y);
  const [{ rows }, nameRows, textRows, beforeRows] = await Promise.all([
    db.query<RelEpisode>(REL_EPISODES, [lo, hi, REPORT_HIDE_THRESHOLD]),
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[lo, hi]]),
    // Their texts between dates, for the plans: only the start of each (a plan is at most PLAN_MAX characters), newest 2000.
    db.query<{ who: End; text: string; created_at: string | Date }>(
      `select who, left(text, ${PLAN_MAX}) as text, created_at from couple_texts where character_lo = $1 and character_hi = $2 order by created_at desc limit 2000`,
      [lo, hi],
    ),
    // The stages before this refresh, so a change is appended to the pair's timeline (relationship_events).
    db.query<{ stage: Stage | null; public_stage: Stage | null }>(`select stage, public_stage from relationships where character_a = $1 and character_b = $2`, [lo, hi]),
  ]);
  const before = beforeRows.rows[0] ?? { stage: null, public_stage: null };
  if (!rows.length) {
    await db.query(`delete from relationships where character_a = $1 and character_b = $2`, [lo, hi]);
    await logStageEvents(db, lo, hi, before, { stage: null, public_stage: null }, { all: null, public: null });
    return null;
  }
  const name = (id: string) => nameRows.rows.find((r) => r.id === id)?.name ?? "";
  const texts = textRows.rows.map((t) => ({ who: t.who, text: t.text, at: new Date(t.created_at).toISOString() }));
  const rel = computeRelationship(lo, hi, rows, [name(lo), name(hi)], texts);
  const a = rel.all;
  const p = rel.public;
  await db.query(
    `insert into relationships
       (character_a, character_b, dates, second_dates, last_ending, mutual_yes, chemistry, trust, stage, tie_strength, first_at, last_at,
        public_dates, public_second_dates, public_last_ending, public_stage, public_tie, public_last_at, detail, computed_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, now(), now())
     on conflict (character_a, character_b) do update set
       dates = excluded.dates, second_dates = excluded.second_dates, last_ending = excluded.last_ending,
       mutual_yes = excluded.mutual_yes, chemistry = excluded.chemistry, trust = excluded.trust, stage = excluded.stage,
       tie_strength = excluded.tie_strength, first_at = excluded.first_at, last_at = excluded.last_at,
       public_dates = excluded.public_dates, public_second_dates = excluded.public_second_dates,
       public_last_ending = excluded.public_last_ending, public_stage = excluded.public_stage, public_tie = excluded.public_tie,
       public_last_at = excluded.public_last_at, detail = excluded.detail, computed_at = now(), updated_at = now()`,
    [
      lo, hi, a.dates, a.second_dates, a.last_ending, a.mutual_yes, a.chemistry, a.trust, a.stage, a.tie, a.first_at, a.last_at,
      p.dates, p.second_dates, p.last_ending, p.stage, p.tie, p.last_at,
      JSON.stringify({ history: rel.history, facts: rel.facts, jokes: rel.jokes, plans: rel.plans }),
    ],
  );
  const newest = rel.history[rel.history.length - 1]?.episode_id ?? null;
  const newestPublic = [...rel.history].reverse().find((h) => h.public)?.episode_id ?? null;
  await logStageEvents(db, lo, hi, before, { stage: a.stage, public_stage: p.stage }, { all: newest, public: newestPublic });
  return rel;
}

/**
 * The pair's timeline (relationship_events): one row per layer whose stage changed in this refresh — first met,
 * became exes, rekindled — so a stage is a history, not just its latest value. Best effort: a failed append never
 * breaks a refresh. The 'all' layer can reflect private dates, so like the edge's own all-dates columns it's for owners
 * and the engine, never a public page.
 */
async function logStageEvents(
  db: Db,
  lo: string,
  hi: string,
  before: { stage: Stage | null; public_stage: Stage | null },
  after: { stage: Stage | null; public_stage: Stage | null },
  episodes: { all: string | null; public: string | null },
): Promise<void> {
  const changes: [layer: "all" | "public", from: Stage | null, to: Stage | null, episode: string | null][] = [];
  if (before.stage !== after.stage) changes.push(["all", before.stage, after.stage, episodes.all]);
  if (before.public_stage !== after.public_stage) changes.push(["public", before.public_stage, after.public_stage, episodes.public]);
  for (const [layer, from, to, episode] of changes) {
    await db
      .query(`insert into relationship_events (character_a, character_b, layer, from_stage, to_stage, episode_id) values ($1, $2, $3, $4, $5, $6)`, [lo, hi, layer, from, to, episode])
      .catch(() => {});
  }
}

/** Refreshes the edge of the pair in one date (after it airs, changes visibility, or is reported or moderated). */
export async function refreshEpisodePair(db: Db, episodeId: string): Promise<void> {
  const r = (await db.query<{ character_a: string; character_b: string }>(`select character_a, character_b from episodes where id = $1`, [episodeId])).rows[0];
  if (r) await refreshRelationship(db, r.character_a, r.character_b);
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
  stage: Stage | null;
  tie_strength: number;
  first_at: Date | string | null;
  last_at: Date | string | null;
  public_dates: number;
  public_second_dates: number;
  public_last_ending: Ending | null;
  public_stage: Stage | null;
  public_tie: number;
  public_last_at: Date | string | null;
  detail: { history: HistoryItem[]; facts: Fact[]; jokes: Joke[]; plans: Plan[] } | null;
  computed_at: Date | string | null;
};

function fromRow(r: RelRow): Relationship {
  const d = r.detail ?? { history: [], facts: [], jokes: [], plans: [] };
  return {
    lo: r.character_a,
    hi: r.character_b,
    all: {
      dates: r.dates, second_dates: r.second_dates, mutual_yes: r.mutual_yes, last_ending: r.last_ending,
      first_at: iso(r.first_at), last_at: iso(r.last_at), chemistry: r.chemistry, trust: r.trust, stage: r.stage, tie: r.tie_strength,
    },
    public: {
      dates: r.public_dates, second_dates: r.public_second_dates, mutual_yes: 0, last_ending: r.public_last_ending,
      first_at: d.history.find((h) => h.public)?.at ?? null, last_at: iso(r.public_last_at), chemistry: summarize(d.history.filter((h) => h.public), true).chemistry,
      trust: summarize(d.history.filter((h) => h.public), true).trust, stage: r.public_stage, tie: r.public_tie,
    },
    history: d.history,
    facts: d.facts,
    jokes: d.jokes,
    plans: d.plans,
  };
}

const REL_COLUMNS = `character_a, character_b, dates, second_dates, last_ending, mutual_yes, chemistry, trust, stage, tie_strength, first_at,
  last_at, public_dates, public_second_dates, public_last_ending, public_stage, public_tie, public_last_at, detail, computed_at`;

/** One pair's edge, or null when they've never dated. Rows from before the graph was derived heal on first read. */
export async function loadRelationship(db: Db, x: string, y: string): Promise<Relationship | null> {
  const [lo, hi] = pairKey(x, y);
  const r = (await db.query<RelRow>(`select ${REL_COLUMNS} from relationships where character_a = $1 and character_b = $2`, [lo, hi])).rows[0];
  if (!r) return null;
  if (!r.computed_at) return refreshRelationship(db, lo, hi);
  return fromRow(r);
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

/** Every edge of one character, strongest tie first. */
export async function relationshipsOf(db: Db, characterId: string): Promise<Relationship[]> {
  await healRelationships(db, 10);
  const { rows } = await db.query<RelRow>(
    `select ${REL_COLUMNS} from relationships where $1 in (character_a, character_b) order by tie_strength desc, last_at desc nulls last`,
    [characterId],
  );
  return rows.map(fromRow);
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
  stage: Stage | null;
  stage_label: string | null;
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
  timeline: { episode_id: string; at: string; ending: Ending; ending_label: string; venue: string; aired: boolean; second_date_of: string | null; date_number: number | null }[];
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
 * and a follow-up date that ended wanting more is "another date", not a second one.
 */
export function timelineLabel(h: Pick<HistoryItem, "ending">, ledToAnother: boolean, isFollowUp: boolean): string {
  if (h.ending === "friends" && ledToAnother) return "Friends, for now";
  if (h.ending === "second_date" && isFollowUp) return "Another date";
  return ENDING_LABELS[h.ending];
}

/** What a viewer sees of an edge. Spectators get the public layer only; an owner gets all the pair's dates and the plans. */
export function viewRelationship(rel: Relationship, v: Viewer, now = new Date()): RelationshipView | null {
  const seen = rel.history.filter((h) => visibleTo(h, v));
  if (!seen.length) return null;
  const ids = new Set(seen.map((h) => h.episode_id));
  const publicOnly = !v.owner;
  const s = summarize(seen, publicOnly);
  const idOf = (end: End) => (end === "lo" ? rel.lo : rel.hi);
  const told: Record<string, string[]> = { [rel.lo]: [], [rel.hi]: [] };
  for (const f of rel.facts.filter((f) => ids.has(f.episode_id))) told[idOf(f.about)].push(f.text);
  const ledOn = new Set(seen.flatMap((h) => (h.followup_of && ids.has(h.followup_of) ? [h.followup_of] : [])));
  return {
    stage: s.stage,
    stage_label: s.stage ? STAGE_LABELS[s.stage] : null,
    dates: s.dates,
    second_dates: s.second_dates,
    second_dates_had: seen.filter((h) => (h.followup_of && ids.has(h.followup_of)) || (h.date_number ?? 1) > 1).length,
    first_at: s.first_at,
    last_at: s.last_at,
    tie: tieNow(s, now, publicOnly),
    chemistry: s.chemistry,
    trust: s.trust,
    timeline: seen.map((h) => ({
      episode_id: h.episode_id,
      at: h.aired_at ?? h.at,
      ending: h.ending,
      ending_label: timelineLabel(h, ledOn.has(h.episode_id), Boolean(h.followup_of && ids.has(h.followup_of))),
      venue: venueOf(h.venue).name,
      aired: h.aired_at !== null,
      second_date_of: h.followup_of && ids.has(h.followup_of) ? h.followup_of : null,
      date_number: h.followup_of && ids.has(h.followup_of) ? (h.date_number ?? 2) : null,
    })),
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
  const s = summarize(usable, false);
  const told = rel.facts.filter((f) => f.about !== me && ids.has(f.episode_id)).map((f) => f.text).slice(0, 4);
  const jokes = rel.jokes.filter((j) => j.episode_ids.some((id) => ids.has(id))).map((j) => j.phrase);
  const plan = followupOf && ids.has(followupOf) ? rel.plans.filter((p) => p.episode_id === followupOf) : [];
  const feeling = FEELING(s.chemistry);
  return {
    ...(s.stage ? { where_you_stand_now: STAGE_LABELS[s.stage].replace(/^\S+\s/, "") } : {}),
    times_together: s.dates,
    ...(feeling ? { how_its_been: feeling } : {}),
    ...(told.length ? { things_they_have_told_you: told } : {}),
    ...(jokes.length ? { your_inside_jokes: jokes } : {}),
    ...(plan.length ? { tonight_is_the_plan_you_made: plan.map((p) => `${p.by === me ? "You" : "They"}: “${p.text}”`) } : {}),
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
