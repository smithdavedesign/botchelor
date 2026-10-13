import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { LEAGUE_MEMBER_CAP } from "@/lib/leagues";
import { requireProfileName } from "@/lib/people";

/** Join a league from its invite link. A repeat join is a 200; a full league is a 409. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();

  const league = (await db.query("select 1 from leagues where id = $1", [id])).rows[0];
  if (!league) return json({ error: "league_not_found" }, 404, sess);
  await requireProfileName(db, sess.userId);

  // Soft cap: two joins racing for the last seat can both get in, which is harmless for free points.
  const joined = await db.query(
    `insert into league_members (league_id, user_id)
     select $1, $2 where (select count(*) from league_members where league_id = $1) < $3
     on conflict (league_id, user_id) do nothing
     returning user_id`,
    [id, sess.userId, LEAGUE_MEMBER_CAP],
  );
  if (joined.rows.length) return json({ league_id: id, member: true }, 201, sess);

  const member = (
    await db.query("select 1 from league_members where league_id = $1 and user_id = $2", [id, sess.userId])
  ).rows[0];
  if (member) return json({ league_id: id, member: true }, 200, sess);
  return json({ error: "league_full", message: `A league holds at most ${LEAGUE_MEMBER_CAP} players.` }, 409, sess);
});
