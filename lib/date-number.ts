/**
 * Which date a date is for its couple (their first, second, third...), so a happy ending names the date after it
 * (lib/rules endingLabel: "A fourth date" on their third). The number counts only what the public can see: the pair's
 * earlier dates that aired publicly and weren't hidden or a replay, the dates the couple timeline numbers "Date N"
 * (lib/graph.ts). A private or unlisted date never shows through as a higher number.
 *
 * A follow-up keeps the number its booking stored (setup.date_number: its parent's plus one). Every other booking
 * stores one too, 1 for a first date (lib/simulation.ts buildDate), so the number a date was written with is the one it
 * keeps. A date stored before that reads it here, computed the same way in SQL, so a page or a list stays one query.
 */
import type { Db } from "./db";
import { REPORT_HIDE_THRESHOLD } from "./rules";

/** A date the public layer counts (lib/relationships.ts `HistoryItem.public`): aired, public, not hidden, not a replay. */
export const publicDateSql = (e: string, threshold: string = String(REPORT_HIDE_THRESHOLD)) =>
  `${e}.status = 'ready' and ${e}.visibility = 'public' and ${e}.revealed_at is not null and ${e}.varies_episode_id is null
   and (select count(*)::int from reports r where r.episode_id = ${e}.id) < ${threshold}`;

const samePair = (p: string, e: string) =>
  `((${p}.character_a = ${e}.character_a and ${p}.character_b = ${e}.character_b) or (${p}.character_a = ${e}.character_b and ${p}.character_b = ${e}.character_a))`;

/**
 * The date number of episodes row `e`, as a SQL expression: the stored one, 2 for an older follow-up without one, else
 * 1 + the pair's earlier public dates, or null when there are none (a first date). A stored 1 is a first date (null)
 * and is never counted again (#1190: a date booked before an earlier one aired read "A third date" once it had, while
 * everything written at booking said "A second date").
 */
export const dateNumberSql = (e: string) =>
  `case when (${e}.setup->>'date_number') is not null then nullif((${e}.setup->>'date_number')::int, 1)
   else coalesce(
     case when ${e}.followup_of is not null then 2 end,
     (select nullif(count(*)::int, 0) + 1 from episodes pd
       where ${samePair("pd", e)} and pd.id <> ${e}.id and (pd.created_at, pd.id) < (${e}.created_at, ${e}.id)
         and ${publicDateSql("pd")})) end`;

/** The number a new date between these two gets at booking: 1 + their public dates so far, or null for a first date. */
export async function nextDateNumber(db: Db, x: string, y: string, excludeId?: string): Promise<number | null> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from episodes e
      where ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1)) and e.id <> $3
        and ${publicDateSql("e")}`,
    [x, y, excludeId ?? ""],
  );
  const n = rows[0]?.n ?? 0;
  return n > 0 ? n + 1 : null;
}
