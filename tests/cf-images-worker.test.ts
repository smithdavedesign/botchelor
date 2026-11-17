import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { authorized, DailyBudget, dailyLimit, MODELS, neuronsFor, parseDraw, tiles, type Env } from "@/workers/cf-images/worker";

// The botchelor-images Worker (workers/cf-images, PRD styles-and-storylines phase 1): the gate key, the two models, the
// form it takes and the daily neuron budget. Workers AI is stubbed.

const KEY = "a-test-gate-key-0123456789abcdef";

/** A Durable Object namespace with one DailyBudget behind it, on in-memory storage. */
function budgetNamespace() {
  const store = new Map<string, unknown>();
  const budget = new DailyBudget({
    storage: {
      get: async <T,>(k: string) => store.get(k) as T | undefined,
      put: async <T,>(k: string, v: T) => void store.set(k, v),
    },
  });
  return { idFromName: (n: string) => n, get: () => ({ fetch: (url: string, init?: RequestInit) => budget.fetch(new Request(url, init)) }) };
}

function env(run: (model: string, input: unknown) => Promise<unknown>, extra: Partial<Env> = {}): Env {
  return { AI: { run }, BUDGET: budgetNamespace(), GATE_KEY: KEY, ...extra };
}

function drawForm(fields: Record<string, string> = {}, refs = 0): FormData {
  const f = new FormData();
  f.append("prompt", "a portrait of a fictional adult");
  f.append("width", "640");
  f.append("height", "800");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (let i = 0; i < refs; i++) f.append(`input_image_${i}`, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), `ref${i}.jpg`);
  return f;
}

const call = (e: Env, path: string, init: RequestInit & { key?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.key !== null) headers.set("authorization", `Bearer ${init.key ?? KEY}`);
  return worker.fetch(new Request(`https://images.test${path}`, { ...init, headers }), e);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("the neuron count", () => {
  it("bills klein as at least 1024×1024, as Cloudflare does, and adds each reference picture", () => {
    expect(tiles(640, 800)).toBe(4);
    expect(tiles(512, 768)).toBe(2);
    expect(tiles(512, 512)).toBe(1);
    // Cloudflare's count on 2026-11-17: 512×512, 512×768 and 640×800 all cost ~104 neurons, plus ~4–5 a reference.
    expect(neuronsFor("klein", 640, 800, 0, 4)).toBe(104.2);
    expect(neuronsFor("klein", 512, 512, 1, 4)).toBe(109.57);
    expect(neuronsFor("klein", 512, 768, 1, 4)).toBe(109.57);
    expect(neuronsFor("klein", 1536, 1024, 0, 4)).toBe(156.3);
    // schnell always draws 1024×1024: four tiles and its steps.
    expect(neuronsFor("schnell", 256, 256, 0, 4)).toBe(57.6);
  });

  it("keeps the budget positive and never above the free 10,000", () => {
    expect(dailyLimit(undefined)).toBe(9_000);
    expect(dailyLimit("5000")).toBe(5_000);
    expect(dailyLimit("20000")).toBe(10_000);
    expect(dailyLimit("-1")).toBe(9_000);
    expect(dailyLimit("lots")).toBe(9_000);
  });
});

describe("the form", () => {
  it("takes a klein draw with up to four reference pictures, numbered without gaps", () => {
    const d = parseDraw(drawForm({ seed: "7" }, 2));
    expect(d).toMatchObject({ model: "klein", width: 640, height: 800, seed: 7, steps: 4 });
    expect("refs" in d && d.refs).toHaveLength(2);
    const gap = drawForm();
    gap.append("input_image_1", new Blob([new Uint8Array([1])]), "late.jpg");
    expect(parseDraw(gap)).toEqual({ error: "reference pictures are numbered from input_image_0 with no gaps" });
  });

  it("refuses an unknown model, an empty prompt, odd sizes, a reference given as text and schnell with references", () => {
    expect(parseDraw(drawForm({ model: "dall-e" }))).toEqual({ error: "model must be klein or schnell" });
    expect(parseDraw(drawForm({ prompt: "  " }))).toHaveProperty("error");
    expect(parseDraw(drawForm({ width: "650" }))).toHaveProperty("error");
    expect(parseDraw(drawForm({ height: "2048" }))).toHaveProperty("error");
    expect(parseDraw(drawForm({ steps: "9" }))).toHaveProperty("error");
    expect(parseDraw(drawForm({ seed: "1.5" }))).toHaveProperty("error");
    const text = drawForm();
    text.append("input_image_0", "https://example.com/a.jpg");
    expect(parseDraw(text)).toEqual({ error: "input_image_0 must be a file" });
    expect(parseDraw(drawForm({ model: "schnell" }, 1))).toEqual({ error: "schnell takes no reference pictures" });
  });
});

describe("the gate key", () => {
  it("lets in only the right key, and nobody when none is set", async () => {
    const req = (h?: string) => new Request("https://images.test/budget", { headers: h ? { authorization: h } : {} });
    expect(await authorized(req(`Bearer ${KEY}`), KEY)).toBe(true);
    expect(await authorized(req(`Bearer ${KEY}x`), KEY)).toBe(false);
    expect(await authorized(req(), KEY)).toBe(false);
    expect(await authorized(req(`Bearer ${KEY}`), undefined)).toBe(false);
    const e = env(async () => ({ image: "x" }));
    expect((await call(e, "/budget", { key: null })).status).toBe(401);
    expect((await call(e, "/draw", { method: "POST", body: drawForm(), key: "wrong" })).status).toBe(401);
  });
});

describe("drawing", () => {
  it("draws with klein from a multipart form and counts the neurons", async () => {
    const runs: { model: string; input: unknown }[] = [];
    const e = env(async (model, input) => {
      runs.push({ model, input });
      return { image: "aGVsbG8=" };
    });
    const res = await call(e, "/draw", { method: "POST", body: drawForm({}, 1) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ image: "aGVsbG8=", model: MODELS.klein, neurons: 109.57, used: 109.57, limit: 9_000 });
    expect(runs[0].model).toBe(MODELS.klein);
    const mp = (runs[0].input as { multipart: { contentType: string; body: ReadableStream } }).multipart;
    expect(mp.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const sent = await new Response(mp.body, { headers: { "content-type": mp.contentType } }).formData();
    expect(sent.get("prompt")).toBe("a portrait of a fictional adult");
    expect(sent.get("width")).toBe("640");
    expect(sent.get("input_image_0")).toBeInstanceOf(Blob);
    expect(await (await call(e, "/budget")).json()).toMatchObject({ used: 109.57, limit: 9_000, left: 8_890.43 });
  });

  it("raises the day's count to Cloudflare's own figure, and never lowers it", async () => {
    const e = env(async () => ({ image: "aGk=" }));
    expect((await call(e, "/draw", { method: "POST", body: drawForm() })).status).toBe(200);
    const raise = (atLeast: unknown) => call(e, "/budget", { method: "POST", body: JSON.stringify({ atLeast }), headers: { "content-type": "application/json" } });
    expect(await (await raise(6_494.88)).json()).toMatchObject({ used: 6_494.88, left: 2_505.12 });
    expect(await (await raise(10)).json()).toMatchObject({ used: 6_494.88 });
    expect((await raise("lots")).status).toBe(400);
    expect((await call(e, "/budget", { method: "POST", key: null, body: "{}" })).status).toBe(401);
  });

  it("sends schnell its prompt and steps as JSON", async () => {
    const runs: { model: string; input: unknown }[] = [];
    const e = env(async (model, input) => {
      runs.push({ model, input });
      return { image: "aGk=" };
    });
    const res = await call(e, "/draw", { method: "POST", body: drawForm({ model: "schnell", steps: "6" }) });
    expect(res.status).toBe(200);
    expect(runs[0]).toEqual({ model: MODELS.schnell, input: { prompt: "a portrait of a fictional adult", steps: 6 } });
  });

  it("refuses past the day's budget, and a new UTC day starts from zero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T23:59:00Z"));
    const e = env(async () => ({ image: "aGk=" }), { DAILY_NEURONS: "200" });
    expect((await call(e, "/draw", { method: "POST", body: drawForm() })).status).toBe(200);
    const over = await call(e, "/draw", { method: "POST", body: drawForm() });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "budget", used: 104.2, limit: 200, neurons: 104.2 });
    vi.setSystemTime(new Date("2026-11-18T00:00:01Z"));
    expect((await call(e, "/draw", { method: "POST", body: drawForm() })).status).toBe(200);
    expect(await (await call(e, "/budget")).json()).toMatchObject({ day: "2026-11-18", used: 104.2 });
  });

  it("gives the neurons back when the model fails, and names Cloudflare's own stop", async () => {
    let fail = "3040: Capacity temporarily exceeded";
    const e = env(async () => {
      throw new Error(fail);
    });
    const res = await call(e, "/draw", { method: "POST", body: drawForm() });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "model_failed", detail: "3040: Capacity temporarily exceeded" });
    expect(await (await call(e, "/budget")).json()).toMatchObject({ used: 0 });
    fail = "4006: you have used up your daily free allocation of 10,000 neurons";
    const stop = await call(e, "/draw", { method: "POST", body: drawForm() });
    expect(stop.status).toBe(429);
    expect(await stop.json()).toMatchObject({ error: "allowance" });
    const empty = await call(env(async () => ({})), "/draw", { method: "POST", body: drawForm() });
    expect(await empty.json()).toEqual({ error: "model_failed", detail: "the model answered without a picture" });
  });

  it("answers a bad form with 400 and anything else with 404", async () => {
    const e = env(async () => ({ image: "aGk=" }));
    const bad = await call(e, "/draw", { method: "POST", body: drawForm({ width: "100" }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "bad_request" });
    expect((await call(e, "/draw", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call(e, "/draw")).status).toBe(404);
    expect((await call(e, "/")).status).toBe(404);
  });
});
