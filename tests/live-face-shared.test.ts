import { describe, expect, it } from "vitest";
import { audioPieces, LIVE_FACE_CHUNK_BYTES, secondsOfFaceAudio, voiceForLiveFace } from "@/lib/live-face-shared";

// The companion's voice as a live face takes it (lib/live-face-shared.ts): 24 kHz PCM from Aura down to 16 kHz 16-bit mono.
describe("the voice for a live face", () => {
  it("resamples a 24 kHz piece to 16 kHz, two bytes a sample, whole samples only", () => {
    // 240 samples of a 1 kHz-ish wave at 24 kHz: 10 ms.
    const samples = new Int16Array(240).map((_, i) => Math.round(Math.sin(i / 4) * 8000));
    const b64 = Buffer.from(samples.buffer).toString("base64");
    const out = voiceForLiveFace(b64, 24_000);
    expect(out.length % 2).toBe(0);
    expect(out.length / 2).toBe(160);
    expect(secondsOfFaceAudio(out.length)).toBeCloseTo(0.01, 4);
    expect(voiceForLiveFace("", 24_000).length).toBe(0);
  });

  it("cuts the bytes into pieces the renderer likes, the last one shorter", () => {
    const bytes = new Uint8Array(LIVE_FACE_CHUNK_BYTES * 2 + 100);
    const pieces = [...audioPieces(bytes)];
    expect(pieces.map((p) => p.length)).toEqual([LIVE_FACE_CHUNK_BYTES, LIVE_FACE_CHUNK_BYTES, 100]);
    expect([...audioPieces(new Uint8Array(0))]).toEqual([]);
  });
});
