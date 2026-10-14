import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  MAX_RETRY_AFTER_MS,
  modelFromEnv,
  ModelError,
  openAICompatibleModel,
  RETRY_DELAYS_MS,
  type ChatMessage,
} from "@/lib/model";

// Built at runtime so no credential-shaped literal sits in the repo.
const fakeKey = () => ["test", "key", "Q1w2E3r4".repeat(4)].join("-");
const messages: ChatMessage[] = [
  { role: "system", content: "You are a showrunner." },
  { role: "user", content: "Write it." },
];

function fakeFetch(response: { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const completion = (content: unknown) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("openAICompatibleModel", () => {
  it("posts the messages as an OpenAI-compatible JSON-mode chat completion and returns the content", async () => {
    const key = fakeKey();
    const { calls, fetchImpl } = fakeFetch({ body: completion('{"ok":true}') });
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1/", apiKey: key, model: "free-model", fetchImpl });

    expect(await model.complete(messages)).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://llm.example.test/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(headers.get("content-type")).toBe("application/json");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ model: "free-model", messages, response_format: { type: "json_object" } });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a ModelError on a non-2xx response", async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 400, body: { error: { message: "bad request" } } });
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl });
    await expect(model.complete(messages)).rejects.toBeInstanceOf(ModelError);
    expect(calls).toHaveLength(1); // a plain error is not retried
  });

  it("backs off and retries a rate limit (429), then gives up with a ModelError after the bounded retries", async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 429, body: { error: { message: "quota" } } });
    const waits: number[] = [];
    const model = openAICompatibleModel({
      baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl,
      sleep: async (ms) => void waits.push(ms),
    });
    await expect(model.complete(messages)).rejects.toThrow("HTTP 429");
    expect(calls).toHaveLength(1 + RETRY_DELAYS_MS.length);
    expect(waits).toEqual(RETRY_DELAYS_MS);
  });

  it("rides out a brief rate limit: 429 then 200 succeeds, honouring a capped Retry-After", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "60" } })
        : new Response(JSON.stringify(completion('{"ok":true}')), { status: 200 });
    }) as typeof fetch;
    const waits: number[] = [];
    const model = openAICompatibleModel({
      baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(await model.complete(messages)).toBe('{"ok":true}');
    expect(waits).toEqual([MAX_RETRY_AFTER_MS]); // 60s asked, capped
  });

  it("throws a ModelError when the response has no text content", async () => {
    const { fetchImpl } = fakeFetch({ body: completion(null) });
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl });
    await expect(model.complete(messages)).rejects.toBeInstanceOf(ModelError);
  });
});

describe("modelFromEnv", () => {
  it("fails closed without calling anything when no key is configured", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: completion("{}") });
    const model = modelFromEnv({}, fetchImpl);
    await expect(model.complete(messages)).rejects.toBeInstanceOf(ModelError);
    expect(calls).toHaveLength(0);
  });

  it("defaults to Gemini's free OpenAI-compatible endpoint with GOOGLE_API_KEY", async () => {
    const key = fakeKey();
    const { calls, fetchImpl } = fakeFetch({ body: completion("{}") });
    await modelFromEnv({ GOOGLE_API_KEY: key }, fetchImpl).complete(messages);
    expect(calls[0].url).toBe(`${DEFAULT_LLM_BASE_URL}/chat/completions`);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(calls[0].init.body)).model).toBe(DEFAULT_LLM_MODEL);
  });

  it("lets LLM_BASE_URL, LLM_API_KEY and LLM_MODEL point at another free endpoint (e.g. a LiteLLM proxy)", async () => {
    const key = fakeKey();
    const { calls, fetchImpl } = fakeFetch({ body: completion("{}") });
    await modelFromEnv(
      { LLM_BASE_URL: "http://localhost:4000", LLM_API_KEY: key, LLM_MODEL: "openrouter/some-free-model", GOOGLE_API_KEY: "unused" },
      fetchImpl,
    ).complete(messages);
    expect(calls[0].url).toBe("http://localhost:4000/chat/completions");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(calls[0].init.body)).model).toBe("openrouter/some-free-model");
  });
});
