/**
 * Smaller pictures for the showcase's tiles and reels (David, 2026-10-29: each tile loaded the full picture, about
 * 2.3 MB, heavy on a phone). Each size is drawn from the original the first time it's asked for, as WebP with the
 * AI-generated mark, and kept in showcase_thumbs (tens of KB), which goes with its post. The viewer and downloads still
 * get the original; who may see a post is decided before any of this (the media route), the same for every size.
 */
import type { Db } from "./db";
import { markAiImage } from "./ai-mark";

/** The sizes, by their longest useful width: a grid tile (two or three a row, sharp at 2×), and a phone's screen. */
export const THUMB_WIDTHS = { tile: 640, screen: 1080 } as const;
export type ThumbSize = keyof typeof THUMB_WIDTHS;
export const thumbSizeOf = (v: string | null): ThumbSize | null => (v === "tile" || v === "screen" ? v : null);

/** A smaller copy of a picture, never wider than the original. Null when sharp can't read it. */
export async function shrink(bytes: Buffer, width: number): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return markAiImage(await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 76 }).toBuffer());
  } catch {
    return null;
  }
}

/** The kept copy of a post's picture at `size`, drawn from `load` (its original) the first time; null for a non-picture. */
export async function thumbFor(db: Db, postId: string, size: ThumbSize, load: () => Promise<{ data: Buffer; mime: string } | null>): Promise<Buffer | null> {
  const kept = (await db.query<{ data: Buffer }>(`select data from showcase_thumbs where post_id = $1 and size = $2`, [postId, size])).rows[0];
  if (kept) return Buffer.from(kept.data);
  const original = await load();
  if (!original || !original.mime.startsWith("image/")) return null;
  const thumb = await shrink(original.data, THUMB_WIDTHS[size]);
  if (!thumb) return null;
  await db.query(`insert into showcase_thumbs (post_id, size, data) values ($1, $2, $3) on conflict do nothing`, [postId, size, thumb]);
  return thumb;
}
