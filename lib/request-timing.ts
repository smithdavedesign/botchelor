import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "./db";

/*
 * Where one request's time goes (2026-11-22: a Step in line took 7.6–12.4 s, its last line 20–24 s, against ~2 s for a
 * companion's reply). A request run under timeRequest counts its database queries and its model calls, and the wall
 * time with at least one of each in flight, so a slow request says whether it waited on the model, on round trips to
 * the database, or on neither. Numbers only, never words. Outside a timed request inSpan just runs the call.
 */

type Span = { n: number; open: number; since: number; ms: number };
type Spans = { db: Span; model: Span; now: () => number };

/** One timed request: its wall time, and how much of it had a query or a model call in flight (ms, rounded). */
export type RequestTiming = { ms: number; db_queries: number; db_ms: number; model_calls: number; model_ms: number; other_ms: number };

const spans = new AsyncLocalStorage<Spans>();
const fresh = (): Span => ({ n: 0, open: 0, since: 0, ms: 0 });

/** Runs one database query or model call, counted (and its time kept) when a timed request is running. */
export async function inSpan<T>(kind: "db" | "model", fn: () => Promise<T>): Promise<T> {
  const store = spans.getStore();
  if (!store) return fn();
  const s = store[kind];
  s.n++;
  if (s.open++ === 0) s.since = store.now();
  try {
    return await fn();
  } finally {
    if (--s.open === 0) s.ms += store.now() - s.since;
  }
}

/** Runs `fn` as one timed request: what it returns, and where its time went. */
export async function timeRequest<T>(fn: () => Promise<T>, now: () => number = () => performance.now()): Promise<{ result: T; timing: RequestTiming }> {
  const store: Spans = { db: fresh(), model: fresh(), now };
  const start = now();
  const result = await spans.run(store, fn);
  const ms = Math.round(now() - start);
  const db_ms = Math.round(store.db.ms);
  const model_ms = Math.round(store.model.ms);
  return {
    result,
    timing: { ms, db_queries: store.db.n, db_ms, model_calls: store.model.n, model_ms, other_ms: Math.max(0, ms - db_ms - model_ms) },
  };
}

/** A database whose queries count toward the timed request they run in (the same database otherwise). */
export function timedDb(db: Db): Db {
  return {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => inSpan("db", () => db.query<T>(sql, params)),
    exec: (sql: string) => inSpan("db", () => db.exec(sql)),
  };
}
