/**
 * Small, pure helpers for the admin analytics charts (app/admin/analytics): UTC days, moving averages, weekly buckets,
 * axis ticks, scales, SVG paths, number formats and CSV. No React and no server imports, so the browser and
 * lib/insights.ts share them and tests/insights.test.ts checks them on their own.
 */

export const DAY_MS = 86_400_000;

/** A UTC day as "YYYY-MM-DD". */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The day `n` days after (or before, for a negative n) a "YYYY-MM-DD" day. */
export const addDays = (day: string, n: number): string => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));

/** Whole days from one "YYYY-MM-DD" day to another (to minus from). */
export const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Every UTC day from `from` to `to`, both included; empty when `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0, n = dayDiff(from, to); i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** True for a real calendar day written "YYYY-MM-DD" (not "2026-02-31"). */
export const isDay = (s: string | null | undefined): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && isoDay(new Date(`${s}T00:00:00Z`)) === s;

/** The Monday of a day's week (weeks start on Monday, like ISO weeks). */
export function weekOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * A trailing moving average: each point is the mean of itself and the `window - 1` points before it, missing values
 * (null) skipped. `lead` is the series just before the first point (the previous period's tail), so the first days get
 * a full window rather than a short one. A point with no values at all in its window is null.
 */
export function movingAverage(values: readonly (number | null)[], window: number, lead: readonly (number | null)[] = []): (number | null)[] {
  const all = [...lead, ...values];
  return values.map((_, i) => {
    const end = lead.length + i;
    const seen = all.slice(Math.max(0, end - window + 1), end + 1).filter((v): v is number => v !== null && Number.isFinite(v));
    return seen.length ? seen.reduce((s, v) => s + v, 0) / seen.length : null;
  });
}

/**
 * Daily values folded into weeks (each labelled by its Monday): summed for counts, averaged over the days that have a
 * value for rates and ratings. A week with no value at all (every day missing) is null either way: summing nothing
 * would make it a zero. `days` says how many of each week's days were in the range (fewer than 7 is a partial week).
 */
export function byWeek(days: readonly string[], values: readonly (number | null)[], how: "sum" | "mean"): { labels: string[]; values: (number | null)[]; days: number[] } {
  const labels: string[] = [];
  const counts: number[] = [];
  const buckets: number[][] = [];
  days.forEach((day, i) => {
    const week = weekOf(day);
    if (labels[labels.length - 1] !== week) {
      labels.push(week);
      counts.push(0);
      buckets.push([]);
    }
    counts[counts.length - 1]++;
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) buckets[buckets.length - 1].push(v);
  });
  return {
    labels,
    values: buckets.map((b) => (b.length === 0 ? null : how === "sum" ? b.reduce((s, v) => s + v, 0) : b.reduce((s, v) => s + v, 0) / b.length)),
    days: counts,
  };
}

export type Interval = "day" | "week";

/** A daily series as a chart shows it: day by day, or folded into weeks. `partial` marks a week cut short by the range. */
export function bucket(days: readonly string[], values: readonly (number | null)[], interval: Interval, how: "sum" | "mean"): { labels: string[]; values: (number | null)[]; partial: boolean[] } {
  if (interval === "day") return { labels: [...days], values: [...values], partial: days.map(() => false) };
  const w = byWeek(days, values, how);
  return { labels: w.labels, values: w.values, partial: w.days.map((n) => n < 7) };
}

/** The trend window: a week of days, or four weeks. */
export const trendWindow = (interval: Interval): number => (interval === "day" ? 7 : 4);

/**
 * A count series' two companion lines, both on the chart's own buckets: the trend (a 7-day or 4-week moving average,
 * its first points led in by the previous period so they average a full window) and the previous period point for point.
 * A missing day (null: not logged yet) is skipped by the average rather than counted as zero.
 */
export function trendLines(
  days: readonly string[],
  current: readonly (number | null)[],
  previousDays: readonly string[],
  previous: readonly (number | null)[],
  interval: Interval,
): { average: (number | null)[]; previous: (number | null)[] } {
  const now = bucket(days, current, interval, "sum");
  const before = bucket(previousDays, previous, interval, "sum");
  return {
    average: movingAverage(now.values, trendWindow(interval), before.values),
    // Weeks can fall differently in the two periods: line them up from the start, and leave a missing week empty.
    previous: now.values.map((_, i) => before.values[i] ?? null),
  };
}

/**
 * Round axis ticks from 0 up to at least `max` (0, 5, 10, 15 or 0, 0.25, 0.5…): about `count` steps of 1, 2, 2.5 or
 * 5 × 10^n. `integer` keeps them whole (a count never has 2.5 of anything).
 */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).filter((s) => !integer || (Number.isInteger(s) && s >= 1));
  const step = steps.find((s) => s >= raw) ?? (integer ? Math.max(1, Math.ceil(raw)) : 10 * magnitude);
  const ticks: number[] = [];
  // Rounded so 0.1 + 0.2 shows as 0.3, not 0.30000000000000004.
  for (let v = 0; v < max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

/** A linear scale: maps a value in `domain` onto `range` (an empty domain maps everything to the range's start). */
export function scaleLinear([d0, d1]: [number, number], [r0, r1]: [number, number]): (v: number) => number {
  const span = d1 - d0;
  return (v) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

/** An SVG path through the points, lifted where a value is missing (null) so a gap shows as a gap, not a zero. */
export function linePath(points: readonly ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${round2(p.x)} ${round2(p.y)}`;
    pen = true;
  }
  return d;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 1,284 → "1.3K", 2,500,000 → "2.5M"; under 1,000 as it is (one decimal at most). */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n);
}
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 3" for a "YYYY-MM-DD" day, read as UTC so it never slips a day in another time zone. */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** A share as a whole percentage ("42%"); null as "—". */
export const percent = (share: number | null): string => (share === null || !Number.isFinite(share) ? "—" : `${Math.round(share * 100)}%`);

/**
 * CSV text (RFC 4180): a cell with a comma, quote or line break is quoted. A text cell starting with = + - @ or a tab is
 * prefixed with ' so a spreadsheet shows it rather than running it as a formula (character names are typed by people).
 */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
