import { z } from "zod";
import { track } from "@/lib/analytics";
import { bombshellBoard, voteBombshell } from "@/lib/bombshell";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { TOO_MANY_VOTES, voteLimited } from "@/lib/limits";

const VoteInput = z.object({ pick: z.string().min(1).max(120) });

/** The bombshell (lib/bombshell.ts): the mid-season vote on which audition walks into the house, as this viewer sees it. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await bombshellBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_bombshell", message: "No bombshell this season." }, 404, sess);
  return json(board, 200, sess);
});

/** A vote (or a changed one) for who walks in: one a viewer, until it closes. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  if (await voteLimited(db, "bombshell_vote", req.headers)) return json(TOO_MANY_VOTES, 429, sess);
  const result = await voteBombshell(db, sess.userId, input.pick);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("bombshell_vote", {});
  return json({ pick: result.pick }, 201, sess);
});
