/**
 * The showrunner's model client: one OpenAI-compatible chat-completions call.
 *
 * Default: Google's free Gemini tier through its OpenAI-compatible endpoint, keyed by GOOGLE_API_KEY.
 * Any other free OpenAI-compatible endpoint (a LiteLLM proxy, OpenRouter ":free" models, …) works by
 * setting LLM_BASE_URL, LLM_API_KEY and LLM_MODEL. With no key configured, every call fails closed.
 */

import { safeEqual } from "./http";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Per-call generation settings. Optional: a model may ignore them (scripted test models do). */
export type ModelOptions = {
  /** Sampling temperature: higher for spoken dialogue (variety), lower for plans and recaps (fidelity). */
  temperature?: number;
};

export interface Model {
  complete(messages: ChatMessage[], options?: ModelOptions): Promise<string>;
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
/**
 * Backoff before each retry of a retryable status. Bounded, so a generation job can't stall for long; the
 * last, longer wait is what rides out a free tier's per-minute window (a date makes ~14 calls in a row).
 */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
/** The most we'll honour from the server's own retry hint (a Retry-After header, or Google's retryDelay). */
export const MAX_RETRY_AFTER_MS = 15_000;
const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * After the provider refuses a call for good with a 429, later calls on the same client fail at once for this
 * long instead of each waiting out its own retries: a date is ~14 calls, and a spent quota won't come back
 * mid-date (each waited-out call would add ~20s to a date that fails anyway).
 */
export const RATE_LIMIT_TRIP_MS = 60_000;

type ErrorDetail = { retryDelay?: unknown; violations?: { quotaValue?: unknown; quotaId?: unknown }[] };
type ErrorBody = { error?: { message?: unknown; status?: unknown; details?: ErrorDetail[] } };

/** The error object of a refusal's JSON body (Google sometimes wraps it in an array), or null. */
async function refusal(res: Response): Promise<ErrorBody["error"] | null> {
  const body = (await res.json().catch(() => null)) as ErrorBody | ErrorBody[] | null;
  return (Array.isArray(body) ? body[0]?.error : body?.error) ?? null;
}

/**
 * How to handle a retryable refusal. Stop at once when waiting can't help: the model has no quota at all on
 * this key (Google answers 429 with "limit: 0" for a model outside the free tier), the day's quota is spent
 * (a "…PerDay…" quota), or the server asks for a longer wait than we're willing to spend. Otherwise wait the
 * server's hint (Retry-After, or Google's RetryInfo "17s"), else the backoff.
 */
async function retryPlan(res: Response, fallbackMs: number): Promise<{ stop: true } | { stop: false; waitMs: number }> {
  const err = await refusal(res.clone());
  const message = typeof err?.message === "string" ? err.message : "";
  const violations = (err?.details ?? []).flatMap((d) => d.violations ?? []);
  const noQuota = /limit:\s*0\b/.test(message) || violations.some((v) => String(v.quotaValue) === "0");
  const dailySpent = violations.some((v) => /PerDay/i.test(String(v.quotaId ?? "")));
  if (noQuota || dailySpent) return { stop: true };
  const header = Number(res.headers.get("retry-after"));
  const hinted = (err?.details ?? []).map((d) => (typeof d.retryDelay === "string" ? parseFloat(d.retryDelay) : NaN)).find(Number.isFinite);
  const seconds = Number.isFinite(header) && header > 0 ? header : hinted !== undefined && hinted > 0 ? hinted : null;
  if (seconds === null) return { stop: false, waitMs: fallbackMs };
  return seconds * 1000 > MAX_RETRY_AFTER_MS ? { stop: true } : { stop: false, waitMs: seconds * 1000 };
}

/**
 * The provider's own short reason for a refusal, for the logs: it tells a per-minute burst from a model with
 * no free-tier quota at all ("… limit: 0"). Trimmed, and scrubbed of anything shaped like a Google key.
 */
async function errorReason(res: Response): Promise<string> {
  const err = await refusal(res);
  const text = typeof err?.message === "string" ? err.message : typeof err?.status === "string" ? err.status : "";
  const clean = text.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 160);
  return clean ? ` (${clean})` : "";
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
  /** Injectable clock for tests (the rate-limit trip). */
  now?: () => number;
}): Model {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetchImpl ?? fetch;
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  let trippedUntil = 0;
  let trippedBy = "";
  return {
    async complete(messages, options) {
      if (now() < trippedUntil) throw new ModelError(trippedBy);
      let res: Response;
      const body: Record<string, unknown> = { model: opts.model, messages, response_format: { type: "json_object" } };
      if (options?.temperature !== undefined) body.temperature = options.temperature;
      // A free tier answers 429 when a burst of calls (a date is ~13 in a row) crosses its per-minute quota;
      // a short, bounded backoff rides that out instead of losing the whole conversation to one refusal.
      for (let attempt = 0; ; attempt++) {
        try {
          res = await doFetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(opts.timeoutMs ?? MODEL_TIMEOUT_MS),
          });
        } catch (err) {
          throw new ModelError(`model request failed (${err instanceof Error ? err.name : "unknown"})`);
        }
        if (!RETRYABLE_STATUS.has(res.status) || attempt >= delays.length) break;
        const plan = await retryPlan(res, delays[attempt]);
        if (plan.stop) break;
        await res.body?.cancel().catch(() => {}); // free the connection while we wait
        await sleep(plan.waitMs);
      }
      if (!res.ok) {
        const message = `model returned HTTP ${res.status}${await errorReason(res)}`;
        if (res.status === 429) {
          trippedUntil = now() + RATE_LIMIT_TRIP_MS;
          trippedBy = message;
        }
        throw new ModelError(message);
      }
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

/**
 * The director: the model that plans the date and writes the recap (one or two calls a date), as opposed to
 * the actor that speaks every line. LLM_DIRECTOR_MODEL puts it on a stronger model at the same endpoint and
 * key — a better plan for almost no extra quota — and it falls back to the actor's model when unset.
 */
export function getDirectorModel(env: Record<string, string | undefined> = process.env): Model {
  if (testModel) return testModel;
  return env.LLM_DIRECTOR_MODEL ? modelFromEnv({ ...env, LLM_MODEL: env.LLM_DIRECTOR_MODEL }) : modelFromEnv(env);
}

/** A model by name at the configured endpoint and key (the quality eval's A/B arms). */
export function namedModel(name: string, env: Record<string, string | undefined> = process.env): Model {
  return modelFromEnv({ ...env, LLM_MODEL: name });
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
