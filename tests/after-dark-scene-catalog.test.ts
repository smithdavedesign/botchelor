import { describe, expect, it } from "vitest";
import { stageFor } from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { filterScenes, libraryVenueFor, SCENE_CATEGORIES, sceneCatalog } from "@/lib/adult/scene-catalog";
import { SCENARIOS } from "@/lib/adult/scenarios";
import { SET_SCENE_MAX } from "@/lib/adult/scenes";
import { checkAdultText, excludedTheme } from "@/lib/safety";
import { DATE_VENUES } from "@/lib/venues";

// The theater's scene picker (lib/adult/scene-catalog.ts; David, 2026-10-25): every place, sorted by roleplay genre.
describe("the scene catalog", () => {
  const all = sceneCatalog(["the cozy bedroom", "Lexi's bedroom", "a rooftop pool"]);

  it("holds the venue library, every scenario, the ideas and the drawn sets, once each", () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const v of DATE_VENUES) expect(all.some((s) => s.id === `venue:${v.id}`)).toBe(true);
    for (const sc of SCENARIOS) expect(all.find((s) => s.id === `scenario:${sc.id}`)?.scenario).toBe(sc.id);
    expect(all.some((s) => s.id.startsWith("idea:"))).toBe(true);
    expect(all.find((s) => s.place === "the cozy bedroom")?.categories).toEqual(["nightin"]);
  });

  it("drops a drawn set a card already covers", () => {
    // "the rooftop pool" is a scenario's place; "a rooftop pool" is the same place, written another way.
    expect(all.filter((s) => s.place.toLowerCase().includes("rooftop pool"))).toHaveLength(1);
  });

  it("every place fits set_scene and stays inside the lines that never move", () => {
    for (const s of all) {
      expect(s.place.length, s.place).toBeLessThanOrEqual(SET_SCENE_MAX);
      expect(checkAdultText({ place: s.place, title: s.title }).ok, s.place).toBe(true);
      expect(excludedTheme(`${s.title} ${s.place}`), s.place).toBeNull();
    }
  });

  it("every category has scenes, and every card at least one category", () => {
    for (const c of SCENE_CATEGORIES) expect(all.some((s) => s.categories.includes(c.id)), c.id).toBe(true);
    for (const s of all) expect(s.categories.length, s.id).toBeGreaterThan(0);
  });

  it("filters by category, every picked tag and words", () => {
    const fantasy = filterScenes(all, { category: "fantasy" });
    expect(fantasy.length).toBeGreaterThan(0);
    expect(fantasy.every((s) => s.categories.includes("fantasy"))).toBe(true);
    const wet = filterScenes(all, { tags: ["Water", "Night"] });
    expect(wet.every((s) => s.tags.includes("Water") && s.tags.includes("Night"))).toBe(true);
    expect(filterScenes(all, { query: "CASTLE" }).map((s) => s.place)).toContain("a candlelit castle chamber");
    expect(filterScenes(all, { query: "nowhere-at-all" })).toEqual([]);
  });

  it("a library venue picked by name stands on its own reviewed set, not a drawn one", () => {
    expect(libraryVenueFor("A rooftop bar at golden hour")).toBe("rooftop_bar");
    // set_place keeps 40 characters.
    expect(libraryVenueFor("A cooking class with a nervous smoke alarm".slice(0, 40))).toBe("cooking_class");
    expect(libraryVenueFor("Their place")).toBe("home");
    expect(libraryVenueFor("the observatory")).toBeNull();
    expect(stageFor("A rooftop bar at golden hour", null)).toBe("rooftop_bar");
    expect(stageFor("the observatory", null)).toBe("elsewhere@the observatory");
  });
});
