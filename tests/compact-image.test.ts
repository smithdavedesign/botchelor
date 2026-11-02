// Big PNG portraits are stored as JPEGs a tenth the size (lib/compact-image.ts, 2026-11-01): 4.5 MB data URLs kept the
// database and its transfer off Neon's free plan.
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasAiMark } from "@/lib/ai-mark";
import { recordAsset } from "@/lib/assets";
import { COMPACT_OVER_BYTES, compactImageDataUrl, hasPngChunk } from "@/lib/compact-image";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

/** A noisy picture, so its PNG is well over the threshold. */
async function bigPng(channels: 3 | 4 = 3, alpha = 1): Promise<Buffer> {
  const png = await sharp({ create: { width: 800, height: 800, channels, background: { r: 120, g: 90, b: 60, alpha }, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .png()
    .toBuffer();
  expect(png.length).toBeGreaterThan(COMPACT_OVER_BYTES);
  return png;
}
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
const bytesOf = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");

/** The PNG with a chunk of this type put in right after IHDR (8-byte signature + 25-byte IHDR chunk). */
function withChunk(png: Buffer, type: string): Buffer {
  const data = Buffer.from("c2pa manifest", "latin1");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

describe("compactImageDataUrl", () => {
  it("re-encodes a big opaque PNG as a JPEG of the same size in pixels, much smaller", async () => {
    const c = await compactImageDataUrl(dataUrl(await bigPng()));
    expect(c.changed).toBe(true);
    expect(c.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(c.after).toBeLessThan(c.before / 2);
    const meta = await sharp(bytesOf(c.url)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 800, 800]);
  });

  it("leaves small ones, transparent ones, ones with a C2PA credential and anything that isn't a PNG data URL", async () => {
    const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#808080" } }).png().toBuffer();
    expect(await compactImageDataUrl(dataUrl(small))).toMatchObject({ changed: false, reason: "small" });
    expect(await compactImageDataUrl(dataUrl(await bigPng(4, 0.5)))).toMatchObject({ changed: false, reason: "transparent" });
    const credentialed = withChunk(await bigPng(), "caBX");
    expect(hasPngChunk(credentialed, Buffer.from("caBX"))).toBe(true);
    expect(await compactImageDataUrl(dataUrl(credentialed))).toMatchObject({ changed: false, reason: "c2pa" });
    expect(await compactImageDataUrl("data:image/jpeg;base64,AAAA")).toMatchObject({ changed: false });
    expect(await compactImageDataUrl("/cast/venue-karaoke_bar.webp")).toMatchObject({ changed: false });
    expect(await compactImageDataUrl("data:image/png;base64,bm90IGEgcG5n" + "A".repeat(900_000))).toMatchObject({ changed: false });
  });

  it("recordAsset stores a generated portrait compacted and still AI-marked; a licensed one as given", async () => {
    const png = await bigPng();
    const id = await recordAsset(t.db, { content_rating: "pg", character_id: "house-nell", kind: "portrait", source_type: "generated", source_model: "venice", url: dataUrl(png) });
    const stored = (await t.db.query<{ url: string }>(`select url from character_assets where id = $1`, [id])).rows[0].url;
    expect(stored.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(stored.length).toBeLessThan(dataUrl(png).length / 2);
    expect(hasAiMark(bytesOf(stored))).toBe(true);

    const licensed = await recordAsset(t.db, {
      content_rating: "pg",
      character_id: "house-nell",
      kind: "portrait",
      source_type: "licensed",
      source_url: "https://example.com/p",
      license_name: "CC0",
      url: dataUrl(png),
    });
    expect((await t.db.query<{ url: string }>(`select url from character_assets where id = $1`, [licensed])).rows[0].url).toBe(dataUrl(png));
  });
});
