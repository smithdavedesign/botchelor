/**
 * After dark: an admin-only, local-only adult mode (David, 2026-10-18). A date between the admin's own characters can
 * carry on, explicitly, in private, on a model running on the admin's own machine. Nothing it writes is stored with
 * the show's data or shown anywhere else (adult_scenes, lib/db.ts).
 *
 * It is off unless ADULT_MODE=1, and it never runs on Vercel, whatever the flag says: the public site has no way
 * in. Only a signed, signed-in admin session opens it (an old unsigned bz_uid cookie never does).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { authFromRequest, authFromCookieStore } from "../http";
import { openAICompatibleModel, type Model } from "../model";

/** Ollama's OpenAI-compatible endpoint on this machine, and an open model that writes adult fiction. */
export const ADULT_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const ADULT_DEFAULT_MODEL = "dolphin-mistral";

export function adultModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ADULT_MODE !== "1") return false;
  // Never on a deployment: the public site must not even have the route.
  if (env.VERCEL || env.VERCEL_ENV) return false;
  return true;
}

let testModel: Model | null = null;
export function setAdultModelForTests(model: Model | null): void {
  testModel = model;
}

/** The after-dark model: a local one by default (ADULT_LLM_BASE_URL / ADULT_LLM_MODEL to change it). */
export function adultModel(env: Record<string, string | undefined> = process.env): Model {
  if (testModel) return testModel;
  return openAICompatibleModel({
    baseUrl: env.ADULT_LLM_BASE_URL || ADULT_DEFAULT_BASE_URL,
    apiKey: env.ADULT_LLM_API_KEY || "local",
    model: env.ADULT_LLM_MODEL || ADULT_DEFAULT_MODEL,
    // A local model on a laptop is slow on a long prompt.
    timeoutMs: 180_000,
    retryDelaysMs: [],
  });
}

/** The admin's user id when after dark may open for this request; null for everyone and everything else. */
export async function adultViewer(db: Db, req: Request): Promise<string | null> {
  if (!adultModeEnabled()) return null;
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return null;
  return (await isAdmin(db, auth.userId)) ? auth.userId : null;
}

/** The same, for a server page (its cookie store). */
export async function adultViewerFromCookies(db: Db, store: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  if (!adultModeEnabled()) return null;
  const auth = authFromCookieStore(store);
  if (!auth?.authenticated) return null;
  return (await isAdmin(db, auth.userId)) ? auth.userId : null;
}
