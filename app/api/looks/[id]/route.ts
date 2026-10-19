import { canAfterDark } from "@/lib/adult/entitlement";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { isTileId } from "@/lib/looks";
import { getTile } from "@/lib/looks-draw";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One looks-builder tile (lib/looks.ts). The show's are public and cached. After Dark's are sent only to an account
 * that can open After Dark (lib/adult/entitlement.ts); everyone else gets a 404 and the builder shows them blurred show
 * tiles instead, so an explicit picture never reaches someone who hasn't paid.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isTileId(id)) return json({ error: "not_found" }, 404);
  const db = await getDb();
  if (id.startsWith("nsfw-") && !(await canAfterDark(db, authFromRequest(req))).ok) return json({ error: "not_found" }, 404);
  const tile = await getTile(db, id);
  if (!tile) return json({ error: "not_found" }, 404);
  const cache = tile.variant === "nsfw" ? "private, max-age=3600" : "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
  return new Response(new Uint8Array(tile.data), { status: 200, headers: { "content-type": tile.mime, "cache-control": cache } });
});
