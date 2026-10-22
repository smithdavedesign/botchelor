/**
 * Bring-your-own-key (M16): a signed-in user may store their own model provider key, so their dates run on
 * their quota and their choice of model instead of the show's free tier. The engine still decides every
 * outcome, so a stronger model can never buy a result.
 *
 * Privacy is the whole design. A key is only ever used for calls whose prompt contains no OTHER user's
 * private soul (lib/pipeline keyForSide): a user's own turns (their soul, which they consent to), and
 * soulless turns (a house character). The director and narrator see both souls, so they always run on the
 * platform key. Keys are known providers only — no custom endpoints — so a key can't be pointed at an
 * attacker's server to harvest prompts. Stored AES-256-GCM encrypted (key derived from SESSION_SECRET),
 * account-only, never logged and never returned in full (only the provider and the last four characters).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Db } from "./db";
import { openAICompatibleModel, type Model, type ReasoningEffort } from "./model";

/**
 * Providers whose chat API is OpenAI-compatible at a known base URL. No custom endpoints (SSRF / prompt theft).
 * Each entry declares a short list of recommended models the UI shows: curated so users don't paste an id a
 * provider doesn't have. The `defaultModel` is used when a user picks a provider but doesn't name a model.
 *
 * Adding a provider? Pick one that's genuinely OpenAI-compatible at `/chat/completions`, add it below, and keep
 * the entry a single line. The validate ping and MCP's `set_model` pick it up automatically.
 */
export const TEXT_PROVIDERS = {
  google: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", note: "the free-tier default; cheap and fast" },
      { id: "gemini-3.5-flash", note: "a step up in writing, still cheap" },
      { id: "gemini-3.5-pro", note: "best Gemini writing; more expensive" },
    ],
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    models: [
      { id: "gpt-4.1-mini", note: "the default; cheap, strong at dialogue" },
      { id: "gpt-4.1", note: "flagship; best writing, highest cost" },
      { id: "gpt-5-mini", note: "newer reasoning model" },
    ],
  },
  anthropic: {
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-5-5",
    models: [
      { id: "claude-haiku-5-5", note: "cheap, fast; strong dialogue" },
      { id: "claude-sonnet-5-5", note: "the balanced pick for writing" },
      { id: "claude-opus-5-5", note: "best writing; expensive" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat", note: "very cheap; good at English + Chinese" },
      { id: "deepseek-reasoner", note: "reasoning model; more thought, slower" },
    ],
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      { id: "llama-3.3-70b-versatile", note: "fast inference (~500 tok/s)" },
      { id: "llama-3.1-8b-instant", note: "smaller, cheaper, fastest" },
      { id: "openai/gpt-oss-120b", note: "open-weights GPT; largest Groq hosts" },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    models: [
      { id: "openai/gpt-4.1-mini", note: "route to OpenAI, pay by usage" },
      { id: "anthropic/claude-haiku-5-5", note: "route to Anthropic Claude" },
      { id: "deepseek/deepseek-chat", note: "route to DeepSeek" },
      { id: "x-ai/grok-4", note: "route to xAI Grok" },
    ],
  },
} as const;

/**
 * Image providers. OpenAI generation is wired (lib/image): it moderates its own input and output, so a
 * user-key portrait is provider-moderated, and our prompt is built only from already content-filtered sheet
 * text. fal / replicate are stored for later (no moderation story yet). Video is a key slot only for now.
 */
export const IMAGE_PROVIDERS = {
  openai: { label: "OpenAI Images", generates: true },
  // Google's key in the image/video slot runs intro clips (Veo, lib/video.ts), not portraits.
  google: { label: "Google (Veo clips)", generates: false },
  fal: { label: "fal.ai", generates: false },
  replicate: { label: "Replicate", generates: false },
} as const;

export type TextProvider = keyof typeof TEXT_PROVIDERS;
export type KeyKind = "text" | "image";

/** The ids the set_model schema accepts — one source for the schema enum and the dispatcher's ENUM_SOURCES. */
export const TEXT_PROVIDER_IDS = Object.keys(TEXT_PROVIDERS) as readonly TextProvider[];

export const isTextProvider = (p: string): p is TextProvider => p in TEXT_PROVIDERS;
export const isImageProvider = (p: string): boolean => p in IMAGE_PROVIDERS;

/* ----------------------------------- encryption ----------------------------------- */

function aesKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  // Derived from SESSION_SECRET so there's no second secret to manage; domain-separated from session signing.
  return Buffer.from(hkdfSync("sha256", secret, Buffer.from("botchelor-byok-v1"), Buffer.from("user-keys"), 32));
}

/** True when the app can store BYOK keys (it can encrypt them). Same gate as accounts. */
export const byokAvailable = (env: Record<string, string | undefined> = process.env): boolean => aesKey(env) !== null;

type Encrypted = { ciphertext: string; nonce: string };

function encryptKey(plain: string, env: Record<string, string | undefined> = process.env): Encrypted {
  const key = aesKey(env);
  if (!key) throw new Error("BYOK unavailable: no SESSION_SECRET");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]).toString("base64"), nonce: iv.toString("base64") };
}

function decryptKey(enc: Encrypted, env: Record<string, string | undefined> = process.env): string | null {
  const key = aesKey(env);
  if (!key) return null;
  try {
    const raw = Buffer.from(enc.ciphertext, "base64");
    const tag = raw.subarray(raw.length - 16);
    const data = raw.subarray(0, raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.nonce, "base64"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const last4 = (s: string): string => s.slice(-4);

/** The same sealing for a secret stored somewhere other than user_keys (lib/adult/settings.ts). */
export const sealSecret = (plain: string, env: Record<string, string | undefined> = process.env) => encryptKey(plain, env);
export const openSecret = (enc: { ciphertext: string; nonce: string }, env: Record<string, string | undefined> = process.env) => decryptKey(enc, env);

/* ----------------------------------- store ----------------------------------- */

export type StoredKeyInfo = { provider: string; kind: KeyKind; last4: string; model: string | null; created_at: string };

/** Saves (replaces) a user's key for a provider+kind. Only the provider, last four and optional model are shown later. */
export async function saveUserKey(
  db: Db,
  userId: string,
  provider: string,
  kind: KeyKind,
  apiKey: string,
  model: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<StoredKeyInfo> {
  const { ciphertext, nonce } = encryptKey(apiKey, env);
  await db.query(
    `insert into user_keys (user_id, provider, kind, ciphertext, nonce, last4, model)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, provider, kind) do update set
       ciphertext = excluded.ciphertext, nonce = excluded.nonce, last4 = excluded.last4,
       model = excluded.model, created_at = now()`,
    [userId, provider, kind, ciphertext, nonce, last4(apiKey), model],
  );
  return { provider, kind, last4: last4(apiKey), model, created_at: new Date().toISOString() };
}

/**
 * Validate a key by making one tiny chat-completions call to the provider at a sub-1¢ cost. Returns the model
 * that actually answered, the latency, and whether it worked. Called before `saveUserKey` on request, and from
 * the MCP `set_model` tool with `test: true`. Never logs the key.
 */
export async function pingKey(
  provider: string,
  apiKey: string,
  model: string | null = null,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: true; model: string; latency_ms: number } | { ok: false; status?: number; error: string }> {
  if (!isTextProvider(provider)) return { ok: false, error: `Unknown provider: ${provider}. Supported: ${Object.keys(TEXT_PROVIDERS).join(", ")}.` };
  const p = TEXT_PROVIDERS[provider];
  const chosen = model || p.defaultModel;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeout = opts.timeoutMs ?? 10_000;
  const started = Date.now();
  try {
    const res = await doFetch(`${p.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: chosen,
        messages: [{ role: "user", content: "Reply with just: ok" }],
        max_tokens: 4,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    const latency_ms = Date.now() - started;
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json() as { error?: { message?: string } | string };
        detail = typeof body?.error === "string" ? body.error : body?.error?.message ?? "";
      } catch { /* body wasn't JSON */ }
      return { ok: false, status: res.status, error: `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
    }
    return { ok: true, model: chosen, latency_ms };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteUserKey(db: Db, userId: string, provider: string, kind: KeyKind): Promise<boolean> {
  const { rows } = await db.query<{ user_id: string }>(
    `delete from user_keys where user_id = $1 and provider = $2 and kind = $3 returning user_id`,
    [userId, provider, kind],
  );
  return rows.length > 0;
}

/** The provider/last4/model of every key a user has saved (never the key itself). For the account page. */
export async function listUserKeys(db: Db, userId: string): Promise<StoredKeyInfo[]> {
  const { rows } = await db.query<{ provider: string; kind: KeyKind; last4: string; model: string | null; created_at: Date }>(
    `select provider, kind, last4, model, created_at from user_keys where user_id = $1 order by created_at desc`,
    [userId],
  );
  return rows.map((r) => ({ provider: r.provider, kind: r.kind, last4: r.last4, model: r.model, created_at: new Date(r.created_at).toISOString() }));
}

/**
 * A user's TEXT model built from their saved key, or null if they have none (or the app can't decrypt).
 * The reasoning level is passed through so a user-key actor also keeps thinking low (their cost too).
 */
export async function userTextModel(db: Db, userId: string, reasoning?: ReasoningEffort, env: Record<string, string | undefined> = process.env): Promise<Model | null> {
  const { rows } = await db.query<{ provider: string; ciphertext: string; nonce: string; model: string | null }>(
    `select provider, ciphertext, nonce, model from user_keys where user_id = $1 and kind = 'text' limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row || !isTextProvider(row.provider)) return null;
  const apiKey = decryptKey({ ciphertext: row.ciphertext, nonce: row.nonce }, env);
  if (!apiKey) return null;
  const p = TEXT_PROVIDERS[row.provider];
  return openAICompatibleModel({ baseUrl: p.baseUrl, apiKey, model: row.model || p.defaultModel, reasoning });
}

/** A user's saved image key (provider + decrypted key + optional model), or null. For portrait generation. */
export async function userImageKey(
  db: Db,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ provider: string; apiKey: string; model: string | null } | null> {
  // A user may hold more than one image-slot key (OpenAI for portraits, Google for clips): portraits want OpenAI.
  const { rows } = await db.query<{ provider: string; ciphertext: string; nonce: string; model: string | null }>(
    `select provider, ciphertext, nonce, model from user_keys where user_id = $1 and kind = 'image'
      order by (provider = 'openai') desc limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const apiKey = decryptKey({ ciphertext: row.ciphertext, nonce: row.nonce }, env);
  return apiKey ? { provider: row.provider, apiKey, model: row.model } : null;
}

/**
 * A user's Google key for intro clips (Veo, lib/video.ts): one saved in the image/video slot if they keep a
 * separate one, else the Google key they use for dates. Null when they have neither. Veo needs billing on.
 */
export async function userVideoKey(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const { rows } = await db.query<{ ciphertext: string; nonce: string }>(
    `select ciphertext, nonce from user_keys where user_id = $1 and provider = 'google'
      order by (kind = 'image') desc limit 1`,
    [userId],
  );
  const row = rows[0];
  return row ? decryptKey({ ciphertext: row.ciphertext, nonce: row.nonce }, env) : null;
}

/**
 * The per-side actor-model resolver for a date (lib/pipeline keyForSide). The rule that keeps BYOK private:
 * a user's key may run a turn only when the turn's prompt carries no OTHER user's soul.
 *  - A side owned by a real user runs on that user's own key (their own soul, which they consent to).
 *  - A soulless side (a house character, or a soul kept local-only) rides the date's lone creator's key
 *    when there is exactly one real creator — nothing private of anyone else is in that prompt.
 *  - Otherwise (a blind date between two users, the other side having no key) that side stays on the platform.
 * `reachableSoul[i]` is whether side i's prompt actually contains that side's private soul.
 */
export async function buildKeyForSide(
  db: Db,
  owners: [string | null, string | null],
  reachableSoul: [boolean, boolean],
  reasoning?: ReasoningEffort,
  env: Record<string, string | undefined> = process.env,
): Promise<(side: "a" | "b") => Model | null> {
  const models = new Map<string, Model | null>();
  for (const o of owners) if (o && !models.has(o)) models.set(o, await userTextModel(db, o, reasoning, env));
  const realOwners = owners.filter((o): o is string => o !== null);
  const loneCreatorKey = realOwners.length === 1 ? (models.get(realOwners[0]) ?? null) : null;
  return (side) => {
    const i = side === "a" ? 0 : 1;
    const own = owners[i];
    const ownKey = own ? (models.get(own) ?? null) : null;
    if (ownKey) return ownKey; // the side's own soul on the side's own key
    if (!reachableSoul[i] && loneCreatorKey) return loneCreatorKey; // a soulless side can ride the lone creator's key
    return null; // platform
  };
}
