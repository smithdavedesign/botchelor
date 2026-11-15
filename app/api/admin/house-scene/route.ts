import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { ensureChallenge, ensureConfrontation } from "@/lib/house-conflict";
import { ensureHouseScene } from "@/lib/house-scenes";
import { authFromRequest, handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";
// One call on the show's free model (25 s at most), then rows.
export const maxDuration = 60;

/**
 * Owner-only: write today's house scene now instead of waiting for its hour (lib/house-scenes.ts). Everything else
 * holds: one scene of a kind a day, only about public dates that aired, every line checked, nothing when HOUSE_SCENES=0.
 * `?kind=confrontation` stages today's confrontation now when a tension is due (the weekly cadence still holds);
 * `?kind=challenge` holds the week's challenge today whatever the weekday (lib/house-conflict.ts). For seeing the
 * feature on a new deploy, and for the visual audit's seeded season.
 */
export const POST = handle(async (req: Request) => {
  if (!frontierAuthorized(req) && !(await isSignedInAdmin(await getDb(), authFromRequest(req)))) {
    return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  }
  const db = await getDb();
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind === "confrontation") return json({ confrontation: await ensureConfrontation(db, new Date(), { anyHour: true }) });
  if (kind === "challenge") return json({ challenge: await ensureChallenge(db, new Date(), { anyHour: true, anyDay: true }) });
  return json({ house_scene: await ensureHouseScene(db, new Date(), { anyHour: true }) });
});
