import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { VOICE_BATCH_MAX, voiceLines } from "@/lib/adult/voice-lines";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

// A few short lines through Kokoro: a second or two each.
export const maxDuration = 60;

const id = z.string().min(1).max(64);
/** The next few lines to play, by their place in the night and their words (the running scene, or a saved night). */
const Input = z.object({
  a: id,
  b: id,
  night_id: id.nullable().optional(),
  lines: z
    .array(z.object({ i: z.number().int().min(0).max(5000), text: z.string().min(1).max(4000) }))
    .min(1)
    .max(VOICE_BATCH_MAX),
});

/**
 * The lines' voices (lib/adult/voice-lines.ts): each one's audio id, made the first time it's asked for and kept, so a
 * replay costs nothing. The audio itself is served by /api/admin/after-dark/media/<id>.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await voiceLines(db, viewer, input);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ voices: r.voices });
});
