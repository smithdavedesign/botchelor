import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { episodeCreatorIds } from "@/lib/people";

const BlockInput = z.object({ episode_id: z.string().min(1).max(64) });

/**
 * Blocks are made from an episode, because creators are anonymous: you block "whoever made this",
 * never a name. Your feed then skips their characters from that episode, and blind dates never pair
 * you again (a server-side check nobody can observe). Every response depends only on your own
 * blocks of *this* episode, so blocking can't be used to tell which episodes share a creator.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(BlockInput, await readJson(req), "invalid_request");
  const db = await getDb();

  const creators = await episodeCreatorIds(db, input.episode_id);
  if (!creators) return json({ error: "episode_not_found" }, 404, sess);
  const others = creators.filter((id) => id !== sess.userId);
  if (!others.length) {
    return json(
      { error: "nothing_to_block", message: "This is your own date with a house character: there's nobody to block." },
      422,
      sess,
    );
  }

  const inserted = await db.query(
    `insert into blocks (blocker_id, via_episode_id, blocked_id)
     select $1, $2, blocked from unnest($3::text[]) as blocked
     on conflict (blocker_id, via_episode_id, blocked_id) do nothing
     returning blocked_id`,
    [sess.userId, input.episode_id, others],
  );
  return json({ episode_id: input.episode_id, blocked: true }, inserted.rows.length ? 201 : 200, sess);
});

/** Removes the blocks made from this episode. */
export const DELETE = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(BlockInput, await readJson(req), "invalid_request");
  const db = await getDb();

  if (!(await episodeCreatorIds(db, input.episode_id))) return json({ error: "episode_not_found" }, 404, sess);
  await db.query(`delete from blocks where blocker_id = $1 and via_episode_id = $2`, [sess.userId, input.episode_id]);
  return json({ episode_id: input.episode_id, blocked: false }, 200, sess);
});
