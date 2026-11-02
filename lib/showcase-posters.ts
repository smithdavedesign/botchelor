/**
 * A still for every showcase clip (David, 2026-11-02: "do all 3"; a clip showed black on the grid and in the reels until
 * it loaded, and only 22 of 203 live clips had one). A clip filmed from a picture already has that picture as its
 * poster (app/api/showcase/[id]/media, adult_images.source_image). Any other gets its own first frame, cut once with
 * ffmpeg and kept as its tile and screen sizes in showcase_thumbs (lib/showcase-thumbs.ts), so the media route's
 * `?size=` serves it like any other post's: same viewer rules, gone with the post.
 *
 * The first frame, not one from the middle: the reels start a clip from its beginning, so the still and the clip's
 * first moment are the same picture. ffmpeg runs only where its binary ships (next.config.ts outputFileTracingIncludes):
 * the hourly showcase-check job on After Dark's host, which can also read After Dark's store.
 */
import type { Db } from "./db";
import { frameAt } from "./media-tools/ffmpeg";
import { readBytes } from "./object-store";
import { shrink, THUMB_WIDTHS, type ThumbSize } from "./showcase-thumbs";

/** How many in one go: each is a clip read from the store and one frame cut. */
export const POSTER_BATCH = 24;

const NEEDS_POSTER = `
   from showcase_posts p join adult_images i on i.id = p.media_id
  where p.source = 'after_dark' and p.status = 'live' and i.status = 'ready' and i.mime like 'video/%' and i.source_image is null
    and not exists (select 1 from showcase_thumbs t where t.post_id = p.id and t.size = 'screen')`;

export async function posterCount(db: Db): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n ${NEEDS_POSTER}`)).rows[0].n;
}

export type PosterResult = { post_id: string; outcome: "made" } | { post_id: string; outcome: "skipped"; reason: string };

/** One clip's first frame, kept at both sizes. Never throws. */
export async function makePoster(db: Db, postId: string, mediaId: string): Promise<PosterResult> {
  const row = (await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(`select mime, data, object_key from adult_images where id = $1`, [mediaId])).rows[0];
  const bytes = row ? await readBytes(row).catch(() => null) : null;
  if (!row || !bytes) return { post_id: postId, outcome: "skipped", reason: "its clip couldn't be read" };
  let frame: Buffer;
  try {
    frame = (await frameAt(bytes, 0)).png;
  } catch (e) {
    return { post_id: postId, outcome: "skipped", reason: `no frame: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
  }
  for (const size of Object.keys(THUMB_WIDTHS) as ThumbSize[]) {
    const thumb = await shrink(frame, THUMB_WIDTHS[size]);
    if (!thumb) return { post_id: postId, outcome: "skipped", reason: "its frame couldn't be resized" };
    await db.query(`insert into showcase_thumbs (post_id, size, data) values ($1, $2, $3) on conflict do nothing`, [postId, size, thumb]);
  }
  return { post_id: postId, outcome: "made" };
}

/**
 * The next clips without a still, a batch at a time (the showcase-check job, hourly, and an admin's call), so a clip
 * published since gets one within the hour. In no fixed order, so a clip that can't be read never holds up the rest.
 */
export async function posterBatch(db: Db, size = POSTER_BATCH): Promise<{ ok: true; results: PosterResult[]; left: number }> {
  const todo = (await db.query<{ post_id: string; media_id: string }>(`select p.id as post_id, p.media_id ${NEEDS_POSTER} order by random() limit $1`, [size])).rows;
  const results: PosterResult[] = [];
  for (const t of todo) results.push(await makePoster(db, t.post_id, t.media_id));
  return { ok: true, results, left: await posterCount(db) };
}
