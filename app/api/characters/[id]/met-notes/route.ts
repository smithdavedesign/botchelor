import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { MET_NOTE_MAX, noteMeeting } from "@/lib/memory";

type Ctx = { params: Promise<{ id: string }> };
const NoteInput = z.object({ about: z.string().min(1).max(64), note: z.string().min(1).max(MET_NOTE_MAX) });

/**
 * Your character's take on someone it met at a group night without dating (the web's "What did you think of them?",
 * the same as the remember_meeting tool): private to you, carried into a later first date with them. Owner only.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(NoteInput, await readJson(req), "invalid_request");
  const saved = await noteMeeting(await getDb(), sess.userId, id, input.about, input.note);
  if (!saved.ok) return json({ error: "note_refused", message: saved.error }, 422, sess);
  return json({ met: saved.met }, 200, sess);
});
