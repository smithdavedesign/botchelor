import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { listSceneRequests } from "@/lib/scenes";
import { drawMissingSets, drawQueuedSets, listSetQueue } from "@/lib/sets";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

/** Owner-only: the places dates went that the library has no set for, most asked-for first (lib/scenes.ts), and the queue of sets still to draw (lib/sets.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  const db = await getDb();
  return json({ scenes: await listSceneRequests(db), queue: await listSetQueue(db) });
});

/** Owner-only: draws sets for the most-asked-for places that have none yet (lib/sets.ts), `limit` at a time (max 25). */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown; queue?: unknown };
  const limit = Math.min(25, Math.max(1, Number(body.limit) || 10));
  const db = await getDb();
  // The queue of sets scenes are waiting on (lib/sets.ts listSetQueue), or the most-asked-for places dates went.
  if (body.queue === true) return json({ drawn: await drawQueuedSets(db, limit), queue: await listSetQueue(db) });
  return json({ drawn: await drawMissingSets(db, limit) });
});
