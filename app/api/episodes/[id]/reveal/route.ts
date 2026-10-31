import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { airEpisode } from "@/lib/air";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";

/**
 * The host (the creator who asked for the date) "airs the finale": predictions close and every pick
 * is scored from then on. Not to be confused with POST /api/reveal, the creators' identity consent.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();

  // Only the host, only once, only once it's ready (an agent can ask early: air_date), and not while hidden by reports
  // (scoring a hidden episode would let its predictors work out the ending they can no longer see). lib/air.ts.
  // #1032: the host aired it themselves, so they need no "aired" notice (its other owner still gets one).
  const revealed = await airEpisode(db, id, sess.userId, { airedBy: sess.userId });
  if (!revealed) {
    const episode = (
      await db.query<{ is_host: boolean; revealed: boolean; hidden: boolean; ready: boolean; offline: boolean }>(
        `select e.creator_id = $2 as is_host, e.revealed_at is not null as revealed, e.status = 'ready' as ready,
                e.visibility = 'private' as offline,
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
    if (!episode.ready) return json({ error: "not_ready", message: "It's still being filmed: air it once its status is 'ready'." }, 409, sess);
    if (episode.offline) {
      return json(
        { error: "offline", message: "This date is private, so it stays offline and never airs. Make it public or unlisted (on its page, or set_date_visibility for an agent) to put it on the air." },
        409,
        sess,
      );
    }
    return json(
      { error: "episode_hidden", message: "This episode was hidden after reports and can't air until it's reviewed." },
      409,
      sess,
    );
  }

  return json({ id, ai_generated: true, revealed: true, ending: revealed.ending, predictions: revealed.predictions }, 200, sess);
});
