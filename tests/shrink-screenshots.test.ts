import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { psnr, shrinkPng } from "../scripts/shrink-screenshots.mjs";

// New proof screenshots are shrunk before they're committed (scripts/shrink-screenshots.mjs), so the history grows by a
// third as much, and nobody can see the difference.
describe("shrinking a screenshot", () => {
  const W = 320;
  const H = 480;
  /** A picture made pixel by pixel, saved the way a browser saves a screenshot (light compression). */
  const png = (colour: (x: number, y: number) => [number, number, number]) => {
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) raw.set(colour(x, y), (y * W + x) * 3);
    }
    return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 1, adaptiveFiltering: false }).toBuffer();
  };
  const pixels = (bytes: Buffer) => sharp(bytes).ensureAlpha().raw().toBuffer();
  // A page: a few flat colours (the background, a card, text, a button).
  const page = () => png((x, y) => (y % 120 < 20 ? [40, 20, 30] : x > 200 && y % 120 > 60 ? [200, 40, 120] : (x + y) % 9 === 0 ? [90, 90, 90] : [252, 240, 244]));
  // A wash of colour no 256-colour palette can hold.
  const wash = () => png((x, y) => [Math.round((x / W) * 255), Math.round((y / H) * 255), (x * 7 + y * 13) % 256]);

  it("draws a page again in 256 colours, a fraction of the bytes, with no visible change", async () => {
    const bytes = await page();
    const out = await shrinkPng(bytes);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThan(bytes.length * 0.8);
    expect((await sharp(out!).metadata()).isPalette).toBe(true);
    expect(psnr(await pixels(bytes), await pixels(out!))).toBeGreaterThanOrEqual(44);
  });

  it("keeps every pixel of a picture 256 colours can't hold", async () => {
    const bytes = await wash();
    const out = await shrinkPng(bytes);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThan(bytes.length * 0.95);
    expect((await pixels(out!)).equals(await pixels(bytes))).toBe(true);
  });

  it("leaves alone a picture already shrunk, and anything that isn't a PNG", async () => {
    expect(await shrinkPng((await shrinkPng(await page()))!)).toBeNull();
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c0ffee" } }).jpeg().toBuffer();
    expect(await shrinkPng(jpeg)).toBeNull();
  });
});
