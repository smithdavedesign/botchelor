import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { WATCH_REACTION_EMOJIS } from "@/lib/rules";
import { toggleReaction } from "@/lib/watch";

const Input = z.object({ emoji: z.enum(WATCH_REACTION_EMOJIS) });

/** Toggles one of the viewer's emoji reactions on the room (one of each per viewer, so it can't be spammed). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_reaction");
  const result = await toggleReaction(await getDb(), id, sess.userId, input.emoji);
  if (!result.ok) return json({ error: result.error }, result.status, sess);
  return json({ emoji: result.emoji, count: result.count, mine: result.mine }, 200, sess);
});
