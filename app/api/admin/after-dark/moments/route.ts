import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { HivePausedError } from "@/lib/adult/hive-limit";
import { deriveClip, momentFrame, saveMoment } from "@/lib/adult/moments";
import { mediaRefusal } from "@/lib/adult/place";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// Cutting a frame takes a second or two; a boomerang or a loop is re-encoded (ffmpeg, a few seconds for a 10 s clip).
// The one route ffmpeg runs in (next.config.ts ships its binary here only: lib/media-tools/ffmpeg.ts).
export const maxDuration = 120;

const id = z.string().min(1).max(64);
/** A clip's moment (lib/adult/moments.ts): save the still at a second (or its end), or make a boomerang or a loop of it. */
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), media_id: id, at: z.union([z.number().min(0).max(600), z.literal("end")]) }),
  z.object({ action: z.literal("boomerang"), media_id: id }),
  z.object({ action: z.literal("loop"), media_id: id }),
  // The frame a clip keeps going from (lib/adult/clips.ts): cut and checked here, then kept going from by its id.
  z.object({ action: z.literal("frame"), media_id: id, at: z.union([z.number().min(0).max(600), z.literal("end")]) }),
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
  if (input.action === "frame") {
    try {
      return json({ frame: await momentFrame(db, viewer, input.media_id, input.at) });
    } catch (err) {
      if (err instanceof HivePausedError) return json({ error: "hive_paused", message: err.message }, 503);
      return json({ error: "not_cut", message: `That moment couldn't be cut from the video (${err instanceof Error ? err.message.slice(0, 160) : "error"}).` }, 502);
    }
  }
  const r = input.action === "save" ? await saveMoment(db, viewer, input.media_id, input.at) : await deriveClip(db, viewer, input.media_id, input.action);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ media: r.media });
});
