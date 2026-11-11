import { z } from "zod";
import { CALL_VOICE_MAX_MESSAGES, callVoice } from "@/lib/companion-call-voice";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { visitorKey } from "@/lib/limits";
import { companionRefusal } from "../../access";

// The audio is made per request, never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Input = z.object({ message_ids: z.array(z.string().min(1).max(64)).min(1).max(CALL_VOICE_MAX_MESSAGES) });

/**
 * A taking-turns call's reply in the character's own voice (lib/companion-call-voice.ts): the stored, checked reply
 * said by Deepgram Aura, as a WAV for the call to play. Refused (JSON) when it's off, isn't theirs, wasn't said on the
 * call, was said already, or Aura is down: the call then says it in the device's voice.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const guest = !sess.authenticated;
  const r = await callVoice(db, sess.userId, id, input.message_ids, { guest, guestKey: guest ? visitorKey(req.headers) : null, signal: req.signal });
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return new Response(r.audio, {
    status: 200,
    headers: { "content-type": "audio/wav", "content-length": String(r.audio.byteLength), "cache-control": "no-store" },
  });
});
