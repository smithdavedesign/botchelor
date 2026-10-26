import { z } from "zod";
import { getDb } from "@/lib/db";
import { acceptDateLink } from "@/lib/date-invites";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

const Input = z.object({ character_id: z.string().min(1).max(64) });
type Ctx = { params: Promise<{ code: string }> };

/** Take a date link with one of your characters: a match with the date agreed, and the way to their thread. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await acceptDateLink(await getDb(), sess.userId, (await ctx.params).code, input.character_id);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ thread: r.thread, already: r.already }, 200, sess);
});
