/**
 * The Daily Date's pure half, shared by the server and the browser: which day it is, the streak kept in the browser,
 * and the spoiler-free line "Copy result" puts on the clipboard. No database here (lib/daily.ts deals the dates).
 *
 * A day is a UTC day, numbered from #1 on Sunday 25 October 2026, the day the Daily Date was built: everyone in the
 * world plays the same date on the same number, and a shared "#12" means the same date to whoever reads it.
 */
import { ENDINGS, type Ending } from "./rules";

export const DAILY_PATH = "/daily";
/** The tag on a shared result's link, which the beacon counts (app/funnel.ts BEACON_REFS). */
export const DAILY_REF = "daily";
export const DAILY_SHARE_PATH = `${DAILY_PATH}?ref=${DAILY_REF}`;
/** Where the browser keeps its picks: no account, nothing on our side. */
export const DAILY_STORAGE_KEY = "botchelor:daily";
/** The Daily Date's link preview is the site's own card (app/opengraph-image.tsx): it gives nothing away. */
export const SITE_CARD = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Botchelor: a blind-date show for original characters. Friends predict the ending, for free points.",
};

const DAY_MS = 86_400_000;
/** 00:00 UTC on Daily Date #1. */
const FIRST_DAY_MS = Date.UTC(2026, 9, 25);
/** How many days of picks the browser keeps: a year and some, which is also the longest streak it can count. */
const KEPT_DAYS = 400;

/** The Daily Date number for a moment: 1 on 25 October 2026 (UTC), 2 the day after. 0 or less before it began. */
export function dailyNumberAt(now: Date | number): number {
  const ms = typeof now === "number" ? now : now.getTime();
  return Math.floor((ms - FIRST_DAY_MS) / DAY_MS) + 1;
}

/** The UTC day of Daily Date #n, YYYY-MM-DD. */
export function dailyDayOf(n: number): string {
  return new Date(FIRST_DAY_MS + (n - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** "Sunday, October 25": the day Daily Date #n is for, in UTC like its number. */
export function dailyDayLabel(n: number): string {
  return new Date(`${dailyDayOf(n)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Milliseconds until the next Daily Date: the next UTC midnight. */
export function msUntilNextDaily(nowMs: number): number {
  return DAY_MS - ((((nowMs - FIRST_DAY_MS) % DAY_MS) + DAY_MS) % DAY_MS);
}

/** "5h 12m", "12m", "under a minute": how long until the next one. */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** A day number from an address (/daily/12): digits only, no leading zero, at most six of them. Else null. */
export function parseDailyNumber(raw: string): number | null {
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : null;
}

/** One day's pick, as the browser keeps it. */
export type DailyPlay = { pick: Ending; correct: boolean };
export type DailyHistory = Record<number, DailyPlay>;

/** The browser's stored picks, read defensively: anything that isn't a day number and a valid pick is dropped. */
export function readDailyHistory(raw: string | null): DailyHistory {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: DailyHistory = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const n = parseDailyNumber(key);
    const play = value as Partial<DailyPlay> | null;
    if (n === null || !play || typeof play !== "object") continue;
    if (!ENDINGS.includes(play.pick as Ending) || typeof play.correct !== "boolean") continue;
    out[n] = { pick: play.pick as Ending, correct: play.correct };
  }
  return out;
}

/** The history with day n's pick in, keeping the newest KEPT_DAYS days. */
export function recordDailyPlay(history: DailyHistory, n: number, play: DailyPlay): DailyHistory {
  const next: DailyHistory = { ...history, [n]: play };
  const days = Object.keys(next).map(Number).sort((x, y) => y - x);
  for (const old of days.slice(KEPT_DAYS)) delete next[old];
  return next;
}

/** Right picks in a row, ending on day n: a wrong pick, or a day not played, starts it over. */
export function dailyStreak(history: DailyHistory, n: number): number {
  let streak = 0;
  while (history[n - streak]?.correct) streak++;
  return streak;
}

/** A day's date once it may be told: how it ended and how it went (lib/daily.ts dailyStory). */
export type DailyStory = {
  n: number;
  ending: Ending;
  ending_label: string;
  scenes: string[];
  finale: string;
  best_line: string | null;
  why: string | null;
  episode_path: string;
  names: [string, string];
};

/** What POST /api/daily returns once a pick is in: the day's date, the pick and whether it was right. */
export type DailyReveal = DailyStory & { pick: Ending; correct: boolean };

/**
 * The line "Copy result" copies: the day's number, ✅ or ❌, the streak and the link, Wordle-style. Never the ending
 * and never the characters' names, so pasting it spoils nothing for anyone who hasn't played.
 */
export function dailyShareText({ n, correct, streak, url }: { n: number; correct: boolean; streak: number; url: string }): string {
  return [`Botchelor Daily #${n} ${correct ? "✅ Called it" : "❌ Missed it"}`, `Streak: ${streak}`, url].join("\n");
}
