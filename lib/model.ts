/**
 * The showrunner's model client: one OpenAI-compatible chat-completions call.
 *
 * Default: Google's free Gemini tier through its OpenAI-compatible endpoint, keyed by GOOGLE_API_KEY.
 * Any other free OpenAI-compatible endpoint (a LiteLLM proxy, OpenRouter ":free" models, …) works by
 * setting LLM_BASE_URL, LLM_API_KEY and LLM_MODEL. With no key configured, every call fails closed.
 */

import { safeEqual } from "./http";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * How much a model "thinks" before it answers (Gemini 3 can't turn thinking off; the default level applies when
 * none is sent). Thinking bills as output, so it's the biggest cost lever: a short in-character line needs
 * almost none (docs/upgrade-cost.md).
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** One call's token usage, as the provider billed it (output includes thinking). */
export type Usage = { model: string; input: number; cachedInput: number; output: number; thinking: number };

/** Per-call generation settings. Optional: a model may ignore them (scripted test models do). */
export type ModelOptions = {
  /** Sampling temperature: higher for spoken dialogue (variety), lower for plans and recaps (fidelity). */
  temperature?: number;
  /** Called with the call's token usage when the provider reports it (lib/pricing.ts turns it into a cost). */
  onUsage?: (usage: Usage) => void;
};

export interface Model {
  complete(messages: ChatMessage[], options?: ModelOptions): Promise<string>;
}

export class ModelError extends Error {
  override name = "ModelError";
}

export const DEFAULT_LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_LLM_MODEL = "gemini-3.5-flash-lite";
/**
 * The director plans the beat sheet and writes the recap — one or two calls a date, versus the actor's ~12.
 * It runs on a stronger free Gemini by default: the plan sets the whole date's grounding and specificity, so a
 * better director is the cheapest big lever on date quality (≈1 extra-tier call, not per-line). Used only on the
 * default Google endpoint and when neither LLM_DIRECTOR_MODEL nor a custom LLM_MODEL is set (so BYOK/custom
 * endpoints are never forced onto a Gemini model name). LLM_DIRECTOR_MODEL overrides it.
 */
export const DEFAULT_DIRECTOR_MODEL = "gemini-3.5-flash";
export const MODEL_TIMEOUT_MS = 25_000;

type UsageBody = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown };
  completion_tokens_details?: { reasoning_tokens?: unknown };
};
type CompletionResponse = { choices?: { message?: { content?: unknown } }[]; usage?: UsageBody };

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * A call's usage from the response. Google doesn't document how its OpenAI-compatible endpoint reports thinking,
 * so this reads both conventions: OpenAI counts reasoning inside completion_tokens (with a breakdown); Gemini may
 * report it only in total_tokens. Billed output is whichever is larger, so the cost is right either way.
 */
export function usageFrom(body: UsageBody | undefined, model: string): Usage | null {
  if (!body || typeof body.prompt_tokens !== "number") return null;
  const input = count(body.prompt_tokens);
  const completion = count(body.completion_tokens);
  const output = Math.max(completion, count(body.total_tokens) - input);
  const reported = body.completion_tokens_details?.reasoning_tokens;
  const thinking = typeof reported === "number" ? count(reported) : Math.max(0, output - completion);
  return { model, input, cachedInput: count(body.prompt_tokens_details?.cached_tokens), output, thinking };
}

/** Models that refused a thinking level (an endpoint or model without one): asked without it from then on. */
const noReasoning = new Set<string>();

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
  /** The thinking level to ask for (omitted: the model's default). Dropped automatically if the model refuses it. */
  reasoning?: ReasoningEffort;
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
      let useReasoning = opts.reasoning !== undefined && !noReasoning.has(opts.model);
      for (let pass = 0; ; pass++) {
        let res: Response;
        const body: Record<string, unknown> = { model: opts.model, messages, response_format: { type: "json_object" } };
        if (options?.temperature !== undefined) body.temperature = options.temperature;
        if (useReasoning) body.reasoning_effort = opts.reasoning;
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
          const reason = await errorReason(res);
          // A model or endpoint that doesn't take a thinking level: drop it (for this model, from now on) and ask again.
          if (res.status === 400 && useReasoning && pass === 0 && /reason|think/i.test(reason)) {
            noReasoning.add(opts.model);
            useReasoning = false;
            continue;
          }
          const message = `model returned HTTP ${res.status}${reason}`;
          if (res.status === 429) {
            trippedUntil = now() + RATE_LIMIT_TRIP_MS;
            trippedBy = message;
          }
          throw new ModelError(message);
        }
        const data = (await res.json().catch(() => null)) as CompletionResponse | null;
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.length === 0) throw new ModelError("model returned no text");
        const usage = usageFrom(data?.usage, opts.model);
        if (usage) options?.onUsage?.(usage);
        return content;
      }
    },
  };
}

/**
 * The thinking level for a role. The actor speaks ~12 short lines a date, so it asks for the least thinking;
 * the director's plan and recap get a little. LLM_ACTOR_REASONING / LLM_DIRECTOR_REASONING override it
 * ("default" sends none, so the model's own default applies).
 */
export function roleReasoning(role: "actor" | "director", env: Record<string, string | undefined> = process.env): ReasoningEffort | undefined {
  // Actors used to think as little as possible ("minimal"); a touch more ("low") lets them actually follow the
  // grounded-first-date instructions instead of defaulting to flowery filler, for a small per-line cost.
  const raw = (role === "actor" ? env.LLM_ACTOR_REASONING : env.LLM_DIRECTOR_REASONING) || "low";
  return (REASONING_EFFORTS as readonly string[]).includes(raw) ? (raw as ReasoningEffort) : undefined;
}

export function modelFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
  reasoning?: ReasoningEffort,
): Model {
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
  return openAICompatibleModel({ baseUrl, apiKey, model: env.LLM_MODEL || DEFAULT_LLM_MODEL, fetchImpl, reasoning });
}

let testModel: Model | null = null;

/** Tests swap in a scripted model; production reads the environment on each call. */
export function setModelForTests(model: Model | null): void {
  testModel = model;
}

/** The actor: speaks every line of the date and the morning-after texts. */
export function getModel(reasoning: ReasoningEffort | undefined = roleReasoning("actor")): Model {
  return testModel ?? modelFromEnv(process.env, undefined, reasoning);
}

/**
 * The director: the model that plans the date and writes the recap (one or two calls a date), as opposed to
 * the actor that speaks every line. LLM_DIRECTOR_MODEL puts it on a stronger model at the same endpoint and
 * key — a better plan for almost no extra quota — and it falls back to the actor's model when unset.
 */
export function getDirectorModel(
  env: Record<string, string | undefined> = process.env,
  reasoning: ReasoningEffort | undefined = roleReasoning("director", env),
): Model {
  if (testModel) return testModel;
  return modelFromEnv({ ...env, LLM_MODEL: directorModelName(env) ?? env.LLM_MODEL }, undefined, reasoning);
}

/**
 * The model name the director should run on, or undefined to use whatever the actor uses. LLM_DIRECTOR_MODEL
 * wins; otherwise, on the stock free Google setup (no custom endpoint or model), the director gets the stronger
 * DEFAULT_DIRECTOR_MODEL. A custom LLM_BASE_URL or LLM_MODEL (BYOK, a proxy, the eval's named arms) is left
 * exactly as configured, so nothing is ever forced onto a Gemini model name it can't serve.
 */
export function directorModelName(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.LLM_DIRECTOR_MODEL) return env.LLM_DIRECTOR_MODEL;
  const stockGoogle = !env.LLM_BASE_URL && !env.LLM_MODEL && !env.LLM_API_KEY;
  return stockGoogle ? DEFAULT_DIRECTOR_MODEL : undefined;
}

/** A model by name at the configured endpoint and key (the quality eval's A/B arms). */
export function namedModel(name: string, env: Record<string, string | undefined> = process.env, reasoning?: ReasoningEffort): Model {
  return modelFromEnv({ ...env, LLM_MODEL: name }, undefined, reasoning);
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
