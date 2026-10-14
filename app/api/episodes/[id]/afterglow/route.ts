import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { episodeCreatorIds } from "@/lib/people";

/**
 * M11 — one owner opens the afterglow (the private morning-after thread). The thread and the mutual
 * verdict unlock in episode responses only once every real owner has opened it: both on a blind date,
 * the only one on a house date. Unlike the identity reveal, it exposes no names, so no profile is needed.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();

  const creators = await episodeCreatorIds(db, id);
  if (!creators) return json({ error: "episode_not_found" }, 404, sess);
  if (!creators.includes(sess.userId)) {
    return json({ error: "not_creator", message: "Only the episode's creators can open the afterglow." }, 403, sess);
  }

  const created = (
    await db.query(
      `insert into afterglow_consents (episode_id, user_id) values ($1, $2)
       on conflict (episode_id, user_id) do nothing
       returning user_id`,
      [id, sess.userId],
    )
  ).rows.length;
  const consents = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from afterglow_consents where episode_id = $1 and user_id = any($2::text[])`,
      [id, creators],
    )
  ).rows[0].n;

  return json(
    { episode_id: id, afterglow_revealed: consents >= creators.length, consents, needed: creators.length },
    created ? 201 : 200,
    sess,
  );
});
