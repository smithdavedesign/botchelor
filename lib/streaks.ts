/**
 * Your calls (docs/ideas.md "Bringing viewers back", idea 10; David 2026-11-01). Predictions were already on the show
 * (the ending pick before a date airs, lib/air.ts scores it, points and friend leagues count it); what they lacked was a
 * reason to keep calling. So: your record (how many endings you called right), your run of right calls in a row and your
 * best run, and a show-wide board of this week's best callers. $0: read from the predictions table, no model call.
 *
 *  - Only public dates count, as they do for points: a private date's ending isn't the show's to score.
 *  - Only the ending pick counts toward the record and the run (the drama question is a side bet worth fewer points).
 *  - In order of airing, so a run is the dates as they aired, not as they were picked.
 *  - The board names only people who chose a display name (lib/people.ts profiles, the name leagues and creator reveals
 *    already show); everyone else is counted without a name, so a person never appears on it by surprise.
 */
import type { Db } from "./db";

export type CallRecord = {
  /** Public dates whose ending this person called, that have aired. */
  called: number;
  /** How many of those they called right. */
  right: number;
  /** Right calls in a row, up to the latest aired one (0 when the latest was wrong). */
  streak: number;
  /** Their longest run ever. */
  best: number;
  /** The run the latest call ended (when it was wrong), or 0: "that ends a run of 4". */
  ended: number;
};

export const NO_CALLS: CallRecord = { called: 0, right: 0, streak: 0, best: 0, ended: 0 };

/** The record from a person's calls in airing order (true: called it right). */
export function recordOf(calls: readonly boolean[]): CallRecord {
  let run = 0;
  let best = 0;
  let right = 0;
  let ended = 0;
  for (const hit of calls) {
    if (hit) {
      run++;
      right++;
      best = Math.max(best, run);
      ended = 0;
    } else {
      ended = run;
      run = 0;
    }
  }
  return { called: calls.length, right, streak: run, best, ended };
}

/** One person's record across every public date they called that has aired. */
export async function callRecord(db: Db, userId: string | null): Promise<CallRecord> {
  if (!userId) return NO_CALLS;
  const { rows } = await db.query<{ hit: boolean }>(
    `select p.pick = e.ending as hit
       from predictions p join episodes e on e.id = p.episode_id
      where p.user_id = $1 and e.revealed_at is not null and e.visibility = 'public' and e.ending is not null
      order by e.revealed_at, e.id`,
    [userId],
  );
  return recordOf(rows.map((r) => r.hit));
}

/** How long the board looks back. */
export const BOARD_DAYS = 7;
/** How many names the board shows. */
export const BOARD_SIZE = 5;

export type BoardEntry = { name: string; right: number; called: number; mine: boolean };
export type CallersBoard = { top: BoardEntry[]; /** callers this week with a right call and no display name */ unnamed: number; my_rank: number | null };

/**
 * This week's best callers: right ending calls on public dates that aired in the last BOARD_DAYS days, the most first,
 * then the fewer misses, then whoever got there first. Named only by display name (see above).
 */
export async function callersBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<CallersBoard> {
  const since = new Date(now.getTime() - BOARD_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await db.query<{ user_id: string; name: string | null; hits: number; called: number }>(
    `select p.user_id, pr.name, count(*) filter (where p.pick = e.ending)::int as hits, count(*)::int as called,
            max(e.revealed_at) filter (where p.pick = e.ending) as last_hit
       from predictions p
       join episodes e on e.id = p.episode_id
       left join profiles pr on pr.user_id = p.user_id
      where e.revealed_at >= $1 and e.revealed_at <= $2 and e.visibility = 'public' and e.ending is not null
      group by p.user_id, pr.name
     having count(*) filter (where p.pick = e.ending) > 0
      order by hits desc, called asc, last_hit asc, p.user_id`,
    [since.toISOString(), now.toISOString()],
  );
  const myIndex = viewerId ? rows.findIndex((r) => r.user_id === viewerId) : -1;
  const named = rows.filter((r) => r.name);
  return {
    top: named.slice(0, BOARD_SIZE).map((r) => ({ name: r.name!, right: r.hits, called: r.called, mine: r.user_id === viewerId })),
    unnamed: rows.length - named.length,
    my_rank: myIndex >= 0 ? myIndex + 1 : null,
  };
}

/** The record in a few words: "7 of 10 right · 3 in a row". */
export function recordLine(r: CallRecord): string {
  const parts = [`${r.right} of ${r.called} right`];
  if (r.streak >= 2) parts.push(`${r.streak} in a row`);
  if (r.best >= 2 && r.best > r.streak) parts.push(`best run ${r.best}`);
  return parts.join(" · ");
}

/** What a scored call adds to its notice: the run it extends or ends. "" when there's nothing to say. */
export function runNote(r: CallRecord, right: boolean): string {
  if (right && r.streak >= 2) return ` That's ${r.streak} in a row.`;
  if (!right && r.ended >= 2) return ` That ends a run of ${r.ended}.`;
  return "";
}
