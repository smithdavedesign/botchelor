/**
 * After dark: an admin-only adult season (David, 2026-10-18; docs/PRDs/after-dark.md). Two ways it opens:
 *  - on the site, once an admin has turned it on in its settings and saved an OpenRouter key (lib/adult/settings.ts):
 *    text on OpenRouter, pictures and clips on fal.ai;
 *  - on the admin's own machine with ADULT_MODE=1, on a local open-weight model (Ollama), never on Vercel.
 * Either way only a signed, signed-in admin session opens it (an old unsigned bz_uid cookie never does), everyone else
 * gets a 404, and nothing it writes is stored with the show's data (adult_* tables only).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { authFromCookieStore, authFromRequest } from "../http";
import { openAICompatibleModel, type Model } from "../model";
import { adultKeys, cloudReady, getAdultSettings } from "./settings";

/** Ollama's OpenAI-compatible endpoint on this machine, and an open model that writes adult fiction. */
export const ADULT_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const ADULT_DEFAULT_MODEL = "dolphin-mistral";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** The local mode: ADULT_MODE=1 on the admin's own machine, never on a deployment. */
export function adultModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ADULT_MODE !== "1") return false;
  if (env.VERCEL || env.VERCEL_ENV) return false;
  return true;
}

/** Whether after dark is open at all here: the local mode, or the cloud settings. */
export async function adultAvailable(db: Db, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  return adultModeEnabled(env) || (await cloudReady(db).catch(() => false));
}

let testModel: Model | null = null;
export function setAdultModelForTests(model: Model | null): void {
  testModel = model;
}

/** The after-dark model: OpenRouter when its key is saved, else the local model (local mode only). */
export async function adultModel(db: Db, env: Record<string, string | undefined> = process.env): Promise<Model> {
  if (testModel) return testModel;
  const { openrouter } = await adultKeys(db).catch(() => ({ openrouter: null }));
  if (openrouter) {
    const s = await getAdultSettings(db);
    return openAICompatibleModel({ baseUrl: OPENROUTER_BASE_URL, apiKey: openrouter, model: s.text_model, timeoutMs: 120_000, retryDelaysMs: [2_000] });
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

/** A signed-in admin, whether or not after dark is on (the settings page itself). Null for everyone else. */
export async function signedInAdmin(db: Db, auth: { userId: string; authenticated: boolean } | null): Promise<string | null> {
  if (!auth?.authenticated) return null;
  return (await isAdmin(db, auth.userId)) ? auth.userId : null;
}

/** The admin's user id when after dark may open for this request; null for everyone and everything else. */
export async function adultViewer(db: Db, req: Request): Promise<string | null> {
  const admin = await signedInAdmin(db, authFromRequest(req));
  return admin && (await adultAvailable(db)) ? admin : null;
}

/** The same, for a server page (its cookie store). */
export async function adultViewerFromCookies(db: Db, store: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  return admin && (await adultAvailable(db)) ? admin : null;
}
