import { z } from "zod";
import { mediaRefusal } from "@/lib/adult/place";
import { stepInViewer } from "@/lib/adult/step-in";
import { VOICE_PIECES_MAX } from "@/lib/adult/step-in-shared";
import { stepInVoice } from "@/lib/adult/step-in-voice";
import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// One short piece through the voice: a second or two.
export const maxDuration = 60;

/** Which piece of which reply: by the message and the piece's place in it, never by words. */
const Input = z.object({ message_id: z.string().min(1).max(64), piece: z.number().int().min(0).max(VOICE_PIECES_MAX - 1).default(0) });

/**
 * A piece of what a character says in a Step in scene, out loud (lib/adult/step-in-voice.ts): "Hear it" on a reply, and
 * the character's voice on a call. The answer is the audio itself (the viewer's own, never cached by anything between),
 * with how many pieces the reply has in `x-voice-pieces`. Not found for anyone Step in isn't open to; refused where only
 * text is allowed (lib/adult/place.ts), like every picture, video and voiced line.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const v = await stepInVoice(db, viewer, id, input.message_id, input.piece);
  if (!v.ok) return json({ error: v.error, message: v.message }, v.status);
  return new Response(new Uint8Array(v.bytes), {
    headers: { "content-type": v.mime, "cache-control": "private, no-store", "x-robots-tag": "noindex", "x-voice-pieces": String(v.pieces), ...AI_HEADERS },
  });
});
