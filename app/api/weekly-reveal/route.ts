import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { revealBoard, voteReveal } from "@/lib/weekly-reveal";

const VoteInput = z.object({ pick: z.string().min(1).max(120) });

/** Sunday's reveal (lib/weekly-reveal.ts) as this viewer sees it: the countdown, the ballot while it's open, the last result. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await revealBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_reveal", message: "There's no reveal this week." }, 404, sess);
  return json(board, 200, sess);
});

/** A vote (or a changed one) on whose secret comes out this Sunday: one a viewer, while the window is open. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const result = await voteReveal(await getDb(), sess.userId, input.pick);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("reveal_vote", {});
  return json({ pick: result.pick }, 201, sess);
});
