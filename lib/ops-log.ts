import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { getHeapStatistics } from "node:v8";
import { afterDarkOnly } from "./after-dark-host";
import { episodeCostProps, track, trackEpisodeCost, type AnalyticsEvent, type EpisodeCost, type Props } from "./analytics";
import { dbFailure, getDb, type Db } from "./db";
import { commitSha, isDeployed } from "./deploy";
import { cleanMessage } from "./errors";

/**
 * The servers' own log, kept in the database (ops_log, lib/db.ts). The container's output was the only log there was, and
 * every deploy (about 36 a day) replaces the container and takes its output along: a date that failed, what a date cost,
 * even when the server last started were gone by the next merge (2026-11-22 audit). This keeps those few things as rows:
 * ids, counts and short cleaned reasons, never a word of a date or who anyone is. Writing is best effort and stays off a
 * request's path: callers never wait for it, it never throws, and at most MAX_IN_FLIGHT writes wait at once (a database
 * gone slow loses rows, not requests). /admin shows them (opsSummary); the daily job keeps KEEP_DAYS.
 */

/** What the log keeps: a server starting, and the failures and costs of the dates. */
export type OpsEvent = "boot" | Extract<AnalyticsEvent, "generation_failed" | "conversation_failed" | "episode_generated">;

const KEEP_DAYS = 30;
const MAX_IN_FLIGHT = 20;
const MAX_TEXT = 120;
const MB = 1024 * 1024;

/** Which server wrote a row: After Dark's own host, the show's, or a developer's machine. */
export function opsHost(env: Record<string, string | undefined> = process.env): string {
  if (afterDarkOnly(env)) return "after-dark";
  return isDeployed(env) ? "show" : "local";
}

/** A row's fields: scalars only, texts cut short, and a reason cleaned of anything secret-shaped (lib/errors.ts). */
function cleanProps(props: Props): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (typeof v === "string") out[k] = k === "reason" ? cleanMessage(v) || "unknown" : v.slice(0, MAX_TEXT);
    else if (typeof v === "number") out[k] = Number.isFinite(v) ? v : null;
    else out[k] = v;
  }
  return out;
}

let inFlight = 0;
let dropped = 0;

/**
 * Keeps one row. The caller doesn't wait (`void keepOps(…)`); the promise is for tests. A write that fails, or one
 * past MAX_IN_FLIGHT, is dropped with a line in the container's log.
 */
export async function keepOps(event: OpsEvent, props: Props, db?: Db): Promise<void> {
  if (inFlight >= MAX_IN_FLIGHT) {
    if (dropped++ % 100 === 0) console.error(`[ops] log rows dropped while the database is slow (${dropped} so far)`);
    return;
  }
  inFlight++;
  try {
    await (db ?? (await getDb())).query("insert into ops_log (host, event, props) values ($1, $2, $3::jsonb)", [
      opsHost(),
      event,
      JSON.stringify(cleanProps(props)),
    ]);
  } catch (err) {
    console.error(`[ops] ${event} not kept: ${dbFailure(err)}`);
  } finally {
    inFlight--;
  }
}

/** track() and keep it: the analytics line in the container's log, and a row here that outlives the next deploy. */
export function trackKept(event: Exclude<OpsEvent, "boot" | "episode_generated">, props: Props): void {
  track(event, props);
  void keepOps(event, props);
}

/** trackEpisodeCost() and keep it: what one date cost and how long it took, past the next deploy. */
export function trackEpisodeCostKept(props: EpisodeCost): void {
  trackEpisodeCost(props);
  void keepOps("episode_generated", episodeCostProps(props));
}

/** The container's memory limit in MB (cgroup v2, else v1), or null with none (a developer's machine). */
export function containerMemoryLimitMb(read: (path: string) => string = (p) => readFileSync(p, "utf8")): number | null {
  for (const path of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const bytes = Number(read(path).trim());
      // "max" (v2) reads as NaN; v1 says "no limit" with a number near 2^63.
      if (Number.isFinite(bytes) && bytes > 0 && bytes < 2 ** 50) return Math.round(bytes / MB);
    } catch {
      /* not this cgroup version */
    }
  }
  return null;
}

/** What a server starts with: the commit it was built from, its memory and heap limits, Node's version, the instance. */
export function bootFacts(env: Record<string, string | undefined> = process.env): Props {
  return {
    sha: commitSha(env),
    memory_limit_mb: containerMemoryLimitMb(),
    heap_limit_mb: Math.round(getHeapStatistics().heap_size_limit / MB),
    node: process.version,
    instance: hostname().slice(0, 40),
    malloc_arena_max: env.MALLOC_ARENA_MAX?.trim() || null,
  };
}

/**
 * A server started (instrumentation.ts, on the connection that brought the schema up to date): one row, and the same
 * facts as one line in the container's log. Never throws.
 */
export async function recordBoot(db: Db, env: Record<string, string | undefined> = process.env): Promise<void> {
  const facts = bootFacts(env);
  console.log(`[ops] server started: ${opsHost(env)} ${JSON.stringify(facts)}`);
  try {
    await db.query("insert into ops_log (host, event, props) values ($1, 'boot', $2::jsonb)", [opsHost(env), JSON.stringify(cleanProps(facts))]);
  } catch (err) {
    console.error(`[ops] server start not kept: ${dbFailure(err)}`);
  }
}

export async function pruneOpsLog(db: Db, now = new Date()): Promise<void> {
  await db.query("delete from ops_log where at < $1", [new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()]);
}

type Row = { at: Date | string; host: string; event: string; props: Record<string, unknown> };

const short = (sha: unknown) => (typeof sha === "string" && sha ? sha.slice(0, 7) : "unknown");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One line about a row, for the admin's list: what it says, never more than the row holds. */
export function opsDetail(event: string, p: Record<string, unknown>): string {
  if (event === "boot") {
    const mem = num(p.memory_limit_mb);
    return `commit ${short(p.sha)}${mem ? `, ${mem} MB` : ""}${num(p.heap_limit_mb) ? `, heap ${p.heap_limit_mb} MB` : ""}`;
  }
  if (event === "episode_generated") {
    const cost = num(p.cost_usd);
    const ms = num(p.ms);
    return [p.where, p.model, `${num(p.model_calls) ?? "?"} calls`, ms !== null ? `${Math.round(ms / 1000)} s` : null, cost !== null ? `$${cost.toFixed(4)}` : null]
      .filter(Boolean)
      .join(" · ");
  }
  return [p.where, p.reason].filter((x) => typeof x === "string" && x).join(": ") || event;
}

export type OpsSummary = {
  /** Each host's latest start: what's running now. */
  live: { host: string; since: string; sha: string | null; memory_limit_mb: number | null; heap_limit_mb: number | null }[];
  /** Starts in the last day, and how many of them were on the same commit as the start before (a restart, not a deploy). */
  starts: { host: string; starts: number; restarts: number; unknown: number }[];
  /** The dates of the last day: written, failed, their conversations failed, what the written ones cost, the median time. */
  dates: { written: number; failed: number; conversation_failed: number; cost_usd: number; median_s: number | null };
  recent: { at: string; host: string; event: string; detail: string }[];
};

/** What /admin shows (app/api/admin/ops): what's running, the last day in numbers, and the latest rows. */
export async function opsSummary(db: Db, now = new Date()): Promise<OpsSummary> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [boots, dates, recent] = await Promise.all([
    // Two days of starts, so the first start of the last day has the one before it to compare commits with.
    db.query<Row>(`select at, host, event, props from ops_log where event = 'boot' and at > $1 order by host, at`, [
      new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
    ]),
    db.query<{ event: string; n: number; cost: string | number | null; median_ms: string | number | null }>(
      `select event, count(*)::int as n, sum((props->>'cost_usd')::numeric) as cost,
              percentile_cont(0.5) within group (order by (props->>'ms')::numeric) as median_ms
         from ops_log
        where at > $1 and event in ('episode_generated', 'generation_failed', 'conversation_failed')
        group by event`,
      [dayAgo],
    ),
    db.query<Row>(`select at, host, event, props from ops_log order by at desc limit 30`),
  ]);
  const byHost = new Map<string, Row[]>();
  for (const b of boots.rows) byHost.set(b.host, [...(byHost.get(b.host) ?? []), b]);
  const live: OpsSummary["live"] = [];
  const starts: OpsSummary["starts"] = [];
  for (const [host, rows] of byHost) {
    const last = rows[rows.length - 1];
    live.push({
      host,
      since: new Date(last.at).toISOString(),
      sha: typeof last.props.sha === "string" ? last.props.sha : null,
      memory_limit_mb: num(last.props.memory_limit_mb),
      heap_limit_mb: num(last.props.heap_limit_mb),
    });
    const s = { host, starts: 0, restarts: 0, unknown: 0 };
    rows.forEach((r, i) => {
      if (new Date(r.at).toISOString() <= dayAgo) return;
      s.starts++;
      const before = rows[i - 1];
      if (!before || typeof r.props.sha !== "string" || typeof before.props.sha !== "string") s.unknown++;
      else if (r.props.sha === before.props.sha) s.restarts++;
    });
    if (s.starts) starts.push(s);
  }
  const of = (event: string) => dates.rows.find((r) => r.event === event);
  const written = of("episode_generated");
  const median = written?.median_ms === null || written?.median_ms === undefined ? null : Number(written.median_ms);
  return {
    live: live.sort((a, b) => a.host.localeCompare(b.host)),
    starts: starts.sort((a, b) => a.host.localeCompare(b.host)),
    dates: {
      written: written?.n ?? 0,
      failed: of("generation_failed")?.n ?? 0,
      conversation_failed: of("conversation_failed")?.n ?? 0,
      cost_usd: Number(written?.cost ?? 0),
      median_s: median === null || !Number.isFinite(median) ? null : Math.round(median / 1000),
    },
    recent: recent.rows.map((r) => ({ at: new Date(r.at).toISOString(), host: r.host, event: r.event, detail: opsDetail(r.event, r.props) })),
  };
}
