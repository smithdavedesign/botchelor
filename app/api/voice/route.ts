import { voicePickerOn } from "@/lib/voice";
import { VOICE_PICKS } from "@/lib/voice-picks";

/**
 * The voices an owner can pick for their character (lib/voice-picks.ts), for the builder's picker, and whether picking
 * is open (VOICE_PICKER). Public and the same for everyone.
 */
export async function GET() {
  const on = voicePickerOn();
  return Response.json(
    { on, picks: on ? VOICE_PICKS.map(({ id, label, sounds }) => ({ id, label, sounds })) : [] },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
