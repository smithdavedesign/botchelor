import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { deriveClip, saveMoment } from "@/lib/adult/moments";
import { mediaRefusal } from "@/lib/adult/place";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// Cutting a frame takes a second or two; a boomerang or a loop is re-encoded (ffmpeg, a few seconds for a 10 s clip).
export const maxDuration = 120;

const id = z.string().min(1).max(64);
/** A clip's moment (lib/adult/moments.ts): save the still at a second (or its end), or make a boomerang or a loop of it. */
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), media_id: id, at: z.union([z.number().min(0).max(600), z.literal("end")]) }),
  z.object({ action: z.literal("boomerang"), media_id: id }),
  z.object({ action: z.literal("loop"), media_id: id }),
]);

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = input.action === "save" ? await saveMoment(db, viewer, input.media_id, input.at) : await deriveClip(db, viewer, input.media_id, input.action);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ media: r.media });
});
