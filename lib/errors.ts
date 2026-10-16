/**
 * Server errors, counted so the owner hears about them: every unexpected API error (lib/http.ts handle) and every page
 * or render error (instrumentation.ts onRequestError) becomes a short row: the route pattern, a cleaned message, when.
 * GET /api/health reports the last hour to RepoHQ's collector, which alerts #team-agents. Recording is best effort: it
 * never throws and never changes the response. Rows older than a week are pruned by the daily job.
 */
import { getDb, type Db } from "./db";

const MAX_MESSAGE = 240;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The route with ids stripped ("/api/assets/fe00…" → "/api/assets/:id"), no query: a bounded label, never data. */
export function routePattern(path: string): string {
  const bare = path.split("?")[0] || "/";
  return bare
    .split("/")
    .map((seg) => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) || /^\d+$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 120);
}

/** The message without anything secret-shaped (connection strings, bearer tokens, long keys), cut short. */
export function cleanMessage(message: string): string {
  return message
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://…")
    .replace(/\bBearer\s+\S+/gi, "Bearer …")
    .replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_]{8,}/g, "$1_…")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE);
}

export async function recordServerError(kind: string, path: string, message: string, db?: Db): Promise<void> {
  try {
    await (db ?? (await getDb())).query("insert into server_errors (kind, route, message) values ($1, $2, $3)", [
      kind.slice(0, 20),
      routePattern(path),
      cleanMessage(message) || "unknown",
    ]);
  } catch {
    /* the database may be what failed: the error still reaches the Vercel log */
  }
}

export type ErrorSummary = { last_hour: number; latest: { at: string; kind: string; route: string; message: string } | null };

/** What the monitor needs: how many errors in the last hour, and the latest one. */
export async function serverErrorSummary(db: Db, now = new Date()): Promise<ErrorSummary> {
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const [count, latest] = await Promise.all([
    db.query<{ n: number }>("select count(*)::int as n from server_errors where at > $1", [since]),
    db.query<{ at: string | Date; kind: string; route: string; message: string }>(
      "select at, kind, route, message from server_errors where at > $1 order by at desc limit 1",
      [since],
    ),
  ]);
  const l = latest.rows[0];
  return { last_hour: count.rows[0]?.n ?? 0, latest: l ? { ...l, at: new Date(l.at).toISOString() } : null };
}

export async function pruneServerErrors(db: Db, now = new Date()): Promise<void> {
  await db.query("delete from server_errors where at < $1", [new Date(now.getTime() - RETENTION_MS).toISOString()]);
}
