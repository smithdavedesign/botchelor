import { z } from "zod";
import { track } from "@/lib/analytics";
import { dareBoard, voteDare } from "@/lib/dares";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const VoteInput = z.object({ pick: z.string().min(1).max(64) });

/** Tonight's dare vote (lib/dares.ts), as this viewer sees it. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await dareBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_vote_today", message: "There's no dare vote today." }, 404, sess);
  return json(board, 200, sess);
});

/** A vote (or a changed one) on tonight's dare: one a viewer a day, until UTC midnight. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const result = await voteDare(await getDb(), sess.userId, input.pick);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("dare_vote", { pick: result.pick });
  return json({ pick: result.pick }, 201, sess);
});
