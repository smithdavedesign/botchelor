import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { ensureHouseScene } from "@/lib/house-scenes";
import { authFromRequest, handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";
// One call on the show's free model (25 s at most), then rows.
export const maxDuration = 60;

/**
 * Owner-only: write today's house scene now instead of waiting for its hour (lib/house-scenes.ts). Everything else
 * holds: one scene a day, only about public dates that aired, every line checked, nothing when HOUSE_SCENES=0. For
 * seeing the feature on a new deploy, and for the visual audit's seeded season.
 */
export const POST = handle(async (req: Request) => {
  if (!frontierAuthorized(req) && !(await isSignedInAdmin(await getDb(), authFromRequest(req)))) {
    return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  }
  return json({ house_scene: await ensureHouseScene(await getDb(), new Date(), { anyHour: true }) });
});
