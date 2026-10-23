/**
 * Bring-your-own-key (M16): a signed-in user may store their own model provider key, so their dates run on
 * their quota and their choice of model instead of the show's free tier. The engine still decides every
 * outcome, so a stronger model can never buy a result.
 *
 * Since Connections (docs/PRDs/connections.md) keys live in lib/connections.ts: one per provider, each used by the
 * jobs it's assigned to (dates and texts, portraits, intro clips), sealed by lib/key-crypto.ts. This module keeps the
 * names the rest of the app was built on (MCP's set_model / my_model / clear_model, the routes, the date pipeline),
 * now on that store: a "text" key is the key the Dates & texts job uses; an "image" key, the one portraits (OpenAI)
 * or clips (Google) use.
 *
 * Privacy is the whole design. A key is only ever used for calls whose prompt contains no OTHER user's
 * private soul (lib/pipeline keyForSide): a user's own turns (their soul, which they consent to), and
 * soulless turns (a house character). The director and narrator see both souls, so they always run on the
 * platform key. Keys are known providers only — no custom endpoints — so a key can't be pointed at an
 * attacker's server to harvest prompts. Account-only, never logged and never returned in full (only the
 * provider and the last four characters).
 */
import type { Db } from "./db";
import { isTextProvider, plainError, TEXT_PROVIDERS, type Job, type TextProvider } from "./connections-shared";
import {
  assignJob,
  chatBaseUrl,
  classifyRefusal,
  hasJobKey,
  jobKey,
  listConnections,
  recordError,
  recordUse,
  refusalKind,
  removeConnection,
  saveConnection,
  unassignJob,
} from "./connections";
import { canSeal, openKey, sealKey } from "./key-crypto";
import { ModelError, openAICompatibleModel, type Model, type ReasoningEffort } from "./model";

export { isTextProvider, TEXT_PROVIDERS, type TextProvider };

/**
 * Image providers. OpenAI generation is wired (lib/image): it moderates its own input and output, so a
 * user-key portrait is provider-moderated, and our prompt is built only from already content-filtered sheet
 * text. fal / replicate were stored for later (no moderation story yet); the Connections page doesn't offer them.
 */
export const IMAGE_PROVIDERS = {
  openai: { label: "OpenAI Images", generates: true },
  // Google's key in the image/video slot runs intro clips (Veo, lib/video.ts), not portraits.
  google: { label: "Google (Veo clips)", generates: false },
  fal: { label: "fal.ai", generates: false },
  replicate: { label: "Replicate", generates: false },
} as const;

export type KeyKind = "text" | "image";

/** The ids the set_model schema accepts — one source for the schema enum and the dispatcher's ENUM_SOURCES. */
export const TEXT_PROVIDER_IDS = Object.keys(TEXT_PROVIDERS) as readonly TextProvider[];

export const isImageProvider = (p: string): boolean => p in IMAGE_PROVIDERS;

/** True when the app can store BYOK keys: accounts work (SESSION_SECRET) and a key can be sealed. */
export const byokAvailable = (env: Record<string, string | undefined> = process.env): boolean => Boolean(env.SESSION_SECRET) && canSeal(env);

/**
 * The same sealing for a secret stored somewhere other than a person's connections (lib/adult/settings.ts). `context`
 * is where it's stored ("adult:openrouter"): a v2 seal opens only there (lib/key-crypto.ts).
 */
export const sealSecret = (plain: string, context = "", env: Record<string, string | undefined> = process.env) => sealKey(plain, context, env);
export const openSecret = (enc: { ciphertext: string; nonce: string }, context = "", env: Record<string, string | undefined> = process.env) => openKey(enc, context, env);

/* ----------------------------------- store ----------------------------------- */

export type StoredKeyInfo = { provider: string; kind: KeyKind; last4: string; model: string | null; created_at: string };

/** The job an M16 key slot is: a text key runs dates and texts; an OpenAI image key, portraits; a Google one, clips. */
export function jobForSlot(provider: string, kind: KeyKind): Job | null {
  if (kind === "text") return "text";
  if (provider === "openai") return "image";
  if (provider === "google") return "video";
  return null;
}

/**
 * Saves (replaces) a user's key for a provider and points the slot's job at it. Only the provider, last four and
 * optional model are shown later. A Google key for dates covers clips too when clips have no key of their own (it
 * always did: clips fell back to the dates key).
 */
export async function saveUserKey(
  db: Db,
  userId: string,
  provider: string,
  kind: KeyKind,
  apiKey: string,
  model: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<StoredKeyInfo> {
  const saved = await saveConnection(db, userId, provider, apiKey, { env });
  const job = jobForSlot(provider, kind);
  if (job) await assignJob(db, userId, job, provider, model);
  if (job === "text" && provider === "google" && !(await hasJobKey(db, userId, "video"))) await assignJob(db, userId, "video", "google", null);
  return { provider, kind, last4: saved.last4, model, created_at: new Date().toISOString() };
}

/** A provider's own words, minus the key itself and anything shaped like one: for scrubbing before a message leaves. */
export function scrubKey(text: string, apiKey: string): string {
  let out = text;
  if (apiKey.length >= 8) out = out.split(apiKey).join("[key]");
  return out.replace(/\b(sk|rk|pk|gsk|xai|AIza)[-_A-Za-z0-9]{12,}/g, "[key]");
}

/**
 * Validate a key by making one tiny chat-completions call to the provider at a sub-1¢ cost. Returns the model
 * that actually answered, the latency, and whether it worked. Called from the MCP `set_model` tool with `test: true`
 * (the Connections page checks for free instead: lib/connections.ts checkKey). Never logs the key, and a refusal is
 * told in plain words, never the provider's own text.
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
    const res = await doFetch(`${(chatBaseUrl(provider) ?? p.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
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
      const body = await res.text().catch(() => "");
      const kind = classifyRefusal(res.status, body);
      // Without its full stop: MCP's set_model says "The key didn't work: <this>. Nothing was saved."
      return { ok: false, status: res.status, error: `${res.status}: ${plainError(provider, kind, { model: chosen }).message.replace(/\.$/, "")}` };
    }
    return { ok: true, model: chosen, latency_ms };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: plainError(provider, timedOut ? "provider_down" : "unreachable").message.replace(/\.$/, "") };
  }
}

/**
 * Takes a key out of a slot: its job (or jobs, for an image key: portraits and clips) stops using it, and once no job
 * uses the key at all it's deleted. True when anything was removed.
 */
export async function deleteUserKey(db: Db, userId: string, provider: string, kind: KeyKind): Promise<boolean> {
  const { connections, jobs } = await listConnections(db, userId);
  const mine = jobs.filter((j) => j.provider === provider);
  const slot = mine.filter((j) => (kind === "text" ? j.job === "text" : j.job !== "text"));
  for (const j of slot) await unassignJob(db, userId, j.job);
  if (connections.some((c) => c.provider === provider) && mine.length === slot.length) return removeConnection(db, userId, provider);
  return slot.length > 0;
}

/** The provider/last4/model of each key a job uses (never the key itself), in M16's slot shape. Newest first. */
export async function listUserKeys(db: Db, userId: string): Promise<StoredKeyInfo[]> {
  const { connections, jobs } = await listConnections(db, userId);
  const out: StoredKeyInfo[] = [];
  for (const j of jobs) {
    const c = connections.find((x) => x.provider === j.provider);
    if (c) out.push({ provider: j.provider, kind: j.job === "text" ? "text" : "image", last4: c.last4, model: j.model, created_at: c.updated_at });
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/**
 * A person's key as a model, recording on its card when it last worked (once per model, so once per date) and,
 * when the provider turned it down for a reason they can fix (a bad key, no credit, a limit), what went wrong. The
 * error that leaves here never carries the key.
 */
function trackedModel(db: Db, userId: string, provider: string, apiKey: string, model: Model, modelId: string): Model {
  let used = false;
  return {
    async complete(messages, options) {
      try {
        const out = await model.complete(messages, options);
        if (!used) {
          used = true;
          await recordUse(db, userId, provider);
        }
        return out;
      } catch (err) {
        if (err instanceof ModelError) {
          const kind = refusalKind(err.status, err.message);
          if (kind) await recordError(db, userId, provider, kind, { model: modelId });
          throw new ModelError(scrubKey(err.message, apiKey), err.status);
        }
        throw err;
      }
    },
  };
}

/**
 * A user's TEXT model built from their saved key, or null if they have none (or the app can't decrypt).
 * The reasoning level is passed through so a user-key actor also keeps thinking low (their cost too).
 */
export async function userTextModel(db: Db, userId: string, reasoning?: ReasoningEffort, env: Record<string, string | undefined> = process.env): Promise<Model | null> {
  const key = await jobKey(db, userId, "text", env);
  if (!key || !isTextProvider(key.provider)) return null;
  const baseUrl = chatBaseUrl(key.provider, env) ?? TEXT_PROVIDERS[key.provider].baseUrl;
  const model = openAICompatibleModel({ baseUrl, apiKey: key.apiKey, model: key.model, reasoning });
  return trackedModel(db, userId, key.provider, key.apiKey, model, key.model);
}

/** A user's saved image key (provider + decrypted key + optional model), or null. For portrait generation. */
export async function userImageKey(
  db: Db,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ provider: string; apiKey: string; model: string | null } | null> {
  const key = await jobKey(db, userId, "image", env);
  return key ? { provider: key.provider, apiKey: key.apiKey, model: key.model } : null;
}

/** A user's Google key for intro clips (Veo, lib/video.ts): the key the Intro clips job uses. Null without one. */
export async function userVideoKey(db: Db, userId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const key = await jobKey(db, userId, "video", env);
  return key?.provider === "google" ? key.apiKey : null;
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
