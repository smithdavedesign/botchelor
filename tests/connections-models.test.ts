import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FeelPicker, { feelValue } from "@/app/account/keys/FeelPicker";
import ModelPicker, { SHOWN } from "@/app/account/keys/ModelPicker";
import { GET as getModels } from "@/app/api/me/connections/models/route";
import { POST as postCheck } from "@/app/api/me/connections/check/route";
import { PUT as putConnection } from "@/app/api/me/connections/route";
import { registerAccount } from "@/lib/auth";
import { assignJob, jobKey, listConnections, modelsFor, OPENROUTER_LIST_TTL_MS, openRouterModels, resetModelCacheForTests, saveConnection } from "@/lib/connections";
import {
  BOUNDS,
  clampSetting,
  DATE_TOKENS,
  DIALOGUE_TEMPERATURE,
  feelLabel,
  jobCards,
  modelFitsJob,
  modelOptions,
  perDateHint,
  PRESETS,
  samplingFor,
  tagsFor,
} from "@/lib/connections-shared";
import { TURN_TEMPERATURE } from "@/lib/conversation";
import { userTextModel, withSampling } from "@/lib/keys";
import type { Model, ModelOptions } from "@/lib/model";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// Connections M2 (docs/PRDs/connections.md): the models a key can use, tagged and priced, cached; the feel (presets and
// Advanced, within bounds); and both wired into the calls a person's key makes. Every provider is stubbed.

const U = "eeee5555-0000-4000-8000-000000000005";
const fakeKey = (tag: string) => ["test", "key", "not", "real", tag, "1357"].join("-");
const legacyEnv = { SESSION_SECRET: TEST_SESSION_SECRET };

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
let cookie = "";
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from accounts");
  resetModelCacheForTests();
  resetRateLimitsForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  await registerAccount(t.db, U, "modelpicker", ["a", "good", "password"].join("-"));
  cookie = signedInCookie(U);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** OpenRouter's public list as its API shapes it: per-token prices as strings, modalities. */
const OPENROUTER_LIST = {
  data: [
    { id: "openai/gpt-4.1-mini", name: "OpenAI: GPT-4.1 Mini", pricing: { prompt: "0.0000004", completion: "0.0000016" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
    { id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek: DeepSeek V3.1", pricing: { prompt: "0.00000027", completion: "0.0000011" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    { id: "deepseek/deepseek-chat-v3.1:free", name: "DeepSeek: DeepSeek V3.1 (free)", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    { id: "openai/text-embedding-3-small", name: "Embedding", pricing: { prompt: "0.00000002", completion: "0" } },
    { id: "black-forest-labs/flux-1.1-pro", name: "FLUX", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
  ],
};
/** A fetch that serves OpenRouter's list and counts the calls; anything else is refused (no real network). */
function openRouterStub(answer: () => Response = () => jsonRes(OPENROUTER_LIST)) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return answer();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("price hints and tags", () => {
  it("prices one date's worth of lines on the key: about 30k tokens in and 1.5k out", () => {
    expect(DATE_TOKENS).toEqual({ input: 30_000, output: 1_500 });
    expect(perDateHint(null)).toBeNull();
    expect(perDateHint({ input: 0, output: 0 })).toBe("free");
    expect(perDateHint({ input: 0.28, output: 0.42 })).toBe("≈ 0.9¢ a date");
    expect(perDateHint({ input: 2, output: 8 })).toBe("≈ 7¢ a date");
    expect(perDateHint({ input: 5, output: 25 })).toBe("≈ 19¢ a date");
    expect(perDateHint({ input: 60, output: 240 })).toBe("≈ $2.16 a date");
    expect(perDateHint({ input: 0.01, output: 0.01 })).toBe("≈ 0.1¢ a date"); // never "0¢"
  });

  it("tags free, fast and vision from the id and provider", () => {
    expect(tagsFor("groq", "llama-3.3-70b-versatile")).toEqual(["fast"]);
    expect(tagsFor("google", "gemini-3.5-flash-lite")).toEqual(["free", "fast", "vision"]);
    expect(tagsFor("deepseek", "deepseek-chat")).toEqual([]);
    expect(tagsFor("openrouter", "meta-llama/llama-3.3-70b-instruct:free")).toEqual(["free"]);
    expect(tagsFor("openrouter", "openai/gpt-4.1-mini", { recommended: true })).toEqual(["recommended", "fast", "vision"]);
    expect(tagsFor("openrouter", "x/whatever", { free: true, vision: true })).toEqual(["free", "vision"]);
  });

  it("keeps each job to the models that can do it", () => {
    for (const id of ["gpt-4.1-mini", "claude-haiku-5-5", "gemini-3.5-flash", "deepseek-chat", "llama-3.3-70b-versatile"]) expect(modelFitsJob("text", id), id).toBe(true);
    for (const id of ["text-embedding-3-small", "tts-1", "whisper-large-v3", "dall-e-3", "gpt-image-2", "gpt-4o-realtime-preview", "omni-moderation-latest", "llama-guard-4", "veo-3.1-lite-generate-preview", "gemini-embedding-001", "gpt-3.5-turbo-instruct"]) {
      expect(modelFitsJob("text", id), id).toBe(false);
    }
    expect(modelFitsJob("image", "gpt-image-2")).toBe(true);
    expect(modelFitsJob("image", "gpt-image-1")).toBe(false); // retired: it runs gpt-image-2 anyway (lib/image.ts)
    expect(modelFitsJob("image", "dall-e-3")).toBe(false);
    expect(modelFitsJob("video", "veo-3.1-lite-generate-preview")).toBe(true);
  });

  it("lists the curated models first (Recommended at the top), then the key's own, sorted; with no list, the curated ones", () => {
    const listed = ["gpt-5-nano", "text-embedding-3-large", "gpt-4.1-mini", "gpt-4.1-nano", "tts-1"];
    const options = modelOptions("openai", "text", listed);
    expect(options.map((o) => o.id)).toEqual(["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-4.1-nano", "gpt-5-nano"]);
    expect(options[0]).toMatchObject({ tags: expect.arrayContaining(["recommended"]), perDate: "≈ 1¢ a date", price: { input: 0.4, output: 1.6 } });
    expect(options.find((o) => o.id === "gpt-4.1-nano")).toMatchObject({ price: null, perDate: null, note: null });
    expect(modelOptions("openai", "text", null).map((o) => o.id)).toEqual(["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini"]);
    expect(modelOptions("google", "video", ["veo-3.1-generate-preview", "veo-3.1-lite-generate-preview"]).map((o) => o.id)).toEqual(["veo-3.1-lite-generate-preview"]);
    expect(modelOptions("openai", "image", ["gpt-image-1", "gpt-image-2", "dall-e-3"]).map((o) => o.id)).toEqual(["gpt-image-2"]);
  });
});

describe("OpenRouter's live list", () => {
  it("reads each model's own prices and modalities, keeps text-out chat models only, and sends no key", async () => {
    const { fetchImpl, calls } = openRouterStub();
    const models = (await openRouterModels({ fetchImpl }))!;
    expect(models.map((m) => m.id)).toEqual(["openai/gpt-4.1-mini", "deepseek/deepseek-chat-v3.1", "deepseek/deepseek-chat-v3.1:free", "qwen/qwen3-235b-a22b"]);
    // Its own name, its own prices; the curated pick is Recommended here too.
    expect(models[0]).toMatchObject({ note: "OpenAI: GPT-4.1 Mini", price: { input: 0.4, output: 1.6 }, tags: ["recommended", "fast", "vision"], perDate: "≈ 1¢ a date" });
    expect(models[2]).toMatchObject({ tags: ["free"], perDate: "free" });
    expect(models[3].tags).toContain("free"); // both prices 0
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/models");
    expect(calls[0].headers.get("authorization")).toBeNull();
  });

  it("is reused for an hour, then fetched again; a failure is null (the curated list stands in)", async () => {
    const { fetchImpl, calls } = openRouterStub();
    const now = Date.parse("2026-10-23T12:00:00Z");
    await openRouterModels({ fetchImpl, now });
    await openRouterModels({ fetchImpl, now: now + OPENROUTER_LIST_TTL_MS - 1 });
    expect(calls).toHaveLength(1);
    await openRouterModels({ fetchImpl, now: now + OPENROUTER_LIST_TTL_MS + 1 });
    expect(calls).toHaveLength(2);
    resetModelCacheForTests();
    expect(await openRouterModels({ fetchImpl: openRouterStub(() => jsonRes({ error: "down" }, 503)).fetchImpl })).toBeNull();
    expect(await openRouterModels({ fetchImpl: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch })).toBeNull();
  });

  it("modelsFor: the curated ones first with OpenRouter's own prices, then the rest; curated alone when the list is down", async () => {
    const { fetchImpl } = openRouterStub();
    const live = await modelsFor(null, null, "openrouter", "text", { fetchImpl });
    expect(live.source).toBe("provider");
    expect(live.models[0]).toMatchObject({ id: "openai/gpt-4.1-mini", note: "route to OpenAI, pay by usage", tags: ["recommended", "fast", "vision"], price: { input: 0.4, output: 1.6 } });
    expect(live.models.map((m) => m.id)).toContain("deepseek/deepseek-chat-v3.1:free");
    resetModelCacheForTests();
    const down = await modelsFor(null, null, "openrouter", "text", { fetchImpl: openRouterStub(() => jsonRes({}, 500)).fetchImpl });
    expect(down.source).toBe("curated");
    expect(down.models.map((m) => m.id)).toEqual(["openai/gpt-4.1-mini", "anthropic/claude-haiku-5-5", "deepseek/deepseek-chat", "x-ai/grok-4"]);
    expect((await modelsFor(null, null, "anthropic", "image")).models).toEqual([]); // a job the provider can't do
  });

  it("a stored key's list is kept from its check, and the step offers it", async () => {
    await saveConnection(t.db, U, "groq", fakeKey("groq"), { env: legacyEnv, models: ["llama-3.3-70b-versatile", "qwen-qwq-32b", "whisper-large-v3"] });
    const { models, source } = await modelsFor(t.db, U, "groq", "text");
    expect(source).toBe("provider");
    expect(models.map((m) => m.id)).toEqual(["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "qwen-qwq-32b"]);
    expect(models.every((m) => m.tags.includes("fast"))).toBe(true); // Groq is fast
  });
});

describe("presets and their bounds", () => {
  it("Lively is the show's own sampling, so a key with no choice sounds like the show", () => {
    expect(DIALOGUE_TEMPERATURE).toBe(TURN_TEMPERATURE);
    expect(PRESETS.lively).toMatchObject({ temperature: TURN_TEMPERATURE, frequency_penalty: 0, presence_penalty: 0 });
    expect(samplingFor("openrouter")).toEqual({ temperature: 1 });
    expect(samplingFor("openrouter", { preset: "steady" })).toEqual({ temperature: 0.7, frequencyPenalty: 0.1 });
    expect(samplingFor("openrouter", { preset: "wild" })).toEqual({ temperature: 1.25, frequencyPenalty: 0.3, presencePenalty: 0.3 });
  });

  it("only sends penalties to providers that take them, and holds Anthropic's temperature to 1", () => {
    expect(samplingFor("anthropic", { preset: "wild" })).toEqual({ temperature: 1 });
    expect(samplingFor("google", { preset: "wild" })).toEqual({ temperature: 1.25 });
    for (const p of ["openai", "deepseek", "groq", "openrouter"]) expect(samplingFor(p, { preset: "wild" }).frequencyPenalty).toBe(0.3);
  });

  it("clamps Advanced's raw numbers into their bounds, and ignores anything that isn't a number", () => {
    expect(BOUNDS).toEqual({ temperature: { min: 0, max: 1.5 }, penalty: { min: 0, max: 1 } });
    expect(samplingFor("openai", { preset: "custom", temperature: 5, frequency_penalty: 3, presence_penalty: -2 })).toEqual({ temperature: 1.5, frequencyPenalty: 1 });
    expect(samplingFor("openai", { preset: "custom", temperature: -1 })).toEqual({ temperature: 0 });
    expect(samplingFor("anthropic", { preset: "custom", temperature: 1.4 })).toEqual({ temperature: 1 });
    expect(clampSetting("0.333", "temperature")).toBe(0.33);
    expect(clampSetting(Number.NaN, "penalty")).toBeNull();
    expect(clampSetting("lots", "temperature")).toBeNull();
    expect(clampSetting(null, "temperature")).toBeNull();
    expect(samplingFor("openai", { preset: "steady", temperature: null })).toEqual({ temperature: 0.7, frequencyPenalty: 0.1 }); // null: the preset's
  });

  it("names the feel for the card", () => {
    expect(feelLabel({})).toBe("Lively");
    expect(feelLabel({ preset: "wild" })).toBe("Wild");
    expect(feelLabel({ preset: "custom", temperature: 0.9 })).toBe("Custom (0.9)");
  });
});

describe("the feel, on the calls a person's key makes", () => {
  /** A model that records the options each call was given. */
  const recorder = () => {
    const seen: (ModelOptions | undefined)[] = [];
    const model: Model = { async complete(_m, options) { seen.push(options); return "{}"; } };
    return { model, seen };
  };

  it("date lines run at the preset's temperature; a cooler call is scaled by the same ratio", async () => {
    const { model, seen } = recorder();
    const wild = withSampling(model, samplingFor("openrouter", { preset: "wild" }));
    await wild.complete([], { temperature: TURN_TEMPERATURE }); // a date line
    await wild.complete([], { temperature: 0.7 }); // a reflection
    await wild.complete([]); // asks for nothing
    expect(seen.map((o) => o?.temperature)).toEqual([1.25, 0.88, 1.25]);
    expect(seen.every((o) => o?.frequencyPenalty === 0.3 && o?.presencePenalty === 0.3)).toBe(true);
    const steady = withSampling(model, samplingFor("anthropic", { preset: "steady" }));
    await steady.complete([], { temperature: 0.9, maxTokens: 50 });
    expect(seen[3]).toEqual({ temperature: 0.63, maxTokens: 50 }); // no penalties for Anthropic; the rest passed on
  });

  it("end to end: the chosen model, temperature and penalties reach the provider's request", async () => {
    await saveConnection(t.db, U, "openrouter", fakeKey("feel"), { env: legacyEnv });
    await assignJob(t.db, U, "text", "openrouter", "deepseek/deepseek-chat-v3.1", { preset: "wild" });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonRes({ choices: [{ message: { content: "{}" } }] });
    });
    const model = (await userTextModel(t.db, U, undefined, legacyEnv))!;
    await model.complete([{ role: "user", content: "hi" }], { temperature: TURN_TEMPERATURE });
    expect(bodies[0]).toMatchObject({ model: "deepseek/deepseek-chat-v3.1", temperature: 1.25, frequency_penalty: 0.3, presence_penalty: 0.3 });

    // Anthropic: the same preset, held to its API: temperature 1 at most, and no penalties at all.
    await saveConnection(t.db, U, "anthropic", fakeKey("claude"), { env: legacyEnv });
    await assignJob(t.db, U, "text", "anthropic", "claude-sonnet-5-5", { preset: "wild" });
    const claude = (await userTextModel(t.db, U, undefined, legacyEnv))!;
    await claude.complete([{ role: "user", content: "hi" }], { temperature: TURN_TEMPERATURE });
    expect(bodies[1]).toMatchObject({ model: "claude-sonnet-5-5", temperature: 1 });
    expect(bodies[1]).not.toHaveProperty("frequency_penalty");
    expect(bodies[1]).not.toHaveProperty("presence_penalty");
  });

  it("stores a feel clamped, and reads one back clamped even if the row was edited by hand", async () => {
    await saveConnection(t.db, U, "openai", fakeKey("store"), { env: legacyEnv });
    await assignJob(t.db, U, "text", "openai", null, { preset: "custom", temperature: 9, frequency_penalty: -1, presence_penalty: 0.4 });
    expect((await jobKey(t.db, U, "text", legacyEnv))?.feel).toEqual({ preset: "custom", temperature: 1.5, frequency_penalty: 0, presence_penalty: 0.4 });
    await t.db.query(`update user_connection_jobs set preset = 'reckless', temperature = 40 where user_id = $1`, [U]);
    expect((await jobKey(t.db, U, "text", legacyEnv))?.feel).toMatchObject({ preset: null, temperature: 1.5 });
    // A job that isn't Dates & texts keeps no feel.
    await assignJob(t.db, U, "image", "openai", null, { preset: "wild", temperature: 1 });
    expect((await listConnections(t.db, U)).jobs.find((j) => j.job === "image")).toMatchObject({ preset: null, temperature: null });
  });

  it("the card says the feel: the preset's name, or Custom with its temperature", async () => {
    await saveConnection(t.db, U, "openrouter", fakeKey("card"), { env: legacyEnv });
    await assignJob(t.db, U, "text", "openrouter", "deepseek/deepseek-chat-v3.1", { preset: "steady" });
    expect(jobCards(await listConnections(t.db, U))[0].status).toBe("Your OpenRouter key ✓ · deepseek/deepseek-chat-v3.1 · Steady");
    await assignJob(t.db, U, "text", "openrouter", "deepseek/deepseek-chat-v3.1", { preset: "custom", temperature: 1.1 });
    expect(jobCards(await listConnections(t.db, U))[0].status).toBe("Your OpenRouter key ✓ · deepseek/deepseek-chat-v3.1 · Custom (1.1)");
  });
});

describe("the routes", () => {
  const stubProviders = () =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://openrouter.ai/api/v1/models") return jsonRes(OPENROUTER_LIST);
      if (url === "https://openrouter.ai/api/v1/key") return jsonRes({ data: { usage: 0, limit: null } });
      if (url === "https://api.openai.com/v1/models") return jsonRes({ data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1-nano" }, { id: "whisper-1" }] });
      return jsonRes({ error: "not stubbed" }, 404);
    });
  const req = (method: string, path: string, body?: unknown, c: string | null = cookie) =>
    new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it("a passing check for a job lists the key's models for it, tagged and priced; the key never comes back", async () => {
    stubProviders();
    const key = fakeKey("listed");
    const res = await postCheck(req("POST", "/api/me/connections/check", { provider: "openai", key, job: "text" }));
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.ok).toBe(true);
    expect(body.models.map((m: { id: string }) => m.id)).toEqual(["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-4.1-nano"]);
    expect(body.models[0].tags).toContain("recommended");
    expect(text).not.toContain(key);
  });

  it("OpenRouter's check lists its live models, with their prices", async () => {
    stubProviders();
    const body = await (await postCheck(req("POST", "/api/me/connections/check", { provider: "openrouter", key: fakeKey("or"), job: "text" }))).json();
    expect(body.models.find((m: { id: string }) => m.id === "deepseek/deepseek-chat-v3.1")).toMatchObject({ perDate: "≈ 1¢ a date", price: { input: 0.27, output: 1.1 } });
  });

  it("saving keeps the key's list, the feel (a hand-set number makes it custom, clamped), and the models route serves the list", async () => {
    stubProviders();
    const saved = await putConnection(req("PUT", "/api/me/connections", { job: "text", provider: "openai", key: fakeKey("save"), model: "gpt-4.1-nano", preset: "wild", temperature: 7 }));
    expect(saved.status).toBe(200);
    expect((await jobKey(t.db, U, "text"))?.feel).toEqual({ preset: "custom", temperature: 1.5, frequency_penalty: null, presence_penalty: null });
    const listed = await (await getModels(new Request(`${BASE_URL}/api/me/connections/models?provider=openai&job=text`, { headers: { cookie } }))).json();
    expect(listed.source).toBe("provider");
    expect(listed.models.map((m: { id: string }) => m.id)).toContain("gpt-4.1-nano");
    expect(listed.models.map((m: { id: string }) => m.id)).not.toContain("whisper-1");
    // A preset alone is stored as the preset.
    await putConnection(req("PUT", "/api/me/connections", { job: "text", provider: "openai", preset: "steady" }));
    expect((await jobKey(t.db, U, "text"))?.feel).toEqual({ preset: "steady", temperature: null, frequency_penalty: null, presence_penalty: null });
  });

  it("validates: signed in only, a known provider and a job it can do, a real preset, numbers for the numbers", async () => {
    expect((await getModels(new Request(`${BASE_URL}/api/me/connections/models?provider=openai&job=text`))).status).toBe(401);
    expect((await getModels(new Request(`${BASE_URL}/api/me/connections/models?provider=anthropic&job=image`, { headers: { cookie } }))).status).toBe(422);
    expect((await getModels(new Request(`${BASE_URL}/api/me/connections/models?provider=evil&job=text`, { headers: { cookie } }))).status).toBe(422);
    stubProviders();
    expect((await putConnection(req("PUT", "/api/me/connections", { job: "text", provider: "openai", key: fakeKey("v"), preset: "reckless" }))).status).toBe(422);
    expect((await putConnection(req("PUT", "/api/me/connections", { job: "text", provider: "openai", key: fakeKey("v"), temperature: "hot" }))).status).toBe(422);
  });
});

describe("the model step and the feel step, rendered", () => {
  it("each model is a radio row with its tags and price hint; a short list has no filter", () => {
    const html = renderToStaticMarkup(createElement(ModelPicker, { options: modelOptions("openai", "text", null), value: "gpt-4.1", onChange: () => {} }));
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/<label class="model-row is-picked">.*?gpt-4\.1<\/span>/);
    expect(html).toContain(">Recommended<");
    expect(html).toContain("≈ 1¢ a date");
    expect(html).not.toContain('type="search"');
  });

  it("a long list gets a filter, tag toggles, and at most SHOWN rows at a time", () => {
    const many = Array.from({ length: 60 }, (_, i) => modelOption60(i));
    const html = renderToStaticMarkup(createElement(ModelPicker, { options: many, value: "m-3", onChange: () => {} }));
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-pressed="false">Free<');
    expect(html.match(/type="radio"/g)).toHaveLength(SHOWN);
    expect(html).toContain(`Showing ${SHOWN} of 60`);
    expect(html).toContain("Picked: <strong>m-3</strong>");
  });

  it("the feel: three presets (Lively the default), Advanced with penalties only where the provider takes them", () => {
    const openai = renderToStaticMarkup(createElement(FeelPicker, { provider: "openai", value: feelValue(null), onChange: () => {} }));
    for (const label of ["Steady", "Lively", "Wild"]) expect(openai).toContain(`<strong>${label}</strong>`);
    expect(openai).toMatch(/is-picked.*?<strong>Lively<\/strong>/);
    expect(openai).toContain("Frequency penalty");
    expect(openai).toContain('max="1.5"');
    const claude = renderToStaticMarkup(createElement(FeelPicker, { provider: "anthropic", value: feelValue(null), onChange: () => {} }));
    expect(claude).not.toContain("Frequency penalty");
    expect(claude).toContain("doesn&#x27;t take penalties");
    expect(claude).toContain('max="1"'); // Anthropic's API stops at 1
  });

  it("a custom feel opens Advanced with its numbers, and offers the way back to the preset", () => {
    const html = renderToStaticMarkup(createElement(FeelPicker, { provider: "openai", value: feelValue({ preset: "custom", temperature: 1.1, frequency_penalty: null, presence_penalty: null }), onChange: () => {} }));
    expect(html).toContain('<details class="feel-advanced" open="">');
    expect(html).toContain('value="1.1"');
    expect(html).toContain("Back to Lively");
  });
});

/** A made-up model for the long-list test: every third one free, every fourth fast. */
function modelOption60(i: number) {
  return { id: `m-${i}`, note: null, tags: [...(i % 3 === 0 ? ["free" as const] : []), ...(i % 4 === 0 ? ["fast" as const] : [])], price: null, perDate: null };
}
