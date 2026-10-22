import { z } from "zod";
import { track } from "@/lib/analytics";
import { recordChoice } from "@/lib/choice-history";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import {
  DRAMA_ANSWERS,
  ENDINGS,
  HIDDEN_EPISODE_MESSAGE,
  REPORT_HIDE_THRESHOLD,
  type DramaAnswer,
  type Ending,
} from "@/lib/rules";

const PredictionInput = z.object({
  episode_id: z.string().min(1).max(64),
  pick: z.enum(ENDINGS),
  drama_pick: z.enum(DRAMA_ANSWERS).optional(),
});

export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(PredictionInput, await readJson(req), "invalid_prediction");
  const db = await getDb();

  // One statement: insert (or change) the pick only while the episode is unaired, not hidden, and the
  // predictor owns neither character. FOR SHARE makes a concurrent air wait for, or exclude, this pick.
  // A pick without drama_pick keeps the earlier drama pick; an episode without a drama question stores none.
  const { rows } = await db.query<{ pick: Ending; drama_pick: DramaAnswer | null }>(
    `insert into predictions (episode_id, user_id, pick, drama_pick)
     select e.id, $2, $3, case when e.drama_question is null then null else $4::text end
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.revealed_at is null
        and not coalesce($2 in (a.owner_id, b.owner_id), false)
        and (select count(*) from reports r where r.episode_id = e.id) < $5
        for share of e
     on conflict (episode_id, user_id) do update
        set pick = excluded.pick,
            drama_pick = coalesce(excluded.drama_pick, predictions.drama_pick),
            updated_at = now()
     returning pick, drama_pick`,
    [input.episode_id, sess.userId, input.pick, input.drama_pick ?? null, REPORT_HIDE_THRESHOLD],
  );
  const saved = rows[0];
  if (saved) {
    track("prediction_submitted", { episode_id: input.episode_id, pick: saved.pick });
    // Every pick, not just the last: a changed mind is a signal too (lib/choice-history.ts).
    await recordChoice(db, { kind: "prediction", userId: sess.userId, episodeId: input.episode_id, value: { pick: saved.pick, drama_pick: saved.drama_pick } });
    const body = saved.drama_pick
      ? { episode_id: input.episode_id, pick: saved.pick, drama_pick: saved.drama_pick }
      : { episode_id: input.episode_id, pick: saved.pick };
    return json(body, 201, sess);
  }

  const episode = (
    await db.query<{ revealed: boolean; is_creator: boolean; hidden: boolean }>(
      `select e.revealed_at is not null as revealed,
              coalesce($2 in (a.owner_id, b.owner_id), false) as is_creator,
              (select count(*) from reports r where r.episode_id = e.id) >= $3 as hidden
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.id = $1`,
      [input.episode_id, sess.userId, REPORT_HIDE_THRESHOLD],
    )
  ).rows[0];
  if (!episode) return json({ error: "episode_not_found" }, 404, sess);
  if (episode.hidden && !episode.is_creator) {
    return json({ error: "episode_hidden", message: HIDDEN_EPISODE_MESSAGE }, 404, sess);
  }
  if (episode.revealed) {
    return json({ error: "episode_revealed", message: "The finale has aired; predictions are closed." }, 409, sess);
  }
  return json(
    { error: "creator_cannot_predict", message: "You already know how your own date ends." },
    403,
    sess,
  );
});
