import { z } from "zod";
import { track } from "@/lib/analytics";
import { backCastMember, backingBoard } from "@/lib/backing";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const BackInput = z.object({ character_id: z.string().min(1).max(64) });

/** This month's backing board (lib/backing.ts), as this viewer sees it. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const board = await backingBoard(await getDb(), sess.isNew ? null : sess.userId);
  if (!board) return json({ error: "no_cast", message: "There's no season cast to back." }, 404, sess);
  return json(board, 200, sess);
});

/** Back a cast member for the month (one pick a viewer; changeable until mid-month, then locked). */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(BackInput, await readJson(req), "invalid_backing");
  const result = await backCastMember(await getDb(), sess.userId, input.character_id);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("cast_backed", { character: result.character_id });
  return json({ character_id: result.character_id }, 201, sess);
});
