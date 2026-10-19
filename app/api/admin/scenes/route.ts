import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { listSceneRequests } from "@/lib/scenes";
import { drawMissingSets } from "@/lib/sets";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isAdmin(await getDb(), session(req).userId);
}

/** Owner-only: the places dates went that the library has no set for, most asked-for first (lib/scenes.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  return json({ scenes: await listSceneRequests(await getDb()) });
});

/** Owner-only: draws sets for the most-asked-for places that have none yet (lib/sets.ts), `limit` at a time (max 25). */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
  const limit = Math.min(25, Math.max(1, Number(body.limit) || 10));
  return json({ drawn: await drawMissingSets(await getDb(), limit) });
});
