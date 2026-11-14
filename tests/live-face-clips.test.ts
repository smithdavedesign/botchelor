import { describe, expect, it } from "vitest";
import { CLIP_FPS, framesOfPcm, loopTimeAtCycleFrame, splitFirstPiece } from "@/lib/live-face-shared";

describe("a reply's first piece, split at a clause for a sooner first clip", () => {
  it("leaves a short piece alone", () => {
    expect(splitFirstPiece("The usual. High tide tried.")).toBeNull();
  });
  it("splits after a comma near two fifths of the way, keeping the comma on the first part", () => {
    const [a, b] = splitFirstPiece("Spent the morning untangling the weathervane from a fishing net, which the sea left like a calling card.")!;
    expect(a).toBe("Spent the morning untangling the weathervane from a fishing net,");
    expect(b).toBe("which the sea left like a calling card.");
  });
  it("splits before a conjunction when there is no punctuation", () => {
    const [a, b] = splitFirstPiece("I spent the whole morning on the roof and the gulls were louder than usual up there.")!;
    expect(a).toBe("I spent the whole morning on the roof");
    expect(b).toBe("and the gulls were louder than usual up there.");
  });
  it("won't leave a stub on either side", () => {
    // "Yes," alone is too short a first clip; with a later clause the split moves there.
    expect(splitFirstPiece("Yes, and that is exactly what I told the harbourmaster this morning.")).toBeNull();
    expect(splitFirstPiece("Yes, and that is exactly what I told the harbourmaster, so don't look at me like that.")).toEqual([
      "Yes, and that is exactly what I told the harbourmaster,",
      "so don't look at me like that.",
    ]);
    expect(splitFirstPiece("Honestly I have no idea what you mean by that, no.")).toBeNull();
  });
});

describe("how many frames a piece renders", () => {
  it("counts whole 25-fps frames of the voice as MuseTalk hears it (16 kHz)", () => {
    expect(framesOfPcm(130_560, 24_000)).toBe(68); // Juniper's 2.72-s piece: the worker rendered 68
    expect(framesOfPcm(92_160, 24_000)).toBe(48);
    expect(framesOfPcm(2 * 16_000, 16_000)).toBe(CLIP_FPS);
    expect(framesOfPcm(0, 24_000)).toBe(0);
  });
});

describe("where the loop takes over after a clip", () => {
  const loop = 124 / 25; // a 124-frame loop
  it("maps the forward half of the cycle to the loop's own frame", () => {
    expect(loopTimeAtCycleFrame(0, loop)).toBe(0);
    expect(loopTimeAtCycleFrame(50, loop)).toBeCloseTo(2.0, 5);
  });
  it("maps the way back onto the frame the clip was showing", () => {
    expect(loopTimeAtCycleFrame(124, loop)).toBeCloseTo(loop - 1.5 / 25, 5); // frame 123 again, held clear of the fade
    expect(loopTimeAtCycleFrame(130, loop)).toBeCloseTo(117 / 25, 5);
    expect(loopTimeAtCycleFrame(200, loop)).toBeCloseTo(47 / 25, 5);
    expect(loopTimeAtCycleFrame(248, loop)).toBe(0);
  });
  it("never lands past the fade at the loop's end", () => {
    expect(loopTimeAtCycleFrame(123, loop)).toBeLessThan(loop);
    expect(loopTimeAtCycleFrame(123, loop)).toBeCloseTo(loop - 1.5 / 25, 5);
  });
});
