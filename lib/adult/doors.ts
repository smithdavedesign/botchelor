/**
 * After Dark's doors that depend on who's looking (David, 2026-11-15: "shouldn't we have an easier way to get to the
 * studio? or the showcase page in after dark?"). The header is Scenes · Studio · Gallery (Episodes a section of Scenes
 * since 2026-11-18), with the account beside the token count (app/Nav.tsx):
 *  - Studio is a door of its own (/after-dark/studio: whose Studio, and who's in). Where the Studio isn't open to this
 *    viewer (`studio.open_to`: admins until payments and age checks, lib/adult/studio-config.ts), the same page only
 *    holds the switches, so the door says what it holds: "Characters".
 *  - Showcase is a room of the Gallery since 2026-11-18 (Yours | Showcase, app/after-dark/GalleryTabs.tsx; it was a
 *    header door to the show's host, which "takes you out of after dark"): the creator showcase's After Dark side, on
 *    After Dark's own page (/after-dark/showcase), shown only to whoever may see that side (lib/showcase.ts
 *    showcaseViewer: an admin, or anyone once `studio.showcase.explicit_open` is on and media is allowed where they
 *    are). Everyone else's showcase is the show's own.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { mediaAllowedFor } from "./place";
import { rolloutOn } from "./rollout";
import { getAdultSettings } from "./settings";
import { notesWaitingCount } from "./step-in-notes";
import type { AdDoors } from "./door-links";

export async function afterDarkDoors(db: Db, userId: string): Promise<AdDoors> {
  const [admin, settings] = await Promise.all([isAdmin(db, userId), getAdultSettings(db)]);
  // A character wrote first in a Step in scene (lib/adult/step-in-notes.ts): counted only where Step in is open to them.
  const notes = rolloutOn(settings.rollout, "companion", admin) ? await notesWaitingCount(db, userId).catch(() => 0) : 0;
  if (admin) return { studio: true, showcase: true, notes };
  const showcase = settings.studio.showcase.explicit_open && (await mediaAllowedFor(db, userId));
  return { studio: settings.studio.open_to === "entitled", showcase, notes };
}
