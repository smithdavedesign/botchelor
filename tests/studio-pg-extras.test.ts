import { describe, expect, it } from "vitest";
import { STUDIO_GROUPS } from "@/lib/adult/studio-catalog";
import { studioTileSpecs } from "@/lib/adult/studio-tiles";

// The PG Studio's everyday extras in After Dark's Studio (2026-10-30): wearable accessories and places, level 0, no tiles.
const group = (id: string) => STUDIO_GROUPS.find((g) => g.id === id)!;

describe("the PG Studio's extras in After Dark's Studio", () => {
  it("adds wearable accessories only, at level 0, without doubling an id After Dark has", () => {
    const acc = group("accessories").options;
    expect(acc.find((o) => o.id === "beanie")).toMatchObject({ level: 0, fromPg: true, words: "a beanie" });
    expect(acc.find((o) => o.id === "pet_dog")).toBeUndefined();
    expect(acc.filter((o) => o.id === "glasses")).toHaveLength(1);
  });

  it("adds places as words without their preposition, public unless at home or a backdrop, never swim-only ones", () => {
    const places = group("place").options;
    expect(places.find((o) => o.id === "cafe")).toMatchObject({ words: "a cosy café", public: true, level: 0 });
    expect(places.find((o) => o.id === "living_room")).toMatchObject({ words: "a cosy living room" });
    expect(places.find((o) => o.id === "living_room")?.public).toBeUndefined();
    expect(places.filter((o) => o.id === "beach")).toHaveLength(1);
  });

  it("queues no new tiles to draw", () => {
    expect(studioTileSpecs().some((t) => t.option === "cafe" || t.option === "tokyo")).toBe(false);
  });
});
