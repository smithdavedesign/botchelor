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

/** A later piece of a clip reply waits this long for its clip after its voice ended, then plays the plain way. */
export const CLIP_LATE_MS = 8_000;
/** The clips' frame rate: the worker renders the idle cycle at 25 fps. */
export const CLIP_FPS = 25;

/**
 * Where in the kit's loop a clip leaves off. The worker renders through the idle cycle, the loop's frames forward and
 * then back again (so the motion never jumps at the loop's end); `end` is the cycle index after the clip's last frame.
 * The loop plays on forward from there: a clip that ended on the way back hands over with a turn, never a jump.
 */
export function loopTimeAtCycleFrame(end: number, loopSeconds: number, fps = CLIP_FPS): number {
  const n = Math.max(1, Math.round(loopSeconds * fps));
  const c = ((Math.floor(end) % (2 * n)) + 2 * n) % (2 * n);
  const idx = c < n ? c : 2 * n - 1 - c;
  return Math.min(Math.max(0, loopSeconds - 1.5 / fps), idx / fps);
}

/** How many frames the worker renders for a piece of 16-bit mono PCM: whole frames of its length as MuseTalk hears it (16 kHz). */
export function framesOfPcm(bytes: number, rate: number, fps = CLIP_FPS): number {
  const samples16k = Math.ceil((bytes / 2) * (16_000 / rate));
  return Math.floor((samples16k / 16_000) * fps);
}

/**
 * A reply's first piece split at a clause, so its first clip is ready sooner: a clip can't start rendering until the
 * whole piece's voice is in and takes about half the piece's length, and nothing plays until the first clip is there.
 * Splits only where the voice would pause anyway (after a comma, semicolon or colon, at a dash, before and/but/so/
 * because/which/while/then), nearest to two fifths of the way in, with at least `min` characters each side; null when
 * the piece is short or has no such place.
 */
export function splitFirstPiece(text: string, opts: { min?: number; long?: number } = {}): [string, string] | null {
  const min = opts.min ?? 18;
  const long = opts.long ?? 48;
  const t = text.trim();
  if (t.length < long) return null;
  const re = /([,;:]\s+)|(\s+[—–-]\s+)|(\s+(?=(?:and|but|so|because|which|while|then)\s))/g;
  const want = t.length * 0.4;
  let best: { head: string; tail: string; off: number } | null = null;
  for (const m of t.matchAll(re)) {
    const at = m.index ?? 0;
    const head = t.slice(0, m[1] ? at + 1 : at).trim();
    const tail = t.slice(at + m[0].length).trim();
    if (head.length < min || tail.length < min) continue;
    const off = Math.abs(head.length - want);
    if (!best || off < best.off) best = { head, tail, off };
  }
  return best ? [best.head, best.tail] : null;
}
