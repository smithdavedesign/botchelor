/**
 * The After Dark door (the design review's A3; David, 2026-11-13: built, on admins only until payments are live). Who
 * sees the header's door, and whether the arrival screen (app/Threshold.tsx) shows, from the rollout switch
 * (lib/adult/rollout.ts public_door):
 *  - someone After Dark is open to (lib/adult/entitlement.ts) sees the door wherever it isn't blocked, as before;
 *  - once the door is opened to everyone, every adult where it isn't blocked sees it too, and lands on the subscribe page
 *    (app/after-dark/page.tsx) instead of not-found: the taste, the invite request, the waitlist;
 *  - the arrival screen shows to admins while it's on admins only, to everyone once it's open.
 */
import type { Db } from "../db";
import { getDb } from "../db";
import { requestPlace } from "../place";
import { shared } from "../shared-cache";
import { adultAvailable } from "./mode";
import { accessFor, accessHere } from "./place";
import { rolloutConfigOf, rolloutOn, type RolloutConfig } from "./rollout";
import { getAdultSettings } from "./settings";

/** The rollout switches, one shared copy for every visitor (read on every page's header). */
export async function adRollout(): Promise<RolloutConfig> {
  return shared("after-dark:rollout", async () => (await getAdultSettings(await getDb())).rollout).catch(() => rolloutConfigOf(null));
}

/** Whether the door is open to everyone: switched to everyone, and After Dark on at all. */
export async function publicDoorOpen(): Promise<boolean> {
  if ((await adRollout()).public_door !== "everyone") return false;
  return shared("after-dark:available", async () => adultAvailable(await getDb())).catch(() => false);
}

export type Door = { door: boolean; threshold: boolean };

/** The header's door for this viewer here, and whether crossing it shows the arrival screen. */
export async function afterDarkDoor(db: Db | null, auth: { userId: string; authenticated: boolean } | null, headers: Headers): Promise<Door> {
  const rollout = await adRollout();
  const here = db && auth ? await accessHere(db, auth, headers).catch(() => null) : null;
  const threshold = rolloutOn(rollout, "public_door", Boolean(here?.admin));
  if (here?.entitled.ok) return { door: here.mode !== "blocked", threshold };
  if (!(await publicDoorOpen())) return { door: false, threshold: false };
  const mode = here ? here.mode : accessFor(requestPlace(headers), false).mode;
  return { door: mode !== "blocked", threshold };
}
