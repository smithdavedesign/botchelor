import { describe, expect, it } from "vitest";
import { ExtrasInput, TEXT_DETAILS } from "@/lib/extras";
import { HOUSE_KITS } from "@/lib/house-kits";
import { HOUSE_PROFILES } from "@/lib/house-profiles";

// A few sentences of past for every house character (David, 2026-11-18): where they come from, what shaped them and
// why they're dating now. Visitors' characters never get one written for them; only the show's own cast does.
describe("the house cast's backstories", () => {
  it("every house character has one, within the field's limit, and it reaches their kit", () => {
    const ids = Object.keys(HOUSE_PROFILES);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const b = HOUSE_PROFILES[id].backstory;
      expect(b, id).toBeTruthy();
      expect(b!.length, id).toBeLessThanOrEqual(TEXT_DETAILS.backstory.max);
      expect(b, id).toMatch(/Dating now/);
      expect(HOUSE_KITS[id]?.backstory, id).toBe(b);
    }
  });

  it("passes the same extras check a character's own edit does", () => {
    for (const [id, kit] of Object.entries(HOUSE_KITS)) {
      const r = ExtrasInput.safeParse({ backstory: kit.backstory, world: kit.world });
      expect(r.success, id).toBe(true);
    }
  });
});
