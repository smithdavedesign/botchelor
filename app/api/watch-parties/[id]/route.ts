import { getDb } from "@/lib/db";
import { handle, json, userIdFromRequest } from "@/lib/http";
import { getRoomState } from "@/lib/watch";

/** The room's current state: content unlocked so far, live tallies and recent chat. Read-only. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const state = await getRoomState(await getDb(), id, userIdFromRequest(req));
  if (!state) return json({ error: "party_not_found" }, 404);
  return json(state);
});
