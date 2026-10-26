/**
 * Pictures as a creator posts them (the creator suite, 2026-10-26): cut to a social size, as JPEG or PNG, with an
 * optional small "AI" badge in a corner, and a contact sheet of several. sharp (libvips, Next's own image library) does
 * the work. Whatever it writes is marked AI-generated again (lib/ai-mark.ts): re-encoding drops the mark the original
 * carried. The badge is drawn as shapes, never as text: a server may have no fonts at all.
 */
import { markAiImage } from "../ai-mark";

/** The social sizes, as most apps want them (a picture is never enlarged to fit: a smaller one keeps the shape). */
export const EXPORT_SIZES = {
  story: { w: 1080, h: 1920, label: "Story 9:16" },
  feed: { w: 1080, h: 1350, label: "Feed 4:5" },
  square: { w: 1080, h: 1080, label: "Square 1:1" },
} as const;
export type SocialSize = keyof typeof EXPORT_SIZES;
export type ExportSize = "original" | SocialSize;
export type ImageFormat = "jpg" | "png";

type Box = { left: number; top: number; width: number; height: number };

/**
 * The part of a w×h picture with the shape aw:ah: all of its width or all of its height kept, the rest cut. Cut from the
 * top and bottom, the window sits a quarter of the way down (faces are near the top of a portrait); cut from the sides,
 * it's centred.
 */
export function cropBox(w: number, h: number, aw: number, ah: number, topBias = 0.25): Box {
  const want = aw / ah;
  if (w / h > want) {
    const width = Math.max(1, Math.round(h * want));
    return { left: Math.round((w - width) / 2), top: 0, width, height: h };
  }
  const height = Math.max(1, Math.round(w / want));
  return { left: 0, top: Math.round((h - height) * topBias), width: w, height };
}

/**
 * The "AI" badge for a w×h picture: a dark pill in its bottom right corner with the letters drawn as strokes. On a
 * story, higher up (an app's reply bar covers the bottom).
 */
export function badgeSvg(w: number, h: number, size: ExportSize = "original"): string {
  const ph = Math.max(26, Math.round(Math.min(w, h) * 0.055));
  const pw = Math.round(ph * 1.9);
  const x = w - pw - Math.round(w * 0.03);
  const y = h - ph - Math.round(h * (size === "story" ? 0.12 : 0.03));
  const s = (n: number) => n.toFixed(1);
  // The letters: an "A" (two legs and a bar) and an "I", in the pill's middle.
  const top = y + ph * 0.24;
  const base = y + ph * 0.76;
  const a0 = x + pw * 0.24;
  const a1 = x + pw * 0.56;
  const am = (a0 + a1) / 2;
  const bar = top + (base - top) * 0.62;
  const ix = x + pw * 0.74;
  const stroke = Math.max(2.5, ph * 0.1);
  const letters = `M${s(a0)} ${s(base)} L${s(am)} ${s(top)} L${s(a1)} ${s(base)} M${s(a0 + (am - a0) * 0.38)} ${s(bar)} L${s(a1 - (a1 - am) * 0.38)} ${s(bar)} M${s(ix)} ${s(top)} L${s(ix)} ${s(base)}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="${s(ph / 2)}" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.7)" stroke-width="${s(Math.max(1, ph * 0.04))}"/>`,
    `<path d="${letters}" fill="none" stroke="#fff" stroke-width="${s(stroke)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    "</svg>",
  ].join("");
}

async function sharpOf() {
  const { default: sharp } = await import("sharp");
  return sharp;
}

/** A picture's width and height (null when sharp can't read it). */
export async function imageSize(bytes: Buffer): Promise<{ w: number; h: number } | null> {
  const sharp = await sharpOf();
  const m = await sharp(bytes, { failOn: "none" }).metadata().catch(() => null);
  return m?.width && m.height ? { w: m.width, h: m.height } : null;
}

/**
 * A drawn picture in the shape it was asked for (native sizes, lib/studio/formats.ts): as it is when it's already that
 * shape (within 2%), else cut to it (a quarter of the way down, like an export) in its own format. So a model asked for
 * the nearest ratio it takes (Replicate has no 4:5) still gives the shape asked for. One sharp can't read stays as it is.
 */
export async function fitRatio(file: { bytes: Buffer; mime: string }, ratio: string): Promise<{ bytes: Buffer; mime: string }> {
  const [aw, ah] = ratio.split(":").map(Number);
  if (!(aw > 0 && ah > 0)) return file;
  const sharp = await sharpOf();
  const meta = await sharp(file.bytes, { failOn: "none" }).metadata().catch(() => null);
  if (!meta?.width || !meta.height) return file;
  const want = aw / ah;
  if (Math.abs(meta.width / meta.height - want) / want <= 0.02) return file;
  const img = sharp(file.bytes, { failOn: "none" }).extract(cropBox(meta.width, meta.height, aw, ah));
  return meta.format === "jpeg" ? { bytes: await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer(), mime: "image/jpeg" } : { bytes: await img.png().toBuffer(), mime: "image/png" };
}

/**
 * One picture as it's exported: at a social size (cut to its shape, never enlarged) or its own, as JPEG or PNG, with the
 * badge or without, marked AI-generated. An original in its own format with no badge isn't re-encoded at all.
 */
export async function renderImage(bytes: Buffer, opts: { size: ExportSize; format: ImageFormat; badge?: boolean }): Promise<Buffer> {
  const sharp = await sharpOf();
  const meta = await sharp(bytes, { failOn: "none" }).metadata();
  const same = (opts.format === "png" && meta.format === "png") || (opts.format === "jpg" && meta.format === "jpeg");
  if (opts.size === "original" && same && !opts.badge) return markAiImage(bytes);
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  if (!w0 || !h0) throw new Error("the picture couldn't be read");
  let img = sharp(bytes, { failOn: "none" });
  let w = w0;
  let h = h0;
  if (opts.size !== "original") {
    const target = EXPORT_SIZES[opts.size];
    const box = cropBox(w0, h0, target.w, target.h);
    const scale = Math.min(1, target.w / box.width);
    w = Math.max(1, Math.round(box.width * scale));
    h = Math.max(1, Math.round(box.height * scale));
    img = img.extract(box).resize({ width: w, height: h, fit: "fill" });
  }
  if (opts.badge) img = img.composite([{ input: Buffer.from(badgeSvg(w, h, opts.size)), top: 0, left: 0 }]);
  const out = opts.format === "png" ? await img.png().toBuffer() : await img.flatten({ background: "#000" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return markAiImage(out);
}

/** The badge alone, as a PNG the size of a w×h frame: what a video's export lays over it (lib/media-tools/ffmpeg.ts). */
export async function badgePng(w: number, h: number, size: ExportSize): Promise<Buffer> {
  const sharp = await sharpOf();
  return sharp(Buffer.from(badgeSvg(w, h, size))).png().toBuffer();
}

/**
 * A contact sheet: up to `columns × rows` pictures in 4:5 cells on a dark ground (the export's sheet.jpg, and a
 * character's identity views), marked AI-generated.
 */
export async function contactSheet(pictures: Buffer[], opts: { columns?: number; cell?: number; format?: ImageFormat; badge?: boolean } = {}): Promise<Buffer> {
  const sharp = await sharpOf();
  const columns = Math.max(1, Math.min(opts.columns ?? 3, pictures.length || 1));
  const cw = opts.cell ?? 360;
  const ch = Math.round((cw * 5) / 4);
  const gap = Math.round(cw / 30);
  const rows = Math.max(1, Math.ceil(pictures.length / columns));
  const W = columns * cw + (columns + 1) * gap;
  const H = rows * ch + (rows + 1) * gap;
  const cells = await Promise.all(
    pictures.map(async (p, k) => ({
      input: await sharp(p, { failOn: "none" }).resize({ width: cw, height: ch, fit: "cover", position: "north" }).toBuffer(),
      left: gap + (k % columns) * (cw + gap),
      top: gap + Math.floor(k / columns) * (ch + gap),
    })),
  );
  const layers = opts.badge ? [...cells, { input: Buffer.from(badgeSvg(W, H)), left: 0, top: 0 }] : cells;
  const canvas = sharp({ create: { width: W, height: H, channels: 3, background: "#16101c" } }).composite(layers);
  const out = opts.format === "png" ? await canvas.png().toBuffer() : await canvas.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return markAiImage(out);
}
