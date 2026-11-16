import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { setSeasonPins, startersAdminView, STARTERS } from "@/lib/season-page";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts), as /api/admin/season. */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/**
 * The season page's "Start here" box (lib/season-page.ts, docs/season-page.md): which lead season takes pins now (this
 * one while it runs a lead format, else the next), its lead, the stored pins (each with whether it shows) and what
 * the box shows now.
 */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await startersAdminView(await getDb()));
});

const PinInput = z.object({
  season_id: z.string().min(4).max(10),
  // Episode ids or links (/episodes/<id>…), in the order the box shows them; an empty list goes back to the automatic picks.
  episode_ids: z.array(z.string().max(300)).max(STARTERS),
});

/** Pins up to three of the lead's dates for that season's page; each must pass the automatic picks' checks (400 otherwise). */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(PinInput, await readJson(req), "invalid_request");
  const db = await getDb();
  const result = await setSeasonPins(db, input.season_id, input.episode_ids);
  if (!result.ok) return json({ error: result.error, message: result.message, ...(result.failing ? { failing: result.failing } : {}) }, result.status);
  return json({ ...(await startersAdminView(db)), note: result.pins.length ? `Pinned ${result.pins.length}.` : "Back to the automatic picks." });
});
