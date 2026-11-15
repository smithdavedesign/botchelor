import { z } from "zod";
import { track } from "@/lib/analytics";
import { ceremonyBoard, voteCeremony } from "@/lib/ceremony";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const VoteInput = z.object({ pick: z.string().min(1).max(120) });

/** The rose ceremony's board (lib/ceremony.ts): the lead, the suitors, Sunday's vote and the last ceremony, as this viewer sees it. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await ceremonyBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_ceremony", message: "This season has no rose ceremony." }, 404, sess);
  return json(board, 200, sess);
});

/** A vote (or a changed one) on who goes home this Sunday: one a viewer, until the ceremony is held. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  const result = await voteCeremony(db, sess.userId, input.pick);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("ceremony_vote", {});
  return json({ pick: result.pick }, 201, sess);
});
