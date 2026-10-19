/**
 * When a season starts and ends. No imports, so lib/seasons.ts (the leaderboard) and lib/season-cast.ts (who's on the
 * show) can share it without seasons.ts → game.ts → mechanics.ts → season-cast.ts going round in a circle.
 *
 * Seasons went monthly on 2026-10-19 (David: "have the season last a month and on the first we rotate"): the week that
 * started that Monday became the first monthly season and runs to the end of October; from November each season is a
 * calendar month, 1st 00:00 UTC to the next 1st. Seasons before then were weeks, Monday to Monday, and keep their ids
 * (the Monday) so closed seasons and their badges read the same.
 *
 * What stays weekly: free dates (lib/allowance.ts) and a character's "this week" (lib/life.ts) use weekWindow.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The first monthly season starts here (UTC). */
export const MONTHLY_FROM = Date.UTC(2026, 9, 19);

/** The week containing `now`: Monday 00:00 UTC to the next Monday. */
export function weekWindow(now: Date): { start: Date; end: Date } {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const start = new Date(midnight - daysSinceMonday * DAY_MS);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

/** The season containing `now`: a week before MONTHLY_FROM, a calendar month after (the first one starts on it). */
export function seasonWindow(now: Date): { start: Date; end: Date } {
  if (now.getTime() < MONTHLY_FROM) return weekWindow(now);
  const start = Math.max(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), MONTHLY_FROM);
  return { start: new Date(start), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/** A season's id: the day it starts, YYYY-MM-DD (UTC). */
export const seasonIdOf = (now: Date): string => seasonWindow(now).start.toISOString().slice(0, 10);

/** The id of the week containing `now` (its Monday), for what stays weekly. */
export const weekIdOf = (now: Date): string => weekWindow(now).start.toISOString().slice(0, 10);

/** The season after the one containing `now`. */
export const nextSeasonStart = (now: Date): Date => seasonWindow(now).end;

/** The season before the one containing `now`. */
export const previousSeasonStart = (now: Date): Date => seasonWindow(new Date(seasonWindow(now).start.getTime() - 1)).start;

/** "week of Oct 12" for a weekly season, "October 2026" for a monthly one. */
export function seasonLabel(id: string): string {
  const d = new Date(`${id}T00:00:00.000Z`);
  if (d.getTime() < MONTHLY_FROM) return `week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
