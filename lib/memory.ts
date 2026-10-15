/**
 * M14 — the learned memory layer: how a character "trains itself" from its own past dates.
 *
 * This is the materialized, owner/self-only read of everything a character has learned across its dates:
 * what it reliably likes, what keeps putting it off, a few lines it has actually said, a one-line arc of
 * who it is becoming, and a small bounded drift to its engine signals. It is recomputed deterministically
 * from the character's finished episodes — aggregation only, NO model call and NO cost — right after a date
 * is stored (see lib/jobs.ts and lib/watch.ts, next to rememberDate).
 *
 * Privacy: likes / turnoffs / memorable_lines / signal_delta all derive from the owner-only debrief data
 * (the per-side SideOutcome and the transcript), so they live only in the character's SELF view and the
 * owner's own view — never the public card, never the other agent (same rule as the soul). The learned
 * drift is capped (±MEMORY_SIGNAL_CAP per axis) so a character can evolve without one axis ever swinging a
 * result wildly; the deterministic engine itself is untouched (lib/engine.ts).
 *
 * Only AIRED (revealed) dates count, exactly like the public record (lib/game.ts getCharacterHistory). A
 * ready-but-unrevealed episode still has predictions open, and the arc is shown on the public contestant
 * card, so counting it would leak that date's outcome. Memory is therefore recomputed when a date airs
 * (the reveal route and the watch room's airing), not when it is generated.
 */
import type { Db } from "./db";
import type { SideOutcome, SoulSignals } from "./engine";
import type { Ending } from "./rules";
import type { Turn } from "./conversation";
import { checkFields } from "./safety";

/** Max learned drift per signal axis. Small on purpose: a character evolves, it does not transform. */
export const MEMORY_SIGNAL_CAP = 0.15;
/** How many standout lines of its own a character carries forward. */
export const MEMORABLE_LINES = 3;
/** How many top like / turnoff cues the arc and self-view keep. */
export const MEMORY_TOP_CUES = 3;

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
  /** A single templated sentence of who the character has become; null before its first date. */
  arc: string | null;
};

type MemoryRow = {
  dates: number;
  second_dates: number;
  friends: number;
  disasters: number;
  likes: string[];
  turnoffs: string[];
  signal_delta: Partial<SoulSignals>;
  memorable_lines: string[];
  arc: string | null;
};

/** Reads the materialized memory for a character, or null when it has none yet (a fresh OC). */
export async function loadCharacterMemory(db: Db, characterId: string): Promise<CharacterMemory | null> {
  const { rows } = await db.query<MemoryRow>(
    `select dates, second_dates, friends, disasters, likes, turnoffs, signal_delta, memorable_lines, arc
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
    arc: r.arc,
  };
}

type EpisodeRow = {
  ending: Ending;
  sides: [SideOutcome, SideOutcome] | null;
  transcript: Turn[] | null;
  is_a: boolean;
};

/** The episodes a character has learned from: its AIRED dates (same aired-only rule as the public record). */
const MEMORY_EPISODES_WHERE = "(e.character_a = $1 or e.character_b = $1) and e.revealed_at is not null and e.visibility = 'public'";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

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
    `select e.ending, e.sides, e.transcript, (e.character_a = $1) as is_a
       from episodes e
      where ${MEMORY_EPISODES_WHERE}
      order by e.revealed_at, e.id`,
    [characterId],
  );

  let second_dates = 0;
  let friends = 0;
  let disasters = 0;
  const likeCues: string[] = [];
  const turnoffCues: string[] = [];
  const myLines: Array<{ dialogue: string; interest: number; order: number }> = [];

  rows.forEach((r, order) => {
    if (r.ending === "second_date") second_dates++;
    else if (r.ending === "friends") friends++;
    else if (r.ending === "disaster") disasters++;

    const mine = r.sides?.[r.is_a ? 0 : 1];
    if (mine?.want_met) likeCues.push(mine.want_met);
    if (mine?.dealbreaker_hit) turnoffCues.push(mine.dealbreaker_hit);

    const meSide = r.is_a ? "a" : "b";
    for (const t of r.transcript ?? []) {
      if (t.side === meSide && t.dialogue) myLines.push({ dialogue: t.dialogue, interest: t.interest ?? 0, order });
    }
  });

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
  };
  const memory: CharacterMemory = { ...base, arc: buildArc(base) };

  await db.query(
    `insert into character_memory
       (character_id, dates, second_dates, friends, disasters, likes, turnoffs, signal_delta, memorable_lines, arc, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, now())
     on conflict (character_id) do update set
       dates = excluded.dates, second_dates = excluded.second_dates, friends = excluded.friends,
       disasters = excluded.disasters, likes = excluded.likes, turnoffs = excluded.turnoffs,
       signal_delta = excluded.signal_delta, memorable_lines = excluded.memorable_lines, arc = excluded.arc,
       updated_at = now()`,
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
      memory.arc,
    ],
  );
  return memory;
}
