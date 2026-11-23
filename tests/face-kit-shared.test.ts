import { describe, expect, it } from "vitest";
import { FACE_PARTS, hasFace, kitComplete, RETIRED_STILLS, talkingStill, voiceRing, type FaceKit } from "@/lib/face-kit-shared";

// The face on a call, the part the browser runs (lib/face-kit-shared.ts; app/companion/[id]/LiveFace.tsx): a portrait and
// a living loop, and a ring that swells with the voice. No mouth is drawn to the words (the swapped mouth stills read as
// choppy and were retired 2026-11-22).
describe("what a kit can do", () => {
  const kit = (stills: string[], loop: string | null = null, making = false): FaceKit => ({ stills: Object.fromEntries(stills.map((p) => [p, `/api/face-kit/${p}`])), loop, making, failed: null });
  it("has a face once the portrait is there; is complete with the portrait, the loop and nothing on its way", () => {
    expect(hasFace(null)).toBe(false);
    expect(hasFace(kit(["talk"]))).toBe(false);
    expect(hasFace(kit(["portrait"]))).toBe(true);
    expect(kitComplete(kit(["portrait"]))).toBe(false);
    expect(kitComplete(kit(["portrait"], "/api/face-kit/loop", true))).toBe(false);
    expect(kitComplete(kit([], "/api/face-kit/loop"))).toBe(false);
    expect(kitComplete(kit(["portrait"], "/api/face-kit/loop"))).toBe(true);
  });
  it("gives Ditto the talking still once it's drawn, else the portrait, else nothing", () => {
    expect(talkingStill(null)).toBeNull();
    expect(talkingStill(kit(["mouth_small"]))).toBeNull();
    expect(talkingStill(kit(["portrait", "mouth_small"]))).toEqual({ still: "portrait", url: "/api/face-kit/portrait" });
    expect(talkingStill(kit(["portrait", "talk"]))).toEqual({ still: "talk", url: "/api/face-kit/talk" });
  });
  it("still names the stills older kits hold, so their rows fit the table, and never among what's shown", () => {
    for (const p of RETIRED_STILLS) expect(FACE_PARTS).toContain(p);
    expect([...RETIRED_STILLS].sort()).toEqual(["blink", "mouth_open", "mouth_round", "mouth_small", "smile", "surprised"]);
  });
});

describe("the ring around their face follows the voice", () => {
  it("is still when quiet, swells with a loud voice, and never leaves 0 to 1", () => {
    expect(voiceRing(0, 0)).toBe(0);
    let ring = 0;
    for (let i = 0; i < 20; i++) ring = voiceRing(0.3, ring);
    expect(ring).toBeGreaterThan(0.95);
    expect(ring).toBeLessThanOrEqual(1);
    for (let i = 0; i < 20; i++) ring = voiceRing(5, ring);
    expect(ring).toBeLessThanOrEqual(1);
    expect(voiceRing(-0.5, 0.4)).toBe(0.4);
  });
  it("rises faster than it falls, so a syllable lands and trails off rather than flickers", () => {
    const up = voiceRing(0.3, 0) - 0;
    const down = 1 - voiceRing(0, 1);
    expect(up).toBeGreaterThan(down * 2);
    // It does get back to rest.
    let ring = 1;
    for (let i = 0; i < 80; i++) ring = voiceRing(0, ring);
    expect(ring).toBe(0);
  });
  it("leaves the ring as it was for a voice that can't be measured (the device's own)", () => {
    expect(voiceRing(-1, 0.37)).toBe(0.37);
  });
});
