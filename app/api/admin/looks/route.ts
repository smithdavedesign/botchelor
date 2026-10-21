import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { drawMissingTiles, tileProgress } from "@/lib/looks-draw";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";
// A batch of pictures, each screened by Hive, takes a while.
export const maxDuration = 300;

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const denied = () => json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);

/** Owner-only: how far the looks builder's tiles are drawn (lib/looks-draw.ts), and any refused with why. */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return denied();
  return json(await tileProgress(await getDb()));
});

/**
 * Owner-only: draws tiles not drawn yet, `limit` at a time (max 40). `variant` "pg" or "nsfw" narrows it; `only` names
 * tiles. Each is drawn once: a refused tile stays refused, and a drawn one is never redrawn.
 */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return denied();
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown; variant?: unknown; only?: unknown };
  const variant = body.variant === "pg" || body.variant === "nsfw" ? body.variant : undefined;
  const only = Array.isArray(body.only) ? body.only.filter((x): x is string => typeof x === "string").slice(0, 40) : undefined;
  return json({ drawn: await drawMissingTiles(await getDb(), { limit: Number(body.limit) || 10, variant, only }) });
});
