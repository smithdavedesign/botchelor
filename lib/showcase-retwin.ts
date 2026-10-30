/**
 * The older SFW twins drawn again with today's prompt (David, 2026-10-30: "go for it the older SFW twins"; some kept
 * the original's suggestive pose, made with the first prompt's "framed the same way", lib/adult/sfw-twin.ts).
 *
 * For each of the owner's twins on the showcase made with the first prompt: a new twin of the same original (the
 * stricter prompt, kept only when the PG check says pg), published in its place. The old twin's post comes down (as an
 * owner's Unpublish; the picture stays in their gallery), and so does its living portrait, so the reels show the new
 * pose (the next 🎬 run brings the new one to life). One that can't be drawn again keeps its old post. Each twin once
 * (showcase_retwins).
 */
import type { Db } from "./db";
import { TWIN_PLACEHOLDERS } from "./adult/sfw-twin";
import { publish } from "./showcase";

/** How many at once: each is a Venice edit of a minute or so and its check, all inside one request. */
export const RETWIN_BATCH = 3;

/** A twin made with the first prompt: its prompt says so, or it's a placeholder (made before prompts were kept). */
const OLD = `(t.prompt is null or t.prompt like 'Make Picture 1 again%' or t.prompt = any($2::text[]))`;

export type RetwinTarget = { old_id: string; source: "pg" | "after_dark"; original: string; post_id: string };

/** The owner's twins on the showcase still in their first prompt's pose, newest first. */
export async function retwinTargets(db: Db, owner: string): Promise<RetwinTarget[]> {
  return (
    await db.query<RetwinTarget>(
      `select t.id as old_id, 'pg' as source, t.twin_of as original, p.id as post_id, p.published_at
         from studio_pg_pictures t join showcase_posts p on p.source = 'pg' and p.media_id = t.id and p.status = 'live'
        where t.owner_id = $1 and t.twin_of is not null and ${OLD} and not exists (select 1 from showcase_retwins r where r.old_id = t.id)
       union all
       select t.id, 'after_dark', t.twin_of, p.id, p.published_at
         from adult_images t join showcase_posts p on p.source = 'after_dark' and p.media_id = t.id and p.status = 'live'
        where t.owner_id = $1 and t.twin_of is not null and t.status = 'ready' and ${OLD} and not exists (select 1 from showcase_retwins r where r.old_id = t.id)
       order by published_at desc nulls last, old_id`,
      [owner, TWIN_PLACEHOLDERS],
    )
  ).rows.map(({ old_id, source, original, post_id }) => ({ old_id, source, original, post_id }));
}

export type RetwinResult = { old_id: string; ok: true; new_post: string } | { old_id: string; ok: false; reason: string };

/** One twin drawn again and swapped in. A failure leaves the old one up. Never throws. */
export async function retwin(db: Db, owner: string, t: RetwinTarget, baseUrl: string): Promise<RetwinResult> {
  const note = async (newId: string | null, status: "done" | "failed", why: string | null) => {
    await db.query(`insert into showcase_retwins (old_id, new_id, status, note) values ($1, $2, $3, $4) on conflict (old_id) do nothing`, [t.old_id, newId, status, why?.slice(0, 200) ?? null]);
  };
  try {
    const { sfwTwin } = await import("./adult/sfw-twin");
    const made = await sfwTwin(db, owner, t.original, baseUrl);
    if (!made.ok) {
      // Venice or the check busy: tried again next time; anything else (not PG, gone): left as it is.
      if (made.status >= 500 || made.status === 409) return { old_id: t.old_id, ok: false, reason: made.message };
      await note(null, "failed", made.message);
      return { old_id: t.old_id, ok: false, reason: made.message };
    }
    const caption = (await db.query<{ caption: string | null; show_prompt: boolean }>(`select caption, show_prompt from showcase_posts where id = $1`, [t.post_id])).rows[0];
    const posted = await publish(db, owner, { source: made.where === "pg" ? "pg" : "after_dark", media_id: made.picture.id, caption: caption?.caption ?? null, show_prompt: caption?.show_prompt ?? true });
    if (!posted.ok) {
      await note(made.picture.id, "failed", `drawn, not published: ${posted.message}`);
      return { old_id: t.old_id, ok: false, reason: posted.message };
    }
    // The old twin's living portrait shows the old pose too: down with it.
    await db.query(
      `update showcase_posts set status = 'removed' where id in (select l.post_id from showcase_loops l where l.source = 'post' and l.source_id = $1 and l.post_id is not null)`,
      [t.post_id],
    );
    await db.query(`delete from showcase_posts where id = $1`, [t.post_id]);
    await note(made.picture.id, "done", null);
    return { old_id: t.old_id, ok: true, new_post: posted.post_id };
  } catch (err) {
    return { old_id: t.old_id, ok: false, reason: err instanceof Error ? err.message.slice(0, 160) : "error" };
  }
}

/** The next few. `left`: how many are still to do after these. */
export async function retwinBatch(db: Db, owner: string, baseUrl: string): Promise<{ ok: true; results: RetwinResult[]; left: number }> {
  const todo = await retwinTargets(db, owner);
  const batch = todo.slice(0, RETWIN_BATCH);
  const results = await Promise.all(batch.map((t) => retwin(db, owner, t, baseUrl)));
  return { ok: true, results, left: (await retwinTargets(db, owner)).length };
}
