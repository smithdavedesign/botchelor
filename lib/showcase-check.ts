/**
 * Dressed pictures off After Dark's side of the showcase (David, 2026-10-29: "in the gallery mode we added all the
 * dressed images of the nsfw. They don't make sense in the NSFW gallery. make sure assets are tagged correctly safe and
 * nsfw and live").
 *
 * Everything made in After Dark starts explicit (lib/content-rating.ts: fail closed), and an admin's pictures skip the
 * output check, so a dressed picture published from After Dark landed on the explicit side. Each such post is checked:
 *
 * - **Which:** a live After Dark post still rated explicit and never checked, unless it was asked to be nude or more
 *   (its level, its shoot's, a stage tag, a nude baseline): that one is explicit whatever a check says.
 * - **How:** the PG check, fresh, with its age question: a picture as it is, a clip by three frames (start, middle,
 *   end). A pass brings the item down to the stricter of every frame and what it was asked for, and the post to the
 *   safe side; if its SFW twin (lib/adult/sfw-twin.ts) is up already for as many people, the twin stays its one safe
 *   face and the original's post comes down. Nudity or sex keeps it explicit; an age doubt holds it out of sight for a
 *   look in /admin/showcase as well. A check that couldn't run changes nothing and is tried again next time.
 * - **When:** hourly (the DigitalOcean scheduled job in .do/app.yaml, /api/jobs/showcase-check), a few at a time, and from /admin/showcase.
 */
import type { Db } from "./db";
import { checkRating } from "./adult/moderation";
import { ratingForLevel, ratingOf, stricter, type ContentRating } from "./content-rating";
import { frameAt, videoDuration } from "./media-tools/ffmpeg";
import { readBytes } from "./object-store";

/** How many in one go: a clip is three checks and its frames cut, all inside one request. */
export const CHECK_BATCH = 12;
/** How many at once: each is a call or three to Venice's vision model. */
const AT_ONCE = 4;

const SHOOT_LEVEL = `case when sh.choices->>'level' ~ '^[0-3]$' then (sh.choices->>'level')::int end`;
const CANDIDATES = `
   from showcase_posts p join adult_images i on i.id = p.media_id
   left join adult_studio_shoots sh on sh.id = i.shoot_id
  where p.source = 'after_dark' and p.status = 'live' and not p.held and p.rating = 'nsfw' and p.checked_at is null
    and i.status = 'ready' and coalesce(i.attire, '') <> 'nude' and coalesce(i.level, 0) <= 1 and coalesce(${SHOOT_LEVEL}, 0) <= 1
    and not exists (select 1 from adult_media_tags t where t.media_id = i.id and t.kind = 'stage' and not t.removed and t.value in ('2', '3'))`;

/** A post to check, and the highest level it was asked for (null: nothing says). */
export type CheckTarget = { post_id: string; media_id: string; level: number | null };

/** The posts still to check, newest first. */
export async function checkTargets(db: Db, limit = 1000): Promise<CheckTarget[]> {
  return (
    await db.query<CheckTarget>(
      `select p.id as post_id, p.media_id,
              greatest(i.level, ${SHOOT_LEVEL},
                       (select max(t.value::int) from adult_media_tags t where t.media_id = i.id and t.kind = 'stage' and not t.removed and t.value ~ '^[0-3]$')) as level
       ${CANDIDATES} order by p.published_at desc nulls last, p.id limit $1`,
      [limit],
    )
  ).rows;
}

export async function checkCount(db: Db): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n ${CANDIDATES}`)).rows[0].n;
}

export type CheckResult =
  | { post_id: string; outcome: "safe"; rating: "pg" | "suggestive" }
  | { post_id: string; outcome: "twin"; rating: "pg" | "suggestive"; twin_post: string }
  | { post_id: string; outcome: "explicit"; held: boolean; reason: string }
  | { post_id: string; outcome: "skipped"; reason: string };

/** One post, checked and settled. Never throws. */
export async function checkPost(db: Db, t: CheckTarget): Promise<CheckResult> {
  const row = (await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(`select mime, data, object_key from adult_images where id = $1`, [t.media_id])).rows[0];
  const bytes = row ? await readBytes(row).catch(() => null) : null;
  if (!row || !bytes) return { post_id: t.post_id, outcome: "skipped", reason: "its media couldn't be read" };
  const frames: { base64: string; mime: string }[] = [];
  try {
    if (row.mime.startsWith("video/")) {
      const seconds = await videoDuration(bytes);
      for (const at of [0.1, seconds / 2, "end" as const]) frames.push({ base64: (await frameAt(bytes, at)).png.toString("base64"), mime: "image/png" });
    } else frames.push({ base64: bytes.toString("base64"), mime: row.mime });
  } catch (err) {
    return { post_id: t.post_id, outcome: "skipped", reason: `its frames couldn't be cut (${err instanceof Error ? err.message.slice(0, 120) : "error"})` };
  }
  let rating: ContentRating = t.level === null ? "pg" : ratingForLevel(t.level);
  for (const f of frames) {
    const v = await checkRating(db, f);
    if (!v.ok) {
      if (!v.checked) return { post_id: t.post_id, outcome: "skipped", reason: v.reason };
      // The same reading of an age doubt as an admin's own check (lib/showcase-moderation.ts reratePost).
      const held = /under 18|adult/.test(v.reason);
      await db.query(`update showcase_posts set held = held or $2, checked_at = now() where id = $1`, [t.post_id, held]);
      return { post_id: t.post_id, outcome: "explicit", held, reason: v.reason };
    }
    rating = stricter(rating, v.rating);
  }
  // Asked for suggestive at most, and every frame passed: pg or suggestive.
  const safe = rating as "pg" | "suggestive";
  await db.query(`update adult_images set content_rating = $2 where id = $1`, [t.media_id, safe]);
  const twin = (
    await db.query<{ id: string; rating: string }>(
      `select q.id, q.rating from showcase_posts q
         left join adult_images ti on q.source = 'after_dark' and ti.id = q.media_id
         left join studio_pg_pictures tp on q.source = 'pg' and tp.id = q.media_id
        where q.status = 'live' and coalesce(ti.twin_of, tp.twin_of) = $1`,
      [t.media_id],
    )
  ).rows.find((q) => stricter(ratingOf(q.rating), safe) === safe);
  if (twin) {
    // As an owner's Unpublish: the post goes, the picture stays theirs (and bestOf leaves it out from now on).
    await db.query(`delete from showcase_posts where id = $1`, [t.post_id]);
    return { post_id: t.post_id, outcome: "twin", rating: safe, twin_post: twin.id };
  }
  await db.query(`update showcase_posts set rating = $2, checked_at = now() where id = $1`, [t.post_id, safe]);
  return { post_id: t.post_id, outcome: "safe", rating: safe };
}

/** The next few posts, checked a few at a time. `left`: how many are still to check after these. */
export async function checkBatch(db: Db, size = CHECK_BATCH): Promise<{ ok: true; results: CheckResult[]; left: number }> {
  const todo = await checkTargets(db, size);
  const results: CheckResult[] = [];
  for (let i = 0; i < todo.length; i += AT_ONCE) results.push(...(await Promise.all(todo.slice(i, i + AT_ONCE).map((t) => checkPost(db, t)))));
  return { ok: true, results, left: await checkCount(db) };
}
