import { afterEach, describe, expect, it, vi } from "vitest";
import { fullPortrait } from "@/app/stage/CharacterFigure";
import { CUTOUT_OPTIONS, cutoutsReady, cutoutUrl, PROBE_PATH, setCutoutsForTests } from "@/lib/cutout";

const SITE = "https://botchelor.com";

afterEach(() => {
  setCutoutsForTests(null);
});

describe("cutoutUrl: a portrait with its background taken out, made by our own Cloudflare zone", () => {
  it("asks the show's origin for the whole served portrait, without the CDN's .webp or a small copy's ?w=", () => {
    expect(cutoutUrl("/api/assets/abc-123", SITE)).toBe(`${SITE}/cdn-cgi/image/${CUTOUT_OPTIONS}/api/assets/abc-123`);
    expect(cutoutUrl("/api/assets/abc-123.webp?w=192", SITE)).toBe(`${SITE}/cdn-cgi/image/${CUTOUT_OPTIONS}/api/assets/abc-123`);
    expect(cutoutUrl("/cast/house-dex-v5.webp", `${SITE}/`)).toBe(`${SITE}/cdn-cgi/image/${CUTOUT_OPTIONS}/cast/house-dex-v5.webp`);
  });

  it("takes the background out, keeps the AI mark, and comes back as a transparent WebP", () => {
    expect(CUTOUT_OPTIONS).toContain("segment=foreground");
    expect(CUTOUT_OPTIONS).toContain("metadata=keep");
    expect(CUTOUT_OPTIONS).toContain("format=webp");
    // A failed one must fail (the figure then shows the portrait), never quietly hand back the picture with its background.
    expect(CUTOUT_OPTIONS).not.toContain("onerror");
  });

  it("is only ever one of our portraits, and only over https (a local server has no zone)", () => {
    for (const p of [null, undefined, "", "https://elsewhere.example/x.png", "data:image/png;base64,AAAA", "/after-dark/media/x.webp", "/api/assets/a/teaser", "/api/assets/../admin", "//evil.example/cast/x.webp"]) {
      expect(cutoutUrl(p, SITE)).toBeNull();
    }
    expect(cutoutUrl("/api/assets/abc", "http://localhost:3000")).toBeNull();
  });
});

describe("cutoutsReady: whether the zone makes them, asked once and kept", () => {
  it("is off in tests unless a test says so, and off whatever the zone says with CUTOUTS=0", async () => {
    expect(await cutoutsReady({ VITEST: "true", SITE_URL: SITE })).toBe(false);
    setCutoutsForTests(true);
    expect(await cutoutsReady({ VITEST: "true", SITE_URL: SITE })).toBe(true);
    expect(await cutoutsReady({ CUTOUTS: "0", SITE_URL: SITE })).toBe(false);
  });

  it("is yes when one small cutout of a house portrait comes back as a picture, and keeps the answer", async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${SITE}/cdn-cgi/image/${CUTOUT_OPTIONS.replace("width=900", "width=16")}${PROBE_PATH}`);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
    });
    setCutoutsForTests(null, f as unknown as typeof fetch);
    const env = { SITE_URL: SITE };
    expect(await cutoutsReady(env, 1_000)).toBe(true);
    expect(await cutoutsReady(env, 2_000)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    // An hour on, it asks again.
    expect(await cutoutsReady(env, 1_000 + 61 * 60_000)).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("is no for Cloudflare's 404 (transformations off), a page instead of a picture, or no answer at all", async () => {
    for (const answer of [
      async () => new Response("not found", { status: 404, headers: { "content-type": "text/html" } }),
      async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
      async () => {
        throw new Error("timed out");
      },
    ]) {
      setCutoutsForTests(null, answer as unknown as typeof fetch);
      expect(await cutoutsReady({ SITE_URL: SITE })).toBe(false);
    }
  });

  it("asks only once when several pages want the answer at the same moment", async () => {
    let calls = 0;
    setCutoutsForTests(null, (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/webp" } });
    }) as unknown as typeof fetch);
    const answers = await Promise.all([cutoutsReady({ SITE_URL: SITE }), cutoutsReady({ SITE_URL: SITE }), cutoutsReady({ SITE_URL: SITE })]);
    expect(answers).toEqual([true, true, true]);
    expect(calls).toBe(1);
  });

  it("never asks from a server with no https address", async () => {
    const f = vi.fn();
    setCutoutsForTests(null, f as unknown as typeof fetch);
    expect(await cutoutsReady({ SITE_URL: "http://localhost:3000" })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("the figure's portrait when there's no cutout", () => {
  it("is the whole picture: never a small copy, which is a square crop", () => {
    expect(fullPortrait("/api/assets/abc.webp?w=768")).toBe("/api/assets/abc");
    expect(fullPortrait("/api/assets/abc")).toBe("/api/assets/abc");
    expect(fullPortrait("/cast/house-dex-v5.webp")).toBe("/cast/house-dex-v5.webp");
    expect(fullPortrait(null)).toBeNull();
  });
});
