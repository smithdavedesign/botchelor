import { describe, expect, it } from "vitest";
import { padWav, wavSeconds } from "@/lib/adult/wav";
import { speechChunk, SPEECH_CHUNK_MAX } from "@/lib/adult/reels";

function wav(samples: number, opts: { rate?: number; bytes?: number; format?: number; extra?: boolean } = {}): Buffer {
  const rate = opts.rate ?? 24_000;
  const width = opts.bytes ?? 2;
  const data = samples * width;
  const list = opts.extra ? Buffer.concat([Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("INFO")]) : Buffer.alloc(0);
  const head = Buffer.alloc(36);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(28 + list.length + 8 + data, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(opts.format ?? 1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * width, 28);
  head.writeUInt16LE(width, 32);
  head.writeUInt16LE(width * 8, 34);
  const dataHead = Buffer.alloc(8);
  dataHead.write("data", 0, "ascii");
  dataHead.writeUInt32LE(data, 4);
  return Buffer.concat([head, list, dataHead, Buffer.alloc(data, 7)]);
}

describe("a voice line's WAV", () => {
  it("knows how long it plays, past other chunks, and reads anything else as not a WAV", () => {
    expect(wavSeconds(wav(48_000))).toBe(2);
    expect(wavSeconds(wav(12_000, { extra: true }))).toBe(0.5);
    expect(wavSeconds(wav(24_000, { bytes: 4, format: 3 }))).toBe(1);
    expect(wavSeconds(wav(100, { format: 2 }))).toBeNull();
    expect(wavSeconds(Buffer.from("ID3 not a wav at all, an mp3 header and then some bytes"))).toBeNull();
  });

  it("pads with silence to the shot's length, sizes rewritten; one already that long stays as it is", () => {
    const line = wav(36_000, { extra: true });
    const padded = padWav(line, 5);
    expect(wavSeconds(padded)).toBe(5);
    expect(padded.readUInt32LE(4)).toBe(padded.length - 8);
    // The sound itself untouched, the rest silence.
    const start = line.length - 36_000 * 2;
    expect(padded.subarray(start, start + 72_000).every((b) => b === 7)).toBe(true);
    expect(padded.subarray(start + 72_000).every((b) => b === 0)).toBe(true);
    expect(padWav(wav(240_000), 5)).toEqual(wav(240_000));
    const notWav = Buffer.from("nope");
    expect(padWav(notWav, 5)).toBe(notWav);
  });

  it("gives the speech model frames enough for the voice in one take, 4n+1, at most the cap", () => {
    expect(speechChunk(5)).toBe(81);
    expect(speechChunk(5.5)).toBe(89);
    expect(speechChunk(2)).toBe(81);
    expect(speechChunk(30)).toBe(SPEECH_CHUNK_MAX);
    for (const s of [5.1, 6.3, 7]) expect((speechChunk(s) - 1) % 4).toBe(0);
  });
});
