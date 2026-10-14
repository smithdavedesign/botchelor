import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { createPremiereParty } from "@/lib/watch";

// Optional: how many seconds from now the premiere should start. Default 0 (premiere right away).
const Input = z.object({ starts_in_seconds: z.number().int().min(0).max(7 * 24 * 3600).optional() });

/**
 * The host schedules a watch party (premiere) of their own date: a synchronized room where the audience
 * reacts, chats and votes while the date plays out. Host-only, one room per episode (idempotent).
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req).catch(() => ({})), "invalid_request");
  const startsAt = new Date(Date.now() + (input.starts_in_seconds ?? 0) * 1000);
  const result = await createPremiereParty(await getDb(), id, sess.userId, startsAt);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  return json({ id: result.id, room_path: result.room_path }, 200, sess);
});
