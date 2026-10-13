import { getDb } from "@/lib/db";
import type { Ending } from "@/lib/game";
import { handle, json, session } from "@/lib/http";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";

/**
 * The host (the creator who asked for the date) "airs the finale": predictions close and every pick
 * is scored from then on. Not to be confused with POST /api/reveal, the creators' identity consent.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();

  // Atomic status transition: only the host, only once, and not while hidden by reports (scoring a
  // hidden episode would let its predictors work out the ending they can no longer see).
  const revealed = (
    await db.query<{ ending: Ending }>(
      `update episodes e set revealed_at = now()
        where e.id = $1 and e.creator_id = $2 and e.revealed_at is null
          and (select count(*) from reports r where r.episode_id = e.id) < $3
       returning e.ending`,
      [id, sess.userId, REPORT_HIDE_THRESHOLD],
    )
  ).rows[0];

  if (!revealed) {
    const episode = (
      await db.query<{ is_host: boolean; revealed: boolean; hidden: boolean }>(
        `select e.creator_id = $2 as is_host, e.revealed_at is not null as revealed,
                (select count(*) from reports r where r.episode_id = e.id) >= $3 as hidden
           from episodes e where e.id = $1`,
        [id, sess.userId, REPORT_HIDE_THRESHOLD],
      )
    ).rows[0];
    if (!episode) return json({ error: "episode_not_found" }, 404, sess);
    if (!episode.is_host) {
      return json(
        { error: "not_creator", message: "Only the creator who asked for this date can air the finale." },
        403,
        sess,
      );
    }
    if (episode.revealed) return json({ error: "already_revealed" }, 409, sess);
    return json(
      { error: "episode_hidden", message: "This episode was hidden after reports and can't air until it's reviewed." },
      409,
      sess,
    );
  }

  const tally = (
    await db.query<{ total: number; correct: number }>(
      `select count(*)::int as total, (count(*) filter (where pick = $2))::int as correct
         from predictions where episode_id = $1`,
      [id, revealed.ending],
    )
  ).rows[0];

  return json({ id, ai_generated: true, revealed: true, ending: revealed.ending, predictions: tally }, 200, sess);
});
