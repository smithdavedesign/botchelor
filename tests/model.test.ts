import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  fallbackModel,
  MAX_RETRY_AFTER_MS,
  modelFromEnv,
  ModelError,
  openAICompatibleModel,
  paidDefaultOn,
  RATE_LIMIT_TRIP_MS,
  RETRY_DELAYS_MS,
  roleReasoning,
  usageFrom,
  type ChatMessage,
  type Model,
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

  it("puts the provider's short reason in the error (so the logs tell a burst from no quota), never a key", async () => {
    const keyShaped = ["AI", "za", "Q1w2E3r4".repeat(4)].join(""); // built at runtime: no credential-shaped literal
    const reason = `Quota exceeded for metric: free_tier_requests, limit: 0, model: m. key=${keyShaped}`;
    const { fetchImpl } = fakeFetch({ status: 429, body: [{ error: { code: 429, message: reason, status: "RESOURCE_EXHAUSTED" } }] });
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl, retryDelaysMs: [] });
    const err = await model.complete(messages).catch((e: Error) => e);
    expect(String(err)).toContain("HTTP 429 (Quota exceeded for metric: free_tier_requests, limit: 0");
    expect(String(err)).not.toContain(keyShaped);
    // No body: just the status, as before.
    const { fetchImpl: bare } = fakeFetch({ status: 503 });
    const quiet = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl: bare, retryDelaysMs: [] });
    await expect(quiet.complete(messages)).rejects.toThrow(/^model returned HTTP 503$/);
  });

  it("rides out a brief rate limit: 429 then 200 succeeds, honouring Retry-After", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "3" } })
        : new Response(JSON.stringify(completion('{"ok":true}')), { status: 200 });
    }) as typeof fetch;
    const waits: number[] = [];
    const model = openAICompatibleModel({
      baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(await model.complete(messages)).toBe('{"ok":true}');
    expect(waits).toEqual([3_000]);
  });

  it("gives up at once when waiting can't help: a longer wait than we'll spend, or the day's quota spent", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const slow = openAICompatibleModel({
      baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", sleep,
      fetchImpl: (async () => new Response("{}", { status: 429, headers: { "retry-after": String(MAX_RETRY_AFTER_MS / 1000 + 45) } })) as typeof fetch,
    });
    await expect(slow.complete(messages)).rejects.toThrow("HTTP 429");
    const daily = [{ error: { code: 429, message: "Quota exceeded.", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "500" }] }] } }];
    const { calls, fetchImpl } = fakeFetch({ status: 429, body: daily });
    const spent = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl, sleep });
    await expect(spent.complete(messages)).rejects.toThrow("HTTP 429");
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("after a refused call, fails fast for a minute instead of waiting out every call's retries", async () => {
    let clock = 1_000_000;
    const { calls, fetchImpl } = fakeFetch({ status: 429, body: { error: { message: "Resource exhausted." } } });
    const model = openAICompatibleModel({
      baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl, retryDelaysMs: [], now: () => clock,
    });
    await expect(model.complete(messages)).rejects.toThrow("HTTP 429");
    await expect(model.complete(messages)).rejects.toThrow("HTTP 429 (Resource exhausted.)"); // same reason, no request
    expect(calls).toHaveLength(1);
    clock += RATE_LIMIT_TRIP_MS;
    await expect(model.complete(messages)).rejects.toThrow("HTTP 429");
    expect(calls).toHaveLength(2); // the trip expired: it asks again
  });

  it("honours Google's own retry hint (RetryInfo), capped", async () => {
    let n = 0;
    const hint = [{ error: { code: 429, message: "Resource exhausted.", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "11s" }] } }];
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? new Response(JSON.stringify(hint), { status: 429 }) : new Response(JSON.stringify(completion('{"ok":true}')), { status: 200 });
    }) as typeof fetch;
    const waits: number[] = [];
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect(await model.complete(messages)).toBe('{"ok":true}');
    expect(waits).toEqual([11_000]);
  });

  it("doesn't retry a model with no quota at all on this key (a 429 with limit: 0)", async () => {
    const body = [{ error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: m", status: "RESOURCE_EXHAUSTED" } }];
    const { calls, fetchImpl } = fakeFetch({ status: 429, body });
    const waits: number[] = [];
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl, sleep: async (ms) => void waits.push(ms) });
    await expect(model.complete(messages)).rejects.toThrow(/HTTP 429 \(Quota exceeded .*limit: 0/);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("reports each call's usage, reading both ways providers count thinking", async () => {
    const seen: unknown[] = [];
    // OpenAI's convention: reasoning inside completion_tokens, with a breakdown.
    const openai = { ...completion("{}"), usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300, completion_tokens_details: { reasoning_tokens: 200 }, prompt_tokens_details: { cached_tokens: 400 } } };
    const { fetchImpl } = fakeFetch({ body: openai });
    await openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m", fetchImpl }).complete(messages, { onUsage: (u) => seen.push(u) });
    expect(seen[0]).toEqual({ model: "m", input: 1000, cachedInput: 400, output: 300, thinking: 200 });
    // Thinking reported only in the total: billed output is the larger figure.
    expect(usageFrom({ prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1350 }, "g")).toEqual({ model: "g", input: 1000, cachedInput: 0, output: 350, thinking: 250 });
    expect(usageFrom(undefined, "g")).toBeNull();
  });

  it("asks for the role's thinking level, and drops it for good if the model refuses it", async () => {
    const bodies: Record<string, unknown>[] = [];
    let refused = false;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.reasoning_effort && !refused) {
        refused = true;
        return new Response(JSON.stringify({ error: { message: "reasoning_effort is not supported for this model" } }), { status: 400 });
      }
      return new Response(JSON.stringify(completion('{"ok":true}')), { status: 200 });
    }) as typeof fetch;
    const name = `refuser-${Math.random()}`;
    const model = openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: name, fetchImpl, reasoning: "minimal" });
    expect(await model.complete(messages)).toBe('{"ok":true}');
    expect(bodies.map((b) => b.reasoning_effort)).toEqual(["minimal", undefined]); // refused, then asked without
    await openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: name, fetchImpl, reasoning: "minimal" }).complete(messages);
    expect(bodies.at(-1)?.reasoning_effort).toBeUndefined(); // remembered for this model
    // Any other 400 is a real error, not retried.
    const { calls, fetchImpl: bad } = fakeFetch({ status: 400, body: { error: { message: "invalid messages" } } });
    await expect(openAICompatibleModel({ baseUrl: "https://llm.example.test/v1", apiKey: fakeKey(), model: "m2", fetchImpl: bad, reasoning: "low" }).complete(messages)).rejects.toThrow("HTTP 400");
    expect(calls).toHaveLength(1);
  });

  it("gives the actor and director a little thinking by default, overridable per role", () => {
    // Actors used to think as little as possible ("minimal"); they now get "low" too, so they actually follow
    // the grounded-first-date instructions instead of reaching for flowery filler.
    expect(roleReasoning("actor", {})).toBe("low");
    expect(roleReasoning("director", {})).toBe("low");
    expect(roleReasoning("actor", { LLM_ACTOR_REASONING: "medium" })).toBe("medium");
    expect(roleReasoning("director", { LLM_DIRECTOR_REASONING: "default" })).toBeUndefined(); // the model's own default
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

describe("paid-model default with free fallback", () => {
  const FRONTIER = { FRONTIER_LLM_BASE_URL: "https://gw", FRONTIER_LLM_API_KEY: "k", FRONTIER_LLM_MODEL: "anthropic/claude-haiku" };

  it("paidDefaultOn needs the flag AND a configured frontier model", () => {
    expect(paidDefaultOn({})).toBe(false);
    expect(paidDefaultOn({ FRONTIER_DEFAULT: "1" })).toBe(false); // flag on but nothing configured
    expect(paidDefaultOn({ ...FRONTIER })).toBe(false); // configured but flag off → still $0
    expect(paidDefaultOn({ FRONTIER_DEFAULT: "1", ...FRONTIER })).toBe(true);
  });

  it("fallbackModel uses the paid result normally", async () => {
    const paid: Model = { async complete() { return "paid line"; } };
    const free: Model = { async complete() { return "free line"; } };
    expect(await fallbackModel(paid, free).complete(messages)).toBe("paid line");
  });

  it("falls back to free when the paid model errors (spent budget / down), so a date never breaks", async () => {
    const paid: Model = { async complete() { throw new ModelError("budget exceeded"); } };
    const free: Model = { async complete() { return "free line"; } };
    expect(await fallbackModel(paid, free).complete(messages)).toBe("free line");
  });

  it("does not swallow a non-ModelError (a real bug still surfaces)", async () => {
    const paid: Model = { async complete() { throw new TypeError("boom"); } };
    const free: Model = { async complete() { return "free line"; } };
    await expect(fallbackModel(paid, free).complete(messages)).rejects.toBeInstanceOf(TypeError);
  });
})
