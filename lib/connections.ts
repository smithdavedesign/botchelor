/**
 * Connections (docs/PRDs/connections.md): a person's own provider keys, organised by what they're for. One stored key
 * per provider (user_connections), and per job, at most one key and the model it runs (user_connection_jobs), so an
 * OpenAI key can make portraits and run dates, and a Google key run dates and clips, from one paste.
 *
 * The key handling follows Stripe's and OpenRouter's: paste once, check it live, store it sealed (lib/key-crypto.ts),
 * and from then on show only "•••• abcd ✓ checked 2 min ago". It can be replaced or removed, never seen again: no
 * route returns it, nothing logs it, and no error message carries it (errors are in plain words, lib/connections-shared
 * plainError, never the provider's own text).
 *
 * The check is free: each provider's own key-info or model-list endpoint, never a model call, so testing a key spends
 * nothing on it. Only the providers below, at their real addresses, so a key can't be pointed at someone else's server;
 * the one exception is BYOK_STUB_ORIGIN, a loopback stub for the screenshot runs, ignored on Vercel.
 *
 * The privacy rule is unchanged (lib/keys.ts buildKeyForSide): a key only ever runs prompts that carry its owner's own
 * soul or none.
 */
import type { Db } from "./db";
import {
  capLevel,
  clampCap,
  clampSetting,
  CURATED_PRICES,
  curatedModels,
  defaultModelFor,
  isUserProvider,
  modelFitsJob,
  modelOption,
  modelOptions,
  money,
  monthOf,
  plainError,
  PRESET_IDS,
  PROVIDER_INFO,
  providerLabel,
  resetDay,
  TEXT_PROVIDERS,
  WARN_AT,
  JOB_INFO,
  type CapSettings,
  type ErrorKind,
  type Feel,
  type Job,
  type ModelOption,
  type OnCap,
  type PlainError,
  type UsageSummary,
  type UserProvider,
} from "./connections-shared";
import type { Usage } from "./model";
import { notify } from "./notifications";
import { needsReseal, openKey, reseal, sealKey, sealVersion, type Sealed, type SealVersion } from "./key-crypto";

type Env = Record<string, string | undefined>;

/* ------------------------------------------------------- the providers ------------------------------------------------------- */

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

type ProviderApi = {
  /** The OpenAI-compatible chat base (dates and texts run there). */
  chat: string | null;
  /** The free check: a key-info or model-list endpoint, and how to send the key to it. */
  check: string;
  headers: (key: string) => Record<string, string>;
};

/**
 * Each provider's free check, chosen so testing a key never spends any of it: OpenRouter's key endpoint (which also
 * says what the key has used and its limit), everyone else's model list (Google's native one, which lists Veo too).
 */
const API: Record<UserProvider, ProviderApi> = {
  openrouter: { chat: TEXT_PROVIDERS.openrouter.baseUrl, check: "https://openrouter.ai/api/v1/key", headers: bearer },
  openai: { chat: TEXT_PROVIDERS.openai.baseUrl, check: "https://api.openai.com/v1/models", headers: bearer },
  google: {
    chat: TEXT_PROVIDERS.google.baseUrl,
    check: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
  anthropic: {
    chat: TEXT_PROVIDERS.anthropic.baseUrl,
    check: "https://api.anthropic.com/v1/models?limit=1000",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  deepseek: { chat: TEXT_PROVIDERS.deepseek.baseUrl, check: "https://api.deepseek.com/models", headers: bearer },
  groq: { chat: TEXT_PROVIDERS.groq.baseUrl, check: "https://api.groq.com/openai/v1/models", headers: bearer },
  // After Dark pictures only (no chat): the key's own rate-limit page and the account page cost nothing.
  venice: { chat: null, check: "https://api.venice.ai/api/v1/api_keys/rate_limits", headers: bearer },
  replicate: { chat: null, check: "https://api.replicate.com/v1/account", headers: bearer },
};

/**
 * The loopback stub every provider points at in a screenshot run (scripts/connections-screenshots.mjs), or null.
 * Only http on 127.0.0.1 or localhost, and never on Vercel, so a production key can't be sent anywhere but its provider.
 */
export function stubOrigin(env: Env = process.env): string | null {
  const raw = env.BYOK_STUB_ORIGIN?.trim();
  if (!raw || env.VERCEL) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") ? u.origin : null;
  } catch {
    return null;
  }
}

/** A provider URL, or its stand-in on the stub ("<stub>/openai/v1/models"). */
function at(provider: UserProvider, url: string, env: Env): string {
  const stub = stubOrigin(env);
  if (!stub) return url;
  const u = new URL(url);
  return `${stub}/${provider}${u.pathname}${u.search}`;
}

/** Where a provider's OpenAI-compatible chat API is (null for one without). */
export function chatBaseUrl(provider: string, env: Env = process.env): string | null {
  if (!isUserProvider(provider)) return null;
  const chat = API[provider].chat;
  return chat ? at(provider, chat, env) : null;
}

/* -------------------------------------------------------- the check -------------------------------------------------------- */

export type CheckOk = {
  ok: true;
  provider: UserProvider;
  checked_at: string;
  latency_ms: number;
  /** The models the key can use, when the check lists them (OpenRouter's key check doesn't: its list is public). */
  models: string[] | null;
  /** What the key has used and its limit, when the provider says (OpenRouter), in USD. */
  account: { usage_usd: number | null; limit_usd: number | null; free_tier: boolean | null } | null;
  /** The jobs this key showed it can do (its provider's, narrowed by its model list when there is one). */
  can: Job[];
};
export type CheckFail = { ok: false; provider: string; error: PlainError; status: number | null };
export type CheckResult = CheckOk | CheckFail;

/** At most this much of an error body is read, to sort it (never shown). */
const BODY_PEEK = 4_000;
export const CHECK_TIMEOUT_MS = 10_000;

/**
 * Sorts a provider's refusal into what the person can do about it. Read from the status first, then the body's own
 * words for the cases a status doesn't tell apart: OpenAI's 429 insufficient_quota and Anthropic's 400 "credit balance
 * is too low" are out of credit, not a burst; Google says a bad key with 400 API_KEY_INVALID.
 */
export function classifyRefusal(status: number, body: string): ErrorKind {
  const text = body.toLowerCase();
  const credit = /insufficient_quota|insufficient[ _]balance|insufficient credits|credit balance|out of credit|payment required|billing/.test(text);
  if (status === 401) return "invalid_key";
  if (status === 402) return "no_credit";
  if (status === 403) return credit ? "no_credit" : "invalid_key";
  if (status === 429) return credit ? "no_credit" : "rate_limited";
  if (status === 400 || status === 422) {
    if (credit) return "no_credit";
    if (/api[_ ]key[_ ]invalid|api key not valid|invalid api key|invalid x-api-key|incorrect api key|authentication/.test(text)) return "invalid_key";
    if (/model/.test(text) && /not found|does not exist|not exist|unknown|invalid|not available|not supported/.test(text)) return "model_unavailable";
    return "unknown";
  }
  if (status === 404) return /model/.test(text) ? "model_unavailable" : "unknown";
  if (status >= 500) return "provider_down";
  return "unknown";
}

/** No answer at all: a timeout, or the network. */
function unanswered(err: unknown): ErrorKind {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "provider_down" : "unreachable";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** The model ids in a provider's list (OpenAI-style data[].id; Google's models[].name without "models/"). */
export function listedModels(provider: UserProvider, body: unknown): string[] | null {
  const b = body as { data?: { id?: unknown }[]; models?: { name?: unknown }[] } | null;
  if (provider === "google") {
    if (!Array.isArray(b?.models)) return null;
    return b.models.map((m) => (typeof m?.name === "string" ? m.name.replace(/^models\//, "") : "")).filter(Boolean);
  }
  if (!Array.isArray(b?.data)) return null;
  return b.data.map((m) => (typeof m?.id === "string" ? m.id : "")).filter(Boolean);
}

/** The jobs a key can do: its provider's, narrowed by what its model list shows (an image model, a Veo model). */
export function jobsFromModels(provider: UserProvider, models: string[] | null): Job[] {
  const jobs = PROVIDER_INFO[provider].jobs;
  if (!models) return [...jobs];
  return jobs.filter((job) => {
    if (job === "image") return models.some((m) => /^(gpt-image|dall-e)/.test(m));
    if (job === "video") return models.some((m) => /^veo/.test(m));
    if (provider === "google") return models.some((m) => /^gemini/.test(m));
    return true;
  });
}

/**
 * Checks a key live, for free, and says what it can do (the models it lists, its usage and limit where the provider
 * says). Nothing is stored here. The key goes only to its provider, in a header, never a URL; the result never
 * carries it, and a refusal comes back in plain words only.
 */
export async function checkKey(provider: string, apiKey: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: Env } = {}): Promise<CheckResult> {
  if (!isUserProvider(provider)) return { ok: false, provider, status: null, error: plainError(provider, "unknown") };
  const api = API[provider];
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  let res: Response;
  try {
    res = await doFetch(at(provider, api.check, env), { headers: api.headers(apiKey), signal: AbortSignal.timeout(opts.timeoutMs ?? CHECK_TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, provider, status: null, error: plainError(provider, unanswered(err)) };
  }
  const latency_ms = Date.now() - started;
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, BODY_PEEK);
    return { ok: false, provider, status: res.status, error: plainError(provider, classifyRefusal(res.status, body)) };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  const checked_at = new Date().toISOString();
  if (provider === "openrouter") {
    const d = (body as { data?: Record<string, unknown> } | null)?.data ?? null;
    const account = d ? { usage_usd: num(d.usage), limit_usd: num(d.limit), free_tier: typeof d.is_free_tier === "boolean" ? d.is_free_tier : null } : null;
    return { ok: true, provider, checked_at, latency_ms, models: null, account, can: ["text"] };
  }
  const models = listedModels(provider, body);
  return { ok: true, provider, checked_at, latency_ms, models, account: null, can: jobsFromModels(provider, models) };
}

/* -------------------------------------------------------- the store -------------------------------------------------------- */

/** Where a person's key is sealed: v2 binds the ciphertext to it (lib/key-crypto.ts). */
const contextFor = (userId: string, provider: string) => `user:${userId}:${provider}`;

export type ConnectionInfo = {
  provider: string;
  last4: string;
  sealed: SealVersion;
  verified_at: string | null;
  last_used_at: string | null;
  last_error: PlainError | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
  /** The jobs it's used for. */
  jobs: Job[];
};
export type JobAssignment = { job: Job; provider: string; model: string | null; updated_at: string; cap_usd: number | null; on_cap: OnCap | null } & Feel;

type ConnRow = {
  provider: string;
  ciphertext: string;
  last4: string;
  verified_at: Date | string | null;
  last_used_at: Date | string | null;
  last_error: string | null;
  last_error_kind: string | null;
  last_error_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};
const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

/** The stored error, with its fix worked out again from its kind (the words are kept as they were shown). */
function storedError(r: ConnRow): PlainError | null {
  if (!r.last_error_kind) return null;
  const fresh = plainError(r.provider, (r.last_error_kind as ErrorKind) ?? "unknown");
  return { ...fresh, message: r.last_error ?? fresh.message };
}

/** A person's connections and what each job runs on. Never a key: only its last four, and how it's sealed. */
export async function listConnections(db: Db, userId: string): Promise<{ connections: ConnectionInfo[]; jobs: JobAssignment[] }> {
  const [conns, jobs] = await Promise.all([
    db.query<ConnRow>(
      `select provider, ciphertext, last4, verified_at, last_used_at, last_error, last_error_kind, last_error_at, created_at, updated_at
         from user_connections where user_id = $1 order by created_at`,
      [userId],
    ),
    db.query<{ job: Job; provider: string; model: string | null; updated_at: Date | string; cap_usd: number | null; on_cap: string | null } & Feel>(
      `select job, provider, model, updated_at, preset, temperature, frequency_penalty, presence_penalty, cap_usd, on_cap from user_connection_jobs where user_id = $1`,
      [userId],
    ),
  ]);
  const assignments = jobs.rows.map((j) => ({
    job: j.job,
    provider: j.provider,
    model: j.model,
    updated_at: iso(j.updated_at)!,
    ...storedFeel(j),
    cap_usd: clampCap(j.cap_usd),
    on_cap: j.on_cap === "pause" ? ("pause" as const) : j.on_cap === "fallback" ? ("fallback" as const) : null,
  }));
  return {
    connections: conns.rows.map((r) => ({
      provider: r.provider,
      last4: r.last4,
      sealed: sealVersion(r),
      verified_at: iso(r.verified_at),
      last_used_at: iso(r.last_used_at),
      last_error: storedError(r),
      last_error_at: iso(r.last_error_at),
      created_at: iso(r.created_at)!,
      updated_at: iso(r.updated_at)!,
      jobs: assignments.filter((a) => a.provider === r.provider).map((a) => a.job),
    })),
    jobs: assignments,
  };
}

/**
 * Stores (or replaces) a person's key for a provider, sealed. `verifiedAt` is when it last passed the live check (the
 * Connections page saves only a key that just passed), and `models` what that check listed. A replaced key starts with a
 * clean slate: no error, not used yet.
 */
export async function saveConnection(
  db: Db,
  userId: string,
  provider: string,
  apiKey: string,
  opts: { verifiedAt?: string | null; models?: string[] | null; env?: Env } = {},
): Promise<{ provider: string; last4: string; sealed: SealVersion }> {
  const sealed = sealKey(apiKey, contextFor(userId, provider), opts.env);
  const last4 = apiKey.slice(-4);
  const models = opts.models ? JSON.stringify(opts.models.slice(0, MAX_LISTED)) : null;
  await db.query(
    `insert into user_connections (user_id, provider, ciphertext, nonce, last4, verified_at, models, models_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, case when $7::jsonb is null then null else now() end)
     on conflict (user_id, provider) do update set
       ciphertext = excluded.ciphertext, nonce = excluded.nonce, last4 = excluded.last4, verified_at = excluded.verified_at,
       models = excluded.models, models_at = excluded.models_at,
       last_used_at = null, last_error = null, last_error_kind = null, last_error_at = null, updated_at = now()`,
    [userId, provider, sealed.ciphertext, sealed.nonce, last4, opts.verifiedAt ?? null, models],
  );
  return { provider, last4, sealed: sealVersion(sealed) };
}

/** A feel as it's read back: only a known preset, and every number inside its bounds (lib/connections-shared.ts). */
function storedFeel(r: Partial<Record<keyof Feel, unknown>>): Feel {
  const preset = r.preset === "custom" || (PRESET_IDS as string[]).includes(String(r.preset)) ? (r.preset as Feel["preset"]) : null;
  return {
    preset,
    temperature: clampSetting(r.temperature, "temperature"),
    frequency_penalty: clampSetting(r.frequency_penalty, "penalty"),
    presence_penalty: clampSetting(r.presence_penalty, "penalty"),
  };
}

/**
 * Points a job at a provider's stored key, with the model it runs (null: the provider's default for the job) and, for
 * Dates & texts, its feel (a preset, or Advanced's raw values, clamped to their bounds for that provider).
 */
export async function assignJob(
  db: Db,
  userId: string,
  job: Job,
  provider: string,
  model: string | null,
  feel: Partial<Feel> = {},
  cap: Partial<CapSettings> = {},
): Promise<void> {
  const f = job === "text" ? feel : {};
  await db.query(
    `insert into user_connection_jobs (user_id, job, provider, model, preset, temperature, frequency_penalty, presence_penalty, cap_usd, on_cap)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, job) do update set provider = excluded.provider, model = excluded.model, preset = excluded.preset,
       temperature = excluded.temperature, frequency_penalty = excluded.frequency_penalty, presence_penalty = excluded.presence_penalty,
       cap_usd = excluded.cap_usd, on_cap = excluded.on_cap, updated_at = now()`,
    [
      userId,
      job,
      provider,
      model,
      f.preset ?? null,
      clampSetting(f.temperature, "temperature", provider),
      clampSetting(f.frequency_penalty, "penalty"),
      clampSetting(f.presence_penalty, "penalty"),
      clampCap(cap.cap_usd),
      // Only Dates & texts has a free model to stand in; portraits and clips always wait at the cap.
      job === "text" && cap.on_cap === "pause" ? "pause" : null,
    ],
  );
}

/** A job back to no key of yours (the free model for dates; portraits and clips need one again). */
export async function unassignJob(db: Db, userId: string, job: Job): Promise<boolean> {
  const { rows } = await db.query(`delete from user_connection_jobs where user_id = $1 and job = $2 returning job`, [userId, job]);
  return rows.length > 0;
}

/** Removes a stored key, and every job that used it. It's gone: there's no copy to get back. */
export async function removeConnection(db: Db, userId: string, provider: string): Promise<boolean> {
  const { rows } = await db.query(`delete from user_connections where user_id = $1 and provider = $2 returning provider`, [userId, provider]);
  return rows.length > 0;
}

/**
 * Opens a stored key for its provider call. A legacy one is sealed again as v2 on the way (when KEY_ENCRYPTION_SECRET
 * is on), only if nobody replaced it meanwhile. One that can't be opened any more is marked unreadable on its card.
 */
async function openStored(db: Db, userId: string, provider: string, stored: Sealed, env: Env): Promise<string | null> {
  const context = contextFor(userId, provider);
  if (needsReseal(stored, env)) {
    const moved = reseal(stored, context, env);
    if (moved) {
      await db
        .query(`update user_connections set ciphertext = $3, nonce = $4 where user_id = $1 and provider = $2 and ciphertext = $5`, [
          userId,
          provider,
          moved.sealed.ciphertext,
          moved.sealed.nonce,
          stored.ciphertext,
        ])
        .catch(() => {});
      return moved.plain;
    }
  }
  const plain = openKey(stored, context, env);
  if (plain === null) await recordError(db, userId, provider, "unreadable");
  return plain;
}

/** A provider's stored key, opened (the server only, for its call), or null. */
export async function openConnection(db: Db, userId: string, provider: string, env: Env = process.env): Promise<string | null> {
  const row = (await db.query<Sealed>(`select ciphertext, nonce from user_connections where user_id = $1 and provider = $2`, [userId, provider])).rows[0];
  return row ? openStored(db, userId, provider, row, env) : null;
}

/**
 * What a job runs on for a person: the provider, its key (opened, for the call only), the model, and (Dates & texts) its
 * feel; null with none.
 */
export async function jobKey(
  db: Db,
  userId: string,
  job: Job,
  env: Env = process.env,
): Promise<{ provider: string; apiKey: string; model: string; feel: Feel; cap: CapSettings } | null> {
  const row = (
    await db.query<{ provider: string; model: string | null; ciphertext: string; nonce: string; cap_usd: number | null; on_cap: string | null } & Feel>(
      `select j.provider, j.model, j.preset, j.temperature, j.frequency_penalty, j.presence_penalty, j.cap_usd, j.on_cap, c.ciphertext, c.nonce
         from user_connection_jobs j join user_connections c on c.user_id = j.user_id and c.provider = j.provider
        where j.user_id = $1 and j.job = $2`,
      [userId, job],
    )
  ).rows[0];
  if (!row) return null;
  const model = row.model || defaultModelFor(row.provider, job);
  if (!model) return null;
  const apiKey = await openStored(db, userId, row.provider, row, env);
  const cap: CapSettings = { cap_usd: clampCap(row.cap_usd), on_cap: job === "text" && row.on_cap === "pause" ? "pause" : job === "text" ? "fallback" : "pause" };
  return apiKey ? { provider: row.provider, apiKey, model, feel: storedFeel(row), cap } : null;
}

/** Whether a person has a key for a job (no decrypting: for the pages that only say "you can"). */
export async function hasJobKey(db: Db, userId: string | null | undefined, job: Job): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await db.query(`select 1 from user_connection_jobs where user_id = $1 and job = $2`, [userId, job]);
  return rows.length > 0;
}

/** A key that just worked: when it was last used, and any earlier error cleared (it's disproved). Best effort. */
export async function recordUse(db: Db, userId: string, provider: string): Promise<void> {
  await db
    .query(
      `update user_connections set last_used_at = now(), last_error = null, last_error_kind = null, last_error_at = null
        where user_id = $1 and provider = $2`,
      [userId, provider],
    )
    .catch(() => {});
}

/**
 * A key that just failed, in plain words for its card. Best effort. True when it's a new failure (the key had no error,
 * or another one), so its owner is told once, not on every call that fails the same way.
 */
export async function recordError(db: Db, userId: string, provider: string, kind: ErrorKind, opts: { model?: string | null } = {}): Promise<boolean> {
  const e = plainError(provider, kind, opts);
  const r = await db
    .query<{ prev: string | null }>(
      `update user_connections c set last_error = $3, last_error_kind = $4, last_error_at = now()
         from (select last_error_kind as prev from user_connections where user_id = $1 and provider = $2) p
        where c.user_id = $1 and c.provider = $2 returning p.prev`,
      [userId, provider, e.message, e.kind],
    )
    .catch(() => null);
  const row = r?.rows[0];
  return row !== undefined && row.prev !== e.kind;
}

/** A key that passed the live check: checked now, its error cleared, and the models it listed kept for the model step. */
export async function recordCheck(db: Db, userId: string, provider: string, at: string, models: string[] | null = null): Promise<void> {
  await db.query(
    `update user_connections set verified_at = $3, last_error = null, last_error_kind = null, last_error_at = null,
       models = coalesce($4::jsonb, models), models_at = case when $4::jsonb is null then models_at else $3::timestamptz end
      where user_id = $1 and provider = $2`,
    [userId, provider, at, models ? JSON.stringify(models.slice(0, MAX_LISTED)) : null],
  );
}

/**
 * A call's refusal on a person's key, sorted for its card: the provider's HTTP status (lib/model ModelError.status)
 * and its message, when it answered. Only what the person can act on is kept; a provider's bad minute isn't the key's
 * fault, and neither is a model's bad reply.
 */
export function refusalKind(status: number | undefined, message = ""): ErrorKind | null {
  if (status === undefined) return null;
  const kind = classifyRefusal(status, message);
  return kind === "unknown" || kind === "provider_down" ? null : kind;
}

/* ------------------------------------------------------ M2: the models ------------------------------------------------------ */

/** The most model ids kept per key (OpenRouter's list is public and isn't kept; the others list dozens). */
export const MAX_LISTED = 500;
/** How long OpenRouter's public model list is reused before it's fetched again (per server instance). */
export const OPENROUTER_LIST_TTL_MS = 60 * 60 * 1000;

type OpenRouterModel = {
  id?: unknown;
  name?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
};
let openRouterCache: { at: number; models: ModelOption[] } | null = null;
/** Tests start from an empty cache. */
export function resetModelCacheForTests(): void {
  openRouterCache = null;
}

/** USD per 1M tokens from OpenRouter's per-token price strings; null when it doesn't say. */
const perMillion = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null;
};

/**
 * OpenRouter's whole model list for Dates & texts (public: no key needed, so none is sent), with each model's own prices
 * and modalities: free when its id says so or both prices are 0, vision when it takes images. Text-out chat models only.
 * Kept for an hour per instance. Null when the list can't be had.
 */
export async function openRouterModels(opts: { fetchImpl?: typeof fetch; env?: Env; now?: number } = {}): Promise<ModelOption[] | null> {
  const now = opts.now ?? Date.now();
  if (openRouterCache && now - openRouterCache.at < OPENROUTER_LIST_TTL_MS) return openRouterCache.models;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(at("openrouter", "https://openrouter.ai/api/v1/models", opts.env ?? process.env), { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { data?: OpenRouterModel[] } | null;
    if (!Array.isArray(body?.data)) return null;
    const models: ModelOption[] = [];
    for (const m of body.data) {
      if (typeof m?.id !== "string" || !modelFitsJob("text", m.id)) continue;
      const outs = Array.isArray(m.architecture?.output_modalities) ? (m.architecture!.output_modalities as unknown[]) : ["text"];
      if (!outs.includes("text")) continue;
      const ins = Array.isArray(m.architecture?.input_modalities) ? (m.architecture!.input_modalities as unknown[]) : [];
      const input = perMillion(m.pricing?.prompt);
      const output = perMillion(m.pricing?.completion);
      const price = input !== null && output !== null ? { input, output } : null;
      models.push(
        modelOption("openrouter", "text", m.id, {
          note: typeof m.name === "string" ? m.name.slice(0, 120) : null,
          price,
          free: /:free$/.test(m.id) || (price !== null && price.input === 0 && price.output === 0),
          vision: ins.includes("image"),
        }),
      );
    }
    openRouterCache = { at: now, models };
    return models;
  } catch {
    return null;
  }
}

/** An OpenRouter model's list price from the list already fetched (never a fetch): for a call that reported no cost. */
export function cachedOpenRouterPrice(id: string): { input: number; output: number } | null {
  return openRouterCache?.models.find((m) => m.id === id)?.price ?? null;
}

/**
 * The models a job can run on a provider, for the model step, Recommended first: OpenRouter's live list (with its prices),
 * or the models this person's key listed at its last check, or (no list) the curated ones. `listed` overrides the stored
 * list (a pasted key's, just checked).
 */
export async function modelsFor(
  db: Db | null,
  userId: string | null,
  provider: string,
  job: Job,
  opts: { listed?: string[] | null; fetchImpl?: typeof fetch; env?: Env } = {},
): Promise<{ models: ModelOption[]; source: "provider" | "curated" }> {
  if (!isUserProvider(provider) || !PROVIDER_INFO[provider].jobs.includes(job)) return { models: [], source: "curated" };
  if (provider === "openrouter" && job === "text") {
    const live = await openRouterModels(opts);
    if (!live) return { models: modelOptions(provider, job, null), source: "curated" };
    // The curated ones first (Recommended at the top), with OpenRouter's own prices; then the rest of its list.
    const byId = new Map(live.map((m) => [m.id, m]));
    const curated = curatedModels(provider, job).map((c) => {
      const listed = byId.get(c.id);
      const tags: ModelOption["tags"] = c.recommended && listed && !listed.tags.includes("recommended") ? ["recommended", ...listed.tags] : (listed?.tags ?? []);
      return listed ? { ...listed, note: c.note, tags } : modelOption(provider, job, c.id);
    });
    const ids = new Set(curated.map((m) => m.id));
    return { models: [...curated, ...live.filter((m) => !ids.has(m.id))], source: "provider" };
  }
  let listed = opts.listed;
  if (listed === undefined && db && userId) {
    const row = (await db.query<{ models: unknown }>(`select models from user_connections where user_id = $1 and provider = $2`, [userId, provider])).rows[0];
    listed = Array.isArray(row?.models) ? (row!.models as unknown[]).filter((m): m is string => typeof m === "string") : null;
  }
  return { models: modelOptions(provider, job, listed ?? null), source: listed?.length ? "provider" : "curated" };
}

/* --------------------------------------------------- M3: usage and caps --------------------------------------------------- */

/** One call's cost on a person's key: what the provider reported, else tokens × the model's list price, else unknown. */
export type CallCost = { usd: number; how: "reported" | "estimated" | "unpriced"; input: number; output: number };

/**
 * What a call cost the key's owner. OpenRouter reports it (asked for with usage.include); otherwise the tokens at the model's
 * list price (lib/connections-shared.ts CURATED_PRICES, or OpenRouter's own prices from its list), thinking billed as
 * output; otherwise unpriced (counted, shown on the card, never guessed).
 */
export function callCost(model: string, usage: Usage, listPrice: { input: number; output: number } | null = null): CallCost {
  const input = usage.input;
  const output = usage.output;
  if (usage.cost !== undefined) return { usd: usage.cost, how: "reported", input, output };
  const price = listPrice ?? CURATED_PRICES[model] ?? CURATED_PRICES[model.replace(/^[\w-]+\//, "")] ?? null;
  if (!price) return { usd: 0, how: "unpriced", input, output };
  return { usd: (input * price.input + output * price.output) / 1e6, how: "estimated", input, output };
}

type UsageRow = { cost_usd: number; calls: number; estimated_calls: number; unpriced_calls: number; warned_at: Date | string | null; capped_at: Date | string | null };

/** What each job of a person's spent this month. */
export async function currentUsage(db: Db, userId: string, now: number = Date.now()): Promise<Partial<Record<Job, UsageSummary>>> {
  const { rows } = await db
    .query<{ job: Job } & UsageRow>(`select job, cost_usd, calls, estimated_calls, unpriced_calls from user_connection_usage where user_id = $1 and month = $2`, [userId, monthOf(now)])
    .catch(() => ({ rows: [] as ({ job: Job } & UsageRow)[] }));
  return Object.fromEntries(rows.map((r) => [r.job, { cost_usd: Number(r.cost_usd), calls: r.calls, estimated_calls: r.estimated_calls, unpriced_calls: r.unpriced_calls }]));
}

/** Adds one call (or one portrait, one clip) to a job's month, and returns the month so far. Never throws. */
export async function recordUsage(db: Db, userId: string, job: Job, cost: CallCost, now: number = Date.now()): Promise<{ cost_usd: number; warned: boolean; capped: boolean } | null> {
  const r = await db
    .query<UsageRow>(
      `insert into user_connection_usage (user_id, job, month, cost_usd, calls, input_tokens, output_tokens, estimated_calls, unpriced_calls)
       values ($1, $2, $3, $4, 1, $5, $6, $7, $8)
       on conflict (user_id, job, month) do update set
         cost_usd = user_connection_usage.cost_usd + excluded.cost_usd, calls = user_connection_usage.calls + 1,
         input_tokens = user_connection_usage.input_tokens + excluded.input_tokens, output_tokens = user_connection_usage.output_tokens + excluded.output_tokens,
         estimated_calls = user_connection_usage.estimated_calls + excluded.estimated_calls, unpriced_calls = user_connection_usage.unpriced_calls + excluded.unpriced_calls,
         updated_at = now()
       returning cost_usd, calls, estimated_calls, unpriced_calls, warned_at, capped_at`,
      [userId, job, monthOf(now), Math.max(0, cost.usd), Math.round(cost.input), Math.round(cost.output), cost.how === "estimated" ? 1 : 0, cost.how === "unpriced" ? 1 : 0],
    )
    .catch(() => null);
  const row = r?.rows[0];
  return row ? { cost_usd: Number(row.cost_usd), warned: row.warned_at !== null, capped: row.capped_at !== null } : null;
}

/** Marks a job's 80% or cap notice as sent this month; true only for the one call that marked it (so it goes once). */
async function claimNotice(db: Db, userId: string, job: Job, which: "warned_at" | "capped_at", now: number): Promise<boolean> {
  const r = await db
    .query(
      `insert into user_connection_usage (user_id, job, month, ${which}) values ($1, $2, $3, now())
       on conflict (user_id, job, month) do update set ${which} = now() where user_connection_usage.${which} is null
       returning 1`,
      [userId, job, monthOf(now)],
    )
    .catch(() => null);
  return Boolean(r?.rows.length);
}

const fallbackWords = (job: Job, cap: CapSettings, now: number) =>
  job === "text" && cap.on_cap === "fallback"
    ? `Botchelor's free model stands in for your dates until ${resetDay(now)}.`
    : `${job === "text" ? "Your dates wait" : job === "image" ? "Portraits wait" : job === "after_dark" ? "Studio pictures on your key wait" : "Clips wait"} until ${resetDay(now)}, or until you raise the cap.`;

/**
 * The notices a job's spend calls for (once a month each): the heads-up at WARN_AT of its cap, and the cap itself. In the
 * app, and by email at once when its owner turned email on (lib/email.ts IMMEDIATE_KINDS).
 */
export async function noteSpend(db: Db, userId: string, job: Job, provider: string, spent: number, cap: CapSettings, now: number = Date.now()): Promise<void> {
  const level = capLevel(spent, cap.cap_usd);
  if (level === "none" || level === "ok" || cap.cap_usd === null) return;
  const title = JOB_INFO[job].title;
  const link = `/account/keys#${JOB_INFO[job].anchor}`;
  if (level === "over") {
    if (!(await claimNotice(db, userId, job, "capped_at", now))) return;
    await notify(db, userId, {
      kind: "key_capped",
      title: `🔑 ${title} reached its ${money(cap.cap_usd)} cap for the month`,
      body: `Your ${providerLabel(provider)} key has spent ${money(spent)} this month. ${fallbackWords(job, cap, now)} Raise the cap on Connections.`,
      link,
    });
    return;
  }
  if (!(await claimNotice(db, userId, job, "warned_at", now))) return;
  await notify(db, userId, {
    kind: "key_usage",
    title: `🔑 ${title} is at ${Math.floor(WARN_AT * 100)}% of its ${money(cap.cap_usd)} cap`,
    body: `Your ${providerLabel(provider)} key has spent ${money(spent)} of ${money(cap.cap_usd)} this month. At the cap, ${fallbackWords(job, cap, now).charAt(0).toLowerCase()}${fallbackWords(job, cap, now).slice(1)}`,
    link,
  });
}

/** A key that stopped working, told once (recordError's new failure), with what to do and what happens meanwhile. */
export async function noteFailure(db: Db, userId: string, job: Job, provider: string, kind: ErrorKind, cap: CapSettings): Promise<void> {
  const e = plainError(provider, kind);
  const meanwhile =
    job === "text" ? (cap.on_cap === "fallback" ? "Meanwhile Botchelor's free model stands in for your dates." : "Meanwhile your dates wait (you chose that).") : "";
  await notify(db, userId, {
    kind: "key_failed",
    title: `🔑 Your ${providerLabel(provider)} key stopped working`,
    body: `${e.message}${e.fix ? ` ${e.fix.label}.` : ""} ${meanwhile}`.trim(),
    link: `/account/keys#${JOB_INFO[job].anchor}`,
  });
}

/** The failures only a key's owner can fix: while one stands, "pause" holds their bookings. */
const OWNER_FIXES: readonly ErrorKind[] = ["invalid_key", "no_credit", "unreadable"];

/**
 * Whether a job can run on its key right now: it has one, it isn't at its cap, and (for a key whose owner chose to pause)
 * it isn't failing for a reason only they can fix. With the words to say when it can't.
 */
export async function jobUsability(
  db: Db,
  userId: string,
  job: Job,
  now: number = Date.now(),
): Promise<{ state: "none" } | { state: "ok"; cap: CapSettings; spent: number } | { state: "over_cap" | "failing"; cap: CapSettings; spent: number; provider: string; message: string }> {
  const row = (
    await db.query<{ provider: string; cap_usd: number | null; on_cap: string | null; last_error_kind: string | null }>(
      `select j.provider, j.cap_usd, j.on_cap, c.last_error_kind
         from user_connection_jobs j join user_connections c on c.user_id = j.user_id and c.provider = j.provider
        where j.user_id = $1 and j.job = $2`,
      [userId, job],
    )
  ).rows[0];
  if (!row) return { state: "none" };
  const cap: CapSettings = { cap_usd: clampCap(row.cap_usd), on_cap: job === "text" && row.on_cap === "pause" ? "pause" : job === "text" ? "fallback" : "pause" };
  const spent = (await currentUsage(db, userId, now))[job]?.cost_usd ?? 0;
  const title = JOB_INFO[job].title;
  if (capLevel(spent, cap.cap_usd) === "over") {
    return {
      state: "over_cap",
      cap,
      spent,
      provider: row.provider,
      message: `${title} has reached its ${money(cap.cap_usd!)} cap for the month on your ${providerLabel(row.provider)} key. ${fallbackWords(job, cap, now)} You can raise the cap on Connections.`,
    };
  }
  const failing = row.last_error_kind && (OWNER_FIXES as readonly string[]).includes(row.last_error_kind) ? (row.last_error_kind as ErrorKind) : null;
  if (failing && cap.on_cap === "pause") {
    const e = plainError(row.provider, failing);
    return {
      state: "failing",
      cap,
      spent,
      provider: row.provider,
      message: `${e.message} You chose to pause when your key can't be used, so ${job === "text" ? "your dates wait" : "this waits"}: ${e.fix ? `${e.fix.label.charAt(0).toLowerCase()}${e.fix.label.slice(1)}, then press Check` : "fix it, then press Check"} on Connections (or let Botchelor's free model stand in).`,
    };
  }
  return { state: "ok", cap, spent };
}

/**
 * One portrait or clip made on a person's key (no per-token usage to read): its list-price estimate added to the job's
 * month, the 80% and cap notices, and the key's "last used". Never throws into the request it follows.
 */
export async function recordJobSpend(db: Db, userId: string, job: Job, provider: string, usd: number, now: number = Date.now()): Promise<void> {
  try {
    await recordUse(db, userId, provider);
    const month = await recordUsage(db, userId, job, { usd, how: "estimated", input: 0, output: 0 }, now);
    const usable = await jobUsability(db, userId, job, now);
    if (month && usable.state !== "none") await noteSpend(db, userId, job, provider, month.cost_usd, usable.cap, now);
  } catch {
    /* the spend is a record, never a reason to fail what was made */
  }
}

/**
 * A portrait or clip the key's provider turned down: when its words carry the HTTP status ("(HTTP 401)"), what went wrong
 * goes on the card in plain words, and its owner hears once when it's newly something only they can fix.
 */
export async function recordJobFailure(db: Db, userId: string, job: Job, provider: string, message: string): Promise<void> {
  const status = Number(/HTTP (\d{3})/.exec(message)?.[1]);
  const kind = refusalKind(Number.isFinite(status) ? status : undefined, message);
  if (!kind) return;
  try {
    const isNew = await recordError(db, userId, provider, kind);
    const usable = await jobUsability(db, userId, job);
    if (isNew && (kind === "invalid_key" || kind === "no_credit") && usable.state !== "none") await noteFailure(db, userId, job, provider, kind, usable.cap);
  } catch {
    /* best effort */
  }
}
