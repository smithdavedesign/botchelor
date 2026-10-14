import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { SLIDING_DOOR_IDS } from "@/lib/rules";
import { slidingDoors } from "@/lib/simulation";

const Input = z.object({ change: z.enum(SLIDING_DOOR_IDS) });

/**
 * Sliding Doors (PRD): replay the owner's own date with one thing changed, reusing the stored seed.
 * No model call — the engine recomputes deterministically — so it costs nothing. Owner-only.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const result = await slidingDoors(await getDb(), id, sess.userId, input.change);
  if (!result) return json({ error: "episode_not_found", message: "Only the creator who asked for this date can replay it." }, 404, sess);
  return json(result, 200, sess);
});
