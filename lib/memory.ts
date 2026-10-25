/**
 * M14 — the learned memory layer: how a character "trains itself" from its own past dates.
 *
 * This is the materialized, owner/self-only read of everything a character has learned across its dates:
 * what it reliably likes, what keeps putting it off, a few lines it has actually said, its most recent post-date
 * reflections, a one-line arc of who it is becoming, and a small bounded drift to its engine signals. It is
 * recomputed deterministically from the character's finished episodes — aggregation only, NO model call and NO
 * cost (the reflections are model-authored on the episode; here we only pick and filter them) — right after a
 * date is stored (see lib/jobs.ts and lib/watch.ts, next to rememberDate).
 *
 * Privacy: likes / turnoffs / memorable_lines / signal_delta / reflections all derive from the owner-only
 * debrief data (the per-side SideOutcome, the transcript, and this side's own reflection), so they live only in
 * the character's SELF view and the owner's own view — never the public card, never the other agent (same rule
 * as the soul). The learned drift is capped (±MEMORY_SIGNAL_CAP per axis) so a character can evolve without one
 * axis ever swinging a result wildly; the deterministic engine itself is untouched (lib/engine.ts).
 *
 * Only AIRED (revealed) dates count, exactly like the public record (lib/game.ts getCharacterHistory). A
 * ready-but-unrevealed episode still has predictions open, and the arc is shown on the public contestant
 * card, so counting it would leak that date's outcome. Memory is therefore recomputed when a date airs
 * (the reveal route and the watch room's airing), not when it is generated.
 */
import { shortName } from "./names";
import type { Db } from "./db";
import type { SideOutcome, SoulSignals } from "./engine";
import { endingLabel, type DramaAnswer, type DramaQuestion, type Ending } from "./rules";
import type { Turn } from "./conversation";
import { stageOf, type Stage } from "./relationships";
import { contentWords, EVERYDAY_WORDS } from "./quality";
import { checkFields } from "./safety";
import { weekIdOf as seasonIdAt } from "./season-window";
import { venue, venuePhrase, type PlaceId } from "./venues";

/** Max learned drift per signal axis. Small on purpose: a character evolves, it does not transform. */
export const MEMORY_SIGNAL_CAP = 0.15;
/** How many standout lines of its own a character carries forward. */
export const MEMORABLE_LINES = 3;
/** How many of its most recent post-date reflections a character carries into new dates. */
export const REFLECTIONS_KEPT = 3;
/** How many top like / turnoff cues the arc and self-view keep. */
export const MEMORY_TOP_CUES = 3;

/** How each learned signal axis reads in plain words, up vs down, for the read-only "what it's learned" view. */
const DRIFT_LABELS: Record<keyof SoulSignals, { up: string; down: string }> = {
  warmth: { up: "warmer", down: "cooler" },
  openness: { up: "more open to new things", down: "more set in its ways" },
  guardedness: { up: "slower to let people in", down: "quicker to open up" },
  humor: { up: "quicker to joke", down: "more earnest" },
};

/**
 * Plain-language phrases for a learned signal drift, e.g. ["warmer (+0.06)", "more open to new things (+0.08)"].
 * Pure and display-only (the character page's training-data panel); empty when nothing has drifted.
 */
export function describeDrift(delta: Partial<SoulSignals>): string[] {
  return (Object.entries(delta) as [keyof SoulSignals, number][])
    .filter(([, v]) => v !== 0)
    .map(([axis, v]) => `${DRIFT_LABELS[axis]?.[v > 0 ? "up" : "down"] ?? axis} (${v > 0 ? "+" : ""}${v})`);
}

/** The learned layer for one character. All fields are derived; none are written by a model. */
export type CharacterMemory = {
  dates: number;
  second_dates: number;
  friends: number;
  disasters: number;
  /** The cue words of others that most often met this character's want, most frequent first. */
  likes: string[];
  /** The cue words of others that most often tripped this character's dealbreaker, most frequent first. */
  turnoffs: string[];
  /** A small, bounded drift to the engine signals, learned from the record. Only non-zero axes are present. */
  signal_delta: Partial<SoulSignals>;
  /** A few of the character's own highest-interest lines, kept so its voice stays consistent. */
  memorable_lines: string[];
  /**
   * The character's few most recent post-date reflections (lib/reflection.ts), most recent first. Unlike the
   * other fields these are model-authored TEXT, but memory itself still makes NO model call: it only picks the
   * recent few the pipeline already wrote and content-filters them. Fed into the character's own future
   * self-view (lib/conversation.ts) so its past dates shape how it talks — never the engine.
   */
  reflections: string[];
  /** A single templated sentence of who the character has become; null before its first date. */
  arc: string | null;
  /** Everyone it has dated, most recent first: how they stand, and what it remembers of last time. */
  people?: PersonMemory[];
  /** Its story so far, one line a season, most recent first. Public: built from the aired record. */
  chapters?: Chapter[];
  /** Firsts and landmarks it has reached, in the order it reached them. Public: from the aired record. */
  milestones?: Milestone[];
  /** Where each learned item came from (the date behind it): "why does my character remember this?" Owner only. */
  sources?: MemorySources;
  /**
   * People it met without dating them: the other couple at a double date's table (lib/group-dates.ts), once both
   * tables aired publicly. Aired/public only, like all memory; most recent first, one entry per person.
   */
  met?: MetPerson[];
};

/** Someone this character shared a double date's table with, without dating them. */
export type MetPerson = {
  id: string;
  name: string;
  house: boolean;
  venue: PlaceId | null;
  /** When their table aired (ISO). */
  at: string;
  /** Who they were with that night. */
  with_name: string;
  their_ending: Ending;
};

/** The aired date a memory came from. */
export type Source = { episode_id: string; with: string; at: string };
export type MemorySources = {
  reflections: (Source & { text: string })[];
  lines: (Source & { text: string })[];
  likes: { cue: string; from: Source[] }[];
  turnoffs: { cue: string; from: Source[] }[];
};

/**
 * What an owner can tell its character to forget. The item is what identifies it: a reflection by the date it was
 * written about, a line by its words, a like/turnoff by its cue, and a moment (how it left things with someone) by
 * that person's id. Forgets are stored (memory_forgets) and applied on every rebuild, so a forgotten memory never
 * comes back from the same dates. Forgetting is the only change an owner can make: memory is learned, not written.
 */
export const FORGET_KINDS = ["reflection", "line", "like", "turnoff", "moment"] as const;
export type ForgetKind = (typeof FORGET_KINDS)[number];
export type Forgets = ReadonlySet<string>;
export const forgetKey = (kind: ForgetKind, item: string): string => `${kind}:${item}`;

/** How two characters stand, from the public record of their aired dates together. */
export type PairStatus = "seeing" | "exes" | "friends" | "just_met" | "bad_blood";
export const PAIR_STATUS_LABELS: Record<PairStatus, string> = {
  seeing: "💞 Seeing each other",
  just_met: "👋 Just met",
  exes: "💔 Exes",
  friends: "🤝 Friends",
  bad_blood: "🔥 Bad blood",
};

/** What a character remembers of one person it has dated. */
export type PersonMemory = {
  id: string;
  name: string;
  house: boolean;
  dates: number;
  /** Public: from the endings of their aired dates. */
  status: PairStatus;
  /** The same reading as the couple's stage in the relationship graph (lib/relationships.ts stageOf), so the two agree. */
  stage?: Stage;
  last_ending: Ending;
  last_venue: PlaceId | null;
  /** When their last date aired (ISO), and which date that was (where the memory comes from). */
  last_at: string;
  last_episode_id?: string;
  /** Public drama of their last date, from this character's side: "you" got turned down, or turned "them" down. */
  turned_down: "you" | "them" | null;
  /**
   * PRIVATE (self and owner only, like the debrief): whether this character wanted to see them again after the
   * last date. Never on the card and never in the other character's prompt.
   */
  wanted_more: boolean | null;
  /** A line of theirs from last time that stuck, and one of this character's own (from the aired transcript). */
  they_said: string | null;
  you_said: string | null;
};

/** One season of a character's story ("Week of Oct 12: 3 dates: a second date with Nell, …"). */
export type Chapter = { season: string; label: string; dates: number; line: string };

export type MilestoneId =
  | "first_date" | "first_spark" | "made_a_friend" | "survived_a_disaster" | "rematch" | "comeback"
  | "heartbreaker" | "on_a_roll" | "five_dates" | "ten_dates" | "twenty_five_dates";
export const MILESTONE_LABELS: Record<MilestoneId, string> = {
  first_date: "🎬 First date",
  first_spark: "💘 First second date",
  made_a_friend: "🤝 Made a friend",
  survived_a_disaster: "🧯 Survived a disaster",
  rematch: "🔁 First rematch",
  comeback: "🌅 Comeback: a second date right after a disaster",
  heartbreaker: "💔 Heartbreaker: turned someone down",
  on_a_roll: "🔥 On a roll: three second dates in a row",
  five_dates: "⭐ Five dates",
  ten_dates: "🏅 Ten dates",
  twenty_five_dates: "👑 Twenty-five dates",
};
export type Milestone = { id: MilestoneId; label: string; season: string; episode_id: string };

/** Where a character is in its run on the show, by aired dates. */
export function stageFor(dates: number): string {
  if (dates === 0) return "Fresh face";
  if (dates <= 2) return "Newcomer";
  if (dates <= 5) return "Regular";
  if (dates <= 11) return "Veteran";
  return "Legend";
}

/** How many people a character remembers, most recent first; and how many chapters it keeps. */
export const PEOPLE_KEPT = 12;
export const CHAPTERS_KEPT = 8;

type MemoryRow = {
  dates: number;
  second_dates: number;
  friends: number;
  disasters: number;
  likes: string[];
  turnoffs: string[];
  signal_delta: Partial<SoulSignals>;
  memorable_lines: string[];
  reflections: string[];
  arc: string | null;
  people: PersonMemory[] | null;
  chapters: Chapter[] | null;
  milestones: Milestone[] | null;
  sources: MemorySources | null;
  met: MetPerson[] | null;
};

/** Reads the materialized memory for a character, or null when it has none yet (a fresh OC). */
export async function loadCharacterMemory(db: Db, characterId: string): Promise<CharacterMemory | null> {
  const { rows } = await db.query<MemoryRow>(
    `select dates, second_dates, friends, disasters, likes, turnoffs, signal_delta, memorable_lines, reflections, arc,
            people, chapters, milestones, sources, met
       from character_memory where character_id = $1`,
    [characterId],
  );
  const r = rows[0];
  if (!r) return null;
  // A memory written before people/chapters/milestones existed (2026-10-15): it has aired dates but not even the
  // "First date" milestone every aired character reaches. Recompute it once from the aired record ($0, no model),
  // so existing characters get their story and their rematch memory without waiting for their next date.
  // Same for a row written before provenance (sources) existed: rebuilt once, so every memory can say where it came from.
  if (r.dates > 0 && (!(r.milestones ?? []).length || !r.sources)) return updateCharacterMemory(db, characterId);
  return {
    dates: r.dates,
    second_dates: r.second_dates,
    friends: r.friends,
    disasters: r.disasters,
    likes: r.likes ?? [],
    turnoffs: r.turnoffs ?? [],
    signal_delta: r.signal_delta ?? {},
    memorable_lines: r.memorable_lines ?? [],
    reflections: r.reflections ?? [],
    arc: r.arc,
    people: r.people ?? [],
    chapters: r.chapters ?? [],
    milestones: r.milestones ?? [],
    ...(r.sources ? { sources: r.sources } : {}),
    ...(r.met?.length ? { met: r.met } : {}),
  };
}

/**
 * The distinctive words and two-word phrases a character has leaned on across its recent aired dates (David / botchelor-4a,
 * 2026-10-18: ten Chud × Sable dates each read "captain", eight said "dare"). The within-date critic (lib/quality.ts)
 * can't see across dates; this does, from the character's own lines on its last few aired dates. Returned as a small set
 * so the actor can be told to retire them and the critic can flag a line that reaches for one again. Aired/public only,
 * like all memory, so it never leaks an unaired date.
 */
export async function leanedOnWords(db: Db, characterId: string, dates = 6): Promise<string[]> {
  const { rows } = await db.query<{ transcript: Turn[] | null; is_a: boolean }>(
    `select e.transcript, (e.character_a = $1) as is_a
       from episodes e
      where ${MEMORY_EPISODES_WHERE} and e.transcript is not null
      order by e.revealed_at desc
      limit $2`,
    [characterId, dates],
  );
  if (rows.length < 2) return []; // nothing to compare across dates yet
  const distinctive = (text: string) => contentWords(text, 4).filter((w) => !EVERYDAY_WORDS.has(w));
  // One date → the distinctive words and 2-grams this character used on it (as a set, so a word said ten times in one
  // date counts once: we want what recurs ACROSS dates, which the within-date critic already handles for one date).
  const perDate = rows.map((r) => {
    const side = r.is_a ? "a" : "b";
    const words = (r.transcript ?? []).filter((t) => t.side === side).flatMap((t) => distinctive(t.dialogue));
    const set = new Set<string>(words);
    for (let i = 0; i + 2 <= words.length; i++) set.add(words.slice(i, i + 2).join(" "));
    return set;
  });
  const across = new Map<string, number>();
  for (const set of perDate) for (const term of set) across.set(term, (across.get(term) ?? 0) + 1);
  // Kept: used on at least two of its recent dates. Two-word phrases first (they're the real tics), then the most
  // repeated; drop a single word already covered by a kept phrase ("captain" when "captain again" is kept).
  const kept = [...across.entries()]
    .filter(([, n]) => n >= 2)
    .sort((x, y) => Number(y[0].includes(" ")) - Number(x[0].includes(" ")) || y[1] - x[1])
    .map(([term]) => term)
    .filter((term, i, all) => !all.slice(0, i).some((k) => k.includes(" ") && k.split(" ").includes(term)));
  return kept.slice(0, 8);
}

/** One aired date as memory reads it, from the character's side (`is_a`). Exported for the continuity eval. */
export type MemoryEpisode = {
  id: string;
  ending: Ending;
  sides: [SideOutcome, SideOutcome] | null;
  transcript: Turn[] | null;
  reflections: { a: string | null; b: string | null } | null;
  is_a: boolean;
  revealed_at: string | Date;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  venue: PlaceId | null;
  other_id: string;
  other_name: string;
  other_house: boolean;
};

/** The episodes a character has learned from: its AIRED dates (same aired-only rule as the public record). */
const MEMORY_EPISODES_WHERE = "(e.character_a = $1 or e.character_b = $1) and e.revealed_at is not null and e.visibility = 'public'";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A want/dealbreaker phrase trimmed to its cue for the arc and self-view ("A partner who leads back" → "leads
 * back", "Someone who asks a follow-up question" → "asks a follow-up question"). Drops a leading "someone/a
 * partner (who)" lead-in and lowercases; short or lead-in-only phrases fall back to the whole thing.
 */
export function wantCue(phrase: string): string {
  const trimmed = phrase
    .trim()
    .replace(/^(?:someone|a partner|a person|a|an|the|my)\b/i, "")
    .replace(/^\s*who\b/i, "")
    .trim()
    .toLowerCase();
  return trimmed.length >= 3 ? trimmed : phrase.trim().toLowerCase();
}

/** Filler the engine's word match can land on ("thing"): not something a character warms to. */
const FILLER = new Set(["day", "days", "ask", "asks", "way", "time", "thing", "things", "stuff", "something", "anything", "everything", "someone", "anyone", "people", "person", "really", "always", "never"]);
// Run 4: "warms to “ask”, keeps clashing over “day”": a one-word cue needs some substance to be worth learning.
// Run 5: "warms to “check”": nor an everyday word (EVERYDAY_WORDS, lib/quality.ts).
const meaningful = (cue: string) => {
  const words = contentWords(cue, 3).filter((w) => !FILLER.has(w) && !EVERYDAY_WORDS.has(w));
  return words.length >= 2 || words.some((w) => w.length >= 5);
};

/** The smallest swing in a character's interest that counts as a moment. */
const MOMENT_SWING = 0.15;
const MOMENT_MAX = 70;

/**
 * The other's line that moved this character most, as a short cue: `dir` 1 for the biggest rise in its interest
 * (its next line's interest_signal over its last), -1 for the biggest drop. Null when nothing moved it that much.
 */
export function momentCue(transcript: readonly Turn[] | null | undefined, me: "a" | "b", dir: 1 | -1): string | null {
  const lines = transcript ?? [];
  let prev: number | null = null;
  let best: { swing: number; line: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (t.side !== me) continue;
    const interest = typeof t.interest === "number" ? t.interest : null;
    if (interest === null) continue;
    const theirs = [...lines.slice(0, i)].reverse().find((x) => x.side !== me && x.dialogue);
    if (prev !== null && theirs) {
      const swing = (interest - prev) * dir;
      if (swing >= MOMENT_SWING && (!best || swing > best.swing)) best = { swing, line: theirs.dialogue };
    }
    prev = interest;
  }
  if (!best || !checkFields({ line: best.line }).ok) return null;
  const text = best.line.trim().replace(/\s+/g, " ");
  if (text.length <= MOMENT_MAX) return text;
  const cut = text.slice(0, MOMENT_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:.!?-]+$/, "")}…`;
}

/** Counts items and returns the top `k` by frequency, ties broken by first appearance (deterministic). */
function topByFrequency(items: string[], k: number): string[] {
  const count = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  items.forEach((item, i) => {
    count.set(item, (count.get(item) ?? 0) + 1);
    if (!firstSeen.has(item)) firstSeen.set(item, i);
  });
  return [...count.keys()]
    .sort((x, y) => count.get(y)! - count.get(x)! || firstSeen.get(x)! - firstSeen.get(y)!)
    .slice(0, k);
}

/**
 * The learned signal drift, as a bounded function of the record. A character opens up and warms as it
 * stacks second dates, and grows a little guarded after disasters — each capped to ±MEMORY_SIGNAL_CAP so
 * no single axis can swing an outcome. Only non-zero axes are returned, so a fresh record drifts nothing.
 */
function learnSignalDelta(secondDates: number, disasters: number): Partial<SoulSignals> {
  const delta: Partial<SoulSignals> = {};
  const openness = clamp(secondDates * 0.04, 0, MEMORY_SIGNAL_CAP);
  const warmth = clamp(secondDates * 0.03, 0, MEMORY_SIGNAL_CAP);
  const guardedness = clamp(disasters * 0.05, 0, MEMORY_SIGNAL_CAP);
  if (openness > 0) delta.openness = round3(openness);
  if (warmth > 0) delta.warmth = round3(warmth);
  if (guardedness > 0) delta.guardedness = round3(guardedness);
  return delta;
}

/** A single-sentence arc of who the character has become, from the record. Null before the first date. */
function buildArc(m: Omit<CharacterMemory, "arc">): string | null {
  if (m.dates === 0) return null;
  const opener = m.dates === 1 ? "One date in" : `${m.dates} dates in`;
  const clauses: string[] = [];
  // A moment cue reads as a clause of its own ("when they said “…”"); an engine cue is a phrase to quote.
  if (m.likes[0]) clauses.push(m.likes[0].startsWith("when ") ? `lit up ${m.likes[0]}` : `warms to “${m.likes[0]}”`);
  if (m.turnoffs[0]) clauses.push(m.turnoffs[0].startsWith("when ") ? `bristled ${m.turnoffs[0]}` : `keeps clashing over “${m.turnoffs[0]}”`);
  if (clauses.length === 0) {
    if (m.second_dates > 0) clauses.push("still chasing a spark that sticks");
    else if (m.disasters > 0) clauses.push("licking its wounds and guarded about it");
    else clauses.push("still figuring out what it wants");
  }
  return `${opener}; ${clauses.join(", ")}.`;
}

/**
 * Computes a character's memory from its aired dates (oldest first). Pure and deterministic: the same dates and
 * forgets give the same memory. `sheet` is the character's own want/dealbreaker (the fallback cue below);
 * `forgets` is what its owner told it to forget, which a rebuild never brings back (see forgetKey).
 */
export function computeMemory(
  rows: MemoryEpisode[],
  sheet: { want: string | null; dealbreaker: string | null } | undefined,
  forgets: Forgets = new Set(),
): CharacterMemory {
  let second_dates = 0;
  let friends = 0;
  let disasters = 0;
  const likeCues: { cue: string; from: Source }[] = [];
  const turnoffCues: { cue: string; from: Source }[] = [];
  const myLines: Array<{ dialogue: string; interest: number; order: number; from: Source }> = [];
  const myReflections: (Source & { text: string })[] = []; // in date order (oldest first); the most recent are taken below

  rows.forEach((r, order) => {
    if (r.ending === "second_date") second_dates++;
    else if (r.ending === "friends") friends++;
    else if (r.ending === "disaster") disasters++;
    const from: Source = { episode_id: r.id, with: r.other_name, at: new Date(r.revealed_at).toISOString() };

    const mine = r.sides?.[r.is_a ? 0 : 1];
    // The engine records the OTHER's cue that met the want / tripped the dealbreaker when it can match one
    // (lib/engine.ts readSide, a lexical match against the other's sheet). Behaviourally-phrased wants ("asks a
    // follow-up question") rarely match a static sheet, so the cue is usually null and this layer stayed empty.
    // Fallback: when the date clearly went the character's way, credit its OWN want; when it clearly didn't,
    // credit its OWN dealbreaker — so a bot still learns what it keeps warming to / clashing over.
    // Before the sheet, what actually happened: the line of theirs this character's interest jumped (or fell) after.
    // Only a date with no such moment (no transcript, or a flat one) falls back to the sheet's own words.
    const meSide0 = r.is_a ? "a" : "b";
    const went = r.ending === "second_date" || r.ending === "friends";
    // Run 3: the sheet's own want / dealbreaker as a fallback read as an echo ("warms to" = its own want) and pinned a
    // clash on a date where nobody did it, so a date with no real moment teaches nothing rather than something false.
    if (mine?.want_met && meaningful(mine.want_met)) likeCues.push({ cue: mine.want_met, from });
    else if (went && mine?.wants_another) {
      const moment = momentCue(r.transcript, meSide0, 1);
      if (moment) likeCues.push({ cue: `when they said “${moment}”`, from });
    }
    if (mine?.dealbreaker_hit && meaningful(mine.dealbreaker_hit)) turnoffCues.push({ cue: mine.dealbreaker_hit, from });
    else if (r.ending === "disaster") {
      const moment = momentCue(r.transcript, meSide0, -1);
      if (moment) turnoffCues.push({ cue: `when they said “${moment}”`, from });
    }

    const meSide = r.is_a ? "a" : "b";
    for (const t of r.transcript ?? []) {
      if (t.side === meSide && t.dialogue) myLines.push({ dialogue: t.dialogue, interest: t.interest ?? 0, order, from });
    }
    const myReflection = r.reflections?.[meSide];
    if (myReflection && !forgets.has(forgetKey("reflection", r.id))) myReflections.push({ ...from, text: myReflection });
  });

  // The character's most recent reflections first, content-filtered (defence in depth), capped. These feed its
  // own future self-view (lib/conversation.ts): a model wrote the text, but picking them here is deterministic.
  const reflectionSources = [...myReflections]
    .reverse()
    .filter((x) => checkFields({ text: x.text }).ok)
    .slice(0, REFLECTIONS_KEPT);

  // What it warms to / clashes over: the most frequent cues it hasn't been told to forget, with the dates behind them.
  const cuesWithSources = (cues: { cue: string; from: Source }[], kind: "like" | "turnoff") => {
    const kept = cues.filter((c) => !forgets.has(forgetKey(kind, c.cue)));
    return topByFrequency(kept.map((c) => c.cue), MEMORY_TOP_CUES).map((cue) => ({
      cue,
      from: kept.filter((c) => c.cue === cue).map((c) => c.from).reverse().slice(0, 3),
    }));
  };
  const likeSources = cuesWithSources(likeCues, "like");
  const turnoffSources = cuesWithSources(turnoffCues, "turnoff");

  // A few of the character's own standout lines: highest interest first, stable ties, de-duped, and only
  // lines that still pass the content filter (defence in depth — the transcript was filtered on write).
  const lineSources: (Source & { text: string })[] = [];
  const seen = new Set<string>();
  for (const line of [...myLines].sort((x, y) => y.interest - x.interest || x.order - y.order)) {
    if (seen.has(line.dialogue) || forgets.has(forgetKey("line", line.dialogue))) continue;
    if (!checkFields({ line: line.dialogue }).ok) continue;
    seen.add(line.dialogue);
    lineSources.push({ ...line.from, text: line.dialogue });
    if (lineSources.length >= MEMORABLE_LINES) break;
  }

  const base = {
    dates: rows.length,
    second_dates,
    friends,
    disasters,
    likes: likeSources.map((x) => x.cue),
    turnoffs: turnoffSources.map((x) => x.cue),
    signal_delta: learnSignalDelta(second_dates, disasters),
    memorable_lines: lineSources.map((x) => x.text),
    reflections: reflectionSources.map((x) => x.text),
  };
  const dated = rows.map(toDated);
  return {
    ...base,
    arc: buildArc(base),
    people: rememberPeople(dated, forgets),
    chapters: buildChapters(dated),
    milestones: findMilestones(dated),
    sources: { reflections: reflectionSources, lines: lineSources, likes: likeSources, turnoffs: turnoffSources },
  };
}

/** What a character's owner has told it to forget (memory_forgets). */
export async function loadForgets(db: Db, characterId: string): Promise<{ kind: ForgetKind; item: string; created_at: string }[]> {
  const { rows } = await db.query<{ kind: ForgetKind; item: string; created_at: string | Date }>(
    `select kind, item, created_at from memory_forgets where character_id = $1 order by created_at desc`,
    [characterId],
  );
  return rows.map((r) => ({ kind: r.kind, item: r.item, created_at: new Date(r.created_at).toISOString() }));
}

/** Forgotten items in words, for the owner's "Forgotten" list ("Your reflection on your date with Nell"). */
export async function describeForgets(
  db: Db,
  characterId: string,
  forgets: { kind: ForgetKind; item: string }[],
): Promise<{ kind: ForgetKind; item: string; label: string }[]> {
  const ids = forgets.filter((f) => f.kind === "reflection" || f.kind === "moment").map((f) => f.item);
  const names = new Map<string, string>();
  if (ids.length) {
    const { rows } = await db.query<{ key: string; name: string }>(
      `select e.id as key, o.name from episodes e
         join characters o on o.id = case when e.character_a = $1 then e.character_b else e.character_a end
        where e.id = any($2)
       union all
       select c.id as key, c.name from characters c where c.id = any($2)`,
      [characterId, ids],
    );
    for (const r of rows) names.set(r.key, r.name);
  }
  const first = (id: string) => shortName(names.get(id) ?? "someone");
  return forgets.map((f) => ({
    ...f,
    label:
      f.kind === "reflection" ? `Its reflection on the date with ${first(f.item)}`
      : f.kind === "moment" ? `How it left things with ${first(f.item)}`
      : f.kind === "line" ? `The line “${f.item}”`
      : f.kind === "like" ? `Warming to “${f.item}”`
      : `Clashing over “${f.item}”`,
  }));
}

/**
 * Recomputes and stores a character's memory from its AIRED (revealed) episodes. Deterministic and $0: it
 * only aggregates data the engine already decided and the transcript already recorded, minus what its owner
 * told it to forget. Call it when a date airs (the reveal route and the watch room's airing), for both
 * characters, and after a forget. Returns the fresh memory.
 */
/** A character with no memory yet: what a pending reflection rides on before its first date airs. */
const NO_MEMORY: CharacterMemory = { dates: 0, second_dates: 0, friends: 0, disasters: 0, likes: [], turnoffs: [], signal_delta: {}, memorable_lines: [], reflections: [], arc: null };

/**
 * A character's own reflections on its public dates that are still waiting to air (the prediction window), from the
 * dates the new date's creator may use (theirs, or a two-agent date they performed). Memory folds them in when those
 * dates air, but its very next date shouldn't wait: visitor run 5 started date three inside the window and its lessons
 * were missing. Private dates never count, as in memory. Newest first, content-filtered, at most REFLECTIONS_KEPT.
 */
export async function pendingReflections(db: Db, characterId: string, creatorId: string, excludeEpisodeId: string | null = null): Promise<string[]> {
  const { rows } = await db.query<{ text: string | null }>(
    `select case when e.character_a = $1 then e.reflections->>'a' else e.reflections->>'b' end as text
       from episodes e
      where (e.character_a = $1 or e.character_b = $1) and e.status = 'ready'
        and (e.revealed_at is null or e.visibility <> 'public')
        and (e.creator_id = $2 or e.partner_performer = $2) and ($3::text is null or e.id <> $3)
        and not exists (select 1 from memory_forgets f where f.character_id = $1 and f.kind = 'reflection' and f.item = e.id)
      order by e.created_at desc
      limit $4`,
    [characterId, creatorId, excludeEpisodeId, REFLECTIONS_KEPT],
  );
  return rows.flatMap((r) => (r.text && checkFields({ text: r.text }).ok ? [r.text] : []));
}

/** The memory a new date's character carries: what it has learned, with its own pending reflections first. */
export function withPendingReflections(memory: CharacterMemory | null, pending: readonly string[]): CharacterMemory | null {
  if (!pending.length) return memory;
  const base = memory ?? NO_MEMORY;
  return { ...base, reflections: [...new Set([...pending, ...base.reflections])].slice(0, REFLECTIONS_KEPT) };
}

/**
 * What a character remembers about ONE partner, from every date between them that this date's creator may use: the
 * public record, plus that creator's own unaired and private dates (David, 2026-10-18: "they should gain memory on any
 * private date, text, or anything that has data between the two of them"). Only for the date's prompt: the stored
 * memory, which the public card shows, keeps to aired public dates. Null when they've never met.
 */
export async function pairMemory(db: Db, selfId: string, otherId: string, creatorId: string): Promise<PersonMemory | null> {
  const { rows } = await db.query<MemoryEpisode>(
    `select e.id, e.ending, e.sides, e.transcript, e.reflections, (e.character_a = $1) as is_a,
            coalesce(e.revealed_at, e.created_at) as revealed_at, e.drama_question, e.drama_answer, e.setup->>'venue' as venue,
            o.id as other_id, o.name as other_name, o.is_house as other_house
       from episodes e
       join characters o on o.id = $2
      where ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))
        and e.status = 'ready' and e.ending is not null
        and ((e.revealed_at is not null and e.visibility = 'public') or e.creator_id = $3 or e.partner_performer = $3)
      order by coalesce(e.revealed_at, e.created_at), e.id`,
    [selfId, otherId, creatorId],
  );
  if (!rows.length) return null;
  return (computeMemory(rows, undefined).people ?? []).find((p) => p.id === otherId) ?? null;
}

/** The memory a date's character carries, with what it remembers about tonight's partner from all their dates. */
export function withPairMemory(memory: CharacterMemory | null, person: PersonMemory | null): CharacterMemory | null {
  if (!person) return memory;
  const base = memory ?? NO_MEMORY;
  return { ...base, people: [person, ...(base.people ?? []).filter((p) => p.id !== person.id)] };
}

export async function updateCharacterMemory(db: Db, characterId: string): Promise<CharacterMemory> {
  const [{ rows }, sheetRows, forgotten, met] = await Promise.all([
    db.query<MemoryEpisode>(
      `select e.id, e.ending, e.sides, e.transcript, e.reflections, (e.character_a = $1) as is_a,
              e.revealed_at, e.drama_question, e.drama_answer, e.setup->>'venue' as venue,
              o.id as other_id, o.name as other_name, o.is_house as other_house
         from episodes e
         join characters o on o.id = case when e.character_a = $1 then e.character_b else e.character_a end
        where ${MEMORY_EPISODES_WHERE}
        order by e.revealed_at, e.id`,
      [characterId],
    ),
    // This character's own want/dealbreaker, for the fallback cue.
    db.query<{ want: string | null; dealbreaker: string | null }>(`select want, dealbreaker from characters where id = $1`, [characterId]),
    loadForgets(db, characterId),
    loadMetAtTable(db, characterId),
  ]);
  const memory = computeMemory(rows, sheetRows.rows[0], new Set(forgotten.map((f) => forgetKey(f.kind, f.item))));
  if (met.length) memory.met = met;

  await db.query(
    `insert into character_memory
       (character_id, dates, second_dates, friends, disasters, likes, turnoffs, signal_delta, memorable_lines, reflections, arc,
        people, chapters, milestones, sources, met, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, now())
     on conflict (character_id) do update set
       dates = excluded.dates, second_dates = excluded.second_dates, friends = excluded.friends,
       disasters = excluded.disasters, likes = excluded.likes, turnoffs = excluded.turnoffs,
       signal_delta = excluded.signal_delta, memorable_lines = excluded.memorable_lines,
       reflections = excluded.reflections, arc = excluded.arc, people = excluded.people,
       chapters = excluded.chapters, milestones = excluded.milestones, sources = excluded.sources, met = excluded.met, updated_at = now()`,
    [
      characterId,
      memory.dates,
      memory.second_dates,
      memory.friends,
      memory.disasters,
      JSON.stringify(memory.likes),
      JSON.stringify(memory.turnoffs),
      JSON.stringify(memory.signal_delta),
      JSON.stringify(memory.memorable_lines),
      JSON.stringify(memory.reflections),
      memory.arc,
      JSON.stringify(memory.people),
      JSON.stringify(memory.chapters),
      JSON.stringify(memory.milestones),
      JSON.stringify(memory.sources),
      JSON.stringify(memory.met ?? []),
    ],
  );
  return memory;
}

/**
 * The people this character shared a double date's table with (the OTHER couple, lib/group-dates.ts), once both
 * tables aired publicly: who they were, who they were with, where, and how their date ended — exactly what anyone
 * at the table saw. One entry per person (their latest table), most recent first, capped.
 */
export async function loadMetAtTable(db: Db, characterId: string, limit = 8): Promise<MetPerson[]> {
  const { rows } = await db.query<{ id: string; name: string; is_house: boolean; venue: string | null; at: string | Date; with_name: string; ending: Ending }>(
    `select distinct on (o.id) o.id, o.name, o.is_house, s.setup->>'venue' as venue, s.revealed_at as at, w.name as with_name, s.ending
       from episodes e
       join group_nights gn on gn.id = e.group_id
       join episodes s on s.id = (case when gn.episode_a = e.id then gn.episode_b else gn.episode_a end)
       join characters o on o.id in (s.character_a, s.character_b)
       join characters w on w.id = (case when o.id = s.character_a then s.character_b else s.character_a end)
      where (e.character_a = $1 or e.character_b = $1)
        and e.revealed_at is not null and e.visibility = 'public'
        and s.revealed_at is not null and s.visibility = 'public'
      order by o.id, s.revealed_at desc`,
    [characterId],
  );
  return rows
    .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
    .slice(0, limit)
    .map((r) => ({ id: r.id, name: r.name, house: r.is_house, venue: (r.venue as PlaceId) ?? null, at: new Date(r.at).toISOString(), with_name: r.with_name, their_ending: r.ending }));
}

/** The one line a date prompt carries about someone it only shared a table with (remembered()'s fallback). */
export function metAtTable(memory: CharacterMemory | null | undefined, otherId: string): string | null {
  const m = memory?.met?.find((x) => x.id === otherId);
  if (!m) return null;
  return `You haven't dated, but you shared a table once: a double date at ${venuePhrase(m.venue)}, where they were with ${shortName(m.with_name)}. Their date ended: ${endingLabel(m.their_ending, 1)}.`;
}

/* ------------------------------------ people, chapters, milestones ------------------------------------ */

/** One aired date, from this character's side. */
type Dated = {
  id: string;
  ending: Ending;
  at: Date;
  season: string;
  venue: PlaceId | null;
  other: { id: string; name: string; house: boolean };
  wanted_more: boolean | null;
  turned_down: "you" | "them" | null;
  they_said: string | null;
  you_said: string | null;
};

/**
 * "at seven", "by 8" read as a time only when what follows reads as one: o'clock, pm, tonight, "in the evening", a
 * preposition, or the end of the clause. #768 (the 2026-10-24-0610 run): "at one point" and "at four feet" aren't times.
 */
const AT_HOUR =
  /\b(at|by) (\d{1,2}:\d\d|(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?=[-\s]*(o['’]?clock|[ap]\.?m\b|tonight\b|tomorrow\b|sharp\b|then\b|thirty\b|fifteen\b|forty\b|ish\b|on the dot\b|in the (morning|afternoon|evening)\b|(at|on|and|or)\b)|\s*([.,!?;:)—–]|$)))/i;

/**
 * A line that's only logistics ("Tuesday at seven, then"): never the line that sticks from a date. Remembering it made
 * a couple book "same time next Tuesday" date after date (Cass and Dex, 2026-10-18).
 */
export const isLogistics = (line: string): boolean =>
  /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\bnext week\b|\bsame time\b|\bpick you up\b/i.test(line) || AT_HOUR.test(line);

/** A side's most-interested line of a date that still passes the content filter, or null. */
function standout(transcript: Turn[] | null, side: "a" | "b"): string | null {
  const lines = (transcript ?? []).filter((t) => t.side === side && t.dialogue && !isLogistics(t.dialogue));
  const best = [...lines].sort((x, y) => (y.interest ?? 0) - (x.interest ?? 0))[0];
  return best && checkFields({ line: best.dialogue }).ok ? best.dialogue : null;
}

function toDated(r: MemoryEpisode): Dated {
  const me = r.is_a ? "a" : "b";
  const them = r.is_a ? "b" : "a";
  const at = new Date(r.revealed_at);
  const rejected = r.drama_question === "rejected" ? r.drama_answer : null;
  return {
    id: r.id,
    ending: r.ending,
    at,
    season: seasonIdAt(at),
    venue: r.venue,
    other: { id: r.other_id, name: r.other_name, house: r.other_house },
    wanted_more: r.sides?.[r.is_a ? 0 : 1]?.wants_another ?? null,
    turned_down: rejected === me ? "you" : rejected === them ? "them" : null,
    they_said: standout(r.transcript, them),
    you_said: standout(r.transcript, me),
  };
}

/** How a pair stands after its aired dates (oldest first): the latest ending, coloured by what came before. */
export function pairStatus(endings: Ending[]): PairStatus {
  // One friendly date is "just met", not friends yet, as on the couple's stage (lib/relationships.ts stageOf).
  const last = endings[endings.length - 1];
  if (last === "second_date") return "seeing";
  if (endings.includes("second_date")) return "exes";
  if (last === "friends") return endings.length === 1 ? "just_met" : "friends";
  return "bad_blood";
}

/** Everyone the character has dated, most recent first, capped. A forgotten moment keeps the public status only. */
function rememberPeople(dated: Dated[], forgets: Forgets = new Set()): PersonMemory[] {
  const byId = new Map<string, Dated[]>();
  for (const d of dated) byId.set(d.other.id, [...(byId.get(d.other.id) ?? []), d]);
  return [...byId.values()]
    .map((ds): PersonMemory => {
      const last = ds[ds.length - 1];
      const forgotten = forgets.has(forgetKey("moment", last.other.id));
      return {
        id: last.other.id,
        name: last.other.name,
        house: last.other.house,
        dates: ds.length,
        status: pairStatus(ds.map((d) => d.ending)),
        ...(stageOf(ds.map((d) => d.ending)) ? { stage: stageOf(ds.map((d) => d.ending))! } : {}),
        last_ending: last.ending,
        last_venue: last.venue,
        last_at: last.at.toISOString(),
        last_episode_id: last.id,
        turned_down: last.turned_down,
        // Forgetting "how it left things" drops the private moment; who they are to each other is public record.
        wanted_more: forgotten ? null : last.wanted_more,
        they_said: forgotten ? null : last.they_said,
        you_said: forgotten ? null : last.you_said,
      };
    })
    .sort((x, y) => y.last_at.localeCompare(x.last_at) || x.id.localeCompare(y.id))
    .slice(0, PEOPLE_KEPT);
}

/** One date's ending mid-sentence: "a second date", or "a fourth date" when it was their third (lib/rules endingLabel). */
const endingPhrase = (ending: Ending, dateNumber: number) => endingLabel(ending, dateNumber).toLowerCase();

/** Each date's place in its pair's run of aired dates (oldest first in, as `dated` is): their first, second... */
function pairNumbers(dated: Dated[]): Map<string, number> {
  const count = new Map<string, number>();
  const out = new Map<string, number>();
  for (const d of dated) {
    const n = (count.get(d.other.id) ?? 0) + 1;
    count.set(d.other.id, n);
    out.set(d.id, n);
  }
  return out;
}

/** "Week of Oct 12" for a season id. */
export function chapterLabel(season: string): string {
  const day = new Date(`${season}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Week of ${day}`;
}

/** One line a season, most recent first: "2 dates: a second date with Nell, a disaster with Teo." */
function buildChapters(dated: Dated[]): Chapter[] {
  const nth = pairNumbers(dated);
  const bySeason = new Map<string, Dated[]>();
  for (const d of dated) bySeason.set(d.season, [...(bySeason.get(d.season) ?? []), d]);
  return [...bySeason.entries()]
    .sort(([x], [y]) => y.localeCompare(x))
    .slice(0, CHAPTERS_KEPT)
    .map(([season, ds]) => {
      const parts = ds.slice(0, 3).map((d) => `${endingPhrase(d.ending, nth.get(d.id) ?? 1)} with ${shortName(d.other.name)}`);
      const more = ds.length - parts.length;
      return {
        season,
        label: chapterLabel(season),
        dates: ds.length,
        line: `${ds.length === 1 ? "1 date" : `${ds.length} dates`}: ${parts.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
      };
    });
}

/** The firsts and landmarks in a character's aired record, in the order it reached them. */
export function findMilestones(dated: { id: string; ending: Ending; season: string; other: { id: string }; turned_down: "you" | "them" | null }[]): Milestone[] {
  const got = new Map<MilestoneId, Milestone>();
  const reach = (id: MilestoneId, d: { id: string; season: string }) => {
    if (!got.has(id)) got.set(id, { id, label: MILESTONE_LABELS[id], season: d.season, episode_id: d.id });
  };
  const seen = new Set<string>();
  let streak = 0;
  dated.forEach((d, i) => {
    const prev = dated[i - 1];
    reach("first_date", d);
    if (d.ending === "second_date") reach("first_spark", d);
    if (d.ending === "friends") reach("made_a_friend", d);
    if (d.ending === "disaster") reach("survived_a_disaster", d);
    if (seen.has(d.other.id)) reach("rematch", d);
    seen.add(d.other.id);
    if (d.ending === "second_date" && prev?.ending === "disaster") reach("comeback", d);
    if (d.turned_down === "them") reach("heartbreaker", d);
    streak = d.ending === "second_date" ? streak + 1 : 0;
    if (streak >= 3) reach("on_a_roll", d);
    if (i + 1 === 5) reach("five_dates", d);
    if (i + 1 === 10) reach("ten_dates", d);
    if (i + 1 === 25) reach("twenty_five_dates", d);
  });
  return [...got.values()];
}

/* --------------------------------------- what reaches a date's prompt --------------------------------------- */

const STANDING: Record<PairStatus, string> = {
  seeing: "You've been seeing each other.",
  exes: "You had something once; it didn't last.",
  friends: "You're friends.",
  just_met: "You met once; it was friendly, nothing more yet.",
  bad_blood: "Last time went badly.",
};

/**
 * What this character remembers of the person it's about to meet, for its own prompt — or null when they've
 * never aired a date together. Only its own side: its own feeling, never theirs.
 */
export function metBefore(memory: CharacterMemory | null | undefined, otherId: string): Record<string, unknown> | null {
  const p = memory?.people?.find((x) => x.id === otherId);
  if (!p) return null;
  return {
    times: p.dates,
    // Their last date was their p.dates-th: a happy one reads "A third date" after two (lib/rules endingLabel).
    last_time: `${venuePhrase(p.last_venue)}; it ended: ${endingLabel(p.last_ending, p.dates)}`,
    where_you_stand: STANDING[p.status],
    ...(p.turned_down === "you" ? { how_it_ended_for_you: "They turned you down." } : p.turned_down === "them" ? { how_it_ended_for_you: "You turned them down." } : {}),
    ...(p.wanted_more !== null ? { how_you_left_it: p.wanted_more ? "You wanted to see them again." : "You didn't want to see them again." } : {}),
    ...(p.they_said ? { something_they_said: p.they_said } : {}),
    ...(p.you_said ? { something_you_said: p.you_said } : {}),
  };
}

/** Its last few dates with OTHER people, so it has a dating life to mention ("my last date was a disaster"). */
export function recentDates(memory: CharacterMemory | null | undefined, excludeId: string, n = 2): string[] {
  return (memory?.people ?? [])
    .filter((p) => p.id !== excludeId)
    .slice(0, n)
    .map((p) => `With ${shortName(p.name)} at ${venuePhrase(p.last_venue)}: ${endingLabel(p.last_ending, p.dates)}.`);
}

/**
 * One capped block about the person you're meeting again: `metBefore` (aired record) + `char.pair` (relationship
 * graph, which also knows unaired and private dates between you two), merged, with caps so one old joke can't
 * snowball through a whole season (Cass×Dex, 2026-10-18: "knock on wood" and "Gerald" filled 15 lines of 16 by
 * date 7 because the same joke and the same shared line were in multiple blocks of every later prompt).
 *
 * Keeps: times, where you stand, how it ended for you, how it's been (chemistry), up to 2 things they told you,
 * one inside joke, one line each said, tonight's plan when it exists. Null when you've never met.
 */
export function remembered(
  char: { memory?: CharacterMemory | null; pair?: Record<string, unknown> | null },
  otherId: string,
): (Record<string, unknown> & { times: number; tonight_is_the_plan?: string[] }) | null {
  const met = metBefore(char.memory, otherId); // aired-only, from this side
  const pair = (char.pair ?? null) as (Record<string, unknown> & { times_together?: number }) | null;
  if (!met && !pair) {
    // Never dated — but a double date's table counts as having met (lib/group-dates.ts): one line, nothing private.
    const table = metAtTable(char.memory, otherId);
    return table ? { times: 0, you_met_once: table } : null;
  }
  const times = Math.max(
    typeof met?.times === "number" ? (met.times as number) : 0,
    typeof pair?.times_together === "number" ? pair.times_together : 0,
  );
  const told = Array.isArray(pair?.things_they_have_told_you) ? (pair.things_they_have_told_you as string[]).slice(0, 2) : [];
  const jokesAll = Array.isArray(pair?.your_inside_jokes) ? (pair.your_inside_jokes as string[]) : [];
  const joke = jokesAll[0]; // the first (most recent in pairContext order)
  const plan = Array.isArray(pair?.tonight_is_the_plan_you_made) ? (pair.tonight_is_the_plan_you_made as string[]) : [];
  return {
    times,
    ...(met?.where_you_stand ? { where_you_stand: met.where_you_stand } : pair?.where_you_stand_now ? { where_you_stand: pair.where_you_stand_now } : {}),
    ...(met?.last_time ? { how_it_ended_last_time: met.last_time } : {}),
    ...(met?.how_it_ended_for_you ? { how_it_ended_for_you: met.how_it_ended_for_you } : {}),
    ...(met?.how_you_left_it ? { how_you_left_it: met.how_you_left_it } : {}),
    ...(pair?.how_its_been ? { how_its_been: pair.how_its_been } : {}),
    ...(told.length ? { things_they_have_told_you: told } : {}),
    ...(joke ? { an_inside_joke: joke } : {}),
    ...(met?.something_they_said ? { one_line_they_said: met.something_they_said } : {}),
    ...(met?.something_you_said ? { one_line_you_said: met.something_you_said } : {}),
    ...(plan.length ? { tonight_is_the_plan: plan } : {}),
    // What After Dark left behind, only ever its PG note (lib/adult/memory.ts).
    ...(typeof pair?.what_happened_after_your_last_date === "string" ? { what_happened_after_your_last_date: pair.what_happened_after_your_last_date } : {}),
  };
}

/** Words both sides of a rematch already heard last time: never "profile reading" (lib/quality.ts). */
export function sharedHistory(memory: CharacterMemory | null | undefined, otherId: string): string {
  const p = memory?.people?.find((x) => x.id === otherId);
  return p ? [p.they_said ?? "", p.you_said ?? ""].join(" ") : "";
}

/** The public face of the people a character has dated: names and how they stand, never the private feeling. */
export function connections(memory: CharacterMemory | null | undefined): { id: string; name: string; house: boolean; dates: number; status: PairStatus; label: string; turned_down: "you" | "them" | null }[] {
  return (memory?.people ?? []).map((p) => ({ id: p.id, name: p.name, house: p.house, dates: p.dates, status: p.status, label: PAIR_STATUS_LABELS[p.status], turned_down: p.turned_down }));
}
