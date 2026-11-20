import { afterDarkOnly } from "@/lib/after-dark-host";
import { clipForOwner } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { handle, json, userIdFromRequest } from "@/lib/http";

export const dynamic = "force-dynamic";

/** A clip request's state, for its owner only (lib/clip-requests.ts): queued, rendering, ready (with its files) or failed. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (afterDarkOnly() || !/^[\w-]{1,64}$/.test(id)) return json({ error: "not_found" }, 404);
  const clip = await clipForOwner(await getDb(), id, userIdFromRequest(req));
  if (!clip) return json({ error: "not_found" }, 404);
  return json({ clip });
});
