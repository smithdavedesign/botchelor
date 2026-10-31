import { markAiVideo, readMp4Xmp } from "@/lib/ai-mark";
import type { Db } from "@/lib/db";
import { faststart, isFaststart } from "@/lib/mp4-faststart";
import type { ObjectStore } from "@/lib/object-store";

/**
 * Brings the clips already in the bucket up to what a clip written today gets: its index moved to the front so it plays
 * from the first bytes (lib/mp4-faststart.ts), and the AI-made mark on it (lib/ai-mark.ts). New clips get both in
 * keepBytes; the ones made before 2026-10-30 don't (the reels on a phone waited on each one, #1036), and the oldest
 * carry no mark at all. The transform is frame-for-frame identical (proven by framemd5 on real clips, the 2026-10-31
 * audit): it only reorders the boxes and appends a metadata box. Idempotent, so a batch can be re-run safely.
 *
 * Runs where the clips live, which is After Dark's own deployment (Bunny); on the show app objectStore() is the other
 * bucket, so the route that calls this is for ad.botchelor.com. `faststart_at` marks a row seen, so `left` is a cheap
 * count and a second pass skips the done ones.
 */
export async function backfillClips(db: Db, store: ObjectStore, limit = 20): Promise<{ checked: number; fixed: number; missing: number; left: number }> {
  const { rows } = await db.query<{ id: string; object_key: string }>(
    `select id, object_key from adult_images
      where mime = 'video/mp4' and object_key is not null and faststart_at is null
      order by created_at limit $1`,
    [limit],
  );
  let fixed = 0;
  let missing = 0;
  for (const r of rows) {
    try {
      const bytes = await store.get(r.object_key);
      if (!bytes) missing++;
      else if (!isFaststart(bytes) || readMp4Xmp(bytes) === null) {
        await store.put(r.object_key, markAiVideo(faststart(bytes)), "video/mp4");
        fixed++;
      }
    } catch (err) {
      // Leave faststart_at null so the row is tried again next pass; don't let one object stop the batch.
      console.warn(`faststart backfill: ${r.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    await db.query(`update adult_images set faststart_at = now() where id = $1`, [r.id]);
  }
  const left = (
    await db.query<{ n: number }>(
      `select count(*)::int n from adult_images where mime = 'video/mp4' and object_key is not null and faststart_at is null`,
    )
  ).rows[0].n;
  return { checked: rows.length, fixed, missing, left };
}
