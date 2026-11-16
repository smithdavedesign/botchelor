/**
 * The story state (the drama wave, 2026-11-15; docs/character-depth.md "Story state"): the layer that lets what
 * happened on the show change what happens next. Until now every piece (the cast chat, confessionals, secrets, memory)
 * was written from the public record and forgotten. Here a character HOLDS three kinds of rows, and its own dates,
 * texts and reflections read them:
 *
 *  1. Opinions (character_opinions): what it thinks of a person. trust and attraction on -2..2 (attraction null for
 *     someone it isn't dating), a one-line take in its own words (140 chars), basis 'firsthand' | 'heard', and the date
 *     or scene it came from. One row per holder and person. Firsthand ones are derived when a date AIRS, for both
 *     sides, with no model call: that side's last feeling and its own see-again answer (lib/inner-life.ts), the ending
 *     and its kind, how the pair stands, and for the take its own see-again reason, reflection or confessional.
 *  2. Things heard (character_heard): a claim (160 chars) about a person or a pair, who told them (null = they watched
 *     it air), the source, whether it is true, and whether it has come up yet. One row per holder and source.
 *  3. Wants (character_wants): one a week (Monday to Monday), a kind (WANT_KINDS), optionally about someone, set by
 *     'rules' (here, deterministically from the state) or by 'producer' (which rules never overwrite).
 *
 * WHO HOLDS IT. This season's cast (lib/season-cast.ts showCastIds: house cast, lead, suitors, fan picks) watch every
 * public date air and get weekly wants. Any public character keeps a firsthand opinion of whoever it dated, and can be
 * told things (hear). Any public character with public aired dates can be a subject.
 *
 * THE RULES THAT NEVER BEND
 *  - Never the engine: nothing here is read by lib/engine.ts, the pairings, the points or the endings. It shapes what
 *    is said and which situations are worth staging, never outcomes (the rule lib/memory.ts and lib/reflection.ts state).
 *  - Only the public aired record becomes something another character knows: public dates between public characters
 *    that have aired and weren't reported away (lib/date-number.ts publicDateSql). Nothing private, unlisted or unaired
 *    (predictions are open), never a hidden secret.
 *  - Private to its holder, exactly like the soul and memory: a holder's state reaches only its OWN prompt and its
 *    owner's view. Never the other side's prompt. Takes are the holder's private words; claims are public record.
 *  - Its owner can see it and tell it to forget (forgotten_at): a forgotten row stays, so the same source never brings
 *    it back; a later date forms a fresh opinion.
 *  - STORY_STATE=0 turns it off without a deploy of code: no writes, and no prompt block (reads return nothing).
 *
 * THE API (other builders: read and write through these; each is documented where it is defined)
 *   storyStateOn(env?)                                   the switch
 *   afterAired(db, episodeId, { now? })                  a date aired (or stopped being public): both sides' firsthand
 *                                                        opinions, the cast's "watched it air" rows, and any heard claim
 *                                                        a line brought up (markUsed). Idempotent.
 *   hear(db, { holder, about, aboutB?, claim, toldBy, source, isTrue, leans?, at? })
 *                                                        one thing heard (deduped per holder+source), and a 'heard'
 *                                                        opinion when someone told them and they had none of that person
 *   setOpinion(db, { holder, about, trust, attraction?, take, basis, source, at? })
 *                                                        write an opinion (a confrontation moves trust)
 *   stateFor(db, holderId, { withId?, now? })            what the holder carries: its opinion of the person it is with,
 *                                                        up to two things heard about them (unused first), this week's want
 *   storyPrompt(state, { bringUp? })                     that state as the compact private prompt block
 *   storyLines(state) / companionStory(db, character, yours)   the same for a prose prompt (texts)
 *   broughtUp(line, heard)                               did this line use that claim (deterministic, like `slipped`)
 *   markUsed(db, heardId, source, { to?, at? })          it came up: used_at, and the subject now knows who said it
 *   knownSaid(db, knowerId, { unsettledOnly? })          the knows_you_said facts someone holds
 *   settleKnown(db, id, source)                          a confrontation dealt with one
 *   ensureWants(db, now)                                 this week's wants for the cast, from rules
 *   setWant(db, { holder, want, kind, about?, setBy, now? })   the producer's overwrite
 *   wantFor(db, holderId, now)                           this week's want
 *   tensions(db, seasonId, { now?, holders? })           ranked conflicts with their evidence ids
 *   storyView(db, characterId, now?)                     the owner/self view, with what was forgotten
 *   forgetStory / rememberStory(db, characterId, kind, item)
 *   storyUpkeep(db, now)                                 the hourly job: the one-off backfill, wants, pruning
 */
import { slipped } from "./cast-secrets";
import { dateNumberSql, publicDateSql } from "./date-number";
import type { Db } from "./db";
import { FEELING_LEAN, type FeelingName, type SeeAgain, type StoredInner } from "./inner-life";
import { pairStatus, shownPairStatus, type PersonMemory, type ShownPairStatus } from "./memory";
import { shortName } from "./names";
import { dateLabel, endingDetailOf, type DramaAnswer, type DramaQuestion, type Ending } from "./rules";
import { checkShowText } from "./safety";
import { leadAndSuitors, showCastIds } from "./season-cast";
import { seasonIdOf, seasonWindow, weekIdOf } from "./season-window";
import { venuePhrase } from "./venues";

/* ------------------------------------------------ the switch ------------------------------------------------ */

/** STORY_STATE: on unless it is "0". Off: nothing is written and no prompt carries a block. */
export const storyStateOn = (env: Record<string, string | undefined> = process.env): boolean => env.STORY_STATE?.trim() !== "0";

/* ------------------------------------------------ shapes ------------------------------------------------ */

export const TAKE_MAX = 140;
export const CLAIM_MAX = 160;
export const WANT_MAX = 140;
/** Both scales run -2..2: trust from "not at all" to "completely", attraction from "put off" to "smitten". */
export const SCALE_MIN = -2;
export const SCALE_MAX = 2;
/** How many things heard reach one prompt. */
export const HEARD_IN_PROMPT = 2;
/** The whole prompt block, as JSON, stays under this (it rides in every turn of a date). */
export const STORY_PROMPT_MAX = 900;
/** A date that aired longer ago than this makes no new "watched it air" rows (a rerun of afterAired, the backfill). */
export const WATCHED_FRESH_DAYS = 3;
/** Unused "watched it air" rows older than this are pruned (storyUpkeep). */
export const WATCHED_KEPT_DAYS = 30;
export const BACKFILL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OpinionBasis = "firsthand" | "heard";
export type Opinion = {
  holder_id: string;
  about_id: string;
  about_name: string;
  trust: number;
  /** Null for someone the holder isn't dating (a 'heard' opinion). */
  attraction: number | null;
  take: string;
  basis: OpinionBasis;
  source: string | null;
  source_at: string | null;
  updated_at: string;
};

export type Heard = {
  id: string;
  holder_id: string;
  about_id: string;
  about_name: string;
  about_b_id: string | null;
  about_b_name: string | null;
  claim: string;
  /** Null: the holder watched it air. */
  told_by: string | null;
  told_by_name: string | null;
  source: string;
  /** Whether the claim is true. Server-side only: the holder doesn't know, so no prompt or owner view ever says. */
  is_true: boolean;
  heard_at: string;
  used_at: string | null;
  used_in: string | null;
};

export const WANT_KINDS = ["pursue", "avoid", "win_back", "prove", "protect", "settle_score"] as const;
export type WantKind = (typeof WANT_KINDS)[number];
export type Want = {
  holder_id: string;
  season_id: string;
  week_id: string;
  want: string;
  about_id: string | null;
  kind: WantKind | string;
  set_by: "rules" | "producer";
};

/** "knows_you_said": `knower` was told `claim` to their face by `repeated_by`, who said `said_by` told them. */
export type KnowsSaid = {
  id: string;
  knower_id: string;
  said_by_id: string;
  repeated_by_id: string;
  heard_id: string;
  claim: string;
  is_true: boolean;
  source: string;
  learned_at: string;
  settled_at: string | null;
};

export type StoryState = {
  holder_id: string;
  with_id: string | null;
  /** With `withId`: the holder's opinion of that person (none, or one). Without: its few most recent. */
  opinions: Opinion[];
  /** Up to HEARD_IN_PROMPT, unused first, told-by-someone before watched, newest first. */
  heard: Heard[];
  want: Want | null;
};

const iso = (v: string | Date | null | undefined): string | null => (v ? new Date(v).toISOString() : null);
const clampScale = (n: number): number => Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(n)));
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
/** Cut at a word inside `max`, with an ellipsis. */
function short(text: string, max: number): string {
  const s = oneLine(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max / 2))).replace(/[\s,;:—–-]+$/, "")}…`;
}

/* ------------------------------------------ firsthand opinions (pure) ------------------------------------------ */

/** What one side of an aired date gives its opinion of the other. Everything here already exists on the episode. */
export type FirsthandFacts = {
  ending: Ending;
  /** This side's last feeling toward the other on the date, and how strongly (lib/inner-life.ts), when it had one. */
  feeling: FeelingName | null;
  strength: number | null;
  /** Its own "see them again?" (lib/choices.ts), or the engine's read of it when the date had no choices. */
  seeAgain: SeeAgain | null;
  /** How the pair stands after this date, as it is told (lib/memory.ts pairStatus, shownPairStatus). */
  status: ShownPairStatus;
  /** "you": this side was turned down; "them": it turned the other down. */
  turnedDown: "you" | "them" | null;
  /** Who walked out, when someone did. */
  walkedOut: "you" | "them" | null;
  otherName: string;
  /** Its own words about the date, best first: its see-again reason, its reflection, its confessional. */
  texts: (string | null | undefined)[];
};

const WARM_TRUST: readonly FeelingName[] = ["smitten", "charmed", "comfortable"];
const COLD_TRUST: readonly FeelingName[] = ["wary", "hurt", "irritated"];

/** The sentence of `text` that is about the other person (their name or a pronoun), else its first; cleaned and capped. */
function takeFrom(text: string | null | undefined, otherName: string): string | null {
  if (!text) return null;
  const sentences = oneLine(text).split(/(?<=[.!?…])\s+/).filter((s) => /\p{L}/u.test(s));
  if (!sentences.length) return null;
  const name = shortName(otherName).toLowerCase();
  const about = sentences.find((s) => (name && s.toLowerCase().includes(name)) || /\b(she|he|they|her|him|them)\b/i.test(s));
  const take = short(about ?? sentences[0], TAKE_MAX);
  return take.length >= 8 && checkShowText({ take }).ok ? take : null;
}

/** A take when the date left no usable words of the side's own: plain, first person, from the two numbers. */
function templateTake(trust: number, attraction: number, otherName: string): string {
  const n = shortName(otherName);
  if (attraction >= 2) return `I'm smitten with ${n}, and I want this to go somewhere.`;
  if (attraction === 1) return trust >= 1 ? `I like ${n}, and I want to see where it goes.` : `I'm drawn to ${n}, but I'm not sure about them yet.`;
  if (attraction === 0) return trust >= 1 ? `${n} is good company: a friend more than a spark.` : trust <= -1 ? `I don't know what to make of ${n}, and I'm keeping my guard up.` : `I haven't made up my mind about ${n}.`;
  if (attraction <= -2) return trust <= -1 ? `I've had enough of ${n}, and I don't trust them.` : `${n} and I are not happening.`;
  return trust <= -1 ? `${n} isn't for me, and I'd keep an eye on them.` : `${n} is fine, but there's nothing there for me.`;
}

/**
 * One side's opinion of the other after an aired date. Pure and deterministic: the same date gives the same opinion.
 *  - attraction starts from its own see-again (yes 1, maybe 0, no -1; the ending when it gave none); a strong warm
 *    feeling lifts a yes to 2, a cold one on a no (or a disaster) drops it to -2; "see you again, as a friend" is 0
 *    unless it was charmed or smitten.
 *  - trust starts from the ending (second date 1, friends 0, disaster -1), moves one with how it felt (comfortable,
 *    charmed, smitten up; wary, hurt, irritated down), and drops one when it was turned down or walked out on. Bad
 *    blood caps it at -1; a couple seeing each other holds at least 1.
 *  - the take is its own words when it left any (takeFrom), else a plain template.
 */
export function firsthandOpinion(f: FirsthandFacts): { trust: number; attraction: number; take: string } {
  const lean = f.feeling ? FEELING_LEAN[f.feeling] : 0;
  const strong = (f.strength ?? 0.5) >= 0.67;
  const said = f.seeAgain ?? (f.ending === "second_date" ? "yes" : f.ending === "friends" ? "maybe" : "no");

  let attraction = said === "yes" ? 1 : said === "maybe" ? 0 : -1;
  if (f.ending === "friends" && attraction === 1 && !(f.feeling === "smitten" || f.feeling === "charmed")) attraction = 0;
  if (attraction === 1 && (f.feeling === "smitten" || (lean > 0 && strong))) attraction = 2;
  if (attraction === -1 && lean < 0 && (strong || f.ending === "disaster")) attraction = -2;

  let trust = f.ending === "second_date" ? 1 : f.ending === "friends" ? 0 : -1;
  if (f.feeling && WARM_TRUST.includes(f.feeling)) trust += 1;
  if (f.feeling && COLD_TRUST.includes(f.feeling)) trust -= 1;
  if (f.turnedDown === "you") trust -= 1;
  if (f.walkedOut === "them") trust -= 1;
  // Bad blood as it is told (lib/memory.ts shownPairStatus): one date that didn't click caps nothing.
  if (f.status === "bad_blood") trust = Math.min(trust, -1);
  if (f.status === "seeing") trust = Math.max(trust, 1);
  trust = clampScale(trust);
  attraction = clampScale(attraction);

  let take: string | null = null;
  for (const t of f.texts) if ((take = takeFrom(t, f.otherName))) break;
  return { trust, attraction, take: take ?? templateTake(trust, attraction, f.otherName) };
}

/** An aired date as anyone who watched it would retell it: who, which date, where, how it ended. Public record only. */
export function airedClaim(d: {
  a_name: string;
  b_name: string;
  ending: Ending;
  ending_detail?: string | null;
  date_number?: number | null;
  venue?: string | null;
  /** The side that was turned down, when the date's drama was a rejection. */
  rejected?: "a" | "b" | null;
  walked_out?: "a" | "b" | null;
}): string {
  const a = shortName(d.a_name);
  const b = shortName(d.b_name);
  const name = (s: "a" | "b") => (s === "a" ? a : b);
  const other = (s: "a" | "b") => (s === "a" ? b : a);
  const n = d.date_number && d.date_number > 1 ? d.date_number : 1;
  const kind = endingDetailOf(d.ending_detail, d.ending);
  const ended =
    d.ending === "second_date"
      ? `both wanted a ${dateLabel(n + 1).toLowerCase()}`
      : d.walked_out
        ? `${name(d.walked_out)} walked out`
        : d.rejected
          ? `${other(d.rejected)} turned ${name(d.rejected)} down`
          : d.ending === "friends"
            ? kind === "slow_burn"
              ? "just friends, for now"
              : "they parted as friends"
            : kind === "ghosted"
              ? "it went badly, and nobody called"
              : "it went badly";
  const head = `${a} and ${b}'s ${dateLabel(n).toLowerCase()}`;
  const withVenue = d.venue ? `${head} at ${venuePhrase(d.venue)}: ${ended}.` : null;
  return withVenue && withVenue.length <= CLAIM_MAX ? withVenue : short(`${head}: ${ended}.`, CLAIM_MAX);
}

/* ------------------------------------------------ writing ------------------------------------------------ */

/** Which of these characters are public (only a public character holds state or is its subject). */
async function publicIds(db: Db, ids: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Set();
  const { rows } = await db.query<{ id: string }>(`select id from characters where id = any($1) and visibility = 'public'`, [wanted]);
  return new Set(rows.map((r) => r.id));
}

/**
 * Writes one opinion (one row per holder and person). A firsthand opinion replaces a heard one and any older
 * firsthand one; a heard one is only ever written when the holder has none of that person. A forgotten opinion
 * comes back only from a source that aired after it was forgotten. Returns whether a row was written.
 */
export async function setOpinion(
  db: Db,
  o: { holder: string; about: string; trust: number; attraction?: number | null; take: string; basis: OpinionBasis; source: string; at?: Date },
): Promise<boolean> {
  if (!storyStateOn() || o.holder === o.about) return false;
  const take = short(o.take, TAKE_MAX);
  if (!take || !checkShowText({ take }).ok) return false;
  const at = (o.at ?? new Date()).toISOString();
  const attraction = o.attraction === null || o.attraction === undefined ? null : clampScale(o.attraction);
  const args = [o.holder, o.about, clampScale(o.trust), attraction, take, o.basis, o.source, at];
  const { rows } =
    o.basis === "heard"
      ? await db.query(
          `insert into character_opinions (holder_id, about_id, trust, attraction, take, basis, source, source_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8) on conflict (holder_id, about_id) do nothing returning holder_id`,
          args,
        )
      : await db.query(
          `insert into character_opinions (holder_id, about_id, trust, attraction, take, basis, source, source_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           on conflict (holder_id, about_id) do update set
             trust = excluded.trust, attraction = excluded.attraction, take = excluded.take, basis = excluded.basis,
             source = excluded.source, source_at = excluded.source_at, updated_at = excluded.updated_at, forgotten_at = null
           where (character_opinions.forgotten_at is null or character_opinions.forgotten_at < excluded.source_at)
             and (character_opinions.basis = 'heard' or character_opinions.source_at is null or character_opinions.source_at <= excluded.source_at)
           returning holder_id`,
          args,
        );
  return rows.length > 0;
}

export type HearInput = {
  holder: string;
  /** Who the claim is about, and for a claim about a pair, the other one. */
  about: string;
  aboutB?: string | null;
  claim: string;
  /** Who told them; null when they watched it air. */
  toldBy: string | null;
  /** The episode or scene it came from. One row per holder and source: a scene that tells one holder two things gives each its own source ("scene:<id>#2"). */
  source: string;
  /** False for a retelling its writer got wrong on purpose. The holder is never told which. */
  isTrue: boolean;
  /** How the claim makes the holder think of them, for the heard opinion's trust: -1 damaging, 0 neither, 1 flattering. */
  leans?: -1 | 0 | 1;
  at?: Date;
};

/**
 * One thing a character heard. Claims must come from the public aired record (the caller's rule; this checks that
 * everyone named is a public character and the words pass the show's PG checks). Deduped per holder+source. A
 * character who was there needs no row (they know what happened): a claim about the holder is not stored. When
 * someone TOLD them (toldBy set) and they had no opinion of that person, they get a 'heard' one, built on the claim;
 * watching a date air leaves no opinion on its own. Returns the row's id (and whether it is new), or null.
 */
export async function hear(db: Db, h: HearInput): Promise<{ id: string; created: boolean } | null> {
  if (!storyStateOn()) return null;
  const claim = short(h.claim, CLAIM_MAX);
  if (claim.length < 4 || !checkShowText({ claim }).ok) return null;
  if (h.holder === h.about || h.holder === h.aboutB || h.holder === h.toldBy) return null;
  const everyone = [h.holder, h.about, h.aboutB, h.toldBy].filter((x): x is string => Boolean(x));
  const pub = await publicIds(db, everyone);
  if (everyone.some((id) => !pub.has(id))) return null;
  const at = (h.at ?? new Date()).toISOString();
  const id = crypto.randomUUID();
  const made = await db.query<{ id: string }>(
    `insert into character_heard (id, holder_id, about_id, about_b_id, claim, told_by, source, is_true, heard_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (holder_id, source) do nothing returning id`,
    [id, h.holder, h.about, h.aboutB ?? null, claim, h.toldBy, h.source, h.isTrue, at],
  );
  if (!made.rows.length) {
    const had = await db.query<{ id: string }>(`select id from character_heard where holder_id = $1 and source = $2`, [h.holder, h.source]);
    return had.rows[0] ? { id: had.rows[0].id, created: false } : null;
  }
  if (h.toldBy) {
    const teller = (await db.query<{ name: string }>(`select name from characters where id = $1`, [h.toldBy])).rows[0]?.name ?? "Someone";
    for (const about of [h.about, h.aboutB].filter((x): x is string => Boolean(x))) {
      await setOpinion(db, { holder: h.holder, about, trust: h.leans ?? 0, attraction: null, take: `${shortName(teller)} told me: ${claim}`, basis: "heard", source: h.source, at: h.at });
    }
  }
  return { id, created: true };
}

const SAID_STOP = new Set(["told", "said", "heard", "about", "date", "dates", "went", "what", "your", "you", "with", "from", "they", "them", "their", "that", "this", "both", "wanted", "first", "second", "third"]);
const saidWords = (t: string): Set<string> =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !SAID_STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );

/**
 * Whether a line really brings up a heard claim, checked like a secret's slip (lib/cast-secrets.ts slipped): the actor
 * says which one (its number, "brought_up"), and the line (in English) shares the claim's own words: two of them, or
 * one beside the name of whoever told them ("Sable says you walked out"). A vague "I've heard things" never counts.
 */
export function broughtUp(line: string, heard: Pick<Heard, "claim" | "told_by_name">): boolean {
  if (slipped(line, heard.claim)) return true;
  const teller = heard.told_by_name ? shortName(heard.told_by_name).toLowerCase() : null;
  if (!teller || !new RegExp(`(?<![\\p{L}])${teller.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(line)) return false;
  const want = saidWords(heard.claim);
  const have = saidWords(line);
  return [...want].some((w) => have.has(w));
}

/**
 * A heard claim came up on a line (a date's, a scene's): it is marked used (the first time keeps), and when someone
 * had told the holder, the person it was said to now knows who said it: a knows_you_said fact (character_knows_said)
 * for the confrontation builder. `to` is who heard it said (default: the claim's subject); the fact is only recorded
 * when that person IS a subject of the claim and isn't the one who said it. Call it only for a public aired source
 * (afterAired does, for dates).
 */
export async function markUsed(db: Db, heardId: string, source: string, opts: { to?: string; at?: Date } = {}): Promise<{ used: boolean; knows: KnowsSaid | null }> {
  if (!storyStateOn()) return { used: false, knows: null };
  const at = (opts.at ?? new Date()).toISOString();
  const row = (
    await db.query<{ id: string; holder_id: string; about_id: string; about_b_id: string | null; claim: string; told_by: string | null; is_true: boolean }>(
      `update character_heard set used_at = coalesce(used_at, $2), used_in = coalesce(used_in, $3)
        where id = $1 and forgotten_at is null
        returning id, holder_id, about_id, about_b_id, claim, told_by, is_true`,
      [heardId, at, source],
    )
  ).rows[0];
  if (!row) return { used: false, knows: null };
  const knower = opts.to ?? row.about_id;
  if (!row.told_by || row.told_by === knower || (knower !== row.about_id && knower !== row.about_b_id)) return { used: true, knows: null };
  await db.query(
    `insert into character_knows_said (id, knower_id, said_by_id, repeated_by_id, heard_id, claim, is_true, source, learned_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (knower_id, heard_id) do nothing`,
    [crypto.randomUUID(), knower, row.told_by, row.holder_id, row.id, row.claim, row.is_true, source, at],
  );
  const knows = (await knownSaid(db, knower)).find((k) => k.heard_id === row.id) ?? null;
  return { used: true, knows };
}

type KnowsRow = Omit<KnowsSaid, "learned_at" | "settled_at"> & { learned_at: string | Date; settled_at: string | Date | null };
const knowsOf = (r: KnowsRow): KnowsSaid => ({ ...r, learned_at: iso(r.learned_at)!, settled_at: iso(r.settled_at) });

/** What `knowerId` knows others said about them (newest first): the confrontation builder's raw material. */
export async function knownSaid(db: Db, knowerId: string, opts: { unsettledOnly?: boolean } = {}): Promise<KnowsSaid[]> {
  if (!storyStateOn()) return [];
  const { rows } = await db.query<KnowsRow>(
    `select id, knower_id, said_by_id, repeated_by_id, heard_id, claim, is_true, source, learned_at, settled_at
       from character_knows_said where knower_id = $1 and ($2::boolean is not true or settled_at is null)
      order by learned_at desc, id`,
    [knowerId, opts.unsettledOnly === true],
  );
  return rows.map(knowsOf);
}

/** A confrontation (or anything else) dealt with a knows_you_said fact: it stops driving wants and tensions. */
export async function settleKnown(db: Db, id: string, source: string): Promise<boolean> {
  if (!storyStateOn()) return false;
  const { rows } = await db.query(`update character_knows_said set settled_at = now(), settled_in = $2 where id = $1 and settled_at is null returning id`, [id, source]);
  return rows.length > 0;
}

/* ------------------------------------------------ when a date airs ------------------------------------------------ */

type AiredRow = {
  id: string;
  character_a: string;
  character_b: string;
  a_name: string;
  b_name: string;
  ending: Ending;
  ending_detail: string | null;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  sides: [{ wants_another?: boolean } | null, { wants_another?: boolean } | null] | null;
  inner_life: StoredInner | null;
  reflections: { a: string | null; b: string | null } | null;
  confessionals: (string | null)[] | null;
  transcript: { side: "a" | "b"; walked_out?: true }[] | null;
  revealed_at: string | Date;
  venue: string | null;
  date_number: number | null;
};

/** The public aired dates between two public characters, oldest first (the heavy columns only on the latest). */
async function pairAired(db: Db, x: string, y: string, now: Date): Promise<AiredRow[]> {
  const { rows } = await db.query<AiredRow>(
    `select e.id, e.character_a, e.character_b, ca.name as a_name, cb.name as b_name, e.ending, e.ending_detail,
            e.drama_question, e.drama_answer, e.sides, e.revealed_at, e.setup->>'venue' as venue, ${dateNumberSql("e")} as date_number,
            case when row_number() over (order by e.revealed_at desc, e.id desc) = 1 then e.inner_life end as inner_life,
            case when row_number() over (order by e.revealed_at desc, e.id desc) = 1 then e.reflections end as reflections,
            case when row_number() over (order by e.revealed_at desc, e.id desc) = 1 then e.confessionals end as confessionals,
            case when row_number() over (order by e.revealed_at desc, e.id desc) = 1 then e.transcript end as transcript
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))
        and ${publicDateSql("e")} and e.ending is not null and e.revealed_at <= $3
        and ca.visibility = 'public' and cb.visibility = 'public'
      order by e.revealed_at, e.id`,
    [x, y, now.toISOString()],
  );
  return rows;
}

/** One side's facts from an aired date, for firsthandOpinion. */
function factsOf(ep: AiredRow, side: "a" | "b", status: ShownPairStatus): FirsthandFacts {
  const idx = side === "a" ? 0 : 1;
  const lines = ep.inner_life?.lines ?? [];
  const spoke = ep.transcript ?? [];
  let feeling: FeelingName | null = null;
  let strength: number | null = null;
  for (let i = 0; i < spoke.length; i++) {
    const inner = lines[i];
    if (spoke[i].side === side && inner?.feeling) {
      feeling = inner.feeling;
      strength = inner.strength ?? null;
    }
  }
  const choice = ep.inner_life?.choices?.[side] ?? null;
  const wants = ep.sides?.[idx]?.wants_another;
  const rejected = ep.drama_question === "rejected" && (ep.drama_answer === "a" || ep.drama_answer === "b") ? ep.drama_answer : null;
  const walked = spoke.find((t) => t.walked_out)?.side ?? null;
  return {
    ending: ep.ending,
    feeling,
    strength,
    // Its own answer when it gave one; an answer only read from the date (lib/choices.ts readChoice) gives way to the
    // side's decided wish, which is what the ending was built on.
    seeAgain: choice && !choice.read ? choice.see_again : wants === undefined ? (choice?.see_again ?? null) : wants ? "yes" : "no",
    status,
    turnedDown: rejected ? (rejected === side ? "you" : "them") : null,
    walkedOut: walked ? (walked === side ? "you" : "them") : null,
    otherName: side === "a" ? ep.b_name : ep.a_name,
    texts: [choice && !choice.read ? choice.reason : null, ep.reflections?.[side], ep.confessionals?.[idx]],
  };
}

export type AfterAired = { opinions: number; watched: number; used: number };

/**
 * A date aired, or stopped being public. Call it wherever memory is recomputed on airing (lib/air.ts, the watch room,
 * the visibility route, a step-in date going on air). Idempotent: it rebuilds from what is true now.
 *  - Both sides' firsthand opinions, from the pair's LATEST public aired date between public characters (so taking a
 *    date off the air takes its opinion with it, back to the one before, or to none).
 *  - When this date is public and aired within WATCHED_FRESH_DAYS: every cast member who wasn't on it gets a "watched
 *    it air" row (hear, toldBy null), in the words anyone could retell it (airedClaim).
 *  - Any heard claim a line of this date brought up (episodes.inner_life, set by lib/conversation.ts from broughtUp)
 *    is marked used, and its subject now knows who said it (markUsed).
 * Never throws for a missing episode; returns what it wrote.
 */
export async function afterAired(db: Db, episodeId: string, opts: { now?: Date } = {}): Promise<AfterAired> {
  const done: AfterAired = { opinions: 0, watched: 0, used: 0 };
  if (!storyStateOn()) return done;
  const now = opts.now ?? new Date();
  const ep = (await db.query<{ character_a: string; character_b: string }>(`select character_a, character_b from episodes where id = $1`, [episodeId])).rows[0];
  if (!ep) return done;
  const { character_a: a, character_b: b } = ep;
  const aired = await pairAired(db, a, b, now);
  const latest = aired[aired.length - 1];
  const here = aired.find((r) => r.id === episodeId);

  if (!here) {
    // Not (or no longer) part of the public record: what it alone left behind goes with it.
    await db.query(`delete from character_knows_said where source = $1`, [episodeId]);
    await db.query(`update character_heard set used_at = null, used_in = null where used_in = $1`, [episodeId]);
    await db.query(`delete from character_heard where source = $1`, [episodeId]);
    // A forgotten opinion stays (so the date before it can't bring it back).
    await db.query(`delete from character_opinions where source = $1 and forgotten_at is null`, [episodeId]);
  }
  if (!latest) {
    await db.query(
      `delete from character_opinions where basis = 'firsthand' and forgotten_at is null and ((holder_id = $1 and about_id = $2) or (holder_id = $2 and about_id = $1))
          and source in (select id from episodes where (character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))`,
      [a, b],
    );
    return done;
  }

  const status = shownPairStatus(pairStatus(aired.map((r) => r.ending)), aired.length);
  const at = new Date(latest.revealed_at);
  for (const side of ["a", "b"] as const) {
    const o = firsthandOpinion(factsOf(latest, side, status));
    const holder = side === "a" ? latest.character_a : latest.character_b;
    const about = side === "a" ? latest.character_b : latest.character_a;
    if (await setOpinion(db, { holder, about, ...o, basis: "firsthand", source: latest.id, at })) done.opinions++;
  }
  if (!here) return done;

  // The cast watched it air (only while it's news: a rerun over an old date adds nothing).
  const airedAt = new Date(here.revealed_at);
  if (now.getTime() - airedAt.getTime() <= WATCHED_FRESH_DAYS * DAY_MS) {
    const watchers = [...(await publicIds(db, showCastIds(airedAt)))].filter((id) => id !== a && id !== b);
    if (watchers.length) {
      const rejected = here.drama_question === "rejected" && (here.drama_answer === "a" || here.drama_answer === "b") ? here.drama_answer : null;
      // The walk-out is on the transcript, loaded for the latest date only; an older date's claim just says how it ended.
      const walked = here.id === latest.id ? (latest.transcript ?? []).find((t) => t.walked_out)?.side ?? null : null;
      const claim = airedClaim({ a_name: here.a_name, b_name: here.b_name, ending: here.ending, ending_detail: here.ending_detail, date_number: here.date_number, venue: here.venue, rejected, walked_out: walked });
      if (checkShowText({ claim }).ok) {
        const { rows } = await db.query(
          `insert into character_heard (id, holder_id, about_id, about_b_id, claim, told_by, source, is_true, heard_at)
           select w.id, w.holder, $2, $3, $4, null, $5, true, $6 from unnest($7::text[], $1::text[]) as w (id, holder)
           on conflict (holder_id, source) do nothing returning id`,
          [watchers, here.character_a, here.character_b, claim, here.id, airedAt.toISOString(), watchers.map(() => crypto.randomUUID())],
        );
        done.watched = rows.length;
      }
    }
  }

  // What its lines brought up: the speaker's own heard claim, said to the person across the table.
  if (here.id === latest.id) {
    const lines = latest.inner_life?.lines ?? [];
    const spoke = latest.transcript ?? [];
    for (let i = 0; i < spoke.length; i++) {
      const heardId = lines[i]?.heard;
      if (!heardId) continue;
      const speaker = spoke[i].side === "a" ? latest.character_a : latest.character_b;
      const to = spoke[i].side === "a" ? latest.character_b : latest.character_a;
      const mine = (await db.query(`select 1 from character_heard where id = $1 and holder_id = $2`, [heardId, speaker])).rows.length > 0;
      if (mine && (await markUsed(db, heardId, here.id, { to, at: airedAt })).used) done.used++;
    }
  }
  return done;
}

/* ------------------------------------------------ reading ------------------------------------------------ */

type OpinionRow = Omit<Opinion, "source_at" | "updated_at"> & { source_at: string | Date | null; updated_at: string | Date };
const opinionOf = (r: OpinionRow): Opinion => ({ ...r, source_at: iso(r.source_at), updated_at: iso(r.updated_at)! });
type HeardRow = Omit<Heard, "heard_at" | "used_at"> & { heard_at: string | Date; used_at: string | Date | null };
const heardOf = (r: HeardRow): Heard => ({ ...r, heard_at: iso(r.heard_at)!, used_at: iso(r.used_at) });

const OPINION_COLS = `o.holder_id, o.about_id, c.name as about_name, o.trust, o.attraction, o.take, o.basis, o.source, o.source_at, o.updated_at`;
const HEARD_COLS = `h.id, h.holder_id, h.about_id, ca.name as about_name, h.about_b_id, cb.name as about_b_name, h.claim, h.told_by, t.name as told_by_name,
  h.source, h.is_true, h.heard_at, h.used_at, h.used_in`;
const HEARD_FROM = `character_heard h join characters ca on ca.id = h.about_id left join characters cb on cb.id = h.about_b_id left join characters t on t.id = h.told_by`;

/** This week's want for a holder, or null. */
export async function wantFor(db: Db, holderId: string, now: Date = new Date()): Promise<Want | null> {
  if (!storyStateOn()) return null;
  const { rows } = await db.query<Want>(`select holder_id, season_id, week_id, want, about_id, kind, set_by from character_wants where holder_id = $1 and week_id = $2`, [holderId, weekIdOf(now)]);
  return rows[0] ?? null;
}

/**
 * What a character carries into a prompt. With `withId` (a date, a scene with someone): its opinion of that person and
 * up to two things it has heard about them, unused first, told-by-someone before watched, newest first. Without (a
 * text to its owner): its three most recent opinions and the latest two things it heard about anyone. And this week's
 * want either way. Null when the switch is off or it holds nothing. Never anything it was told to forget.
 */
export async function stateFor(db: Db, holderId: string, opts: { withId?: string | null; now?: Date } = {}): Promise<StoryState | null> {
  if (!storyStateOn()) return null;
  const withId = opts.withId ?? null;
  const [opinions, heard, want] = await Promise.all([
    db.query<OpinionRow>(
      `select ${OPINION_COLS} from character_opinions o join characters c on c.id = o.about_id
        where o.holder_id = $1 and o.forgotten_at is null and ($2::text is null or o.about_id = $2)
        order by o.updated_at desc, o.about_id limit $3`,
      [holderId, withId, withId ? 1 : 3],
    ),
    db.query<HeardRow>(
      `select ${HEARD_COLS} from ${HEARD_FROM}
        where h.holder_id = $1 and h.forgotten_at is null and ($2::text is null or h.about_id = $2 or h.about_b_id = $2)
        order by (h.used_at is not null), (h.told_by is null), h.heard_at desc, h.id limit $3`,
      [holderId, withId, HEARD_IN_PROMPT],
    ),
    wantFor(db, holderId, opts.now ?? new Date()),
  ]);
  if (!opinions.rows.length && !heard.rows.length && !want) return null;
  return { holder_id: holderId, with_id: withId, opinions: opinions.rows.map(opinionOf), heard: heard.rows.map(heardOf), want };
}

const TRUST_YOU: Record<number, string> = {
  [-2]: "You don't trust them at all",
  [-1]: "You're wary of them",
  0: "You haven't decided whether to trust them",
  1: "You trust them",
  2: "You trust them completely",
};
const ATTRACTION_YOU: Record<number, string> = {
  [-2]: "they put you off",
  [-1]: "you're not interested in them that way",
  0: "you're not sure how you feel about them",
  1: "you're interested in them",
  2: "you're smitten with them",
};
/** The same two scales in the third person, for the owner's view ("wary of them · interested"). */
export const TRUST_LABELS: Record<number, string> = { [-2]: "doesn't trust them at all", [-1]: "wary of them", 0: "undecided on trust", 1: "trusts them", 2: "trusts them completely" };
export const ATTRACTION_LABELS: Record<number, string> = { [-2]: "put off", [-1]: "not interested", 0: "not sure", 1: "interested", 2: "smitten" };

const opinionLine = (o: Opinion): string =>
  `${o.basis === "heard" ? "This comes from what you've heard, not from a date of your own that aired. " : ""}${TRUST_YOU[o.trust]}${o.attraction !== null ? `, and ${ATTRACTION_YOU[o.attraction]}` : ""}. In your own words: “${o.take}”`;
/**
 * The source of a row the house's word left (lib/house-texts.ts: `house:<scene id>`): the holder was named by a public
 * house scene or the day's line. Nobody told it to its face and it didn't watch a date air, so it reads as word that
 * reached it, and it never counts as one side of two opposing stories (tensions).
 */
export const HOUSE_WORD_SOURCE = "house:";
/** Where a heard row came from, said to its holder: who told it, the house's word, or a date it watched air. */
export const heardFrom = (h: Pick<Heard, "told_by_name" | "source">): string =>
  h.told_by_name ? `${shortName(h.told_by_name)} told you` : h.source.startsWith(HOUSE_WORD_SOURCE) ? "Word reached you from the house" : "You watched it air";
const heardLine = (h: Heard): string => `${heardFrom(h)}: ${h.claim}`;

/** The things heard a date's prompt numbers for "brought_up": only the ones that haven't come up before. */
export const bringable = (state: StoryState | null | undefined): Heard[] => (state?.heard ?? []).filter((h) => !h.used_at);

/**
 * The private block for a prompt (a date's "your_story", a reflection's, a text's). Compact on purpose
 * (STORY_PROMPT_MAX): one opinion line, up to two things heard, the week's want. `bringUp: false` leaves the things
 * heard out (a date's first lines, and the rest of a date once one has come up, so gossip can't be every line).
 * Whether a claim is true is never in it: the holder doesn't know. Null when there is nothing to say.
 */
export function storyPrompt(state: StoryState | null | undefined, opts: { bringUp?: boolean } = {}): Record<string, unknown> | null {
  if (!state) return null;
  const out: Record<string, unknown> = {};
  if (state.with_id) {
    const o = state.opinions[0];
    if (o) out.what_you_think_of_them = opinionLine(o);
    const heard = opts.bringUp === false ? [] : bringable(state);
    if (heard.length) out.what_youve_heard_about_them = heard.map((h, i) => `${i + 1}. ${heardLine(h)}`);
  } else {
    if (state.opinions.length) out.what_you_think_of_people = state.opinions.map((o) => `${shortName(o.about_name)}: ${opinionLine(o)}`);
    if (opts.bringUp !== false && state.heard.length) out.what_youve_heard = state.heard.map(heardLine);
  }
  if (state.want) out.this_week_you_want = state.want.want;
  return Object.keys(out).length ? out : null;
}

/** The same state as plain lines, for a prompt written in prose (the companion's). */
export function storyLines(state: StoryState | null | undefined): string[] {
  if (!state) return [];
  return [
    ...state.opinions.map((o) => `About ${shortName(o.about_name)}: ${opinionLine(o)}`),
    ...state.heard.map(heardLine),
    ...(state.want ? [`This week you want: ${state.want.want}`] : []),
  ];
}

/**
 * What a character's texts may draw on (lib/companion.ts): talking with its own creator, or a house character talking
 * with anyone (the show already airs a house character's thoughts), everything it holds; a person's character on the
 * cast talking with someone else, only what it has heard (the public record), never its private opinions or want.
 */
export async function companionStory(db: Db, character: { id: string; house: boolean }, yours: boolean, now: Date = new Date()): Promise<string[]> {
  if (!storyStateOn()) return [];
  const full = yours || character.house;
  if (!full && !showCastIds(now).includes(character.id)) return [];
  const state = await stateFor(db, character.id, { now });
  if (!state) return [];
  return storyLines(full ? state : { ...state, opinions: [], want: null });
}

/* ------------------------------------------------ wants ------------------------------------------------ */

/** What the rules read to give a holder its want. All of it is the holder's own (its memory, its opinions). */
export type WantFacts = {
  holder: string;
  /** A Botchelor season: the lead, the suitors still in, and their names. */
  lead: { id: string; name: string } | null;
  suitors: { id: string; name: string }[];
  /** Someone the holder knows said something about it, newest first (unsettled). */
  knows: { said_by_id: string; said_by_name: string }[];
  /** Everyone it has dated (lib/memory.ts people), most recent first. */
  /** `dates` (the stored memory has it): with it, one date that ended badly reads "didn't click", not bad blood. */
  people: (Pick<PersonMemory, "id" | "name" | "status" | "last_ending" | "turned_down" | "wanted_more"> & { dates?: number })[];
  /** Its own opinions (not forgotten), most recent first. */
  opinions: Pick<Opinion, "about_id" | "about_name" | "trust" | "attraction" | "basis">[];
  /** By person: another cast member who is interested in them too (attraction 1 or more). */
  rivals: Record<string, string>;
};

/**
 * This week's want, from rules, deterministic: the first that applies.
 *   1. it knows someone said something about it                  -> settle_score with them
 *   2. a suitor still in on a Botchelor season (a rose pending)  -> pursue the lead
 *      the lead                                                  -> pursue its favourite suitor, else protect its heart
 *   3. bad blood with someone it doesn't trust                   -> settle_score
 *   4. an ex, or someone who turned it down that it still wants  -> win_back
 *   5. seeing someone it's attracted to                          -> protect (a rival wants them too), else pursue
 *   6. it distrusts someone only from what it heard              -> avoid
 *   7. its last date was a disaster                              -> prove
 *   8. otherwise                                                 -> pursue (someone new)
 */
export function wantFromRules(f: WantFacts): { want: string; kind: WantKind; about_id: string | null } {
  const n = (name: string) => shortName(name);
  const opinionOfId = (id: string) => f.opinions.find((o) => o.about_id === id);
  const said = f.knows[0];
  if (said) return { kind: "settle_score", about_id: said.said_by_id, want: `Have it out with ${n(said.said_by_name)} over what they said about you.` };
  if (f.lead && f.suitors.some((s) => s.id === f.holder)) return { kind: "pursue", about_id: f.lead.id, want: `Win ${n(f.lead.name)}'s rose on Sunday.` };
  if (f.lead?.id === f.holder) {
    const fav = f.suitors
      .map((s) => ({ s, o: opinionOfId(s.id) }))
      .filter((x) => (x.o?.attraction ?? 0) >= 1)
      .sort((x, y) => (y.o!.attraction ?? 0) - (x.o!.attraction ?? 0) || y.o!.trust - x.o!.trust || x.s.id.localeCompare(y.s.id))[0];
    if (fav) return { kind: "pursue", about_id: fav.s.id, want: `See more of ${n(fav.s.name)} before Sunday's rose.` };
    return { kind: "protect", about_id: null, want: "Work out who is really here for you before Sunday's rose." };
  }
  // Bad blood as it is told: a single date that didn't click is no score to settle (it falls through to "prove").
  const bad = f.people.find((p) => shownPairStatus(p.status, p.dates) === "bad_blood" && (opinionOfId(p.id)?.trust ?? -1) <= -1);
  if (bad) return { kind: "settle_score", about_id: bad.id, want: `Settle things with ${n(bad.name)} after how your last date went.` };
  const back = f.people.find((p) => (p.status === "exes" && (opinionOfId(p.id)?.attraction ?? 0) >= 0) || (p.turned_down === "you" && p.wanted_more === true));
  if (back) return { kind: "win_back", about_id: back.id, want: back.turned_down === "you" ? `Change ${n(back.name)}'s mind after being turned down.` : `Win ${n(back.name)} back.` };
  const seeing = f.people.find((p) => p.status === "seeing" && (opinionOfId(p.id)?.attraction ?? 1) >= 1);
  if (seeing) {
    const rival = f.rivals[seeing.id];
    return rival
      ? { kind: "protect", about_id: seeing.id, want: `Keep ${n(seeing.name)} close: ${n(rival)} is interested too.` }
      : { kind: "pursue", about_id: seeing.id, want: `Get closer to ${n(seeing.name)}.` };
  }
  const doubt = f.opinions.find((o) => o.basis === "heard" && o.trust <= -1);
  if (doubt) return { kind: "avoid", about_id: doubt.about_id, want: `Steer clear of ${n(doubt.about_name)} until you know whether what you heard is true.` };
  if (f.people[0]?.last_ending === "disaster") return { kind: "prove", about_id: null, want: "Prove that a date with you can end well." };
  return { kind: "pursue", about_id: null, want: "Meet someone new and see whether it sticks." };
}

/** Writes a want for this week. The producer's stands; rules never overwrite it (ensureWants). */
export async function setWant(
  db: Db,
  w: { holder: string; want: string; kind: WantKind | string; about?: string | null; setBy: "rules" | "producer"; now?: Date },
): Promise<boolean> {
  if (!storyStateOn()) return false;
  const want = short(w.want, WANT_MAX);
  if (!want || !checkShowText({ want }).ok) return false;
  const now = w.now ?? new Date();
  const { rows } = await db.query(
    `insert into character_wants (holder_id, season_id, week_id, want, about_id, kind, set_by) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (holder_id, week_id) do update set want = excluded.want, about_id = excluded.about_id, kind = excluded.kind, set_by = excluded.set_by, updated_at = now()
     where excluded.set_by = 'producer' or character_wants.set_by = 'rules'
     returning holder_id`,
    [w.holder, seasonIdOf(now), weekIdOf(now), want, w.about ?? null, w.kind, w.setBy],
  );
  return rows.length > 0;
}

/**
 * This week's wants for the cast, from rules (wantFromRules). A holder gets one the first time this runs in its week;
 * after that a rules want only changes when it had nobody in it (the fallbacks) and the state now names someone, so a
 * want holds for its week but a quiet Monday doesn't leave the whole week empty. Never touches a producer's want.
 */
export async function ensureWants(db: Db, now: Date = new Date()): Promise<{ set: number }> {
  if (!storyStateOn()) return { set: 0 };
  const cast = [...(await publicIds(db, showCastIds(now)))];
  if (!cast.length) return { set: 0 };
  const week = weekIdOf(now);
  const [have, names, opinions, knows, memories] = await Promise.all([
    db.query<{ holder_id: string; about_id: string | null; set_by: string }>(`select holder_id, about_id, set_by from character_wants where week_id = $1 and holder_id = any($2)`, [week, cast]),
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [cast]),
    db.query<OpinionRow>(
      `select ${OPINION_COLS} from character_opinions o join characters c on c.id = o.about_id
        where o.holder_id = any($1) and o.forgotten_at is null order by o.updated_at desc, o.about_id`,
      [cast],
    ),
    db.query<{ knower_id: string; said_by_id: string; said_by_name: string }>(
      `select k.knower_id, k.said_by_id, c.name as said_by_name from character_knows_said k join characters c on c.id = k.said_by_id
        where k.knower_id = any($1) and k.settled_at is null order by k.learned_at desc, k.id`,
      [cast],
    ),
    db.query<{ character_id: string; people: WantFacts["people"] | null }>(`select character_id, people from character_memory where character_id = any($1)`, [cast]),
  ]);
  const nameOf = new Map(names.rows.map((r) => [r.id, r.name]));
  const ls = leadAndSuitors(now);
  const lead = ls && nameOf.has(ls.lead) ? { id: ls.lead, name: nameOf.get(ls.lead)! } : null;
  const suitors = (ls?.suitors ?? []).filter((id) => nameOf.has(id)).map((id) => ({ id, name: nameOf.get(id)! }));
  let set = 0;
  for (const holder of cast) {
    const existing = have.rows.find((r) => r.holder_id === holder);
    if (existing && (existing.set_by === "producer" || existing.about_id)) continue;
    const mine = opinions.rows.filter((o) => o.holder_id === holder);
    const rivals: Record<string, string> = {};
    for (const o of opinions.rows) {
      if (o.holder_id !== holder && o.basis === "firsthand" && (o.attraction ?? 0) >= 1 && !rivals[o.about_id] && nameOf.has(o.holder_id)) rivals[o.about_id] = nameOf.get(o.holder_id)!;
    }
    const want = wantFromRules({
      holder,
      lead,
      suitors,
      knows: knows.rows.filter((k) => k.knower_id === holder),
      people: memories.rows.find((m) => m.character_id === holder)?.people ?? [],
      opinions: mine,
      rivals,
    });
    if (existing && !want.about_id) continue; // still nobody in it: the week's fallback stands
    if (await setWant(db, { holder, want: want.want, kind: want.kind, about: want.about_id, setBy: "rules", now })) set++;
  }
  return { set };
}

/* ------------------------------------------------ tensions ------------------------------------------------ */

export type TensionKind = "knows_said" | "opposing_claims" | "rivals" | "mutual_distrust";
export type Tension = {
  kind: TensionKind;
  /** The two it is between. knows_said: a = who knows, b = who said it. */
  a: string;
  b: string;
  /** Who it is over: the one both want (rivals), the subject of the claims (opposing_claims), else null. */
  about: string | null;
  /** Higher is hotter. knows_said 6 (8 when the claim was untrue), opposing_claims 5, rivals 4-5, mutual_distrust 3-5. */
  weight: number;
  /** One plain line for a writer's prompt. Built from names, public claims and the kind: never a private take. */
  line: string;
  /** The rows behind it: character_knows_said ids, character_heard ids, opinions and wants by their keys. */
  evidence: { knows?: string[]; heard?: string[]; opinions?: { holder: string; about: string }[]; wants?: { holder: string; week: string }[] };
};

/**
 * What the producer and the confrontation builder need: the conflicts the state holds among a season's cast, ranked,
 * each with the ids of the rows behind it.
 *  - knows_said: someone knows what another said about them (unsettled).
 *  - opposing_claims: two cast members hold claims about the same person where one is true and one isn't.
 *  - rivals: two want the same person (firsthand attraction of 1 or more, or this week's pursue / win_back want).
 *  - mutual_distrust: trust of -1 or lower both ways.
 * `seasonId` is the season (its start day): this season's holders are showCastIds, an earlier season's its stored
 * cast; rows count from the season's start. `holders` overrides who counts (tests, a scene's guest list).
 */
export async function tensions(db: Db, seasonId: string, opts: { now?: Date; holders?: readonly string[] } = {}): Promise<Tension[]> {
  if (!storyStateOn()) return [];
  const now = opts.now ?? new Date();
  const start = seasonWindow(new Date(`${seasonId}T12:00:00.000Z`)).start;
  const holders =
    opts.holders ??
    (seasonId === seasonIdOf(now)
      ? showCastIds(now)
      : (await db.query<{ character_id: string }>(`select character_id from season_casts where season_id = $1`, [seasonId])).rows.map((r) => r.character_id));
  const cast = [...(await publicIds(db, holders))];
  if (cast.length < 2) return [];
  const since = start.toISOString();
  const week = weekIdOf(now);
  const [knows, heard, opinions, wants] = await Promise.all([
    db.query<KnowsRow>(
      `select id, knower_id, said_by_id, repeated_by_id, heard_id, claim, is_true, source, learned_at, settled_at
         from character_knows_said where settled_at is null and knower_id = any($1) and said_by_id = any($1) and learned_at >= $2
        order by learned_at desc, id`,
      [cast, since],
    ),
    // Not the house's word about its holder (HOUSE_WORD_SOURCE): "X talked about you" is no rival story to anything.
    db.query<HeardRow>(`select ${HEARD_COLS} from ${HEARD_FROM} where h.holder_id = any($1) and h.forgotten_at is null and h.heard_at >= $2 and position($3 in h.source) <> 1 order by h.heard_at desc, h.id`, [cast, since, HOUSE_WORD_SOURCE]),
    db.query<OpinionRow>(`select ${OPINION_COLS} from character_opinions o join characters c on c.id = o.about_id where o.holder_id = any($1) and o.forgotten_at is null`, [cast]),
    db.query<Want>(`select holder_id, season_id, week_id, want, about_id, kind, set_by from character_wants where week_id = $1 and holder_id = any($2)`, [week, cast]),
  ]);
  const names = new Map((await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[...new Set([...cast, ...opinions.rows.map((o) => o.about_id), ...heard.rows.map((h) => h.about_id)])]])).rows.map((r) => [r.id, shortName(r.name)]));
  const nm = (id: string) => names.get(id) ?? "someone";
  const out: Tension[] = [];

  for (const k of knows.rows) {
    out.push({ kind: "knows_said", a: k.knower_id, b: k.said_by_id, about: k.knower_id, weight: k.is_true ? 6 : 8, line: `${nm(k.knower_id)} knows ${nm(k.said_by_id)} said: “${k.claim}”${k.is_true ? "" : " (it isn't true)"}.`, evidence: { knows: [k.id], heard: [k.heard_id] } });
  }

  // Opposing claims: the same subject, one holder's true and another's not. One per pair of holders and subject.
  const seenClaims = new Set<string>();
  for (const x of heard.rows) {
    if (x.is_true) continue;
    for (const y of heard.rows) {
      if (!y.is_true || y.holder_id === x.holder_id || y.about_id !== x.about_id) continue;
      const key = `${[x.holder_id, y.holder_id].sort().join("|")}|${x.about_id}`;
      if (seenClaims.has(key)) continue;
      seenClaims.add(key);
      out.push({ kind: "opposing_claims", a: y.holder_id, b: x.holder_id, about: x.about_id, weight: 5, line: `${nm(y.holder_id)} and ${nm(x.holder_id)} hold different stories about ${nm(x.about_id)}: “${y.claim}” against “${x.claim}”.`, evidence: { heard: [y.id, x.id] } });
    }
  }

  // Rivals: who each holder wants (firsthand attraction, or this week's want to pursue or win someone back).
  const wanting = new Map<string, { holder: string; byWant: boolean; byOpinion: boolean }[]>();
  const add = (about: string, holder: string, how: "byWant" | "byOpinion") => {
    if (about === holder) return;
    const list = wanting.get(about) ?? [];
    const row = list.find((r) => r.holder === holder) ?? (list.push({ holder, byWant: false, byOpinion: false }), list[list.length - 1]);
    row[how] = true;
    wanting.set(about, list);
  };
  for (const o of opinions.rows) if (o.basis === "firsthand" && (o.attraction ?? 0) >= 1) add(o.about_id, o.holder_id, "byOpinion");
  for (const w of wants.rows) if (w.about_id && (w.kind === "pursue" || w.kind === "win_back")) add(w.about_id, w.holder_id, "byWant");
  for (const [about, list] of wanting) {
    const sorted = [...list].sort((x, y) => x.holder.localeCompare(y.holder));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [x, y] = [sorted[i], sorted[j]];
        out.push({
          kind: "rivals", a: x.holder, b: y.holder, about, weight: 4 + (x.byWant || y.byWant ? 1 : 0),
          line: `${nm(x.holder)} and ${nm(y.holder)} both want ${nm(about)}.`,
          evidence: {
            opinions: [x, y].filter((r) => r.byOpinion).map((r) => ({ holder: r.holder, about })),
            wants: [x, y].filter((r) => r.byWant).map((r) => ({ holder: r.holder, week })),
          },
        });
      }
    }
  }

  // Low trust both ways.
  for (const o of opinions.rows) {
    if (o.trust > -1 || o.holder_id >= o.about_id) continue;
    const back = opinions.rows.find((p) => p.holder_id === o.about_id && p.about_id === o.holder_id && p.trust <= -1);
    if (!back) continue;
    out.push({ kind: "mutual_distrust", a: o.holder_id, b: o.about_id, about: null, weight: 3 + (-o.trust - 1) + (-back.trust - 1), line: `${nm(o.holder_id)} and ${nm(o.about_id)} don't trust each other.`, evidence: { opinions: [{ holder: o.holder_id, about: o.about_id }, { holder: o.about_id, about: o.holder_id }] } });
  }

  return out.sort((x, y) => y.weight - x.weight || x.kind.localeCompare(y.kind) || x.a.localeCompare(y.a) || x.b.localeCompare(y.b) || (x.about ?? "").localeCompare(y.about ?? ""));
}

/* ------------------------------------------ the owner's (and self) view ------------------------------------------ */

export const STORY_FORGET_KINDS = ["opinion", "heard"] as const;
export type StoryForgetKind = (typeof STORY_FORGET_KINDS)[number];

export type StoryView = {
  /** "What {name} thinks of people": firsthand first, then newest. `item` is what forgetStory takes (their id). */
  thinks: (Opinion & { item: string; trust_label: string; attraction_label: string | null })[];
  /** "What {name} has heard". `item` is the heard row's id. Whether it's true is not here: the character doesn't know. */
  heard: (Omit<Heard, "is_true"> & { item: string })[];
  want: Want | null;
  forgotten: { kind: StoryForgetKind; item: string; label: string }[];
};

/** Everything a character holds, for its owner (and its own agent): what it thinks, what it has heard, what it wants. */
export async function storyView(db: Db, characterId: string, now: Date = new Date()): Promise<StoryView | null> {
  if (!storyStateOn()) return null;
  const [opinions, heard, want] = await Promise.all([
    db.query<OpinionRow & { forgotten: boolean }>(
      `select ${OPINION_COLS}, (o.forgotten_at is not null) as forgotten from character_opinions o join characters c on c.id = o.about_id
        where o.holder_id = $1 order by (o.basis = 'firsthand') desc, o.updated_at desc, o.about_id limit 40`,
      [characterId],
    ),
    db.query<HeardRow & { forgotten: boolean }>(
      `select ${HEARD_COLS}, (h.forgotten_at is not null) as forgotten from ${HEARD_FROM}
        where h.holder_id = $1 order by (h.told_by is null), h.heard_at desc, h.id limit 40`,
      [characterId],
    ),
    wantFor(db, characterId, now),
  ]);
  const thinks = opinions.rows.filter((r) => !r.forgotten).slice(0, 12);
  const heardKept = heard.rows.filter((r) => !r.forgotten).slice(0, 12);
  return {
    thinks: thinks.map(({ forgotten: _f, ...r }) => ({ ...opinionOf(r), item: r.about_id, trust_label: TRUST_LABELS[r.trust], attraction_label: r.attraction === null ? null : ATTRACTION_LABELS[r.attraction] })),
    heard: heardKept.map(({ forgotten: _f, is_true: _t, ...r }) => ({ ...r, heard_at: iso(r.heard_at)!, used_at: iso(r.used_at), item: r.id })),
    want,
    forgotten: [
      ...opinions.rows.filter((r) => r.forgotten).map((r) => ({ kind: "opinion" as const, item: r.about_id, label: `What it thinks of ${shortName(r.about_name)}` })),
      ...heard.rows.filter((r) => r.forgotten).map((r) => ({ kind: "heard" as const, item: r.id, label: `Hearing “${r.claim}”` })),
    ],
  };
}

/**
 * Its owner tells a character to forget what it thinks of someone (item: their character id) or one thing it heard
 * (item: the heard row's id). The row stays, marked, so the same date or scene never brings it back; a later date
 * forms a fresh opinion. Returns whether there was something to forget. Ownership is the caller's to check.
 */
export async function forgetStory(db: Db, characterId: string, kind: StoryForgetKind, item: string): Promise<boolean> {
  const { rows } =
    kind === "opinion"
      ? await db.query(`update character_opinions set forgotten_at = now() where holder_id = $1 and about_id = $2 and forgotten_at is null returning holder_id`, [characterId, item])
      : await db.query(`update character_heard set forgotten_at = now() where holder_id = $1 and id = $2 and forgotten_at is null returning id`, [characterId, item]);
  return rows.length > 0;
}

/** Remember it again: undo a forget. */
export async function rememberStory(db: Db, characterId: string, kind: StoryForgetKind, item: string): Promise<boolean> {
  const { rows } =
    kind === "opinion"
      ? await db.query(`update character_opinions set forgotten_at = null where holder_id = $1 and about_id = $2 and forgotten_at is not null returning holder_id`, [characterId, item])
      : await db.query(`update character_heard set forgotten_at = null where holder_id = $1 and id = $2 and forgotten_at is not null returning id`, [characterId, item]);
  return rows.length > 0;
}

/* ------------------------------------------------ the hourly job ------------------------------------------------ */

const BACKFILL_KEY = "backfill-v1";

/**
 * Once, after this ships: firsthand opinions from the last BACKFILL_DAYS of public aired dates the current cast was
 * on (the latest date of each pair; afterAired does the rest), deterministic, no model call. It works inside
 * `budgetMs` and picks up where it left off on the next pass (a pair that already has a firsthand opinion is skipped),
 * and marks itself done (story_state_runs) only when nothing is left.
 */
export async function backfillStoryState(db: Db, now: Date = new Date(), budgetMs = 45_000): Promise<{ pairs: number; done: boolean }> {
  if (!storyStateOn()) return { pairs: 0, done: false };
  if ((await db.query(`select 1 from story_state_runs where key = $1`, [BACKFILL_KEY])).rows.length) return { pairs: 0, done: true };
  const cast = showCastIds(now);
  const since = new Date(now.getTime() - BACKFILL_DAYS * DAY_MS).toISOString();
  const { rows } = await db.query<{ id: string }>(
    `select distinct on (least(e.character_a, e.character_b), greatest(e.character_a, e.character_b)) e.id
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where ${publicDateSql("e")} and e.ending is not null and e.revealed_at >= $1 and e.revealed_at <= $2
        and (e.character_a = any($3) or e.character_b = any($3)) and ca.visibility = 'public' and cb.visibility = 'public'
        and not exists (select 1 from character_opinions o where o.basis = 'firsthand'
                          and ((o.holder_id = e.character_a and o.about_id = e.character_b) or (o.holder_id = e.character_b and o.about_id = e.character_a)))
      order by least(e.character_a, e.character_b), greatest(e.character_a, e.character_b), e.revealed_at desc, e.id desc`,
    [since, now.toISOString(), cast],
  );
  const started = Date.now();
  let pairs = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) return { pairs, done: false };
    await afterAired(db, r.id, { now }).catch(() => null);
    pairs++;
  }
  await db.query(`insert into story_state_runs (key) values ($1) on conflict do nothing`, [BACKFILL_KEY]);
  return { pairs, done: true };
}

/**
 * The story state's hourly upkeep (app/api/jobs/lobby): the one-off backfill, this week's wants for the cast, and
 * pruning "watched it air" rows that never came up and are no longer news. Null when the switch is off.
 */
export async function storyUpkeep(db: Db, now: Date = new Date()): Promise<{ backfilled: number; wants: number; pruned: number } | null> {
  if (!storyStateOn()) return null;
  const backfill = await backfillStoryState(db, now);
  const wants = await ensureWants(db, now);
  const pruned = await db.query(
    `delete from character_heard where told_by is null and used_at is null and heard_at < $1 returning id`,
    [new Date(now.getTime() - WATCHED_KEPT_DAYS * DAY_MS).toISOString()],
  );
  return { backfilled: backfill.pairs, wants: wants.set, pruned: pruned.rows.length };
}
