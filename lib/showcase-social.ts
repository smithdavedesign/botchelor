/**
 * The showcase's people (docs/PRDs/showcase.md; David's calls, 2026-10-29): the other owner's OK for a picture with their
 * character in it, likes, and following creators. No comments in v1.
 *
 *  - **The OK:** a post with someone else's character waits (`pending`) until every such owner says yes; one no takes
 *    it down. Each is told once, in neutral words (never what the picture shows), and sees it on /showcase/requests
 *    (an explicit one only if After Dark is open to them). Either owner can take it down later.
 *  - **Likes:** one per person per post they can see; Trending is the most liked this week.
 *  - **Follows:** a Following view of the showcase, and a quiet notice when a creator you follow publishes, at most once
 *    a day for each creator.
 */
import type { Db } from "./db";
import { notify } from "./notifications";
import { postMedia, type ShowcaseViewer } from "./showcase";

/** A creator who went live: their followers told, each at most once a day for that creator. */
export async function tellFollowers(db: Db, creatorId: string): Promise<void> {
  const c = (await db.query<{ handle: string; display_name: string }>(`select handle, display_name from creator_profiles where user_id = $1 and not hidden`, [creatorId])).rows[0];
  if (!c) return;
  const link = `/creators/${c.handle}`;
  const { rows } = await db.query<{ follower_id: string }>(
    `select f.follower_id from creator_follows f
      where f.creator_id = $1
        and not exists (select 1 from notifications n where n.user_id = f.follower_id and n.kind = 'showcase_post' and n.link = $2 and n.created_at > now() - interval '20 hours')`,
    [creatorId, link],
  );
  for (const r of rows) await notify(db, r.follower_id, { kind: "showcase_post", title: `📣 ${c.display_name} (@${c.handle}) posted on the showcase`, link });
}

/** Asks each other owner for their OK, once, in neutral words. */
export async function askForOk(db: Db, postId: string): Promise<void> {
  const { rows } = await db.query<{ owner_id: string; character: string }>(
    `select s.owner_id, c.name as character from showcase_consents s join characters c on c.id = s.character_id where s.post_id = $1 and s.status = 'asked'`,
    [postId],
  );
  for (const r of rows) await notify(db, r.owner_id, { kind: "showcase_request", title: `📣 Someone wants to share a picture with ${r.character} on the showcase`, link: "/showcase/requests" });
}

export type Request = { post_id: string; character: { id: string; name: string }; creator: { handle: string; display_name: string }; rating: string; caption: string | null; mime: string | null };

/** What's waiting on their OK. */
export async function myRequests(db: Db, viewer: string): Promise<Request[]> {
  const { rows } = await db.query<{ post_id: string; character_id: string; name: string; handle: string; display_name: string; rating: string; caption: string | null; mime: string | null }>(
    `select s.post_id, s.character_id, c.name, cp.handle, cp.display_name, p.rating, p.caption,
            coalesce((select i.mime from adult_images i where p.source = 'after_dark' and i.id = p.media_id), (select g.mime from studio_pg_pictures g where p.source = 'pg' and g.id = p.media_id)) as mime
       from showcase_consents s join showcase_posts p on p.id = s.post_id and p.status = 'pending'
       join characters c on c.id = s.character_id join creator_profiles cp on cp.user_id = p.owner_id
      where s.owner_id = $1 and s.status = 'asked' order by s.created_at desc`,
    [viewer],
  );
  return rows.map((r) => ({ post_id: r.post_id, character: { id: r.character_id, name: r.name }, creator: { handle: r.handle, display_name: r.display_name }, rating: r.rating, caption: r.caption, mime: r.mime }));
}

/**
 * Their answer for a post with their character in it: yes, and once every owner has said yes it goes live (the
 * publisher told, their followers too); no, and it comes down (the publisher told, in neutral words).
 */
export async function answerOk(db: Db, viewer: string, postId: string, yes: boolean): Promise<{ ok: true; status: "live" | "pending" | "declined" } | { ok: false }> {
  const r = await db.query(`update showcase_consents set status = $3 where post_id = $1 and owner_id = $2 and status = 'asked' returning post_id`, [postId, viewer, yes ? "yes" : "no"]);
  if (!r.rows.length) return { ok: false };
  const post = (await db.query<{ owner_id: string }>(`select owner_id from showcase_posts where id = $1`, [postId])).rows[0];
  if (!post) return { ok: false };
  if (!yes) {
    await db.query(`delete from showcase_posts where id = $1`, [postId]);
    await notify(db, post.owner_id, { kind: "showcase_answer", title: "📣 A showcase post wasn't OK'd by the other character's owner, so it's not up", link: "/showcase" });
    return { ok: true, status: "declined" };
  }
  const waiting = (await db.query(`select 1 from showcase_consents where post_id = $1 and status <> 'yes'`, [postId])).rows.length > 0;
  if (waiting) return { ok: true, status: "pending" };
  await db.query(`update showcase_posts set status = 'live', published_at = now() where id = $1 and status = 'pending'`, [postId]);
  await notify(db, post.owner_id, { kind: "showcase_answer", title: "📣 Your showcase post is live: the other owner said yes", link: "/showcase" });
  await tellFollowers(db, post.owner_id);
  return { ok: true, status: "live" };
}

/** A like on a post they can see, or taken back. */
export async function setLike(db: Db, v: ShowcaseViewer, postId: string, on: boolean): Promise<boolean> {
  if (!v.id || !(await postMedia(db, v, postId))) return false;
  if (on) await db.query(`insert into showcase_likes (post_id, user_id) values ($1, $2) on conflict do nothing`, [postId, v.id]);
  else await db.query(`delete from showcase_likes where post_id = $1 and user_id = $2`, [postId, v.id]);
  return true;
}

/** Following a creator by handle, or not; never yourself. */
export async function setFollow(db: Db, follower: string, handle: string, on: boolean): Promise<boolean> {
  const c = (await db.query<{ user_id: string }>(`select user_id from creator_profiles where handle = $1 and not hidden`, [handle.toLowerCase()])).rows[0];
  if (!c || c.user_id === follower) return false;
  if (on) await db.query(`insert into creator_follows (follower_id, creator_id) values ($1, $2) on conflict do nothing`, [follower, c.user_id]);
  else await db.query(`delete from creator_follows where follower_id = $1 and creator_id = $2`, [follower, c.user_id]);
  return true;
}

/** A creator's followers, and whether this viewer is one. */
export async function followState(db: Db, viewer: string | null, handle: string): Promise<{ followers: number; following: boolean; self: boolean }> {
  const r = (
    await db.query<{ followers: number; following: boolean; self: boolean }>(
      `select (select count(*)::int from creator_follows f where f.creator_id = cp.user_id) as followers,
              exists (select 1 from creator_follows f where f.creator_id = cp.user_id and f.follower_id = $2) as following,
              cp.user_id = $2 as self
         from creator_profiles cp where cp.handle = $1`,
      [handle.toLowerCase(), viewer],
    )
  ).rows[0];
  return r ?? { followers: 0, following: false, self: false };
}
