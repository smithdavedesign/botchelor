/**
 * A countdown in words ("in 5h 12m", "in 40m", "in 2 days"), from a clock the page passes in (the pages are dynamic,
 * so it's the server's). Pure and client-safe: Sunday's reveal (app/WeeklyReveal.tsx) and the season pool use it.
 */
export function countdown(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return "any minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `in ${hours}h ${mins % 60}m` : `in ${hours}h`;
  return inDays(daysUntil(iso, now));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from today to the day `iso` falls on, both the show's days (UTC, lib/season-window.ts): the count the
 * season's arc makes ("8 days to the finale", lib/season-format.ts seasonArc). Every countdown a day or more away counts
 * this way, so one page never says "8 days to the finale" beside "the Recoupling in 9 days" for the same night (the
 * 2026-11-22 audit: hours / 24, rounded, went a day over from the late evening on).
 */
export function daysUntil(iso: string, now: number): number {
  return Math.floor(Date.parse(iso) / DAY_MS) - Math.floor(now / DAY_MS);
}

/** "in 1 day", "in 8 days". */
export const inDays = (days: number): string => `in ${days} ${days === 1 ? "day" : "days"}`;

/**
 * The last moment of the night before `iso`: a season "closes" at midnight after its last night, so a countdown to its
 * close counts to that night, as "N days to the finale" does.
 */
export const lastNightOf = (iso: string): string => new Date(Date.parse(iso) - 1).toISOString();
