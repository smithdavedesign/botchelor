import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import type { Db } from "./db";

/**
 * How hard a background job leans on the one web instance it shares with visitors (2026-11-11: botchelor.com answered
 * 504 for ~5 and ~9 minutes after the 16:20 UTC daily job, on a 1 vCPU / 1 GB instance with a ~520 MB heap, and nothing
 * said which step did it). Each step's time and memory, and how long the event loop stalled (a stall past 3 s three
 * times running fails DigitalOcean's health check, which restarts the instance). Counts only, no content.
 */

const MB = 1024 * 1024;
const mb = (bytes: number) => Math.round(bytes / MB);
/** How long job reports are kept (lib/retention.ts keeps personal data; these are numbers about the server). */
const KEEP_DAYS = 30;

export type StepReport = { step: string; ms: number; heap_mb: number; rss_mb: number };
export type JobReport = {
  ms: number;
  rss_mb_start: number;
  rss_mb_peak: number;
  heap_mb_start: number;
  heap_mb_peak: number;
  heap_limit_mb: number;
  /** The longest the event loop was blocked during the job, and the 99th percentile, in ms. */
  loop_max_ms: number;
  loop_p99_ms: number;
  steps: StepReport[];
};

/** The process's memory now: for the authorized health check, so a slow climb shows up before it becomes an outage. */
export function processMemory(): { uptime_s: number; rss_mb: number; heap_used_mb: number; heap_limit_mb: number; external_mb: number } {
  const m = process.memoryUsage();
  return {
    uptime_s: Math.round(process.uptime()),
    rss_mb: mb(m.rss),
    heap_used_mb: mb(m.heapUsed),
    heap_limit_mb: mb(getHeapStatistics().heap_size_limit),
    external_mb: mb(m.external),
  };
}

/** Times each step of a job and samples memory after it. Uses performance.now(), never Date.now() (tests fake that). */
export function startJobMeter() {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const t = performance.now();
  const start = process.memoryUsage();
  let rssPeak = start.rss;
  let heapPeak = start.heapUsed;
  const steps: StepReport[] = [];
  return {
    /** Runs one step and records it, whether it resolves or throws (the error still propagates). */
    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const s = performance.now();
      try {
        return await fn();
      } finally {
        const m = process.memoryUsage();
        rssPeak = Math.max(rssPeak, m.rss);
        heapPeak = Math.max(heapPeak, m.heapUsed);
        steps.push({ step: name, ms: Math.round(performance.now() - s), heap_mb: mb(m.heapUsed), rss_mb: mb(m.rss) });
      }
    },
    finish(): JobReport {
      loop.disable();
      // The histogram is in nanoseconds; with no samples yet its max is 0 and its percentile NaN.
      const p99 = loop.percentile(99);
      return {
        ms: Math.round(performance.now() - t),
        rss_mb_start: mb(start.rss),
        rss_mb_peak: mb(rssPeak),
        heap_mb_start: mb(start.heapUsed),
        heap_mb_peak: mb(heapPeak),
        heap_limit_mb: mb(getHeapStatistics().heap_size_limit),
        loop_max_ms: Math.round(loop.max / 1e6),
        loop_p99_ms: Number.isFinite(p99) ? Math.round(p99 / 1e6) : 0,
        steps,
      };
    },
  };
}

/** Keeps one job run's report (and drops reports older than KEEP_DAYS). Never throws: a report must not fail the job. */
export async function recordJobRun(db: Db, job: string, part: string, report: JobReport): Promise<void> {
  try {
    await db.query(`insert into job_runs (job, part, ms, report) values ($1, $2, $3, $4::jsonb)`, [job, part, report.ms, JSON.stringify(report)]);
    await db.query(`delete from job_runs where at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
  } catch {
    /* the report is for us; the job's work is already done */
  }
}

/** Each part's latest run of a job in the last day, without its step list: what the health check shows. */
export async function latestJobRuns(db: Db, job: string): Promise<{ part: string; at: string; ms: number; rss_mb_peak: number; heap_mb_peak: number; loop_max_ms: number; slowest: string | null }[]> {
  const { rows } = await db.query<{ part: string; at: Date; ms: number; report: JobReport }>(
    `select distinct on (part) part, at, ms, report from job_runs
      where job = $1 and at > now() - interval '26 hours'
      order by part, at desc`,
    [job],
  );
  return rows.map((r) => {
    const slowest = [...(r.report.steps ?? [])].sort((a, b) => b.ms - a.ms)[0];
    return {
      part: r.part,
      at: new Date(r.at).toISOString(),
      ms: r.ms,
      rss_mb_peak: r.report.rss_mb_peak,
      heap_mb_peak: r.report.heap_mb_peak,
      loop_max_ms: r.report.loop_max_ms,
      slowest: slowest ? `${slowest.step} ${slowest.ms}ms` : null,
    };
  });
}
