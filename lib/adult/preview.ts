/**
 * The locked preview (David, 2026-11-16: "if a user navigates there (allow them to) if they're not signed up for after
 * dark, give them a signup link", then "do the same for the pg studio -> after dark studio"): what After Dark's Gallery
 * and Studio show someone it isn't open to, instead of not-found. Real counts, a grid of server-blurred tiles, and the
 * way in (the subscribe page: the taste, the invite request or the waitlist while billing is off, the subscription once
 * it's on).
 *
 * WHAT THE TILES ARE OF: the explicit posts an ADMIN has published to the showcase (David: "it's only going to be admins
 * content for now"), live and not held by a report, of a character that isn't private. Publishing is already a choice
 * made one post at a time, so nothing appears here that wasn't picked to be seen. The Studio's preview prefers the
 * posts of one character alone (what a Studio shoot makes; lib/adult/gallery.ts sourceOf), the Gallery's takes any.
 *
 * NOTHING EXPLICIT LEAVES THE SERVER. A tile is lib/teaser-image.ts's blurred teaser: the picture (a clip's still)
 * shrunk to 12 by 15 pixels and blown back up, so colour and a rough shape are left and no detail at all, and only that
 * copy is ever sent (app/api/after-dark/preview/[id]). Showing the real pictures free is a legal call held for counsel
 * and a real age check (lib/adult/age-check.ts), not something this file does.
 *
 * WHO GETS TILES (previewTilesAllowed, pure): not a crawler or an agent, has said they're 18 or older (the gate's
 * cookie, which After Dark's pages ask for first anyway), and somewhere After Dark's pictures are allowed
 * (lib/jurisdiction.ts mode "open"). A text-only place gets the words and the way in, no tiles; a blocked place never
 * reaches these pages (app/after-dark/layout.tsx), and the tile route refuses it too.
 */
import type { Db } from "../db";
import type { AfterDarkMode } from "../jurisdiction";
import { readBytes } from "../object-store";

/** How many tiles each page shows. */
export const PREVIEW_TILES = { gallery: 12, studio: 8, characters: 8 } as const;
export type PreviewKind = keyof typeof PREVIEW_TILES;

/** The invite request's source for each page's way in (lib/adult/bridge.ts inviteSource keeps it as it is). */
export const PREVIEW_SOURCE: Record<PreviewKind, string> = { gallery: "gallery", studio: "studio", characters: "characters" };
/** The source the PG Studio's door carries to the locked Studio, passed on to the invite request. */
export const PG_STUDIO_SOURCE = "pg-studio";

export type PreviewTile = { id: string; video: boolean };
export type Preview = { pictures: number; videos: number; tiles: PreviewTile[] };

const VIDEO_MEDIA = `('clip', 'reel', 'boomerang', 'loop')`;

/** Every post the preview may draw from: an admin's published explicit After Dark posts, live, unheld, not private. */
const POOL = `from showcase_posts p
  join admins a on a.user_id = p.owner_id
  join creator_profiles cp on cp.user_id = p.owner_id
  join characters c on c.id = p.character_id
 where p.source = 'after_dark' and p.status = 'live' and not p.held and p.rating = 'nsfw'
   and not cp.hidden and c.visibility <> 'private'`;

/** A Studio-made post: one character alone (a night is always two). */
const ALONE = `and p.character_b is null`;

/** Whether this viewer may be sent the blurred tiles. Pure. */
export function previewTilesAllowed(f: { bot: boolean; attested: boolean; mode: AfterDarkMode }): boolean {
  return !f.bot && f.attested && f.mode === "open";
}

async function poolOf(db: Db, where: string, limit: number): Promise<Preview> {
  const [counts, tiles] = await Promise.all([
    db.query<{ pictures: number; videos: number }>(
      `select count(*) filter (where p.medium not in ${VIDEO_MEDIA})::int as pictures, count(*) filter (where p.medium in ${VIDEO_MEDIA})::int as videos ${POOL} ${where}`,
    ),
    db.query<{ id: string; video: boolean }>(
      `select p.id, p.medium in ${VIDEO_MEDIA} as video ${POOL} ${where} order by coalesce(p.published_at, p.created_at) desc, p.id limit $1`,
      [limit],
    ),
  ]);
  const c = counts.rows[0] ?? { pictures: 0, videos: 0 };
  return { pictures: c.pictures, videos: c.videos, tiles: tiles.rows.map((r) => ({ id: r.id, video: r.video })) };
}

/**
 * What a page's preview shows: the counts and the newest tiles. The Studio's and Characters' are of one character alone,
 * unless there's none of those, then the same as the Gallery's. `tiles: false` (a text-only place): the counts only.
 */
export async function previewOf(db: Db, kind: PreviewKind, opts: { tiles?: boolean } = {}): Promise<Preview> {
  const limit = opts.tiles === false ? 0 : PREVIEW_TILES[kind];
  if (kind === "studio" || kind === "characters") {
    const alone = await poolOf(db, ALONE, limit);
    if (alone.pictures + alone.videos > 0) return alone;
  }
  return poolOf(db, "", limit);
}

/**
 * The locked preview of one character (Step in's Who, for someone whose plan has no pictures: lib/adult/step-in-who.ts):
 * the same pool, the posts with them in it, alone or with someone. `limit` 0: the counts only.
 */
export async function previewOfCharacter(db: Db, characterId: string, limit: number): Promise<Preview> {
  const them = `and (p.character_id = $1 or p.character_b = $1)`;
  const [counts, tiles] = await Promise.all([
    db.query<{ pictures: number; videos: number }>(
      `select count(*) filter (where p.medium not in ${VIDEO_MEDIA})::int as pictures, count(*) filter (where p.medium in ${VIDEO_MEDIA})::int as videos ${POOL} ${them}`,
      [characterId],
    ),
    limit > 0
      ? db.query<{ id: string; video: boolean }>(
          `select p.id, p.medium in ${VIDEO_MEDIA} as video ${POOL} ${them} order by coalesce(p.published_at, p.created_at) desc, p.id limit $2`,
          [characterId, limit],
        )
      : Promise.resolve({ rows: [] as { id: string; video: boolean }[] }),
  ]);
  const c = counts.rows[0] ?? { pictures: 0, videos: 0 };
  return { pictures: c.pictures, videos: c.videos, tiles: tiles.rows.map((r) => ({ id: r.id, video: r.video })) };
}

/** The post behind a tile, if it's one the preview may show. */
export async function previewPost(db: Db, postId: string): Promise<{ id: string; media_id: string } | null> {
  const { rows } = await db.query<{ id: string; media_id: string }>(`select p.id, p.media_id ${POOL} and p.id = $1`, [postId]);
  return rows[0] ?? null;
}

type MediaRow = { mime: string; data: Buffer | Uint8Array | null; object_key: string | null; source_image: string | null };

/**
 * A post's still, to be blurred: the picture itself, or for a clip the picture it was filmed from (back through the
 * clips it was cut from, as the showcase's own tiles do), else the first frame the showcase already cut for it
 * (lib/showcase-posters.ts, kept in showcase_thumbs). Null when there's none: the tile is then left out.
 */
export async function previewStill(db: Db, post: { id: string; media_id: string }): Promise<{ data: Buffer; mime: string } | null> {
  let from: MediaRow | null =
    (await db.query<MediaRow>(`select mime, data, object_key, source_image from adult_images where id = $1 and status = 'ready'`, [post.media_id])).rows[0] ?? null;
  for (let hop = 0; from && from.mime.startsWith("video/") && hop < 4; hop++) {
    from = from.source_image
      ? ((await db.query<MediaRow>(`select mime, data, object_key, source_image from adult_images where id = $1`, [from.source_image])).rows[0] ?? null)
      : null;
  }
  if (from && from.mime.startsWith("image/")) {
    const data = await readBytes(from).catch(() => null);
    if (data) return { data, mime: from.mime };
  }
  const thumb = (
    await db.query<{ data: Buffer }>(`select data from showcase_thumbs where post_id = $1 order by (size = 'tile') desc limit 1`, [post.id])
  ).rows[0];
  return thumb ? { data: Buffer.from(thumb.data), mime: "image/webp" } : null;
}
