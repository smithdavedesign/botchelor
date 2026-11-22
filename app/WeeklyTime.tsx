"use client";

import { useWeeklyWords } from "./weekly-time";

/**
 * A weekly moment of the show in a server page's words (app/weekly-time.ts): "Monday at 00:00 UTC" as sent, then the
 * viewer's own day and time ("Sunday at 4:00 PM") once the page is up. For /pricing and /shop's "free dates come back"
 * (2026-11-22 audit: they read in UTC).
 */
export default function WeeklyTime({ weekday, hour = 0, minute = 0 }: { weekday: number; hour?: number; minute?: number }) {
  return <>{useWeeklyWords(weekday, hour, minute)}</>;
}
