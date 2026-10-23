import { canAfterDark } from "@/lib/adult/entitlement";
import { lockedForRequest } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { isTileId } from "@/lib/looks";
import { getTile } from "@/lib/looks-draw";
import { objectStore } from "@/lib/object-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One looks-builder tile (lib/looks.ts). The show's are public and cached. After Dark's are sent only to an account
 * that can open After Dark (lib/adult/entitlement.ts); everyone else gets a 404 and the builder shows them blurred show
 * tiles instead, so an explicit picture never reaches someone who hasn't paid.
 *
 * In the private bucket (lib/object-store.ts), an After Dark tile is a redirect to a short-lived presigned link, made
 * only after that check. A show tile is still sent from here: the CDN keeps it for a week, so it's rarely read, and a
 * shared cache must never hold a redirect to a link that expires.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isTileId(id)) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const nsfw = id.startsWith("nsfw-");
  const auth = nsfw ? authFromRequest(req) : null;
  if (nsfw && !(await canAfterDark(db, auth)).ok) return json({ error: "not_found" }, 404);
  // Nor to a device locked by the account's After Dark PIN (lib/adult/privacy.ts).
  if (nsfw && (await lockedForRequest(db, auth!.userId, req))) return json({ error: "not_found" }, 404);
  const tile = await getTile(db, id, { bytes: !nsfw });
  if (!tile) return json({ error: "not_found" }, 404);
  const store = tile.key && tile.variant === "nsfw" ? objectStore() : null;
  if (store && tile.key) {
    const link = await store.presign(tile.key);
    return new Response(null, {
      status: 302,
      headers: { location: link.url, "cache-control": `private, max-age=${Math.min(3600, link.maxAge)}`, "referrer-policy": "no-referrer" },
    });
  }
  if (!tile.data) return json({ error: "not_found" }, 404);
  const cache = tile.variant === "nsfw" ? "private, max-age=3600" : "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
  return new Response(new Uint8Array(tile.data), { status: 200, headers: { "content-type": tile.mime, "cache-control": cache } });
});
