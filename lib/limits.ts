/**
 * Launch guards: what stops one visitor, or a script, from spending the show's money.
 *
 *  - Starting dates is limited per visitor. Free dates are counted per anonymous cookie and a cookie costs
 *    nothing, so the visitor is keyed by an HMAC of the client IP (the IP itself is never stored) and the rows
 *    are pruned after two days. In-process calls (the MCP front door, tests) carry no IP and skip it: agent dates
 *    on our model have their own daily cap (lib/dating.ts).
 *  - Dates written by the paid default model (FRONTIER_DEFAULT, docs/frontier.md) are capped per UTC day. Past the
 *    cap a date still runs, on the free model, so a flood can spend at most a day's cap however it arrives.
 */
import { createHmac } from "node:crypto";
import type { Db } from "./db";

export const DATE_START_LIMITS = { perHour: 10, perDay: 30 };
/** Paid-model dates a day unless FRONTIER_DAILY_DATE_CAP says otherwise: about $4–11 at Haiku's 4–11¢ a date. */
export const DEFAULT_PAID_DATES_PER_DAY = 100;
/** How long a rate-limit row is kept (the longest window plus a margin). */
const RATE_HIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** The first address in x-forwarded-for (Vercel sets it), else x-real-ip; null when there is none. */
export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip")?.trim() || null;
}

/** A stable, non-reversible key for the visitor behind a request (an HMAC of the IP), or null without one. */
export function visitorKey(headers: Headers, secret = process.env.SESSION_SECRET || "botchelor-visitor"): string | null {
  const ip = clientIp(headers);
  return ip ? createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32) : null;
}

/**
 * Whether this visitor has used up `bucket` in the last hour or day. When it hasn't, this use is counted.
 * Count-then-insert isn't atomic, so two simultaneous requests can both pass at the edge: fine for an abuse limit.
 */
export async function overLimit(
  db: Db,
  bucket: string,
  key: string,
  limits: { perHour: number; perDay: number },
  now = new Date(),
): Promise<boolean> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.query<{ hour: number; day: number }>(
    `select count(*) filter (where at > $3)::int as hour, count(*)::int as day
       from rate_hits where bucket = $1 and key = $2 and at > $4`,
    [bucket, key, hourAgo, dayAgo],
  );
  const used = rows[0] ?? { hour: 0, day: 0 };
  if (used.hour >= limits.perHour || used.day >= limits.perDay) return true;
  await db.query("insert into rate_hits (bucket, key, at) values ($1, $2, $3)", [bucket, key, now.toISOString()]);
  return false;
}

/** Drops rate-limit rows older than the longest window (the daily job). */
export async function pruneRateHits(db: Db, now = new Date()): Promise<void> {
  await db.query("delete from rate_hits where at < $1", [new Date(now.getTime() - RATE_HIT_RETENTION_MS).toISOString()]);
}

/** Today's cap on paid-model dates: FRONTIER_DAILY_DATE_CAP (0 turns the paid default off), else the default. */
export function paidDatesPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FRONTIER_DAILY_DATE_CAP?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PAID_DATES_PER_DAY;
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Takes one of today's paid-model dates (UTC day). False once the cap is spent: run that date on the free model. */
export async function claimPaidDate(db: Db, cap = paidDatesPerDay(), now = new Date()): Promise<boolean> {
  if (cap <= 0) return false;
  const { rows } = await db.query<{ dates: number }>(
    `insert into paid_usage (day, dates) values ($1, 1)
       on conflict (day) do update set dates = paid_usage.dates + 1
     returning dates`,
    [utcDay(now)],
  );
  return (rows[0]?.dates ?? Number.POSITIVE_INFINITY) <= cap;
}

/** Paid-model dates claimed today (UTC), including any past the cap that fell back to free. */
export async function paidDatesToday(db: Db, now = new Date()): Promise<number> {
  const { rows } = await db.query<{ dates: number }>("select dates from paid_usage where day = $1", [utcDay(now)]);
  return rows[0]?.dates ?? 0;
}
