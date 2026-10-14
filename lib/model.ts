/**
 * The showrunner's model client: one OpenAI-compatible chat-completions call.
 *
 * Default: Google's free Gemini tier through its OpenAI-compatible endpoint, keyed by GOOGLE_API_KEY.
 * Any other free OpenAI-compatible endpoint (a LiteLLM proxy, OpenRouter ":free" models, …) works by
 * setting LLM_BASE_URL, LLM_API_KEY and LLM_MODEL. With no key configured, every call fails closed.
 */

import { safeEqual } from "./http";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface Model {
  complete(messages: ChatMessage[]): Promise<string>;
}

export class ModelError extends Error {
  override name = "ModelError";
}

export const DEFAULT_LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_LLM_MODEL = "gemini-3.5-flash-lite";
export const MODEL_TIMEOUT_MS = 25_000;

type CompletionResponse = { choices?: { message?: { content?: unknown } }[] };

/** Statuses that mean "slow down / try again shortly" (a free tier's per-minute quota, a busy upstream). */
const RETRYABLE_STATUS = new Set([429, 503]);
/** Backoff before each retry of a retryable status. Bounded, so a generation job can't stall for long. */
export const RETRY_DELAYS_MS = [2_000, 5_000];
/** The most we'll honour from a Retry-After header. */
export const MAX_RETRY_AFTER_MS = 8_000;
const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** How long to wait before a retry: the server's Retry-After (seconds) when given, capped; else the backoff. */
function retryDelay(res: Response, fallbackMs: number): number {
  const after = Number(res.headers.get("retry-after"));
  return Number.isFinite(after) && after > 0 ? Math.min(after * 1000, MAX_RETRY_AFTER_MS) : fallbackMs;
}

export function openAICompatibleModel(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Backoff before each retry of a 429/503 (default RETRY_DELAYS_MS); [] disables retries. */
  retryDelaysMs?: number[];
  /** Injectable for tests, so a retry doesn't really wait. */
  sleep?: (ms: number) => Promise<void>;
}): Model {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetchImpl ?? fetch;
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;
  return {
    async complete(messages) {
      let res: Response;
      // A free tier answers 429 when a burst of calls (a date is ~13 in a row) crosses its per-minute quota;
      // a short, bounded backoff rides that out instead of losing the whole conversation to one refusal.
      for (let attempt = 0; ; attempt++) {
        try {
          res = await doFetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ model: opts.model, messages, response_format: { type: "json_object" } }),
            signal: AbortSignal.timeout(opts.timeoutMs ?? MODEL_TIMEOUT_MS),
          });
        } catch (err) {
          throw new ModelError(`model request failed (${err instanceof Error ? err.name : "unknown"})`);
        }
        if (!RETRYABLE_STATUS.has(res.status) || attempt >= delays.length) break;
        await sleep(retryDelay(res, delays[attempt]));
      }
      if (!res.ok) throw new ModelError(`model returned HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as CompletionResponse | null;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) throw new ModelError("model returned no text");
      return content;
    },
  };
}

export function modelFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): Model {
  const baseUrl = env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL;
  // The Google key is only ever sent to Google's endpoint, never to a custom LLM_BASE_URL.
  const apiKey = env.LLM_API_KEY || (baseUrl === DEFAULT_LLM_BASE_URL ? env.GOOGLE_API_KEY : undefined);
  if (!apiKey) {
    return {
      async complete() {
        throw new ModelError("no model is configured (set GOOGLE_API_KEY, or LLM_BASE_URL and LLM_API_KEY)");
      },
    };
  }
  return openAICompatibleModel({ baseUrl, apiKey, model: env.LLM_MODEL || DEFAULT_LLM_MODEL, fetchImpl });
}

let testModel: Model | null = null;

/** Tests swap in a scripted model; production reads the environment on each call. */
export function setModelForTests(model: Model | null): void {
  testModel = model;
}

export function getModel(): Model {
  return testModel ?? modelFromEnv();
}

/* ------------------------------------------------------------------ *
 * Frontier model: a better, paid model, GATED behind an admin password (the owner's approval, 2026-10-13).
 *
 * Off by default: every normal request uses the free model above, so marginal cost stays $0. The frontier
 * model is used only when FRONTIER_LLM_* is configured AND the request carries the matching x-frontier-key
 * header, so spend is limited to explicitly authorized runs ("a handful of examples"). Keys come from the
 * environment (keychain / Vercel), never from code, and the password is compared in constant time.
 * ------------------------------------------------------------------ */

export const frontierConfigured = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.FRONTIER_LLM_BASE_URL && env.FRONTIER_LLM_API_KEY && env.FRONTIER_LLM_MODEL);

export function frontierModelFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): Model | null {
  if (!frontierConfigured(env)) return null;
  return openAICompatibleModel({ baseUrl: env.FRONTIER_LLM_BASE_URL!, apiKey: env.FRONTIER_LLM_API_KEY!, model: env.FRONTIER_LLM_MODEL!, fetchImpl });
}

/** True only when a frontier password is set and the request carries the matching x-frontier-key header. */
export function frontierAuthorized(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  const pw = env.FRONTIER_PASSWORD;
  if (!pw) return false;
  const given = req.headers.get("x-frontier-key") ?? "";
  return given.length > 0 && safeEqual(given, pw);
}

let testFrontierModel: Model | null = null;
export function setFrontierModelForTests(model: Model | null): void {
  testFrontierModel = model;
}
export function getFrontierModel(): Model | null {
  return testFrontierModel ?? frontierModelFromEnv();
}

/**
 * The model for one live episode: the frontier model only when the request is authorized (a valid
 * x-frontier-key, i.e. the owner's approval) AND a frontier model exists; otherwise the free model.
 * So every normal request stays on the free model and marginal cost is $0 — only the owner's authorized
 * requests spend on the frontier model. This is the same gate the admin tool uses, now in the live flow.
 */
export function episodeModel(req: Request, env: Record<string, string | undefined> = process.env): Model {
  if (frontierAuthorized(req, env)) {
    const frontier = getFrontierModel();
    if (frontier) return frontier;
  }
  return getModel();
}
