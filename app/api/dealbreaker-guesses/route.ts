import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { getDealbreakerQuiz } from "@/lib/mechanics";
import { HIDDEN_EPISODE_MESSAGE, REPORT_HIDE_THRESHOLD } from "@/lib/rules";

const Input = z.object({ episode_id: z.string().min(1).max(64), pick: z.string().min(1).max(200) });

/**
 * Guess the dealbreaker (PRD "Further ideas"): a spectator picks character_a's real dealbreaker from the
 * four options. Same guards as a prediction — unaired, not hidden, not a creator — and the pick must be
 * one of the four options. Scored at reveal like the drama pick (lib/game.ts getPoints).
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_guess");
  const db = await getDb();

  const quiz = await getDealbreakerQuiz(db, input.episode_id, sess.userId);
  if (!quiz) return json({ error: "episode_not_found" }, 404, sess);
  if (!quiz.options.includes(input.pick)) {
    // Say the four, so a wrong guess can be corrected in one go (2026-10-20 visitor).
    return json({ error: "invalid_pick", message: `Pick one of the four options: ${quiz.options.map((o, i) => `${i + 1}. ${o}`).join("; ")}.`, options: quiz.options }, 422, sess);
  }

  const { rows } = await db.query<{ pick: string }>(
    `insert into dealbreaker_guesses (episode_id, user_id, pick)
     select e.id, $2, $3
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.revealed_at is null
        and not coalesce($2 in (a.owner_id, b.owner_id), false)
        and (select count(*) from reports r where r.episode_id = e.id) < $4
        for share of e
     on conflict (episode_id, user_id) do update set pick = excluded.pick, created_at = now()
     returning pick`,
    [input.episode_id, sess.userId, input.pick, REPORT_HIDE_THRESHOLD],
  );
  if (rows[0]) return json({ episode_id: input.episode_id, pick: rows[0].pick }, 201, sess);

  // Work out why nothing was stored, exactly as the predictions route does.
  const ep = (
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
  if (!ep) return json({ error: "episode_not_found" }, 404, sess);
  if (ep.hidden && !ep.is_creator) return json({ error: "episode_hidden", message: HIDDEN_EPISODE_MESSAGE }, 404, sess);
  if (ep.revealed) return json({ error: "episode_revealed", message: "The finale has aired; guesses are closed." }, 409, sess);
  return json({ error: "creator_cannot_guess", message: "You wrote this character's dealbreaker." }, 403, sess);
});
