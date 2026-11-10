import { z } from "zod";
import { FIX_KINDS, FIX_NOTE_MAX, fixPicture, fixState, keepVersion, REPAIR_IDS } from "@/lib/adult/fix";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// A fix is one edit (two for two faces on Venice), then the check: a minute or so.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
/** A marked spot, as fractions of the picture (lib/adult/fix.ts cleanSpot makes it sane). */
const Spot = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) });
/**
 * Fix one of the owner's pictures (lib/adult/fix.ts): faces, repair (chips and words), change (words) or undress, a spot
 * for repair and change; or keep one of a picture's versions, the one the galleries show.
 */
const Input = z.union([
  z.object({ action: z.literal("keep"), media_id: id }),
  z.object({
    action: z.literal("fix").optional(),
    media_id: id,
    kind: z.enum(FIX_KINDS),
    repairs: z.array(z.enum(REPAIR_IDS as [string, ...string[]])).max(REPAIR_IDS.length).optional(),
    // Longer than the cap is cut there (cleanCustom), not refused.
    note: z.string().max(FIX_NOTE_MAX * 4).optional(),
    spot: Spot.nullable().optional(),
    who: id.nullable().optional(),
  }),
]);

/** Not found for everyone but a viewer After Dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** The Fix sheet's state for a picture: its versions, the fixes left, and whether Undressed can be had, for what. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const mediaId = new URL(req.url).searchParams.get("media_id") ?? "";
  if (!mediaId || mediaId.length > 64) return json({ error: "invalid_request", message: "Which picture?" }, 422);
  const r = await fixState(db, viewer, mediaId);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ state: r.state });
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.action === "keep") {
    const r = await keepVersion(db, viewer, input.media_id);
    if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
    return json({ kept: r.kept, picture: r.picture, hidden: r.hidden, state: r.state });
  }
  const r = await fixPicture(db, viewer, input.media_id, { kind: input.kind, repairs: input.repairs, note: input.note ?? null, spot: input.spot ?? null, who: input.who ?? null }, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  const state = await fixState(db, viewer, r.picture.id);
  return json({ picture: r.picture, original: r.original, root: r.root, state: state.ok ? state.state : null });
});
