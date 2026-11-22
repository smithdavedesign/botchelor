import { daysUntil } from "./season-window";

/**
 * A countdown in words ("in 5h 12m", "in 40m", "in 2 days"), from a clock the page passes in (the pages are dynamic,
 * so it's the server's). Pure and client-safe: Sunday's reveal (app/WeeklyReveal.tsx) and the season pool use it. A day
 * or more away, it counts whole show days (UTC, lib/season-window.ts daysUntil), as the season's arc does ("8 days to the
 * finale"): hours / 24, rounded, went a day over from the late evening on (the 2026-11-22 audit).
 */
export function countdown(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return "any minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `in ${hours}h ${mins % 60}m` : `in ${hours}h`;
  return inDays(daysUntil(now, iso));
}

/** "in 1 day", "in 8 days". */
const inDays = (days: number): string => `in ${days} ${days === 1 ? "day" : "days"}`;

/**
 * The last moment of the night before `iso`: a season "closes" at midnight after its last night, so a countdown to its
 * close counts to that night, as "N days to the finale" does.
 */
export const lastNightOf = (iso: string): string => new Date(Date.parse(iso) - 1).toISOString();
