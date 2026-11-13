import { describe, expect, it } from "vitest";
import { canTalk, kitComplete, lookFor, MOUTH_OPEN_FROM, MOUTH_SMALL_FROM, mouthFor, nextBlinkIn, syntheticLevel, type FaceKit } from "@/lib/face-kit-shared";

// The face on a call, the part the browser runs (lib/face-kit-shared.ts; app/companion/[id]/LiveFace.tsx).
describe("the mouth follows the voice", () => {
  it("is closed when quiet, parted when soft, open when loud, and rounds on a beat", () => {
    expect(mouthFor(0, "closed", 0)).toBe("closed");
    expect(mouthFor(MOUTH_SMALL_FROM, "closed", 0)).toBe("small");
    expect(mouthFor(MOUTH_OPEN_FROM, "closed", 0)).toBe("open");
    // The third beat of three rounds the lips.
    expect(mouthFor(0.5, "open", 170 * 2)).toBe("round");
    expect(mouthFor(0.5, "round", 170 * 3)).toBe("open");
  });

  it("doesn't flutter: a mouth stays open through a dip just under the line, and closes once the voice really drops", () => {
    expect(mouthFor(MOUTH_OPEN_FROM - 0.01, "open", 0)).toBe("open");
    expect(mouthFor(MOUTH_OPEN_FROM - 0.01, "closed", 0)).toBe("small");
    expect(mouthFor(MOUTH_SMALL_FROM - 0.01, "small", 0)).toBe("small");
    expect(mouthFor(0.01, "small", 0)).toBe("closed");
    expect(mouthFor(0.01, "open", 0)).toBe("closed");
  });

  it("makes up syllables for a voice it can't hear, never silent for long and never shouting", () => {
    const levels = Array.from({ length: 400 }, (_, i) => syntheticLevel(i * 16));
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.46);
    expect(Math.max(...levels)).toBeGreaterThan(MOUTH_OPEN_FROM);
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(0);
    // It opens and closes: both states turn up within a second or two.
    const mouths = new Set(levels.map((l, i) => mouthFor(l, "closed", i * 16)));
    expect(mouths.has("closed") && mouths.has("open")).toBe(true);
  });
});

describe("the look a line calls for", () => {
  it("smiles at a laugh, gasps at a surprise, and otherwise stays as it is", () => {
    expect(lookFor("Haha, you would say that.")).toBe("smile");
    expect(lookFor("lol okay")).toBe("smile");
    expect(lookFor("That's lovely 😄")).toBe("smile");
    expect(lookFor("Wait, really?!")).toBe("surprised");
    expect(lookFor("Wow, I didn't know that")).toBe("surprised");
    expect(lookFor("Tell me about your day.")).toBeNull();
    expect(lookFor("A shallow hat, really.")).toBeNull();
  });
});

describe("what a kit can do", () => {
  const kit = (stills: string[], loop: string | null = null, making = false): FaceKit => ({ stills: Object.fromEntries(stills.map((p) => [p, `/api/face-kit/${p}`])), loop, making, failed: null });
  it("talks once the portrait and the three mouths are there; is complete with every still, the loop and nothing on its way", () => {
    expect(canTalk(null)).toBe(false);
    expect(canTalk(kit(["portrait", "mouth_small", "mouth_open"]))).toBe(false);
    expect(canTalk(kit(["portrait", "mouth_small", "mouth_open", "mouth_round"]))).toBe(true);
    const all = ["portrait", "mouth_small", "mouth_open", "mouth_round", "blink", "smile", "surprised"];
    expect(kitComplete(kit(all))).toBe(false);
    expect(kitComplete(kit(all, "/api/face-kit/loop", true))).toBe(false);
    expect(kitComplete(kit(all, "/api/face-kit/loop"))).toBe(true);
  });
  it("blinks every two and a half to six seconds", () => {
    expect(nextBlinkIn(0)).toBe(2500);
    expect(nextBlinkIn(1)).toBe(6000);
    expect(nextBlinkIn(2)).toBe(6000);
  });
});
