/**
 * Who gets a stored picture's bytes, decided from its strict content tag alone (lib/content-rating.ts). Every route
 * that sends a show asset asks here (app/api/assets/[id]); After Dark's own media route keeps its stricter rules
 * (owner-scoped, lib/adult/media.ts), and its pictures are all nsfw.
 *
 * - pg: anyone, cached publicly as before.
 * - suggestive: a signed-in person, never a bot; private cache only, so the CDN never holds a copy for everyone.
 * - nsfw: the owner of the character (or an admin) when After Dark is open to them and pictures are allowed where they
 *   are. Anyone else signed in, where After Dark is offered, gets the blurred teaser; a bot, a stranger, or someone
 *   where After Dark is blocked gets nothing at all.
 */
import { isAdmin } from "./admins";
import { adultViewer } from "./adult/mode";
import { mediaAllowedFor } from "./adult/place";
import { detectBot } from "./bots";
import { audienceFor, type ContentRating } from "./content-rating";
import type { Db } from "./db";
import { authFromRequest } from "./http";
import { afterDarkAccess } from "./jurisdiction";
import { requestPlace } from "./place";

export const PUBLIC_CACHE = "public, max-age=31536000, immutable";
export const PRIVATE_CACHE = "private, max-age=3600";

export type AssetServe = { serve: "full"; cache: string } | { serve: "teaser" } | { serve: "none" };

/** Whether this request may be sent a blurred teaser: a signed-in person (not a bot) somewhere After Dark is open. */
export function teaserAllowed(req: Request): boolean {
  if (detectBot(req.headers.get("user-agent"))) return false;
  if (!authFromRequest(req)?.authenticated) return false;
  return afterDarkAccess(requestPlace(req.headers)).mode === "open";
}

/** What to send for an asset of `rating` belonging to the character `characterId` (null: a shared asset). */
export async function assetServe(db: Db, req: Request, rating: ContentRating, characterId: string | null): Promise<AssetServe> {
  const audience = audienceFor(rating);
  if (audience === "everyone") return { serve: "full", cache: PUBLIC_CACHE };
  if (detectBot(req.headers.get("user-agent"))) return { serve: "none" };
  if (audience === "signed_in") return authFromRequest(req)?.authenticated ? { serve: "full", cache: PRIVATE_CACHE } : { serve: "none" };
  const viewer = await adultViewer(db, req);
  if (viewer && (await mediaAllowedFor(db, viewer)) && (await ownsOrAdmin(db, viewer, characterId))) return { serve: "full", cache: PRIVATE_CACHE };
  return teaserAllowed(req) ? { serve: "teaser" } : { serve: "none" };
}

async function ownsOrAdmin(db: Db, viewer: string, characterId: string | null): Promise<boolean> {
  if (await isAdmin(db, viewer)) return true;
  if (!characterId) return false;
  const r = await db.query<{ owner_id: string | null }>(`select owner_id from characters where id = $1`, [characterId]);
  return r.rows[0]?.owner_id === viewer;
}
