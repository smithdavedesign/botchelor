"use client";

import { useEffect, useState } from "react";

/**
 * The show's weekly moments (free dates back on Monday 00:00 UTC, Sunday's roses) in the viewer's own clock
 * (2026-11-22 audit: they read in UTC). The server renders UTC, so the browser's words come after the first paint: a time
 * formatted on both sides differs, and React stops hydrating (app/after-dark/LocalTime.tsx).
 */

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The next `weekday` (0 = Sunday … 6 = Saturday) at hh:mm UTC, at or after `now`. */
export function nextWeeklyUtc(weekday: number, hour: number, minute: number, now: Date = new Date()): Date {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  at.setUTCDate(at.getUTCDate() + ((weekday - at.getUTCDay() + 7) % 7));
  if (at.getTime() < now.getTime()) at.setUTCDate(at.getUTCDate() + 7);
  return at;
}

/** "Sunday at 23:20 UTC": what the server's first paint says. */
export const utcWeeklyWords = (weekday: number, hour: number, minute: number): string => `${DAYS[weekday]} at ${pad(hour)}:${pad(minute)} UTC`;

/** "Sunday at 3:20 PM" in a clock (the browser's own unless `timeZone` names one), weekday and time in its locale. */
export function localWeeklyWords(weekday: number, hour: number, minute: number, opts: { now?: Date; locale?: string; timeZone?: string } = {}): string {
  const at = nextWeeklyUtc(weekday, hour, minute, opts.now);
  const day = at.toLocaleDateString(opts.locale, { weekday: "long", timeZone: opts.timeZone });
  const time = at.toLocaleTimeString(opts.locale, { hour: "numeric", minute: "2-digit", timeZone: opts.timeZone });
  return `${day} at ${time}`;
}

/** A weekly UTC moment in words: UTC on the first paint, then the viewer's own clock. */
export function useWeeklyWords(weekday: number, hour: number, minute: number): string {
  const [words, setWords] = useState(() => utcWeeklyWords(weekday, hour, minute));
  useEffect(() => {
    try {
      setWords(localWeeklyWords(weekday, hour, minute));
    } catch {
      // A browser without the time-zone data keeps UTC.
    }
  }, [weekday, hour, minute]);
  return words;
}
