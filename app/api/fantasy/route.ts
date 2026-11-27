import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { draftFantasy, fantasyBoard } from "@/lib/fantasy";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { TOO_MANY_VOTES, voteLimited } from "@/lib/limits";

const DraftInput = z.object({ picks: z.array(z.string().min(1).max(120)).min(1).max(3) });

/** The fantasy league (lib/fantasy.ts): the suitors with their points, and this viewer's draft, score and rank. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await fantasyBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_league", message: "This season has no fantasy league." }, 404, sess);
  return json(board, 200, sess);
});

/** Drafts (or redrafts) this viewer's three suitors, until the first ceremony's vote opens. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(DraftInput, await readJson(req), "invalid_draft");
  const db = await getDb();
  if (await voteLimited(db, "fantasy_draft", req.headers)) return json(TOO_MANY_VOTES, 429, sess);
  const result = await draftFantasy(db, sess.userId, input.picks);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("fantasy_draft", {});
  return json({ picks: result.picks }, 201, sess);
});
