import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { drawWithWorkersAi, REF_MAX_SIDE, shrinkRef, sniffMime, workersAiBudget, workersAiConfig } from "@/lib/workers-ai";

// The show's client for the botchelor-images Worker (lib/workers-ai.ts, PRD styles-and-storylines phase 1). The Worker
// is stubbed: no live calls.

const ENV = { WORKERS_AI_URL: "https://images.example/", WORKERS_AI_KEY: "gate-key" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

async function picture(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 90 } } }).png().toBuffer();
}

/** The Worker, answering `status` with `body`; it keeps what it was sent. */
function worker(status: number, body: unknown) {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

describe("workersAiConfig", () => {
  it("is on with an https address and a key, and WORKERS_AI=0 turns it off", () => {
    expect(workersAiConfig(ENV)).toEqual({ url: "https://images.example", key: "gate-key" });
    expect(workersAiConfig({ ...ENV, WORKERS_AI: "0" })).toBeNull();
    expect(workersAiConfig({ WORKERS_AI_URL: ENV.WORKERS_AI_URL })).toBeNull();
    expect(workersAiConfig({ ...ENV, WORKERS_AI_URL: "http://images.example" })).toBeNull();
  });
});

describe("drawWithWorkersAi", () => {
  it("answers off without the Worker set up, and calls nothing", async () => {
    const w = worker(200, {});
    expect(await drawWithWorkersAi({ prompt: "p", width: 640, height: 800 }, { env: {}, fetchImpl: w.fetchImpl })).toMatchObject({ ok: false, reason: "off" });
    expect(w.sent).toHaveLength(0);
  });

  it("sends the gate key and the form, with each reference picture shrunk under 512×512", async () => {
    const w = worker(200, { image: JPEG.toString("base64"), model: "@cf/black-forest-labs/flux-2-klein-4b", neurons: 109.57, used: 300, limit: 9500 });
    const out = await drawWithWorkersAi({ prompt: "the same person, laughing", width: 640, height: 800, seed: 7, refs: [await picture(1024, 1280)] }, { env: ENV, fetchImpl: w.fetchImpl });
    expect(out).toMatchObject({ ok: true, mime: "image/jpeg", neurons: 109.57, used: 300, limit: 9500, model: "@cf/black-forest-labs/flux-2-klein-4b" });
    expect(out.ok && out.bytes.equals(JPEG)).toBe(true);
    expect(w.sent[0].url).toBe("https://images.example/draw");
    expect(new Headers(w.sent[0].init?.headers).get("authorization")).toBe("Bearer gate-key");
    const form = w.sent[0].init?.body as FormData;
    expect([form.get("model"), form.get("prompt"), form.get("width"), form.get("height"), form.get("seed")]).toEqual(["klein", "the same person, laughing", "640", "800", "7"]);
    const ref = Buffer.from(await (form.get("input_image_0") as Blob).arrayBuffer());
    const meta = await sharp(ref).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(REF_MAX_SIDE);
    expect(form.get("input_image_1")).toBeNull();
  });

  it("says budget on a 429, and failed on an error, a non-picture or more than four references", async () => {
    expect(await drawWithWorkersAi({ prompt: "p", width: 640, height: 800 }, { env: ENV, fetchImpl: worker(429, { error: "budget" }).fetchImpl })).toMatchObject({ ok: false, reason: "budget" });
    expect(await drawWithWorkersAi({ prompt: "p", width: 640, height: 800 }, { env: ENV, fetchImpl: worker(502, { error: "model_failed", detail: "3040: Capacity" }).fetchImpl })).toEqual({
      ok: false,
      reason: "failed",
      detail: "Workers AI answered 502: 3040: Capacity",
    });
    expect(await drawWithWorkersAi({ prompt: "p", width: 640, height: 800 }, { env: ENV, fetchImpl: worker(200, { image: Buffer.from("hello").toString("base64") }).fetchImpl })).toMatchObject({ ok: false, reason: "failed" });
    const refs = await Promise.all([1, 2, 3, 4, 5].map(() => picture(64, 64)));
    expect(await drawWithWorkersAi({ prompt: "p", width: 640, height: 800, refs }, { env: ENV, fetchImpl: worker(200, {}).fetchImpl })).toMatchObject({ ok: false, reason: "failed" });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await drawWithWorkersAi({ prompt: "p", width: 640, height: 800 }, { env: ENV, fetchImpl: down })).toMatchObject({ ok: false, reason: "failed" });
  });
});

describe("the helpers", () => {
  it("shrinks only what's too big, and knows a picture by its first bytes", async () => {
    const small = await sharp(await shrinkRef(await picture(300, 200))).metadata();
    expect([small.width, small.height]).toEqual([300, 200]);
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(await picture(8, 8))).toBe("image/png");
    expect(sniffMime(Buffer.from("RIFF0000WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(sniffMime(Buffer.from("<html>"))).toBeNull();
  });

  it("reads the day's budget, or null when it's off or failing", async () => {
    expect(await workersAiBudget({ env: ENV, fetchImpl: worker(200, { day: "2026-11-17", used: 375.44, limit: 9500, left: 9124.56 }).fetchImpl })).toEqual({ day: "2026-11-17", used: 375.44, limit: 9500, left: 9124.56 });
    expect(await workersAiBudget({ env: {}, fetchImpl: worker(200, {}).fetchImpl })).toBeNull();
    expect(await workersAiBudget({ env: ENV, fetchImpl: worker(401, { error: "unauthorized" }).fetchImpl })).toBeNull();
  });
});
