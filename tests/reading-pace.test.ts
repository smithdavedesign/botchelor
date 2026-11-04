import { describe, expect, it } from "vitest";
import { ACT_BREAK_MS, delayBefore, FIRST_MS, READ_MAX_MS, readingMs, TURN_MS } from "@/app/useReplay";
import type { Turn } from "@/lib/conversation";

// David, 2026-11-04: the slower writer's long lines went by before anyone could read them, and the faster one's pace was
// too quick. Each line stays up long enough to read.
const turn = (dialogue: string, action = "", act = 1): Turn => ({ side: "a", act, dialogue, action, emotion: "", interest: 0.5 });

describe("lines are paced for a reader", () => {
  it("a short line keeps the beat; a long one stays up long enough to read, capped", () => {
    const short = turn("Lead the way.");
    const long = turn(
      "Climate control, reinforced flooring, and a workbench that could support a full marionette rig. The roof leaks near the back storage, I've been meaning to patch it. The debrief requires full disclosure. The mahogany has excellent load-bearing capacity.",
      "adjusts their shared cover as a gust of wind blows rain sideways",
    );
    expect(delayBefore([short, short], 1)).toBe(TURN_MS);
    expect(delayBefore([long, short], 1)).toBeGreaterThan(12_000);
    expect(delayBefore([long, short], 1)).toBeLessThanOrEqual(READ_MAX_MS);
    // The words done count too: an action-heavy line is still something to read.
    expect(readingMs(turn("Mm.", "slides her hand up his chest, fingers tracing the seam of his jacket, slow"))).toBeGreaterThan(readingMs(turn("Mm.")));
  });

  it("the first line still comes quickly, and an act break still pauses at least as long as before", () => {
    expect(delayBefore([turn("Hi.")], 0)).toBe(FIRST_MS);
    expect(delayBefore([turn("Hi."), turn("Hello.", "", 2)], 1)).toBe(ACT_BREAK_MS);
  });
});
