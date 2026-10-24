/**
 * After dark: an admin-only adult season (David, 2026-10-18; docs/PRDs/after-dark.md). Two ways it opens:
 *  - on the site, once an admin has turned it on in its settings and saved an OpenRouter key (lib/adult/settings.ts):
 *    text on OpenRouter, pictures and clips on fal.ai;
 *  - on the admin's own machine with ADULT_MODE=1, on a local open-weight model (Ollama), never on Vercel.
 * Either way it opens only for a signed-in account canAfterDark allows (lib/adult/entitlement.ts: an admin, or an active
 * subscription with a passed age check; an old unsigned bz_uid cookie never counts), everyone else gets a 404, and
 * nothing it writes is stored with the show's data (adult_* tables only).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { authFromCookieStore, authFromRequest } from "../http";
import { openAICompatibleModel, type Model } from "../model";
import { canAfterDark } from "./entitlement";
import { pageHeaders, viewerAccess } from "./place";
import { lockedForCookies, lockedForRequest } from "./privacy";
import { adultKeys, cloudReady, getAdultSettings } from "./settings";

/** Ollama's OpenAI-compatible endpoint on this machine, and an open model that writes adult fiction. */
export const ADULT_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const ADULT_DEFAULT_MODEL = "dolphin-mistral";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The local mode: ADULT_MODE=1 on the admin's own machine, never on a deployment: not on Vercel, and not on After
 * Dark's own host (AFTER_DARK_ONLY=1, docs/after-dark-hosting.md), which has no VERCEL variable to go by.
 */
export function adultModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ADULT_MODE !== "1") return false;
  if (env.VERCEL || env.VERCEL_ENV || env.AFTER_DARK_ONLY === "1") return false;
  return true;
}

/** Whether after dark is open at all here: the local mode, or the cloud settings. */
export async function adultAvailable(db: Db, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  return adultModeEnabled(env) || (await cloudReady(db).catch(() => false));
}

let testModel: Model | null = null;
let testModelId = "test";
/** A scripted model for tests, and the id a step records for it when it reports none (adultModelId). */
export function setAdultModelForTests(model: Model | null, id = "test"): void {
  testModel = model;
  testModelId = id;
}

/** What a caller may change about the client: another OpenRouter model (the eval's A/B arms), and its patience. */
export type AdultModelOptions = { model?: string; timeoutMs?: number; retryDelaysMs?: number[] };

/**
 * The OpenRouter hosts After Dark's text may run on (terms review, 2026-10-22; docs/after-dark.md "Terms fixes"): of the
 * five hosts serving DeepSeek V3.1, the two whose terms allow it. `:nitro` alone sorts all five by throughput, so a
 * scene could land on SiliconFlow (its terms ban "obscene, pornographic, indecent" content) or SambaNova (its terms
 * bar making the service available to third parties), or on Mara, whose terms weren't reviewed. ADULT_TEXT_PROVIDERS
 * (comma-separated OpenRouter provider slugs) replaces the list; read a host's terms before adding it.
 */
export const ADULT_TEXT_PROVIDERS: readonly string[] = ["coreweave", "deepinfra"];

/** The hosts After Dark's OpenRouter calls may use: ADULT_TEXT_PROVIDERS when it names any, else the reviewed two. */
export function adultTextProviders(env: Record<string, string | undefined> = process.env): string[] {
  const named = (env.ADULT_TEXT_PROVIDERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return named.length ? named : [...ADULT_TEXT_PROVIDERS];
}

/**
 * OpenRouter's provider routing for After Dark (openrouter.ai/docs, "Provider Routing"). `only` is a hard allowlist:
 * every attempt, fallbacks included, stays on those hosts, and a model none of them serves fails with OpenRouter's 404
 * instead of landing on an unreviewed host. `sort: "throughput"` is what `:nitro` sorts by, kept explicit so CoreWeave
 * (the faster host) stays first whatever the model id says. allow_fallbacks keeps its default (true): set to false it
 * would allow only the top host, so DeepInfra could never stand in when CoreWeave fails.
 */
export function adultProviderRouting(env: Record<string, string | undefined> = process.env): { only: string[]; sort: "throughput" } {
  return { only: adultTextProviders(env), sort: "throughput" };
}

/**
 * The after-dark model: OpenRouter when its key is saved, else the local model (local mode only). On OpenRouter it asks
 * for each call's cost (usage accounting), which a ModelOptions.onUsage reads as Usage.cost, and runs only on the hosts
 * whose terms allow it (adultProviderRouting).
 */
export async function adultModel(db: Db, env: Record<string, string | undefined> = process.env, opts: AdultModelOptions = {}): Promise<Model> {
  if (testModel) return testModel;
  const { openrouter } = await adultKeys(db).catch(() => ({ openrouter: null }));
  if (openrouter) {
    const s = await getAdultSettings(db);
    return openAICompatibleModel({
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: openrouter,
      model: opts.model || s.text_model,
      timeoutMs: opts.timeoutMs ?? 120_000,
      retryDelaysMs: opts.retryDelaysMs ?? [2_000],
      extraBody: { usage: { include: true }, provider: adultProviderRouting(env) },
    });
  }
  return openAICompatibleModel({
    baseUrl: env.ADULT_LLM_BASE_URL || ADULT_DEFAULT_BASE_URL,
    apiKey: env.ADULT_LLM_API_KEY || "local",
    model: env.ADULT_LLM_MODEL || ADULT_DEFAULT_MODEL,
    // A local model on a laptop is slow on a long prompt.
    timeoutMs: 180_000,
    retryDelaysMs: [],
  });
}

/**
 * The id of the text model adultModel calls (the settings' text_model on OpenRouter, else the local model as
 * `local/<name>`): what a step records as its model when the response doesn't say which one answered.
 */
export async function adultModelId(db: Db, env: Record<string, string | undefined> = process.env, opts: Pick<AdultModelOptions, "model"> = {}): Promise<string> {
  if (testModel) return opts.model || testModelId;
  const { openrouter } = await adultKeys(db).catch(() => ({ openrouter: null }));
  if (openrouter) return opts.model || (await getAdultSettings(db)).text_model;
  return `local/${env.ADULT_LLM_MODEL || ADULT_DEFAULT_MODEL}`;
}

/**
 * Whether After Dark has a text model to call here: the saved OpenRouter key, or the local mode (a test's scripted
 * model counts). The eval route answers 503 without one rather than calling a local model that isn't there.
 */
export async function adultTextReady(db: Db, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (testModel || adultModeEnabled(env)) return true;
  return Boolean((await adultKeys(db).catch(() => ({ openrouter: null }))).openrouter);
}

/** A signed-in admin, whether or not after dark is on (the settings page itself). Null for everyone else. */
export async function signedInAdmin(db: Db, auth: { userId: string; authenticated: boolean } | null): Promise<string | null> {
  if (!auth?.authenticated) return null;
  return (await isAdmin(db, auth.userId)) ? auth.userId : null;
}

/**
 * The viewer's user id when after dark may open for them (lib/adult/entitlement.ts: an admin, or a subscribed and
 * age-checked account) and it's available here; null for everyone and everything else. Null too on a device that
 * hasn't entered the account's PIN (lib/adult/privacy.ts): every After Dark API and the media route ask here, so a
 * locked device gets the same not-found as a stranger.
 */
export async function adultViewer(db: Db, req: Request): Promise<string | null> {
  const auth = authFromRequest(req);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok || !(await adultAvailable(db))) return null;
  // 2026-10-24 (lib/jurisdiction.ts): where it isn't offered, the same not-found as for a stranger; admins are exempt.
  if ((await viewerAccess(db, auth!.userId, entitled.why === "admin", req.headers)).mode === "blocked") return null;
  return (await lockedForRequest(db, auth!.userId, req)) ? null : auth!.userId;
}

/** The same, for a server page (its cookie store). A locked device's page sees null; its layout asks for the PIN. */
export async function adultViewerFromCookies(db: Db, store: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok || !(await adultAvailable(db))) return null;
  if ((await viewerAccess(db, auth!.userId, entitled.why === "admin", await pageHeaders())).mode === "blocked") return null;
  return (await lockedForCookies(db, auth!.userId, store)) ? null : auth!.userId;
}
