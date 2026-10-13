/**
 * The showrunner's model client: one OpenAI-compatible chat-completions call.
 *
 * Default: Google's free Gemini tier through its OpenAI-compatible endpoint, keyed by GOOGLE_API_KEY.
 * Any other free OpenAI-compatible endpoint (a LiteLLM proxy, OpenRouter ":free" models, …) works by
 * setting LLM_BASE_URL, LLM_API_KEY and LLM_MODEL. With no key configured, every call fails closed.
 */

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

export function openAICompatibleModel(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Model {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async complete(messages) {
      let res: Response;
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
