/**
 * Rate limiting for cheap paths (create_character, swipe, send_text, start_own_date, submit_own_date_step).
 *
 * The product's economic model: cheap paths are *free* so people and agents can play without friction, but
 * free + unbounded = abuse. The expensive paths (go_on_date, autoplay_own_date) are already gated by the
 * token system; this is for the ones that aren't.
 *
 * Sliding window, in-memory, process-local. Fine for a single-region Vercel deployment with modest traffic;
 * when the product scales to multiple regions or long-lived workers, swap the backing store for the
 * `rate_limits` table in lib/db.ts (which this module writes to as a persistence hint, not the source of
 * truth). Tests use `resetRateLimitsForTests()` between runs.
 *
 * The returned decision is a plain object so callers can embed it in a tool reply: a rate-limited call gets
 * `{ ok: false, retry_after_seconds, limit, kind }` which the MCP handler maps to `code: "rate_limited"`.
 */

export type RateLimitBucket =
  | "create_character"
  | "swipe"
  | "swipe_deck"
  | "send_text"
  | "start_own_date"
  | "submit_own_date_step"
  | "feedback"
  | "key_check";

/** Per-bucket window and limit, chosen so a healthy user never hits them and an abuser hits them fast. */
const LIMITS: Record<RateLimitBucket, { windowSeconds: number; max: number }> = {
  // A person's thoughtful character takes minutes; an agent probing the system makes 50 in a minute.
  create_character: { windowSeconds: 300, max: 10 },
  // A swipe is one click; thousands in a session is bot abuse.
  swipe: { windowSeconds: 60, max: 60 },
  // Reading the deck: a few times a minute while swiping through it; every call ranks the whole pool and logs what it
  // shows (lib/swipes.ts logImpressions), so a loop polling it is held back.
  swipe_deck: { windowSeconds: 60, max: 20 },
  // A text is a sentence; dozens a minute is spam.
  send_text: { windowSeconds: 60, max: 20 },
  // Starting a new own date takes time to play; starting many an hour is a DoS attempt.
  start_own_date: { windowSeconds: 3600, max: 30 },
  // One line a few seconds; dozens a second is bot churn.
  submit_own_date_step: { windowSeconds: 60, max: 60 },
  // Feedback is grateful, not a channel for noise.
  feedback: { windowSeconds: 3600, max: 10 },
  // Checking a key live (lib/connections.ts checkKey) sends it to its provider for us: a person connecting a few keys
  // checks a handful; anything more is someone using the show to test keys that aren't theirs.
  key_check: { windowSeconds: 600, max: 12 },
};

type Entry = { timestamps: number[] };
const BUCKETS: Map<string, Entry> = new Map();

/** Public read of a bucket's config, for the MCP tool `_meta` hints (`docs/mcp-best-practices-review.md`). */
export const rateLimitInfo = (kind: RateLimitBucket): { windowSeconds: number; max: number } => LIMITS[kind];

export type RateDecision =
  | { ok: true; remaining: number }
  | { ok: false; retry_after_seconds: number; limit: number; kind: RateLimitBucket };

/**
 * Check and record a hit against a bucket, keyed by `userId` (or IP for anonymous). Returns a decision
 * synchronously; nothing async, no DB round-trip in the hot path.
 */
export function checkRateLimit(userId: string, kind: RateLimitBucket, now: number = Date.now()): RateDecision {
  const limit = LIMITS[kind];
  const key = `${kind}:${userId}`;
  const entry = BUCKETS.get(key) ?? { timestamps: [] };
  const horizon = now - limit.windowSeconds * 1000;
  // Drop old timestamps so the array stays O(limit).
  while (entry.timestamps.length && entry.timestamps[0] < horizon) entry.timestamps.shift();
  if (entry.timestamps.length >= limit.max) {
    const retry = Math.ceil((entry.timestamps[0] + limit.windowSeconds * 1000 - now) / 1000);
    return { ok: false, retry_after_seconds: Math.max(1, retry), limit: limit.max, kind };
  }
  entry.timestamps.push(now);
  BUCKETS.set(key, entry);
  return { ok: true, remaining: limit.max - entry.timestamps.length };
}

/** For tests: forget every rate-limit bucket. Never call in production code. */
export function resetRateLimitsForTests(): void {
  BUCKETS.clear();
}

/** Message helper for the MCP handler. */
export function rateLimitMessage(d: Extract<RateDecision, { ok: false }>): string {
  const minutes = Math.ceil(d.retry_after_seconds / 60);
  const when = d.retry_after_seconds < 60 ? `${d.retry_after_seconds} second${d.retry_after_seconds === 1 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `Too many ${d.kind.replace(/_/g, " ")} calls (limit ${d.limit}; try again in ${when}). This path is free, so it has an anti-abuse cap: BYOK or a paid pass raises it.`;
}
