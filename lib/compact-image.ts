/**
 * Big PNG pictures stored as data URLs become JPEGs of the same size in pixels (2026-11-01).
 *
 * The picture models answer in PNG, about 4.5 MB a portrait, and character_assets keeps each one as a data URL: 75 of
 * them were 330 MB of the database, and every view of one read 4.5 MB out of Neon. That is what kept botchelor off
 * Neon's free plan (1 GB of storage, 5 GB of transfer a month). A JPEG at quality 85 is about a tenth of that and looks
 * the same at the sizes the site shows. The url stays a data URL, so nothing that reads it changes (the edit models
 * already take the JPEG portraits we have).
 *
 * Left as they are: anything that isn't a PNG data URL, small ones (under COMPACT_OVER_BYTES), pictures with any
 * transparency (a JPEG can't keep it), and PNGs that carry a provider's C2PA content credential (a `caBX` chunk,
 * OpenAI's): re-encoding would drop the credential, and lib/ai-mark.ts promises it's kept. A result that isn't smaller
 * is thrown away. It never throws: anything it can't read comes back untouched.
 *
 * The AI mark (lib/ai-mark.ts) doesn't survive re-encoding: callers stamp the result (recordAsset does, after this).
 */
import sharp from "sharp";

/** PNG data URLs bigger than this (decoded) are re-encoded. */
export const COMPACT_OVER_BYTES = 600_000;
export const COMPACT_JPEG_QUALITY = 85;

const PNG_PREFIX = "data:image/png;base64,";
const C2PA_CHUNK = Buffer.from("caBX", "latin1");

export type Compacted = { url: string; changed: boolean; before: number; after: number; reason?: string };

export async function compactImageDataUrl(url: string): Promise<Compacted> {
  const before = url.length;
  const keep = (reason: string): Compacted => ({ url, changed: false, before, after: before, reason });
  if (!url.startsWith(PNG_PREFIX)) return keep("not a png data url");
  try {
    const bytes = Buffer.from(url.slice(PNG_PREFIX.length), "base64");
    if (bytes.length <= COMPACT_OVER_BYTES) return keep("small");
    if (hasPngChunk(bytes, C2PA_CHUNK)) return keep("c2pa");
    const img = sharp(bytes, { failOn: "error" });
    const { isOpaque } = await img.stats();
    if (!isOpaque) return keep("transparent");
    const jpeg = await sharp(bytes).removeAlpha().jpeg({ quality: COMPACT_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    const out = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    if (out.length >= before) return keep("not smaller");
    return { url: out, changed: true, before, after: out.length };
  } catch {
    return keep("unreadable");
  }
}

/** Whether a PNG has a chunk of this type, walking the chunk list (not a byte search through the pixels). */
export function hasPngChunk(png: Buffer, type: Buffer): boolean {
  let at = 8; // after the signature
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    if (png.subarray(at + 4, at + 8).equals(type)) return true;
    if (png.subarray(at + 4, at + 8).toString("latin1") === "IEND") return false;
    at += 12 + length;
  }
  return false;
}
