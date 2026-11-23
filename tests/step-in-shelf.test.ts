// Step in's shelf of roleplays (lib/adult/step-in-shelf.ts): who a card is cast with, and which cards tonight shows.
import { describe, expect, it } from "vitest";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import type { StepInCharacter } from "@/lib/adult/step-in-shared";
import { coverFor, ROLEPLAY_COVERS } from "@/lib/adult/roleplay-covers";
import { SHELF_TONIGHT, shelfCast, shelfLead, shelfTonight } from "@/lib/adult/step-in-shelf";
import { cardForYou } from "@/lib/scene-cards";

const person = (id: string, house = false): StepInCharacter => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Vale`, portrait: null, hue: 10, house });
const CAST = [person("ana"), person("bo", true), person("cy"), person("dee", true), person("eli"), person("fay", true)];
const DAY = "2026-11-23";

describe("who a card is cast with", () => {
  it("opens on the people they've already stepped in with, the latest first; then the house cast; then everyone", () => {
    const known = shelfCast(CAST, ["eli", "ana", "gone-from-the-cast"]);
    expect(known.order.map((c) => c.id)).toEqual(["eli", "ana", "bo", "dee", "fay", "cy"]);
    expect(known.leads).toBe(2);
    const fresh = shelfCast(CAST, []);
    expect(fresh.order.map((c) => c.id)).toEqual(["bo", "dee", "fay", "ana", "cy", "eli"]);
    expect(fresh.leads).toBe(3);
    // Opened for one of them ("Roleplay or place" on their card): every card opens on that person, the rest after.
    const asked = shelfCast(CAST, ["eli", "ana"], "cy");
    expect(asked.order.map((c) => c.id)).toEqual(["cy", "eli", "ana", "bo", "dee", "fay"]);
    expect(asked.leads).toBe(1);
    for (const rp of ROLEPLAYS.slice(0, 6)) expect(shelfLead(rp.id, DAY, asked)?.id).toBe("cy");
    expect(shelfLead("neighbours", DAY, asked, 1)?.id).toBe("eli");
    // Someone who isn't in their After Dark is no one to open on.
    expect(shelfCast(CAST, ["eli"], "nobody")).toEqual(shelfCast(CAST, ["eli"]));
    // Nobody from the house in their After Dark: anyone who is.
    const own = shelfCast([person("ana"), person("cy")], []);
    expect(own).toMatchObject({ leads: 2 });
    expect(shelfCast([], ["ana"])).toEqual({ order: [], leads: 0, asked: false });
  });

  it("is the same person all day, someone from the leads, and another spread the next day", () => {
    const cast = shelfCast(CAST, ["eli", "ana"]);
    for (const rp of ROLEPLAYS) {
      const them = shelfLead(rp.id, DAY, cast);
      expect(them).toBe(shelfLead(rp.id, DAY, cast));
      expect(["eli", "ana"]).toContain(them?.id);
    }
    // With nobody chosen before, the house cast is spread across the cards (not one face on all of them).
    const fresh = shelfCast(CAST, []);
    const today = ROLEPLAYS.map((rp) => shelfLead(rp.id, DAY, fresh)!.id);
    expect(new Set(today)).toEqual(new Set(["bo", "dee", "fay"]));
    const tomorrow = ROLEPLAYS.map((rp) => shelfLead(rp.id, "2026-11-24", fresh)!.id);
    expect(tomorrow).not.toEqual(today);
    expect(shelfLead("neighbours", DAY, shelfCast([], []))).toBeNull();
  });

  it("\"Someone else\" walks through everyone once before it comes round again", () => {
    const cast = shelfCast(CAST, ["eli"]);
    const walk = Array.from({ length: CAST.length }, (_, turn) => shelfLead("neighbours", DAY, cast, turn)!.id);
    expect(walk[0]).toBe("eli");
    expect(new Set(walk).size).toBe(CAST.length);
    expect(shelfLead("neighbours", DAY, cast, CAST.length)!.id).toBe("eli");
  });
});

describe("tonight's cards", () => {
  it("are eight of them, the same all day and a different set tomorrow", () => {
    const tonight = shelfTonight(ROLEPLAYS, DAY);
    expect(tonight).toHaveLength(SHELF_TONIGHT);
    expect(new Set(tonight.map((r) => r.id)).size).toBe(SHELF_TONIGHT);
    expect(shelfTonight(ROLEPLAYS, DAY).map((r) => r.id)).toEqual(tonight.map((r) => r.id));
    expect(shelfTonight(ROLEPLAYS, "2026-11-24").map((r) => r.id)).not.toEqual(tonight.map((r) => r.id));
    // Over a fortnight every roleplay has had a night.
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) for (const r of shelfTonight(ROLEPLAYS, `2026-12-${String(d).padStart(2, "0")}`)) seen.add(r.id);
    expect(seen.size).toBe(ROLEPLAYS.length);
  });

  it("every card reads right from the viewer's side with any name on it: a set-up in plain words, no placeholder left", () => {
    for (const rp of ROLEPLAYS) {
      const card = cardForYou(rp.card, "a", "Juniper");
      expect(card.setup, rp.id).not.toMatch(/[{}]/);
      expect(card.setup.length, rp.id).toBeGreaterThan(40);
      expect(card.setup.length, rp.id).toBeLessThan(420);
    }
  });
});

// A cover picture is a card's poster (lib/adult/roleplay-covers.ts): the card opens on the one in the picture.
describe("a card with a cover", () => {
  it("opens on the one in its picture, whoever they've stepped in with; \"Someone else\" then starts with the people they know", () => {
    const cast = shelfCast(CAST, ["eli", "ana"]);
    expect(shelfLead("neighbours", DAY, cast, 0, "fay")?.id).toBe("fay");
    // Everyone else once, from the top of the order, before the poster comes round again.
    const walk = Array.from({ length: CAST.length }, (_, turn) => shelfLead("neighbours", DAY, cast, turn, "fay")!.id);
    expect(walk).toEqual(["fay", "eli", "ana", "bo", "dee", "cy"]);
    expect(shelfLead("neighbours", DAY, cast, CAST.length, "fay")?.id).toBe("eli");
  });

  it("is anyone's on a page opened for one person, and falls back when the one in the picture isn't in their After Dark", () => {
    const asked = shelfCast(CAST, ["eli"], "cy");
    expect(shelfLead("neighbours", DAY, asked, 0, "fay")?.id).toBe("cy");
    const cast = shelfCast(CAST, ["eli", "ana"]);
    expect(shelfLead("neighbours", DAY, cast, 0, "nobody-here")).toBe(shelfLead("neighbours", DAY, cast));
    // Alone in the cast, the poster is the only one there is.
    const one = shelfCast([person("fay", true)], []);
    expect(shelfLead("neighbours", DAY, one, 3, "fay")?.id).toBe("fay");
  });

  it("leads tonight's: half of the eight have pictures and come first, the same all day", () => {
    const pictured = new Set(Object.keys(ROLEPLAY_COVERS));
    const tonight = shelfTonight(ROLEPLAYS, DAY, SHELF_TONIGHT, pictured).map((r) => r.id);
    expect(tonight).toHaveLength(SHELF_TONIGHT);
    expect(new Set(tonight).size).toBe(SHELF_TONIGHT);
    expect(tonight.slice(0, SHELF_TONIGHT / 2).every((id) => pictured.has(id))).toBe(true);
    expect(tonight.slice(SHELF_TONIGHT / 2).some((id) => pictured.has(id))).toBe(false);
    expect(shelfTonight(ROLEPLAYS, DAY, SHELF_TONIGHT, pictured).map((r) => r.id)).toEqual(tonight);
    expect(shelfTonight(ROLEPLAYS, "2026-11-24", SHELF_TONIGHT, pictured).map((r) => r.id)).not.toEqual(tonight);
    // Fewer pictures than half: all of them first, the rest from the others; none: as before.
    const two = new Set(["vampire", "royal"]);
    expect(new Set(shelfTonight(ROLEPLAYS, DAY, SHELF_TONIGHT, two).slice(0, 2).map((r) => r.id))).toEqual(two);
    expect(shelfTonight(ROLEPLAYS, DAY, SHELF_TONIGHT, new Set()).map((r) => r.id)).toEqual(shelfTonight(ROLEPLAYS, DAY).map((r) => r.id));
    // Every pictured roleplay has had a night within a week.
    const seen = new Set<string>();
    for (let d = 1; d <= 7; d++) for (const r of shelfTonight(ROLEPLAYS, `2026-12-0${d}`, SHELF_TONIGHT, pictured).slice(0, SHELF_TONIGHT / 2)) seen.add(r.id);
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it("is only with the one in the picture", () => {
    expect(coverFor("vampire", "house-vesper")).toMatchObject({ you: 1, src: "/cast/roleplay-vampire-vesper.webp" });
    expect(coverFor("vampire", "house-juniper")).toBeNull();
    expect(coverFor("not-a-roleplay", "house-vesper")).toBeNull();
    expect(coverFor("vampire", null)).toBeNull();
  });
});
