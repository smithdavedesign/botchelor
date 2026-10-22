import { describe, expect, it } from "vitest";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { HOUSE_KITS } from "@/lib/house-kits";
import { canonInterest } from "@/lib/interests";
import { ARCHETYPE_IDS, ARCHETYPES, archetypeId, DRAWN_TO_BOOST, DRAWN_TO_IDS, drawnToBoost, GOAL_IDS, KIND_IDS, kindLabel } from "@/lib/kinds";

describe("the vocabularies (lib/kinds.ts)", () => {
  it("has unique ids, and drawn-to is every named kind", () => {
    for (const ids of [KIND_IDS, ARCHETYPE_IDS, GOAL_IDS]) expect(new Set(ids).size).toBe(ids.length);
    expect(DRAWN_TO_IDS).not.toContain("other");
    expect(DRAWN_TO_IDS).toHaveLength(KIND_IDS.length - 1);
  });

  it("every house character's archetype is one of ours, and the cast is human", () => {
    for (const c of ALL_HOUSE_CHARACTERS) expect(archetypeId(c.archetype), `${c.id}: ${c.archetype}`).not.toBeNull();
    for (const a of ARCHETYPES) expect(archetypeId(a.label)).toBe(a.id);
    for (const [id, kit] of Object.entries(HOUSE_KITS)) {
      expect(kit.kind, id).toBe("human");
      expect(kit.archetype, id).toBe(archetypeId(ALL_HOUSE_CHARACTERS.find((c) => c.id === id)!.archetype));
    }
  });

  it("labels a kind, with the owner's own words for other", () => {
    expect(kindLabel({ kind: "vampire" })).toBe("🧛 Vampire");
    expect(kindLabel({ kind: "other", kind_label: "Lighthouse spirit" })).toBe("✨ Lighthouse spirit");
    expect(kindLabel({ kind: "other" })).toBe("✨ Something else");
    expect(kindLabel({})).toBeNull();
    expect(kindLabel({ kind: "dragon" })).toBeNull();
  });

  it("drawn-to is a small boost for a listed kind, nothing otherwise", () => {
    expect(drawnToBoost(["vampire"], "vampire")).toBe(DRAWN_TO_BOOST);
    expect(drawnToBoost(["vampire"], "robot")).toBe(0);
    expect(drawnToBoost(["vampire"], null)).toBe(0);
    expect(drawnToBoost(undefined, "vampire")).toBe(0);
    expect(DRAWN_TO_BOOST).toBeLessThan(2); // below a like-back, so who liked you still leads
  });
});

describe("one spelling per interest (lib/interests.ts)", () => {
  it("folds case, accents, hyphens and spaces, and merges clear synonyms", () => {
    expect(canonInterest("Bouldering")).toBe("climbing");
    expect(canonInterest("rock-climbing")).toBe("climbing");
    expect(canonInterest("  Rock   Climbing ")).toBe("climbing");
    expect(canonInterest("Movies")).toBe(canonInterest("cinema"));
    expect(canonInterest("Star-gazing")).toBe("stargazing");
    expect(canonInterest("Crème brûlée")).toBe("creme brulee");
    expect(canonInterest("Chess")).toBe("chess");
  });

  it("is idempotent, and leaves related-but-different things apart", () => {
    for (const h of ["Bouldering", "Movies", "Video gaming", "Old maps", "Café hopping"]) expect(canonInterest(canonInterest(h))).toBe(canonInterest(h));
    expect(canonInterest("dancing")).not.toBe(canonInterest("dance"));
    expect(canonInterest("hiking")).not.toBe(canonInterest("climbing"));
  });
});
