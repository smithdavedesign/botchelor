import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { renderClip } from "@/lib/live-face/compare";
import { authFromRequest, handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** One render's clip (lib/live-face/compare.ts), for the compare page's players; admins only. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const db = await getDb();
  if (!(await isSignedInAdmin(db, authFromRequest(req)))) return json({ error: "not_found" }, 404);
  const { id } = await ctx.params;
  const bytes = await renderClip(db, id);
  if (!bytes) return json({ error: "not_found" }, 404);
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "video/mp4", "cache-control": "private, max-age=3600", "content-length": String(bytes.length) } });
});
