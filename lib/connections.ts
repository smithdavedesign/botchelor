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
  defaultModelFor,
  isUserProvider,
  plainError,
  PROVIDER_INFO,
  TEXT_PROVIDERS,
  type ErrorKind,
  type Job,
  type PlainError,
  type UserProvider,
} from "./connections-shared";
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
export type JobAssignment = { job: Job; provider: string; model: string | null; updated_at: string };

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
    db.query<{ job: Job; provider: string; model: string | null; updated_at: Date | string }>(
      `select job, provider, model, updated_at from user_connection_jobs where user_id = $1`,
      [userId],
    ),
  ]);
  const assignments = jobs.rows.map((j) => ({ job: j.job, provider: j.provider, model: j.model, updated_at: iso(j.updated_at)! }));
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
 * Connections page saves only a key that just passed). A replaced key starts with a clean slate: no error, not used yet.
 */
export async function saveConnection(
  db: Db,
  userId: string,
  provider: string,
  apiKey: string,
  opts: { verifiedAt?: string | null; env?: Env } = {},
): Promise<{ provider: string; last4: string; sealed: SealVersion }> {
  const sealed = sealKey(apiKey, contextFor(userId, provider), opts.env);
  const last4 = apiKey.slice(-4);
  await db.query(
    `insert into user_connections (user_id, provider, ciphertext, nonce, last4, verified_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, provider) do update set
       ciphertext = excluded.ciphertext, nonce = excluded.nonce, last4 = excluded.last4, verified_at = excluded.verified_at,
       last_used_at = null, last_error = null, last_error_kind = null, last_error_at = null, updated_at = now()`,
    [userId, provider, sealed.ciphertext, sealed.nonce, last4, opts.verifiedAt ?? null],
  );
  return { provider, last4, sealed: sealVersion(sealed) };
}

/** Points a job at a provider's stored key, with the model it runs (null: the provider's default for the job). */
export async function assignJob(db: Db, userId: string, job: Job, provider: string, model: string | null): Promise<void> {
  await db.query(
    `insert into user_connection_jobs (user_id, job, provider, model) values ($1, $2, $3, $4)
     on conflict (user_id, job) do update set provider = excluded.provider, model = excluded.model, updated_at = now()`,
    [userId, job, provider, model],
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

/** What a job runs on for a person: the provider, its key (opened, for the call only) and the model; null with none. */
export async function jobKey(db: Db, userId: string, job: Job, env: Env = process.env): Promise<{ provider: string; apiKey: string; model: string } | null> {
  const row = (
    await db.query<{ provider: string; model: string | null; ciphertext: string; nonce: string }>(
      `select j.provider, j.model, c.ciphertext, c.nonce
         from user_connection_jobs j join user_connections c on c.user_id = j.user_id and c.provider = j.provider
        where j.user_id = $1 and j.job = $2`,
      [userId, job],
    )
  ).rows[0];
  if (!row) return null;
  const model = row.model || defaultModelFor(row.provider, job);
  if (!model) return null;
  const apiKey = await openStored(db, userId, row.provider, row, env);
  return apiKey ? { provider: row.provider, apiKey, model } : null;
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

/** A key that just failed, in plain words for its card. Best effort. */
export async function recordError(db: Db, userId: string, provider: string, kind: ErrorKind, opts: { model?: string | null } = {}): Promise<void> {
  const e = plainError(provider, kind, opts);
  await db
    .query(`update user_connections set last_error = $3, last_error_kind = $4, last_error_at = now() where user_id = $1 and provider = $2`, [userId, provider, e.message, e.kind])
    .catch(() => {});
}

/** A key that passed the live check: checked now, its error cleared. */
export async function recordCheck(db: Db, userId: string, provider: string, at: string): Promise<void> {
  await db.query(
    `update user_connections set verified_at = $3, last_error = null, last_error_kind = null, last_error_at = null where user_id = $1 and provider = $2`,
    [userId, provider, at],
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
