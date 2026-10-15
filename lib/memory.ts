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
import type { Db } from "./db";
import type { SideOutcome, SoulSignals } from "./engine";
import { ENDING_LABELS, type DramaAnswer, type DramaQuestion, type Ending } from "./rules";
import type { Turn } from "./conversation";
import { checkFields } from "./safety";
import { seasonIdAt } from "./season-cast";
import { venue, type VenueId } from "./venues";

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
};

/** How two characters stand, from the public record of their aired dates together. */
export type PairStatus = "seeing" | "exes" | "friends" | "bad_blood";
export const PAIR_STATUS_LABELS: Record<PairStatus, string> = {
  seeing: "💞 Seeing each other",
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
  last_ending: Ending;
  last_venue: VenueId | null;
  /** When their last date aired (ISO). */
  last_at: string;
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
};

/** Reads the materialized memory for a character, or null when it has none yet (a fresh OC). */
export async function loadCharacterMemory(db: Db, characterId: string): Promise<CharacterMemory | null> {
  const { rows } = await db.query<MemoryRow>(
    `select dates, second_dates, friends, disasters, likes, turnoffs, signal_delta, memorable_lines, reflections, arc,
            people, chapters, milestones
       from character_memory where character_id = $1`,
    [characterId],
  );
  const r = rows[0];
  if (!r) return null;
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
  };
}

type EpisodeRow = {
  id: string;
  ending: Ending;
  sides: [SideOutcome, SideOutcome] | null;
  transcript: Turn[] | null;
  reflections: { a: string | null; b: string | null } | null;
  is_a: boolean;
  revealed_at: string | Date;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  venue: VenueId | null;
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
  if (m.likes[0]) clauses.push(`warms to “${m.likes[0]}”`);
  if (m.turnoffs[0]) clauses.push(`keeps clashing over “${m.turnoffs[0]}”`);
  if (clauses.length === 0) {
    if (m.second_dates > 0) clauses.push("still chasing a spark that sticks");
    else if (m.disasters > 0) clauses.push("licking its wounds and guarded about it");
    else clauses.push("still figuring out what it wants");
  }
  return `${opener}; ${clauses.join(", ")}.`;
}

/**
 * Recomputes and stores a character's memory from its AIRED (revealed) episodes. Deterministic and $0: it
 * only aggregates data the engine already decided and the transcript already recorded. Call it when a date
 * airs (the reveal route and the watch room's airing), for both characters. Returns the fresh memory.
 */
export async function updateCharacterMemory(db: Db, characterId: string): Promise<CharacterMemory> {
  const { rows } = await db.query<EpisodeRow>(
    `select e.id, e.ending, e.sides, e.transcript, e.reflections, (e.character_a = $1) as is_a,
            e.revealed_at, e.drama_question, e.drama_answer, e.setup->>'venue' as venue,
            o.id as other_id, o.name as other_name, o.is_house as other_house
       from episodes e
       join characters o on o.id = case when e.character_a = $1 then e.character_b else e.character_a end
      where ${MEMORY_EPISODES_WHERE}
      order by e.revealed_at, e.id`,
    [characterId],
  );
  // This character's own want/dealbreaker, for the fallback cue below.
  const sheet = (await db.query<{ want: string | null; dealbreaker: string | null }>(
    `select want, dealbreaker from characters where id = $1`,
    [characterId],
  )).rows[0];

  let second_dates = 0;
  let friends = 0;
  let disasters = 0;
  const likeCues: string[] = [];
  const turnoffCues: string[] = [];
  const myLines: Array<{ dialogue: string; interest: number; order: number }> = [];
  const myReflections: string[] = []; // in date order (oldest first); the most recent are taken below

  rows.forEach((r, order) => {
    if (r.ending === "second_date") second_dates++;
    else if (r.ending === "friends") friends++;
    else if (r.ending === "disaster") disasters++;

    const mine = r.sides?.[r.is_a ? 0 : 1];
    // The engine records the OTHER's cue that met the want / tripped the dealbreaker when it can match one
    // (lib/engine.ts readSide, a lexical match against the other's sheet). Behaviourally-phrased wants ("asks a
    // follow-up question") rarely match a static sheet, so the cue is usually null and this layer stayed empty.
    // Fallback: when the date clearly went the character's way, credit its OWN want; when it clearly didn't,
    // credit its OWN dealbreaker — so a bot still learns what it keeps warming to / clashing over.
    if (mine?.want_met) likeCues.push(mine.want_met);
    else if (sheet?.want && (r.ending === "second_date" || r.ending === "friends") && mine?.wants_another) likeCues.push(wantCue(sheet.want));
    if (mine?.dealbreaker_hit) turnoffCues.push(mine.dealbreaker_hit);
    else if (sheet?.dealbreaker && r.ending === "disaster") turnoffCues.push(wantCue(sheet.dealbreaker));

    const meSide = r.is_a ? "a" : "b";
    for (const t of r.transcript ?? []) {
      if (t.side === meSide && t.dialogue) myLines.push({ dialogue: t.dialogue, interest: t.interest ?? 0, order });
    }
    const myReflection = r.reflections?.[meSide];
    if (myReflection) myReflections.push(myReflection);
  });

  // The character's most recent reflections first, content-filtered (defence in depth), capped. These feed its
  // own future self-view (lib/conversation.ts): a model wrote the text, but picking them here is deterministic.
  const reflections = [...myReflections]
    .reverse()
    .filter((text) => checkFields({ text }).ok)
    .slice(0, REFLECTIONS_KEPT);

  const likes = topByFrequency(likeCues, MEMORY_TOP_CUES);
  const turnoffs = topByFrequency(turnoffCues, MEMORY_TOP_CUES);

  // A few of the character's own standout lines: highest interest first, stable ties, de-duped, and only
  // lines that still pass the content filter (defence in depth — the transcript was filtered on write).
  const memorable_lines: string[] = [];
  const seen = new Set<string>();
  for (const line of [...myLines].sort((x, y) => y.interest - x.interest || x.order - y.order)) {
    if (seen.has(line.dialogue)) continue;
    if (!checkFields({ line: line.dialogue }).ok) continue;
    seen.add(line.dialogue);
    memorable_lines.push(line.dialogue);
    if (memorable_lines.length >= MEMORABLE_LINES) break;
  }

  const base = {
    dates: rows.length,
    second_dates,
    friends,
    disasters,
    likes,
    turnoffs,
    signal_delta: learnSignalDelta(second_dates, disasters),
    memorable_lines,
    reflections,
  };
  const dated = rows.map(toDated);
  const memory: CharacterMemory = {
    ...base,
    arc: buildArc(base),
    people: rememberPeople(dated),
    chapters: buildChapters(dated),
    milestones: findMilestones(dated),
  };

  await db.query(
    `insert into character_memory
       (character_id, dates, second_dates, friends, disasters, likes, turnoffs, signal_delta, memorable_lines, reflections, arc,
        people, chapters, milestones, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14::jsonb, now())
     on conflict (character_id) do update set
       dates = excluded.dates, second_dates = excluded.second_dates, friends = excluded.friends,
       disasters = excluded.disasters, likes = excluded.likes, turnoffs = excluded.turnoffs,
       signal_delta = excluded.signal_delta, memorable_lines = excluded.memorable_lines,
       reflections = excluded.reflections, arc = excluded.arc, people = excluded.people,
       chapters = excluded.chapters, milestones = excluded.milestones, updated_at = now()`,
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
    ],
  );
  return memory;
}

/* ------------------------------------ people, chapters, milestones ------------------------------------ */

/** One aired date, from this character's side. */
type Dated = {
  id: string;
  ending: Ending;
  at: Date;
  season: string;
  venue: VenueId | null;
  other: { id: string; name: string; house: boolean };
  wanted_more: boolean | null;
  turned_down: "you" | "them" | null;
  they_said: string | null;
  you_said: string | null;
};

/** A side's most-interested line of a date that still passes the content filter, or null. */
function standout(transcript: Turn[] | null, side: "a" | "b"): string | null {
  const lines = (transcript ?? []).filter((t) => t.side === side && t.dialogue);
  const best = [...lines].sort((x, y) => (y.interest ?? 0) - (x.interest ?? 0))[0];
  return best && checkFields({ line: best.dialogue }).ok ? best.dialogue : null;
}

function toDated(r: EpisodeRow): Dated {
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
  const last = endings[endings.length - 1];
  if (last === "second_date") return "seeing";
  if (endings.includes("second_date")) return "exes";
  return last === "friends" ? "friends" : "bad_blood";
}

/** Everyone the character has dated, most recent first, capped. */
function rememberPeople(dated: Dated[]): PersonMemory[] {
  const byId = new Map<string, Dated[]>();
  for (const d of dated) byId.set(d.other.id, [...(byId.get(d.other.id) ?? []), d]);
  return [...byId.values()]
    .map((ds): PersonMemory => {
      const last = ds[ds.length - 1];
      return {
        id: last.other.id,
        name: last.other.name,
        house: last.other.house,
        dates: ds.length,
        status: pairStatus(ds.map((d) => d.ending)),
        last_ending: last.ending,
        last_venue: last.venue,
        last_at: last.at.toISOString(),
        turned_down: last.turned_down,
        wanted_more: last.wanted_more,
        they_said: last.they_said,
        you_said: last.you_said,
      };
    })
    .sort((x, y) => y.last_at.localeCompare(x.last_at) || x.id.localeCompare(y.id))
    .slice(0, PEOPLE_KEPT);
}

const ENDING_PHRASE: Record<Ending, string> = { second_date: "a second date", friends: "just friends", disaster: "a disaster" };

/** "Week of Oct 12" for a season id. */
export function chapterLabel(season: string): string {
  const day = new Date(`${season}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Week of ${day}`;
}

/** One line a season, most recent first: "2 dates: a second date with Nell, a disaster with Teo." */
function buildChapters(dated: Dated[]): Chapter[] {
  const bySeason = new Map<string, Dated[]>();
  for (const d of dated) bySeason.set(d.season, [...(bySeason.get(d.season) ?? []), d]);
  return [...bySeason.entries()]
    .sort(([x], [y]) => y.localeCompare(x))
    .slice(0, CHAPTERS_KEPT)
    .map(([season, ds]) => {
      const parts = ds.slice(0, 3).map((d) => `${ENDING_PHRASE[d.ending]} with ${d.other.name.split(" ")[0]}`);
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
    last_time: `${venue(p.last_venue).name.toLowerCase()}; it ended: ${ENDING_LABELS[p.last_ending]}`,
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
    .map((p) => `With ${p.name.split(" ")[0]} at ${venue(p.last_venue).name.toLowerCase()}: ${ENDING_LABELS[p.last_ending]}.`);
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
