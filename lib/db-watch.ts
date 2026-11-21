import { AsyncLocalStorage } from "node:async_hooks";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import type { PoolClient, QueryResult } from "pg";

/*
 * Watching the Postgres pool (#1948). On 2026-11-21 one page's 134 full-size portraits took all ten connections
 * (lib/db.ts POOL_SIZE), and 30 to 84 requests in a second gave up waiting for one. The log said only "timeout
 * exceeded when trying to connect": not which routes held the connections, nor which waited. Now each query carries a
 * label (the route it serves), and the pool says when a wait or a hold runs long, naming both sides.
 */

const labels = new AsyncLocalStorage<string>();

/** Runs `fn` with its queries labelled `label`: an API request's "GET /api/assets/[id]" (lib/http.ts handle), a job's name. */
export function withDbLabel<T>(label: string, fn: () => T): T {
  return labels.run(label, fn);
}

/**
 * The route Next is rendering or answering ("/couples/[a]/[b]", "/api/assets/[id]"), from its own request store. An
 * `.external` module is the one instance Next shares with the app's bundle (next/headers reads the same one). Null
 * outside a request, and if a Next upgrade moves it.
 */
export function nextRoute(): string | null {
  try {
    const route = workAsyncStorage?.getStore()?.route;
    return typeof route === "string" && route ? route : null;
  } catch {
    return null;
  }
}

/** Who a query is for: the label it runs under, else the route Next is on. */
export function dbLabel(): string {
  return labels.getStore() ?? nextRoute() ?? "outside a request";
}

/** A path as a route, for when Next's isn't known: any part with a digit in it stands for an id. */
export function routeOfPath(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => (/\d/.test(part) ? ":id" : part))
    .join("/");
}

/** An API request's label: its method and route ("POST /api/dates/[id]"). */
export function requestLabel(req: Request): string {
  const route = nextRoute();
  if (route) return `${req.method} ${route}`;
  try {
    return `${req.method} ${routeOfPath(new URL(req.url).pathname)}`;
  } catch {
    return req.method;
  }
}

/** A wait this long for a connection is worth a line: a query takes ~70 ms from New York to the database in Oregon. */
export const SLOW_WAIT_MS = 1_000;
/** One query holding a connection this long is worth a line: with ten connections, a few of these queue the site. */
export const LONG_HOLD_MS = 3_000;
/** At most one line of a kind this often; the rest are counted by label in one line after. */
export const LINE_EVERY_MS = 5_000;

/** The parts of a pg Pool the watch uses. */
export type WatchedPool = {
  connect(): Promise<PoolClient>;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
};

export type PoolWatchOptions = {
  /** Where its lines go (console.warn). */
  log?: (line: string) => void;
  /** The clock (Date.now). */
  now?: () => number;
  /** Runs `fn` after `ms` without keeping the process up (an unref'd setTimeout). */
  later?: (fn: () => void, ms: number) => void;
};

type Entry = { label: string; since: number; sql: string };

/** "0.4 s", "2.5 s", "10 s". */
function seconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 || Number.isInteger(s) ? `${Math.round(s)} s` : `${s.toFixed(1)} s`;
}

/** A query's text for a log line: on one line, its string literals hidden, cut short. Its parameters are never logged. */
export function sqlFingerprint(sql: string, max = 100): string {
  const flat = sql
    .replace(/'(?:[^']|'')*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "GET /api/assets/[id] ×9, /couples/[a]/[b] ×1": the biggest first, five at most. */
function tally(counts: Map<string, number>, after?: (label: string) => string): string {
  const sorted = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const shown = sorted.slice(0, 5).map(([label, n]) => `${label} ×${n}${after ? after(label) : ""}`);
  const rest = sorted.slice(5).reduce((sum, [, n]) => sum + n, 0);
  return rest ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function laterUnref(fn: () => void, ms: number) {
  const timer: unknown = setTimeout(fn, ms);
  if (typeof timer === "object" && timer && "unref" in timer) (timer as { unref: () => void }).unref();
}

/**
 * Runs each query on a connection of its own from `pool`, as pool.query does (the same release, the same guard
 * against a connection dying mid-query), timing the wait for the connection and the hold. A long one gets a line
 * naming its label, who holds the connections and who else is waiting.
 */
export function watchedQueries(pool: WatchedPool, options: PoolWatchOptions = {}) {
  const log = options.log ?? ((line: string) => console.warn(line));
  const now = options.now ?? Date.now;
  const later = options.later ?? laterUnref;
  const waiting = new Set<Entry>();
  const holding = new Set<Entry>();
  const windows = new Map<string, { until: number; more: Map<string, number> }>();

  /** A line now, unless one of this kind went out in the last LINE_EVERY_MS: then it's counted in the line after that. */
  function say(kind: string, label: string, line: () => string) {
    const t = now();
    const open = windows.get(kind);
    if (open && t < open.until) {
      open.more.set(label, (open.more.get(label) ?? 0) + 1);
      return;
    }
    const window = { until: t + LINE_EVERY_MS, more: new Map<string, number>() };
    windows.set(kind, window);
    log(line());
    later(() => {
      if (!window.more.size) return;
      const n = [...window.more.values()].reduce((sum, k) => sum + k, 0);
      log(`[db] ${n} more ${kind} in the ${seconds(LINE_EVERY_MS)} after: ${tally(window.more)}`);
    }, LINE_EVERY_MS);
  }

  /** The pool as it stands: how busy, who holds the connections (each label's longest hold), who's waiting. */
  function scene(): string {
    const t = now();
    const held = new Map<string, number>();
    const longestOf = new Map<string, number>();
    let longest: Entry | null = null;
    for (const h of holding) {
      held.set(h.label, (held.get(h.label) ?? 0) + 1);
      longestOf.set(h.label, Math.max(longestOf.get(h.label) ?? 0, t - h.since));
      if (!longest || h.since < longest.since) longest = h;
    }
    const waits = new Map<string, number>();
    for (const w of waiting) waits.set(w.label, (waits.get(w.label) ?? 0) + 1);
    const parts = [`${pool.totalCount - pool.idleCount} busy, ${pool.waitingCount} waiting`];
    if (held.size) parts.push(`holding: ${tally(held, (label) => ` (longest ${seconds(longestOf.get(label) ?? 0)})`)}`);
    if (waits.size) parts.push(`waiting: ${tally(waits)}`);
    if (longest) parts.push(`longest hold: ${seconds(t - longest.since)} in ${longest.label}: ${sqlFingerprint(longest.sql)}`);
    return parts.join("; ");
  }

  return async function run(sql: string, params?: unknown[]): Promise<QueryResult> {
    const label = dbLabel();
    const waiter: Entry = { label, since: now(), sql };
    waiting.add(waiter);
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (err) {
      waiting.delete(waiter);
      if (err instanceof Error && /timeout exceeded when trying to connect/i.test(err.message)) {
        const waited = now() - waiter.since;
        say("gave up waiting for a connection", label, () => `[db] ${label} gave up after ${seconds(waited)} waiting for a connection (${scene()})`);
      }
      throw err;
    }
    waiting.delete(waiter);
    const waited = now() - waiter.since;
    if (waited >= SLOW_WAIT_MS) say(`waited over ${seconds(SLOW_WAIT_MS)} for a connection`, label, () => `[db] ${label} waited ${seconds(waited)} for a connection (${scene()})`);

    const holder: Entry = { label, since: now(), sql };
    holding.add(holder);
    // pg-pool takes its own "error" listener off a client while it's checked out, so a connection dying mid-query would
    // be an unhandled error that crashes the instance. pool.query listens the same way.
    let broke: Error | true | undefined;
    const onError = (err: Error) => {
      broke = err;
    };
    client.on("error", onError);
    try {
      return await client.query(sql, params);
    } catch (err) {
      broke ??= err instanceof Error ? err : true;
      throw err;
    } finally {
      client.removeListener("error", onError);
      holding.delete(holder);
      // A failed query's connection is dropped rather than reused, as pool.query does.
      client.release(broke);
      const held = now() - holder.since;
      if (held >= LONG_HOLD_MS) say(`held a connection over ${seconds(LONG_HOLD_MS)}`, label, () => `[db] ${label} held a connection ${seconds(held)} (${pool.waitingCount} waiting): ${sqlFingerprint(sql)}`);
    }
  };
}
