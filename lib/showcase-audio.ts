/**
 * Which showcase clips have sound (David, 2026-11-09, "1": show the 🔇 only on a clip that has a sound track). Each live
 * clip is read once and its answer kept on its post (showcase_posts.has_audio, lib/media-audio.ts), so the grid and the
 * reels leave the button off a silent one (Post.silent). Until it's read (null), or when it can't be told (not an MP4),
 * the button shows, as it did before.
 *
 * Run by the hourly showcase-check job on After Dark's host, which can read both stores, so a clip published since is
 * known within the hour.
 */
import type { Db } from "./db";
import { hasAudioTrack } from "./media-audio";
import { readBytes } from "./object-store";

/** How many in one go: each is one clip read from the store (a few MB) and its boxes looked through. */
export const AUDIO_BATCH = 48;

const UNCHECKED = `
   from showcase_posts p
   left join adult_images i on p.source = 'after_dark' and i.id = p.media_id
   left join studio_pg_pictures g on p.source = 'pg' and g.id = p.media_id
  where p.status = 'live' and p.has_audio is null and coalesce(i.mime, g.mime) like 'video/%'`;

export async function audioCount(db: Db): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n ${UNCHECKED}`)).rows[0].n;
}

export type AudioResult = { post_id: string; outcome: "sound" | "silent" | "unknown" | "unread" };

/** One post's clip, read and its answer kept ("unread" keeps nothing, to try again). Never throws. */
export async function checkAudio(db: Db, postId: string): Promise<AudioResult> {
  const row = (
    await db.query<{ data: Buffer | Uint8Array | null; object_key: string | null }>(
      `select coalesce(i.data, g.data) as data, coalesce(i.object_key, g.object_key) as object_key
         from showcase_posts p
         left join adult_images i on p.source = 'after_dark' and i.id = p.media_id
         left join studio_pg_pictures g on p.source = 'pg' and g.id = p.media_id
        where p.id = $1`,
      [postId],
    )
  ).rows[0];
  const bytes = row ? await readBytes(row).catch(() => null) : null;
  if (!bytes) return { post_id: postId, outcome: "unread" };
  const sound = hasAudioTrack(bytes);
  // Unknown counts as sound: the button stays, as it was, rather than hiding one that might have it.
  await db.query(`update showcase_posts set has_audio = $2 where id = $1`, [postId, sound ?? true]);
  return { post_id: postId, outcome: sound === null ? "unknown" : sound ? "sound" : "silent" };
}

/** The next live clips not read yet, a batch at a time, in no fixed order so one that can't be read never holds up the rest. */
export async function audioBatch(db: Db, size = AUDIO_BATCH): Promise<{ ok: true; results: AudioResult[]; left: number }> {
  const todo = (await db.query<{ id: string }>(`select p.id ${UNCHECKED} order by random() limit $1`, [size])).rows;
  const results: AudioResult[] = [];
  for (const t of todo) results.push(await checkAudio(db, t.id));
  return { ok: true, results, left: await audioCount(db) };
}
