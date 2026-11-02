import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { recouplingBoard, voteRecoupling } from "@/lib/recoupling";

const VoteInput = z.object({ pick: z.string().min(1).max(120) });

/** The recoupling night's vote and countdown (lib/recoupling.ts), as this viewer sees it. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await recouplingBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_recoupling", message: "No recoupling night is coming up." }, 404, sess);
  return json(board, 200, sess);
});

/** A vote (or a changed one) on the next recoupling night: one a viewer, until the night runs. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  const result = await voteRecoupling(db, sess.userId, input.pick);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("recoupling_vote", {});
  return json({ pick: result.pick }, 201, sess);
});
