import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { TOO_MANY_VOTES, voteLimited } from "@/lib/limits";
import { seasonFormatNow } from "@/lib/season-format-store";
import { seasonBallot, voteSeasonFormat } from "@/lib/season-vote";

const VoteInput = z.object({ pick: z.string().min(1).max(64) });

/** Next season's format ballot (lib/season-vote.ts), as this viewer sees it. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const db = await getDb();
  const current = (await seasonFormatNow(db)).slug;
  return json(await seasonBallot(db, sess.isNew ? null : sess.userId, current), 200, sess);
});

/** A vote (or a changed one) for next season's format: one a viewer, until the season turns. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  if (await voteLimited(db, "season_format_vote", req.headers)) return json(TOO_MANY_VOTES, 429, sess);
  const result = await voteSeasonFormat(db, sess.userId, input.pick);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("season_format_vote", { pick: result.pick });
  return json({ pick: result.pick, season_id: result.season_id }, 201, sess);
});
