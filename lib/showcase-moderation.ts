/**
 * Reports and takedowns on the showcase (docs/PRDs/showcase.md): anyone who can see a post can report it, through the
 * site's own reports (lib/content-reports.ts: the admins emailed, the response promise said). A serious one (a minor, a
 * real person, non-consent, an intimate image) holds the post out of sight at once until an admin looks; the admin
 * releases it, or removes it for good (it can't be published again).
 */
import { isUrgent, type ContentReportCategory } from "./content-reports-shared";
import { saveContentReport } from "./content-reports";
import type { Db } from "./db";
import { postMedia, type ShowcaseViewer } from "./showcase";

/** A serious report holds a post at once; non-consent too (a character used without its owner's say). */
const HOLDS = (c: ContentReportCategory) => isUrgent(c) || c === "non_consent";

export async function reportPost(
  db: Db,
  v: ShowcaseViewer,
  postId: string,
  input: { category: ContentReportCategory; details: string | null },
  ctx: { userAgent: string | null },
): Promise<{ ok: true; held: boolean; promise: string } | { ok: false }> {
  if (!(await postMedia(db, v, postId))) return { ok: false };
  const saved = await saveContentReport(db, { category: input.category, target: `/showcase?post=${postId}`, details: input.details, email: null }, { userId: v.id, account: Boolean(v.id), userAgent: ctx.userAgent });
  const held = HOLDS(input.category);
  if (held) await db.query(`update showcase_posts set held = true where id = $1 and status <> 'removed'`, [postId]);
  return { ok: true, held, promise: saved.promise };
}

export type HeldPost = { id: string; handle: string; character: string; rating: string; mime: string | null; held: boolean; reports: number; caption: string | null };

/** For the moderators: posts held by a report, then any reported post still up, newest first. */
export async function moderationQueue(db: Db): Promise<HeldPost[]> {
  const { rows } = await db.query<HeldPost>(
    `select p.id, cp.handle, c.name as character, p.rating, p.held, p.caption,
            (select count(*)::int from content_reports r where r.target = '/showcase?post=' || p.id and r.status = 'open') as reports,
            coalesce((select i.mime from adult_images i where p.source = 'after_dark' and i.id = p.media_id), (select g.mime from studio_pg_pictures g where p.source = 'pg' and g.id = p.media_id)) as mime
       from showcase_posts p join creator_profiles cp on cp.user_id = p.owner_id join characters c on c.id = p.character_id
      where p.status <> 'removed' and (p.held or exists (select 1 from content_reports r where r.target = '/showcase?post=' || p.id and r.status = 'open'))
      order by p.held desc, p.created_at desc limit 100`,
  );
  return rows;
}

/** An admin's call: release (up again, its reports resolved) or remove (down for good, its reports resolved). */
export async function decidePost(db: Db, adminId: string, postId: string, decision: "release" | "remove"): Promise<boolean> {
  const r =
    decision === "release"
      ? await db.query(`update showcase_posts set held = false where id = $1 and status <> 'removed' returning id`, [postId])
      : await db.query(`update showcase_posts set status = 'removed', held = false where id = $1 returning id`, [postId]);
  if (!r.rows.length) return false;
  await db.query(`update content_reports set status = 'resolved', decided_at = now(), decided_by = $1, note = $2 where target = $3 and status = 'open'`, [adminId, `showcase: ${decision}`, `/showcase?post=${postId}`]);
  return true;
}

export type RerateResult = { ok: true; rating: "pg" | "suggestive" | "nsfw"; held: boolean; note: string } | { ok: false; status: number; message: string };

/**
 * An admin's correction of which side a post is on (David, 2026-10-29: "I see some nsfw in safe areas and vice versa"):
 *
 * - `after_dark`: explicit, at once. A rating may always go up (lib/content-rating.ts mayRerate), and the item's own
 *   rating goes up with it, so no other page shows it as safe either.
 * - `check`: the PG check again, fresh (a picture only). A pass brings the post and its item down to what it saw (pg or
 *   suggestive); nudity or sex takes them up to explicit; an age doubt holds the post out of sight as well. A check
 *   that couldn't run changes nothing.
 */
export async function reratePost(db: Db, postId: string, to: "after_dark" | "check"): Promise<RerateResult> {
  const post = (await db.query<{ source: "pg" | "after_dark"; media_id: string; rating: string }>(`select source, media_id, rating from showcase_posts where id = $1 and status <> 'removed'`, [postId])).rows[0];
  if (!post) return { ok: false, status: 404, message: "There's no such post." };
  const table = post.source === "pg" ? "studio_pg_pictures" : "adult_images";
  const set = async (rating: "pg" | "suggestive" | "nsfw", held = false) => {
    await db.query(`update showcase_posts set rating = $2, held = held or $3 where id = $1`, [postId, rating, held]);
    await db.query(`update ${table} set content_rating = $2 where id = $1`, [post.media_id, rating]);
  };
  if (to === "after_dark") {
    await set("nsfw");
    return { ok: true, rating: "nsfw", held: false, note: "Moved to After Dark." };
  }
  const row = (await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null }>(`select mime, data, object_key from ${table} where id = $1`, [post.media_id])).rows[0];
  if (!row) return { ok: false, status: 404, message: "Its picture isn't there any more." };
  if (!row.mime.startsWith("image/")) return { ok: false, status: 422, message: "Only a picture can be checked: a clip can only be moved to After Dark." };
  const { readBytes } = await import("./object-store");
  const bytes = await readBytes(row);
  if (!bytes) return { ok: false, status: 404, message: "Its picture couldn't be read." };
  const { checkRating } = await import("./adult/moderation");
  const v = await checkRating(db, { base64: bytes.toString("base64"), mime: row.mime });
  if (v.ok) {
    await set(v.rating);
    return { ok: true, rating: v.rating, held: false, note: v.rating === "pg" ? "The PG check passed it: safe for work, for everyone." : "The PG check rated it suggestive: safe for work, signed-in people only." };
  }
  if (!v.checked) return { ok: false, status: 503, message: `The check couldn't run (${v.reason}). Nothing changed.` };
  const age = /under 18|adult/.test(v.reason);
  await set("nsfw", age);
  return { ok: true, rating: "nsfw", held: age, note: `The check didn't pass it (${v.reason}): moved to After Dark${age ? " and held for a look in /admin/showcase" : ""}.` };
}
