/**
 * The voice of a filmed confessional as a file (lib/date-film.ts): Aura's WAV read, and laid into one take with a
 * breath of silence either side. Server only (it works on bytes); the rules it follows are lib/date-film-shared.ts's.
 */
import { FILM_FPS, FILM_LEAD_S, filmFrames } from "./date-film-shared";

/** The samples inside a WAV (16-bit PCM), and its rate and channels; null when it isn't one. */
export function wavPcm(wav: Uint8Array): { pcm: Uint8Array; rate: number; channels: number } | null {
  const b = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  if (b.length < 44 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
  let rate = 0;
  let channels = 0;
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("latin1", at, at + 4);
    // A streamed WAV says its size is unknown (0 or 0xFFFFFFFF): the samples then run to the end.
    const said = b.readUInt32LE(at + 4);
    const size = id === "data" && (said === 0 || said === 0xffffffff || at + 8 + said > b.length) ? b.length - at - 8 : said;
    if (id === "fmt ") {
      channels = b.readUInt16LE(at + 10);
      rate = b.readUInt32LE(at + 12);
      if (b.readUInt16LE(at + 8) !== 1 || b.readUInt16LE(at + 22) !== 16) return null;
    } else if (id === "data") {
      return rate && channels ? { pcm: b.subarray(at + 8, at + 8 + size - (size % 2)), rate, channels } : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** A 16-bit PCM WAV of those samples. */
export function wavOf(pcm: Uint8Array, rate: number, channels = 1): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 2, 28);
  head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/**
 * The voice laid into one take: silence before it (FILM_LEAD_S) and after, to the take's exact length, since the clip
 * runs as long as its sound. Returns the take's WAV, its frames and how long the voice itself is; null when the voice
 * is too long for one take or isn't a WAV.
 */
export function voiceForTake(wav: Uint8Array): { wav: Buffer; frames: number; seconds: number; voice_seconds: number } | null {
  const v = wavPcm(wav);
  if (!v) return null;
  const perSecond = v.rate * v.channels * 2;
  const voiceSeconds = v.pcm.length / perSecond;
  const frames = filmFrames(voiceSeconds);
  if (!frames) return null;
  const seconds = frames / FILM_FPS;
  const even = (n: number) => n - (n % (v.channels * 2));
  const lead = even(Math.round(FILM_LEAD_S * perSecond));
  const total = even(Math.round(seconds * perSecond));
  const pcm = Buffer.alloc(total);
  Buffer.from(v.pcm.buffer, v.pcm.byteOffset, v.pcm.byteLength).copy(pcm, lead, 0, Math.min(v.pcm.length, total - lead));
  return { wav: wavOf(pcm, v.rate, v.channels), frames, seconds, voice_seconds: Math.round(voiceSeconds * 100) / 100 };
}
