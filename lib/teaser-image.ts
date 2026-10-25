/**
 * A server-blurred teaser of a picture (David, 2026-10-25: "blur or add a way to gate"): the original is shrunk to a
 * few pixels and blown back up, blurred, so nothing in it can be made out, and only that copy is ever sent to someone
 * the picture isn't open to (lib/asset-gate.ts). A CSS blur on the real image was turned down: the full picture would
 * still reach the browser.
 *
 * Drawn the first time it's asked for and kept in media_teasers (a few KB), which cascades away with its picture.
 */
import type { Db } from "./db";

/** The teaser's size: a portrait card, 4:5. */
export const TEASER_WIDTH = 256;
export const TEASER_HEIGHT = 320;
/** How small the original is shrunk first: at 12×15 there's colour and shape, and no detail at all. */
const TINY = { width: 12, height: 15 };

/** The teaser of an image's bytes, or null when they aren't an image sharp can read (a video, a broken file). */
export async function blurredTeaser(bytes: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    const tiny = await sharp(bytes).resize({ ...TINY, fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return await sharp(tiny.data, { raw: tiny.info })
      .resize({ width: TEASER_WIDTH, height: TEASER_HEIGHT, kernel: "cubic" })
      .blur(16)
      .jpeg({ quality: 55 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Which picture a teaser is of: a show asset (character_assets) or an After Dark one (adult_images). */
export type TeaserOf = { asset: string } | { adult: string };
const keyOf = (of: TeaserOf): string => ("asset" in of ? `asset:${of.asset}` : `adult:${of.adult}`);

/**
 * The kept teaser of a picture, drawn from `load` (its original bytes) the first time. Null when there's no picture
 * or it isn't an image. The caller has already decided the viewer may see a teaser.
 */
export async function teaserFor(db: Db, of: TeaserOf, load: () => Promise<{ data: Buffer; mime: string } | null>): Promise<Buffer | null> {
  const key = keyOf(of);
  const kept = (await db.query<{ data: Buffer }>(`select data from media_teasers where key = $1`, [key])).rows[0];
  if (kept) return Buffer.from(kept.data);
  const original = await load();
  if (!original || !original.mime.startsWith("image/")) return null;
  const teaser = await blurredTeaser(original.data);
  if (!teaser) return null;
  await db.query(
    `insert into media_teasers (key, asset_id, adult_id, data) values ($1, $2, $3, $4) on conflict (key) do nothing`,
    [key, "asset" in of ? of.asset : null, "adult" in of ? of.adult : null, teaser],
  );
  return teaser;
}

/** A teaser's response: never the original's headers, and kept only in the viewer's own browser. */
export const teaserResponse = (bytes: Buffer): Response =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-robots-tag": "noindex" },
  });
