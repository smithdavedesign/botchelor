/**
 * Your character meets the cast (docs/ideas.md "Bringing viewers back", idea 15; David 2026-11-01): a weekly earned
 * slot. Once a week, the show looks at last week's most active viewers (web_events, lib/engagement.ts) and grants ONE
 * of them a date between their character and a cast member they pick, on the show. The producers are watching: showing
 * up earns you a seat at the table.
 *
 *  - One winner a week (spend stays at one show-paid date, ~1-5¢): the most page events last week among people who
 *    have a character of their own, leaving out our own traffic and admins (lib/our-traffic.ts loadOurIds covers both)
 *    and anyone who won in the last four weeks, so the slot travels. A quiet week (nobody over MIN_EVENTS) grants nothing.
 *  - The prize is a granted date (token_grants, exactly like an admin grant: counted as a pack date, never revenue).
 *    They book it themselves: pick a cast member, ask them out. No new booking path, every rule applies as usual.
 *  - Picked by the daily job; the claim row (cast_date_weeks, one per week) makes it once however often that runs.
 */
import type { Db } from "./db";
import { loadOurIds } from "./our-traffic";
import { notify } from "./notifications";
import { weekIdOf, weekWindow } from "./season-window";

/** Fewer page events than this last week: nobody earned the slot (a stray page view isn't a most-active viewer). */
export const MIN_EVENTS = 10;
/** A winner sits out this many days before they can win again. */
export const WINNER_COOLDOWN_DAYS = 28;
/** How long the winner's banner shows on the cast tab. */
export const BANNER_DAYS = 7;

export type CastDatePicked =
  | { picked: true; week_id: string; user_id: string; events: number }
  | { picked: false; reason: "already" | "nobody" | "claimed_elsewhere" };

/** The last completed week (Monday to Monday, UTC) as of `now`: the week the slot is earned for. */
export function lastWeekOf(now: Date): { id: string; start: Date; end: Date } {
  const { start } = weekWindow(now);
  const prev = new Date(start.getTime() - 1);
  const w = weekWindow(prev);
  return { id: weekIdOf(prev), start: w.start, end: w.end };
}

/**
 * The weekly pick: last week's most active viewer with a character of their own, granted one date on the show.
 * Idempotent per week (the claim row), so the daily job can call it every run.
 */
export async function pickWeeklyCastDate(db: Db, now: Date = new Date()): Promise<CastDatePicked> {
  const week = lastWeekOf(now);
  const have = (await db.query<{ user_id: string }>(`select user_id from cast_date_weeks where week_id = $1`, [week.id])).rows[0];
  if (have) return { picked: false, reason: "already" };
  const ours = await loadOurIds(db);
  const winner = (
    await db.query<{ user_id: string; events: number }>(
      `select w.user_id, count(*)::int as events
         from web_events w
        where w.at >= $1 and w.at < $2 and w.user_id is not null
          and not (w.user_id = any($3::text[]))
          and exists (select 1 from characters c where c.owner_id = w.user_id and not c.is_house)
          and not exists (select 1 from cast_date_weeks p where p.user_id = w.user_id and p.granted_at > $2::timestamptz - ($4::int * interval '1 day'))
        group by w.user_id
       having count(*) >= $5
        order by events desc, w.user_id
        limit 1`,
      [week.start.toISOString(), week.end.toISOString(), ours, WINNER_COOLDOWN_DAYS, MIN_EVENTS],
    )
  ).rows[0];
  if (!winner) return { picked: false, reason: "nobody" };
  const claimed = (
    await db.query(`insert into cast_date_weeks (week_id, user_id) values ($1, $2) on conflict (week_id) do nothing returning week_id`, [week.id, winner.user_id])
  ).rows.length;
  if (!claimed) return { picked: false, reason: "claimed_elsewhere" };
  // The prize: one granted date, counted like a pack date and spent through the normal booking path (lib/allowance.ts).
  await db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 1, 'cast_date_week')`, [crypto.randomUUID(), winner.user_id]);
  await notify(db, winner.user_id, {
    kind: "cast_date_won",
    title: "The producers were watching: date the cast, on the show",
    body:
      "You were one of last week's most active viewers, so this week's earned slot is yours: one date between your character and a season cast member of your choosing, on the show. Pick your cast member and ask them out.",
    link: "/characters?tab=cast",
  });
  return { picked: true, week_id: week.id, user_id: winner.user_id, events: winner.events };
}

export type CastDateBanner = { granted_at: string };

/** The winner's banner on the cast tab, for BANNER_DAYS after their win. Null for everyone else. */
export async function castDateBanner(db: Db, viewerId: string | null, now: Date = new Date()): Promise<CastDateBanner | null> {
  if (!viewerId) return null;
  const row = (
    await db.query<{ granted_at: Date | string }>(
      `select granted_at from cast_date_weeks where user_id = $1 and granted_at > $2::timestamptz - ($3::int * interval '1 day') order by granted_at desc limit 1`,
      [viewerId, now.toISOString(), BANNER_DAYS],
    )
  ).rows[0];
  return row ? { granted_at: new Date(row.granted_at).toISOString() } : null;
}
