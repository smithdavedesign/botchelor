/**
 * The empty-room rule (docs/show-style.md, 2026-11-14). Real use is near zero, so every crowd count on the show
 * ("1 watching", "2 players have points", a best-callers board of two names) told a newcomer they were alone. A
 * count shows to a stranger only from CROWD_MIN people up; below that the room, the award or the call to play stays
 * and the number goes. Someone with a character of their own is an insider: they see counts from 1, as before.
 *
 * One helper for every count. tests/crowd-threshold.test.ts pins the files that use it, so a new count can't slip
 * in unguarded. Pure, apart from `isInsider`, so client components may import the rule too.
 */
import type { Db } from "./db";

/** The default: fewer than this many people is "a quiet room", not a number. */
export const CROWD_MIN_DEFAULT = 5;

/** CROWD_MIN from the environment (a whole number from 1), else the default. Read at call time, so tests can set it. */
export function crowdMin(): number {
  const n = Number(process.env.CROWD_MIN);
  return Number.isInteger(n) && n >= 1 ? n : CROWD_MIN_DEFAULT;
}

export type CrowdOptions = {
  /** The viewer has a character of their own (isInsider): they see every count from 1. */
  insider?: boolean;
  /** The threshold, when not CROWD_MIN. */
  min?: number;
};

/** Whether to show this count: insiders always (from 1), strangers from the threshold up. */
export function showCrowd(count: number, { insider = false, min = crowdMin() }: CrowdOptions = {}): boolean {
  if (!Number.isFinite(count) || count < 1) return false;
  return insider || count >= min;
}

/**
 * The count in words ("7 watching", "1 player"), or "" when the rule hides it, so a call site can drop the whole
 * clause: `crowdLine(n, "watching")`, `crowdLine(n, { one: "player has", many: "players have" })`.
 */
export function crowdLine(count: number, words: string | { one: string; many: string }, opts: CrowdOptions = {}): string {
  if (!showCrowd(count, opts)) return "";
  const noun = typeof words === "string" ? words : count === 1 ? words.one : words.many;
  return `${count} ${noun}`;
}

/**
 * A ballot's tally once you've voted: "N votes so far." for a crowd or to an insider, else "Your vote's in." (a
 * stranger's lone vote read "1 vote so far" and a 100% bar: the empty room again). Ballots hide their share bars and
 * per-choice counts by the same test (`showCrowd(total, opts)`).
 */
export function tallyLine(total: number, opts: CrowdOptions = {}): string {
  return showCrowd(total, opts) ? `${total} ${total === 1 ? "vote" : "votes"} so far.` : "Your vote's in.";
}

/** An insider: someone with a character of their own on the show (the nav's own test, app/layout.tsx). */
export async function isInsider(db: Db, viewerId: string | null): Promise<boolean> {
  if (!viewerId) return false;
  try {
    const { rows } = await db.query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [viewerId]);
    return rows.length > 0;
  } catch {
    return false;
  }
}
