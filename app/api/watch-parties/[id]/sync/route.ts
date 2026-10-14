import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { syncRoom } from "@/lib/watch";

/**
 * The polling heartbeat: marks the viewer present (for the live "N watching" count), starts a template
 * room on the first join, airs the finale once the clock reaches the decision, and returns the fresh
 * room state. The client calls this on open and every few seconds. Anonymous viewers get a cookie here.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const state = await syncRoom(await getDb(), id, sess.userId);
  if (!state) return json({ error: "party_not_found" }, 404, sess);
  return json(state, 200, sess);
});
