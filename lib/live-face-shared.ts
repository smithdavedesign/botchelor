/**
 * A live face on a call, the part the browser shares with the server (lib/live-face/index.ts mints it;
 * app/companion/[id]/LiveFace.tsx shows it): which renderer, what the browser needs to open it, and the audio it takes.
 *
 *  - `simli`: the browser opens Simli's stream with a five-minute token and sends it the voice (lib/live-face/simli.ts).
 *  - `musetalk`: our own renderer on Runpod (lib/live-face/musetalk.ts): the server turns each clause of the voice into a
 *    clip and streams it to the browser as a `video` event; the browser needs no token, only to expect clips.
 */
import { pcmSamples, toPcm16 } from "./companion-live-shared";

export type LiveFaceProvider = "simli" | "musetalk";
export const LIVE_FACE_PROVIDERS: readonly LiveFaceProvider[] = ["simli", "musetalk"];

/** What the call gets when the character has a live face and it's on for this person: enough to open it, nothing more. */
export type LiveFaceSession =
  | {
      provider: "simli";
      /** The renderer's session token: five minutes to open the stream, then the session's own limits. Never our key. */
      token: string;
      /** The square stream's size in pixels. */
      px: number;
    }
  | {
      provider: "musetalk";
      /** The clips' size in pixels (the idle loop's). */
      px: number;
    };

/** The renderer hears 16 kHz 16-bit mono; its client likes pieces of about this many bytes (Simli's docs: "about 6000"). */
export const LIVE_FACE_AUDIO_RATE = 16_000;
export const LIVE_FACE_CHUNK_BYTES = 6000;

/**
 * A clause's clip (musetalk) that hasn't arrived this long after its voice finished arriving plays without the face:
 * the held voice goes to the call's own player and the kit's face (Tier 0) moves to it.
 */
export const CLIP_HOLD_MS = 4_000;

/** One piece of the companion's voice (our 24 kHz PCM, base64) as the renderer takes it: 16 kHz 16-bit mono bytes. */
export function voiceForLiveFace(b64: string, rate: number): Uint8Array {
  const samples = pcmSamples(b64);
  if (!samples.length) return new Uint8Array(0);
  return new Uint8Array(toPcm16(samples, rate, LIVE_FACE_AUDIO_RATE));
}

/** Bytes split into pieces the renderer likes; the last one shorter. */
export function* audioPieces(bytes: Uint8Array, size = LIVE_FACE_CHUNK_BYTES): Generator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, Math.min(bytes.length, i + size));
}

/** How long these bytes last when played: for knowing when the face has said them all. */
export const secondsOfFaceAudio = (bytes: number): number => bytes / (LIVE_FACE_AUDIO_RATE * 2);
