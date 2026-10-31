import { describe, expect, it } from "vitest";
import { cutSetLabel } from "@/lib/adult/scenes";

// A set's label never ends mid-word (the audit, 2026-10-31: "📍 The pier, deciding to leave for the ferr").
describe("cutSetLabel", () => {
  it("keeps a short label, and cuts a long one at a word", () => {
    expect(cutSetLabel("The pier at night")).toBe("The pier at night");
    expect(cutSetLabel("The pier, deciding to leave for the ferry")).toBe("The pier, deciding to leave for the");
    expect(cutSetLabel("The dark wind-swept pier, just before the ferry ramp")).toBe("The dark wind-swept pier, just before");
    for (const s of ["x".repeat(41), "a ".repeat(30), "The pier, deciding to leave for the ferry"]) expect(cutSetLabel(s).length).toBeLessThanOrEqual(40);
    // One unbroken word longer than the cut keeps the cut itself rather than nothing.
    expect(cutSetLabel("x".repeat(50))).toBe("x".repeat(40));
  });
});
