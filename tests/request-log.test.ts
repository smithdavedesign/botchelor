import { describe, expect, it } from "vitest";
import { cleanBody, currentRequests, logRequest, requestJson, withRequestLog } from "../lib/adult/request-log";

describe("what made a media item (lib/adult/request-log.ts)", () => {
  it("keeps a body without a signature, a picture's bytes or an endless string", () => {
    const png = `data:image/png;base64,${"A".repeat(4096)}`;
    const cleaned = cleanBody({
      prompt: "Make one photograph of the woman from Picture 1.",
      images: ["https://botchelor.com/api/admin/after-dark/media/abc?until=123&sig=SECRETSIG", png],
      audio_url: `data:audio/mpeg;base64,${"B".repeat(2000)}`,
      image: "C".repeat(5000),
      nested: { long: "a long line. ".repeat(500), n: 3, on: true, none: null },
    }) as Record<string, unknown>;
    expect(cleaned.prompt).toBe("Make one photograph of the woman from Picture 1.");
    expect(cleaned.images).toEqual(["https://botchelor.com/api/admin/after-dark/media/abc?until=123&sig=…", "<image/png data, 3 KB>"]);
    expect(cleaned.audio_url).toBe("<audio/mpeg data, 1 KB>");
    expect(cleaned.image).toBe("<base64, 4 KB>");
    const nested = cleaned.nested as Record<string, unknown>;
    expect(String(nested.long)).toMatch(/… \(6500 characters\)$/);
    expect(nested).toMatchObject({ n: 3, on: true, none: null });
    expect(JSON.stringify(cleaned)).not.toContain("SECRETSIG");
  });

  it("logs only into a log that's open, its address without the query", async () => {
    logRequest("https://api.venice.ai/api/v1/image/multi-edit", { prompt: "lost" });
    expect(currentRequests()).toBeNull();
    const { value, requests } = await withRequestLog(async () => {
      logRequest("https://api.venice.ai/api/v1/video/queue?x=1", { model: "wan-3-0-image-to-video" });
      return currentRequests();
    });
    expect(requests).toEqual([{ at: "https://api.venice.ai/api/v1/video/queue", body: { model: "wan-3-0-image-to-video" } }]);
    expect(value).toBe(JSON.stringify(requests));
    expect(requestJson([])).toBeNull();
  });

  it("keeps each of several draws at once to its own log, and a nested one to itself", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const draw = (n: number) =>
      withRequestLog(async () => {
        logRequest("https://api.venice.ai/api/v1/image/multi-edit", { n, step: 1 });
        await tick();
        const inner = await withRequestLog(async () => logRequest("https://fal.run/x", { inner: n }));
        logRequest("https://api.venice.ai/api/v1/image/multi-edit", { n, step: 2 });
        return inner.requests;
      });
    const all = await Promise.all([1, 2, 3, 4].map(draw));
    all.forEach(({ value: inner, requests }, i) => {
      expect(requests.map((r) => r.body)).toEqual([{ n: i + 1, step: 1 }, { n: i + 1, step: 2 }]);
      expect(inner.map((r) => r.body)).toEqual([{ inner: i + 1 }]);
    });
  });
});
