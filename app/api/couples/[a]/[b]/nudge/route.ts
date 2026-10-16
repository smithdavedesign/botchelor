import { z } from "zod";
import { clearNudge, NUDGE_MAX, setNudge } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

type Ctx = { params: Promise<{ a: string; b: string }> };

const Input = z.object({ character_id: z.string().min(1).max(64), note: z.string().max(NUDGE_MAX * 2) });

/**
 * An owner leaves their character a note about the person it's been dating ("bring up the boat"): it colours their
 * texts and goes into their next date together, then it's used (lib/between-dates.ts). character_id is the owner's
 * character, one of the couple.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.character_id !== a && input.character_id !== b) return json({ error: "not_in_couple", message: "That character isn't one of this couple." }, 422, sess);
  const other = input.character_id === a ? b : a;
  const result = await setNudge(await getDb(), sess.userId, input.character_id, other, input.note);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  return json({ character_id: input.character_id, about: other, note: result.note }, 200, sess);
});

const Clear = z.object({ character_id: z.string().min(1).max(64) });

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  const sess = session(req);
  const { character_id } = parseBody(Clear, await readJson(req), "invalid_request");
  if (character_id !== a && character_id !== b) return json({ error: "not_in_couple" }, 422, sess);
  await clearNudge(await getDb(), sess.userId, character_id, character_id === a ? b : a);
  return json({ cleared: true }, 200, sess);
});
