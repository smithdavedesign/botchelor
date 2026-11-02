/**
 * How a monthly season is named and found (lib/season-recap.ts is its finale page): its number ("Season 1" is October
 * 2026, the first monthly season, lib/season-window.ts MONTHLY_FROM), its slug (/seasons/october-2026) and which ones
 * have closed. Pure, no database: the banner, the Reunion's list and "Since you were here" all read it.
 *
 * The weekly seasons before MONTHLY_FROM have no finale: they were leaderboard weeks, not seasons of the show.
 */
import { MONTHLY_FROM, seasonIdOf, seasonLabel, seasonWindow } from "./season-window";

/** How long after a season closes the banner on home and /watch says so (David: "the first 7 days of a month"). */
export const BANNER_DAYS = 7;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export type SeasonRef = { id: string; number: number; label: string; path: string };

/** Whether a season id is a monthly one (it starts on or after MONTHLY_FROM). */
export const isMonthlySeason = (id: string): boolean => Date.parse(`${id}T00:00:00Z`) >= MONTHLY_FROM;

/** A monthly season's number: 1 for October 2026, 2 for November... null for a weekly one. */
export function seasonNumber(id: string): number | null {
  if (!isMonthlySeason(id)) return null;
  const d = new Date(`${id}T00:00:00Z`);
  const first = new Date(MONTHLY_FROM);
  return (d.getUTCFullYear() - first.getUTCFullYear()) * 12 + (d.getUTCMonth() - first.getUTCMonth()) + 1;
}

/** "october-2026": the month and year, which is what people call it. */
export function seasonSlug(id: string): string {
  const d = new Date(`${id}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** The monthly season a slug names, or null (a weekly one, a month before them, or not a slug). */
export function seasonIdFromSlug(slug: string): string | null {
  const m = /^([a-z]+)-(\d{4})$/.exec(slug.trim().toLowerCase());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  // The month's last moment is inside its season even for the first one, which started mid-month (Oct 19).
  const id = seasonIdOf(new Date(Date.UTC(Number(m[2]), month + 1, 1) - 1));
  return isMonthlySeason(id) && seasonSlug(id) === `${m[1]}-${m[2]}` ? id : null;
}

export const seasonPath = (id: string): string => `/seasons/${seasonSlug(id)}`;

export function seasonRef(id: string): SeasonRef {
  return { id, number: seasonNumber(id) ?? 0, label: seasonLabel(id), path: seasonPath(id) };
}

/** The season before the one containing `now`, when it was a monthly one. */
export function lastClosedSeason(now: Date = new Date()): SeasonRef | null {
  const id = seasonIdOf(new Date(seasonWindow(now).start.getTime() - 1));
  return isMonthlySeason(id) ? seasonRef(id) : null;
}

/** Every closed monthly season, newest first. */
export function closedSeasons(now: Date = new Date()): SeasonRef[] {
  const out: SeasonRef[] = [];
  for (let at = seasonWindow(now).start.getTime() - 1; at >= MONTHLY_FROM; at = seasonWindow(new Date(at)).start.getTime() - 1) {
    out.push(seasonRef(seasonIdOf(new Date(at))));
  }
  return out;
}

/** The season that just closed, for the first BANNER_DAYS days of the next one; otherwise null. */
export function seasonBanner(now: Date = new Date()): SeasonRef | null {
  const { start } = seasonWindow(now);
  if (now.getTime() - start.getTime() >= BANNER_DAYS * 24 * 60 * 60 * 1000) return null;
  return lastClosedSeason(now);
}

/** The latest monthly season that closed after `since` (a returning visitor's last visit), or null. */
export function seasonClosedSince(since: Date, now: Date = new Date()): SeasonRef | null {
  const closedAt = seasonWindow(now).start;
  return closedAt > since ? lastClosedSeason(now) : null;
}
