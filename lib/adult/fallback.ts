/**
 * Falling back to the other media provider (David, 2026-10-22, after "rate limited on Replicate" failed a step):
 * After Dark's media is made on Venice or Replicate (`media_provider`, lib/adult/settings.ts). When the one in use is
 * limited, the same job is tried once on the other.
 *
 *  - When: the provider answered 429 (rate limited), 402 (out of credit), a 5xx, or didn't answer (a network error, a
 *    timeout). Anything else (a content refusal, a bad request, the output check failing) doesn't fall back.
 *  - Only onto a provider that's set up: its key saved (or the server's, for Replicate) and its models configured.
 *  - A cooldown: a provider that answered 429 or 402 is skipped for a while (its Retry-After, at most 15 minutes, else
 *    3 minutes for a 429 and 30 for a 402), so the next calls go straight to the other. It's in the database
 *    (adult_media_cooldowns), because Vercel runs many instances. When both are cooling down, the configured one runs
 *    and its error surfaces as before.
 *  - One-shot jobs (a picture, a keyframe, a voice line, a menu picture) switch freely. A video already running on one
 *    provider is polled where it started (lib/adult/reels.ts, the shot's `provider`); only a new shot or segment goes
 *    where this says.
 *  - The output check and the caps don't change: whoever made it, it's checked and counted the same.
 *  - Off with `media_fallback` (on by default) in the settings.
 */
import type { Db } from "../db";
import { MODEL_ID, retryAfterMs } from "./replicate";
import { adultKeys, getAdultSettings, type AdultSettings, type MediaProvider } from "./settings";

/** What's being made: each kind needs its own model configured on a provider. */
export type MediaJob = "picture" | "keyframe" | "video" | "voice";

/** What a job made, and where: `fell_back` when that wasn't the configured provider. */
export type Ran<T> = { value: T; provider: MediaProvider; fell_back: boolean };

/** A provider's refusal with its HTTP status and, when it said, how long to wait (Retry-After). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number | null,
  ) {
    super(message);
  }
}

/** The longest Retry-After honoured, and the cooldowns when there's none. */
export const MAX_COOLDOWN_MS = 15 * 60 * 1000;
export const RATE_COOLDOWN_MS = 3 * 60 * 1000;
export const CREDIT_COOLDOWN_MS = 30 * 60 * 1000;

/** A provider's error response as a ProviderError (worded by `say`, from its status and body), with its Retry-After. */
export async function providerError(res: Response, say: (status: number, text: string) => string): Promise<ProviderError> {
  const text = await res.text().catch(() => "");
  return new ProviderError(say(res.status, text), res.status, retryAfterMs(res.headers.get("retry-after")));
}

export { retryAfterMs };

export type Limit = { kind: "rate" | "credit" | "down"; status: number | null; retryAfterMs: number | null };

/** Whether an error means the provider is limited (and so the other may run the job), and how. Null: it doesn't. */
export function limitOf(err: unknown): Limit | null {
  if (!(err instanceof Error)) return null;
  const e = err as Error & { status?: unknown; retryAfterMs?: unknown; timeout?: unknown };
  const status = typeof e.status === "number" ? e.status : null;
  const wait = typeof e.retryAfterMs === "number" ? e.retryAfterMs : null;
  if (status === 429) return { kind: "rate", status, retryAfterMs: wait };
  if (status === 402) return { kind: "credit", status, retryAfterMs: wait };
  if (status !== null && status >= 500) return { kind: "down", status, retryAfterMs: wait };
  if (status !== null) return null;
  // No answer at all: the network, or a timeout (fetch's own, or Replicate's polling past its time).
  if (e.timeout === true || e.name === "TimeoutError" || e.name === "AbortError") return { kind: "down", status: null, retryAfterMs: null };
  if (e.name === "TypeError" && /fetch failed|network|ECONN|ENOTFOUND|socket/i.test(e.message)) return { kind: "down", status: null, retryAfterMs: null };
  return null;
}

/** How long a limited provider is skipped: none for one that's down (it's tried again next time). */
export function cooldownMs(limit: Limit): number {
  if (limit.kind === "down") return 0;
  if (limit.retryAfterMs !== null) return Math.min(MAX_COOLDOWN_MS, Math.max(0, limit.retryAfterMs));
  return limit.kind === "credit" ? CREDIT_COOLDOWN_MS : RATE_COOLDOWN_MS;
}

export const otherProvider = (p: MediaProvider): MediaProvider => (p === "venice" ? "replicate" : "venice");
export const providerName = (p: MediaProvider): string => (p === "venice" ? "Venice" : "Replicate");

let clock: () => number = Date.now;
/** Tests move the clock (a cooldown running out). */
export function setFallbackClockForTests(now: (() => number) | null): void {
  clock = now ?? Date.now;
}

/** The providers cooling down right now, with until when. */
export async function coolingDown(db: Db, now = clock()): Promise<Map<MediaProvider, string>> {
  const { rows } = await db
    .query<{ provider: string; until: string | Date }>(`select provider, until from adult_media_cooldowns where until > $1`, [new Date(now).toISOString()])
    .catch(() => ({ rows: [] as { provider: string; until: string | Date }[] }));
  return new Map(rows.filter((r) => r.provider === "venice" || r.provider === "replicate").map((r) => [r.provider as MediaProvider, new Date(r.until).toISOString()]));
}

/** Skips a provider for its cooldown (never shortening one already longer). Best effort. */
export async function coolDown(db: Db, provider: MediaProvider, limit: Limit, reason: string, now = clock()): Promise<void> {
  const ms = cooldownMs(limit);
  if (ms <= 0) return;
  const until = new Date(now + ms).toISOString();
  await db
    .query(
      `insert into adult_media_cooldowns (provider, until, status, reason, updated_at) values ($1, $2, $3, $4, $5)
       on conflict (provider) do update set until = greatest(adult_media_cooldowns.until, excluded.until), status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at`,
      [provider, until, limit.status, reason.slice(0, 300), new Date(now).toISOString()],
    )
    .catch(() => {});
}

/** Whether a provider can make this kind of thing: its key, and the model for the job. */
export function providerReady(p: MediaProvider, job: MediaJob, s: AdultSettings, keys: { venice: string | null; replicate: string | null }): boolean {
  if (p === "venice") return Boolean(keys.venice) && (job !== "picture" || Boolean(s.venice_image_model)) && (job !== "video" || Boolean(s.reel_model));
  if (!keys.replicate) return false;
  const model = { picture: s.replicate_picture_model, keyframe: s.replicate_keyframe_model, video: s.replicate_video_model, voice: s.replicate_voice_model }[job];
  return Boolean(model) && MODEL_ID.test(model);
}

/**
 * Runs a media job on the configured provider (or the other while the configured one cools down), and once more on the
 * other when the first is limited (limitOf). `configured` stands in for the settings' provider (a reel's shot polled
 * where it started); `available` narrows who may run it (a caller holding one provider's details only).
 */
export async function runMedia<T>(
  db: Db,
  job: MediaJob,
  run: (provider: MediaProvider) => Promise<T>,
  opts: { configured?: MediaProvider; available?: (p: MediaProvider) => boolean } = {},
): Promise<Ran<T>> {
  const s = await getAdultSettings(db);
  const configured = opts.configured ?? s.media_provider;
  if (!s.media_fallback) return { value: await run(configured), provider: configured, fell_back: false };
  const keys = await adultKeys(db).catch(() => ({ venice: null, replicate: null }));
  const ready = (p: MediaProvider) => providerReady(p, job, s, keys) && (opts.available?.(p) ?? true);
  const cooling = await coolingDown(db);
  const other = otherProvider(configured);
  const first = cooling.has(configured) && !cooling.has(other) && ready(other) ? other : configured;
  try {
    return { value: await run(first), provider: first, fell_back: first !== configured };
  } catch (err) {
    const limit = limitOf(err);
    if (!limit) throw err;
    await coolDown(db, first, limit, err instanceof Error ? err.message : "limited");
    const second = otherProvider(first);
    if (!ready(second) || cooling.has(second)) throw err;
    return { value: await run(second), provider: second, fell_back: second !== configured };
  }
}

/** What the gallery says under a picture made on the other provider: "made on Replicate (fallback)". */
export const fallbackNote = (provider: string | null | undefined, fellBack: boolean | null | undefined): string | null =>
  fellBack && (provider === "venice" || provider === "replicate") ? `made on ${providerName(provider)} (fallback)` : null;
