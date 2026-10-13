import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { episodeCreatorIds, requireProfileName } from "@/lib/people";

const ConsentInput = z.object({ episode_id: z.string().min(1).max(64) });

/**
 * One creator agrees to reveal who made the episode. Names appear in episode responses only once
 * every creator has agreed: both on a blind date, the only one on a house date. Not to be confused
 * with POST /api/episodes/:id/reveal, which airs the finale.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(ConsentInput, await readJson(req), "invalid_request");
  const db = await getDb();

  const creators = await episodeCreatorIds(db, input.episode_id);
  if (!creators) return json({ error: "episode_not_found" }, 404, sess);
  if (!creators.includes(sess.userId)) {
    return json({ error: "not_creator", message: "Only the episode's creators can agree to reveal themselves." }, 403, sess);
  }
  await requireProfileName(db, sess.userId);

  const created = (
    await db.query(
      `insert into identity_consents (episode_id, user_id) values ($1, $2)
       on conflict (episode_id, user_id) do nothing
       returning user_id`,
      [input.episode_id, sess.userId],
    )
  ).rows.length;
  const consents = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from identity_consents where episode_id = $1 and user_id = any($2::text[])`,
      [input.episode_id, creators],
    )
  ).rows[0].n;

  return json(
    { episode_id: input.episode_id, identity_revealed: consents >= creators.length, consents, needed: creators.length },
    created ? 201 : 200,
    sess,
  );
});
