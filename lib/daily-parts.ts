import type { Props } from "./analytics";
import type { Db } from "./db";
import { writeOps } from "./ops-log";

/**
 * The daily job's parts (app/api/jobs/daily), and the pass that gives a part that didn't finish another go.
 *
 * The scheduled job (.do/app.yaml) calls the parts one request each from 16:20 UTC. A deploy replaces the show's only
 * instance and ends whatever part is running (the people part, with the day's texts and digest, on 2026-11-17; growth on
 * 11-14), and nothing ran them again. So each part writes a row to the servers' own log (lib/ops-log.ts, daily_part) as
 * it starts and as it ends, and from 17:20 the hourly job calls ?part=resume: the first of the day's parts with no "done"
 * row runs again. Running a part again is safe: its steps keep to once a day on their own (the texts by their day, the
 * digest by when it went out, the reminders by what they already sent), as they had to for a manual run.
 */

export const DAILY_PARTS = ["upkeep", "show", "people", "growth"] as const;
export type DailyPart = (typeof DAILY_PARTS)[number];
export const isDailyPart = (s: string): s is DailyPart => (DAILY_PARTS as readonly string[]).includes(s);

/** The hour (UTC) the scheduled job runs the parts (.do/app.yaml: 16:20). The day's parts count from it. */
export const DAILY_HOUR_UTC = 16;
/** The resume pass starts the hour after, so it never runs beside the scheduled run. */
export const RESUME_FROM_HOUR_UTC = DAILY_HOUR_UTC + 1;
/** A part that started this recently and wrote no end is taken to be running still (the slowest so far: 6.5 minutes). */
export const STILL_RUNNING_MS = 30 * 60_000;
/** Runs a part gets in a day, the scheduled one included: a part that keeps failing waits for tomorrow's. */
export const MAX_TRIES = 3;

export type PartState = "started" | "done" | "failed";
/** Why a part runs again: it never started, it started and never ended (a deploy, a crash), or it failed. */
export type Why = "missed" | "cut off" | "failed";
export type PartRow = { part: string; state: string; at: Date };
export type PartStatus = { part: DailyPart; state: PartState | "not run"; at: string | null; tries: number };

export type Resume =
  | { part: DailyPart; why: Why; tries: number }
  | { part: null; reason: "not_yet" | "running" | "all_done"; busy: DailyPart | null; gave_up: DailyPart[] };

/** Writes a part's row and waits for it, since the next resume pass reads it. Never throws. */
export function notePart(db: Db, part: DailyPart, state: PartState, extra: Props = {}): Promise<boolean> {
  return writeOps("daily_part", { ...extra, part, state }, db);
}

/** Where the day's parts are counted from: DAILY_HOUR_UTC today, or yesterday's before that hour. */
export function dailyWindowStart(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_HOUR_UTC);
  return new Date(today > now.getTime() ? today - 24 * 60 * 60_000 : today);
}

/** Each part's state from a window's rows, oldest first: done once any run finished, else its latest row. */
export function partStatus(rows: PartRow[]): PartStatus[] {
  return DAILY_PARTS.map((part) => {
    const mine = rows.filter((r) => r.part === part);
    const done = mine.filter((r) => r.state === "done").at(-1);
    const last = done ?? mine.at(-1);
    const state: PartStatus["state"] = last && (last.state === "started" || last.state === "done" || last.state === "failed") ? last.state : "not run";
    return { part, state, at: last ? last.at.toISOString() : null, tries: mine.filter((r) => r.state === "started").length };
  });
}

/** What a resume pass does with today's rows: nothing while a part still runs, else the first part not done, once. */
export function pickResume(rows: PartRow[], now: Date): Resume {
  if (now.getUTCHours() < RESUME_FROM_HOUR_UTC) return { part: null, reason: "not_yet", busy: null, gave_up: [] };
  const status = partStatus(rows);
  const running = status.find((s) => s.state === "started" && s.at !== null && now.getTime() - Date.parse(s.at) < STILL_RUNNING_MS);
  if (running) return { part: null, reason: "running", busy: running.part, gave_up: [] };
  const gaveUp: DailyPart[] = [];
  for (const s of status) {
    if (s.state === "done") continue;
    if (s.tries >= MAX_TRIES) {
      gaveUp.push(s.part);
      continue;
    }
    return { part: s.part, why: s.state === "not run" ? "missed" : s.state === "failed" ? "failed" : "cut off", tries: s.tries };
  }
  return { part: null, reason: "all_done", busy: null, gave_up: gaveUp };
}

/**
 * The window's rows. A part with none in the servers' log but a run in job_runs (lib/job-meter.ts, written as each part
 * ends) counts as done: the job ran it before parts were logged (the day this shipped), or the log's write failed.
 * Without this, the first resume pass would run every part a second time that day. A run of all four (no ?part) is
 * job_runs part "all".
 */
async function partRows(db: Db, since: Date): Promise<PartRow[]> {
  const { rows } = await db.query<{ part: string | null; state: string | null; at: Date | string }>(
    `select props->>'part' as part, props->>'state' as state, at from ops_log
      where event = 'daily_part' and at >= $1 order by at, id`,
    [since.toISOString()],
  );
  const logged = rows.flatMap((r) => (r.part && r.state ? [{ part: r.part, state: r.state, at: new Date(r.at) }] : []));
  const ran = await db.query<{ part: string; at: Date | string }>(
    `select part, max(at) as at from job_runs where job = 'daily' and at >= $1 group by part`,
    [since.toISOString()],
  );
  const seen = new Set(logged.map((r) => r.part));
  const unlogged = ran.rows
    .flatMap((r) => (r.part === "all" ? DAILY_PARTS.map((part) => ({ part, at: r.at })) : [{ part: r.part, at: r.at }]))
    .filter((r) => isDailyPart(r.part) && !seen.has(r.part))
    .map((r) => ({ part: r.part, state: "done", at: new Date(r.at) }));
  return [...logged, ...unlogged].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The resume pass's pick (app/api/jobs/daily ?part=resume), from today's rows. */
export async function nextDailyPart(db: Db, now = new Date()): Promise<Resume> {
  if (now.getUTCHours() < RESUME_FROM_HOUR_UTC) return { part: null, reason: "not_yet", busy: null, gave_up: [] };
  return pickResume(await partRows(db, dailyWindowStart(now)), now);
}

/** The latest day's parts, for /admin (app/api/admin/ops). */
export async function dailyStatus(db: Db, now = new Date()): Promise<{ since: string; parts: PartStatus[] }> {
  const since = dailyWindowStart(now);
  return { since: since.toISOString(), parts: partStatus(await partRows(db, since)) };
}
