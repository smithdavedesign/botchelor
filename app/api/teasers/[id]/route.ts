import { mediaBytes, mediaRef } from "@/lib/adult/media";
import { teaserAllowed } from "@/lib/asset-gate";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { teaserFor, teaserResponse } from "@/lib/teaser-image";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The blurred teaser of an After Dark picture (lib/teaser-image.ts), for the show's pages: its owner (or an admin)
 * sees that it's there without its bytes ever reaching the show. Signed in, never a bot, and only where After Dark is
 * offered; the picture must be one mediaRef would show them (theirs, ready, a keyframe only once its shot passed).
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = authFromRequest(req)?.userId ?? null;
  if (!viewer || !teaserAllowed(req)) return json({ error: "not_found" }, 404);
  const db = await getDb();
  if (!(await mediaRef(db, id, viewer))) return json({ error: "not_found" }, 404);
  const teaser = await teaserFor(db, { adult: id }, () => mediaBytes(db, id, viewer));
  return teaser ? teaserResponse(teaser) : json({ error: "not_found" }, 404);
});
