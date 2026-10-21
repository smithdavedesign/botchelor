// The eval judge's safety (scripts/eval/local-judge.mjs, a copy of the crowd brain's #544 check): only a LiteLLM alias
// served by Ollama on this Mac with no fallbacks, every request with disable_fallbacks, and every answer's headers naming
// a local deployment, or it refuses. A fake LiteLLM (fetchImpl) stands in: nothing real is called.
import { describe, expect, it } from "vitest";
import { checkLocalAlias, checkLocalResponse, createLocalJudge, isLocalUrl, LocalJudgeError } from "../scripts/eval/local-judge.mjs";

// The shape of ~/ai-stack/litellm/config.yaml: local-coder ends at paid Claude through its fallbacks.
const CONFIG = [
  "model_list:",
  "  - model_name: local-qwen3",
  "    litellm_params:",
  "      model: ollama_chat/qwen3:8b",
  "      api_base: http://host.docker.internal:11434",
  "  - model_name: local-uncensored",
  "    litellm_params:",
  "      model: ollama_chat/dolphin-mistral",
  "      api_base: http://host.docker.internal:11434",
  "      num_ctx: 16384",
  "  - model_name: local-coder",
  "    litellm_params:",
  "      model: ollama_chat/qwen2.5:7b-coding",
  "      api_base: http://host.docker.internal:11434",
  "  - model_name: cloud-smart",
  "    litellm_params:",
  "      model: anthropic/claude-sonnet-4-6",
  "  - model_name: free-agent-c",
  "    litellm_params:",
  "      model: openai/nemotron-3-super",
  "      api_base: https://ollama.com/v1",
  "  - model_name: ollama-cloud",
  "    litellm_params:",
  "      model: ollama_chat/gpt-oss:120b-cloud",
  "      api_base: http://localhost:11434",
  "router_settings:",
  "  fallbacks:",
  '    - local-coder: ["free-agent", "cloud-smart"]',
].join("\n");
const KEY = ["fake", "litellm", "key"].join("-");
const LOCAL = { "x-litellm-model-name": "ollama_chat/dolphin-mistral", "x-litellm-model-api-base": "http://host.docker.internal:11434", "x-litellm-attempted-fallbacks": "0", "x-litellm-response-cost": "0.0" };

type Reply = { status?: number; headers?: Record<string, string>; content?: string };
/** A fake LiteLLM: /models lists the aliases, /chat/completions answers with `reply`. Records every request. */
function fakeLiteLLM(reply: () => Reply = () => ({ content: '{"winner":"A"}' }), models = ["local-uncensored", "local-qwen3", "local-coder"]) {
  const requests: { url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = ((init?.headers as Record<string, string>) ?? {}).authorization ?? null;
    requests.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null, auth });
    if (url.endsWith("/models")) return Response.json({ data: models.map((id) => ({ id })) });
    const r = reply();
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: r.content ?? "" } }] }), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...LOCAL, ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}
const judgeOn = (o: Partial<Parameters<typeof createLocalJudge>[0]> = {}, fake = fakeLiteLLM()) =>
  createLocalJudge({ baseUrl: "http://127.0.0.1:4000/v1", key: KEY, model: "local-uncensored", configText: CONFIG, fetchImpl: fake.fetchImpl, ...o });

describe("which LiteLLM aliases the judge may use", () => {
  it("only Ollama on this Mac, with no fallbacks that could reach a cloud model", () => {
    expect(checkLocalAlias(CONFIG, "local-uncensored")).toMatchObject({ ok: true });
    expect(checkLocalAlias(CONFIG, "local-qwen3")).toMatchObject({ ok: true });
    expect(checkLocalAlias(CONFIG, "local-coder").reason).toMatch(/fallbacks/);
    expect(checkLocalAlias(CONFIG, "cloud-smart").reason).toMatch(/not a local Ollama model/);
    expect(checkLocalAlias(CONFIG, "free-agent-c").reason).toMatch(/not a local Ollama model/);
    expect(checkLocalAlias(CONFIG, "ollama-cloud").reason).toMatch(/Ollama cloud model/);
    expect(checkLocalAlias(CONFIG, "nope").reason).toMatch(/isn't in the LiteLLM config/);
    expect(checkLocalAlias(`${CONFIG}\n  default_fallbacks: ["cloud-smart"]`, "local-uncensored").reason).toMatch(/default_fallbacks/);
    expect(checkLocalAlias(CONFIG.replace("http://host.docker.internal:11434\n      num_ctx", "https://ollama.example.com\n      num_ctx"), "local-uncensored").reason).toMatch(/not this Mac/);
    expect(checkLocalAlias(CONFIG, "local uncensored; rm").ok).toBe(false);
    expect(checkLocalAlias(null, "local-uncensored").ok).toBe(false); // fails closed
  });

  it("a local URL is this Mac", () => {
    expect(isLocalUrl("http://127.0.0.1:4000/v1")).toBe(true);
    expect(isLocalUrl("http://host.docker.internal:11434")).toBe(true);
    expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });
});

describe("creating the judge refuses before anything is sent", () => {
  it("an alias with a cloud fallback, a remote base, no key, no LiteLLM, or an alias LiteLLM doesn't serve", async () => {
    const fake = fakeLiteLLM();
    await expect(judgeOn({ model: "local-coder" }, fake)).rejects.toThrow(/judge model refused: local-coder has fallbacks/);
    await expect(judgeOn({ model: "cloud-smart" }, fake)).rejects.toThrow(/not a local Ollama model/);
    await expect(judgeOn({ baseUrl: "https://litellm.example.com/v1" }, fake)).rejects.toThrow(/isn't this Mac/);
    await expect(judgeOn({ key: null }, fake)).rejects.toThrow(/no LiteLLM key/);
    await expect(judgeOn({ configText: null, configPath: "/nonexistent/config.yaml" }, fake)).rejects.toThrow(/can't read the LiteLLM config/);
    expect(fake.requests).toHaveLength(0); // all of the above refused without a request
    await expect(judgeOn({}, fakeLiteLLM(undefined, ["local-qwen3"]))).rejects.toThrow(/doesn't serve local-uncensored/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(createLocalJudge({ baseUrl: "http://127.0.0.1:4000/v1", key: KEY, model: "local-uncensored", configText: CONFIG, fetchImpl: down })).rejects.toThrow(LocalJudgeError);
  });
});

describe("every answer is checked to have come from this Mac", () => {
  it("asks with disable_fallbacks and the key, and returns the text from a local deployment", async () => {
    const fake = fakeLiteLLM();
    const judge = await judgeOn({}, fake);
    expect(await judge.complete([{ role: "user", content: "Which is better?" }])).toBe('{"winner":"A"}');
    const ask = fake.requests.find((r) => r.url.endsWith("/chat/completions"))!;
    expect(ask.body).toMatchObject({ model: "local-uncensored", disable_fallbacks: true, stream: false });
    expect(ask.auth).toBe(`Bearer ${KEY}`);
  });

  it("an answer from a cloud deployment, a fallback, a cost or no deployment header switches the judge off for good", async () => {
    const bad: Record<string, string>[] = [
      { "x-litellm-model-name": "anthropic/claude-sonnet-4-6", "x-litellm-model-api-base": "https://api.anthropic.com" },
      { "x-litellm-attempted-fallbacks": "1" },
      { "x-litellm-response-cost": "0.0021" },
      { "x-litellm-model-name": "ollama_chat/gpt-oss:120b-cloud" },
    ];
    for (const headers of bad) {
      let n = 0;
      const judge = await judgeOn({}, fakeLiteLLM(() => (n++ === 0 ? { headers, content: "{}" } : { content: "{}" })));
      const first = await judge.complete([{ role: "user", content: "?" }]).catch((e) => e);
      expect(first).toBeInstanceOf(LocalJudgeError);
      expect(first.fatal).toBe(true);
      // Off for the rest of the run, even when the next answer would look local.
      await expect(judge.complete([{ role: "user", content: "?" }])).rejects.toThrow(/switched itself off/);
    }
  });

  it("requires the deployment header: an answer that doesn't say where it came from isn't used", async () => {
    const fetchImpl = (async (input: string | URL | Request) =>
      String(input).endsWith("/models")
        ? Response.json({ data: [{ id: "local-uncensored" }] })
        : Response.json({ choices: [{ message: { content: '{"winner":"B"}' } }] })) as typeof fetch;
    const judge = await createLocalJudge({ baseUrl: "http://127.0.0.1:4000/v1", key: KEY, model: "local-uncensored", configText: CONFIG, fetchImpl });
    await expect(judge.complete([{ role: "user", content: "?" }])).rejects.toThrow(/no x-litellm-model-api-base header/);
    expect(checkLocalResponse(new Headers(LOCAL))).toEqual({ ok: true, reason: null });
    expect(checkLocalResponse({ "x-litellm-model-api-base": "http://127.0.0.1:11434" })).toEqual({ ok: true, reason: null });
  });

  it("a failed request is an error for that call, not a reason to switch off", async () => {
    let n = 0;
    const judge = await judgeOn({}, fakeLiteLLM(() => (n++ === 0 ? { status: 500, headers: { "x-litellm-model-api-base": "" } } : { content: "ok" })));
    const err = await judge.complete([{ role: "user", content: "?" }]).catch((e) => e);
    expect(err).toBeInstanceOf(LocalJudgeError);
    expect(err.fatal).toBe(false);
    expect(await judge.complete([{ role: "user", content: "?" }])).toBe("ok");
  });
});
