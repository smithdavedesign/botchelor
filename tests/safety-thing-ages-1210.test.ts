import { describe, expect, it } from "vitest";
import { checkAdultText, checkShowText } from "@/lib/safety";

// #1210 (David, 2026-11-01: "short object list"): a fountain appraiser's "a sixteen-year-old fountain" was refused as a
// person's age. "<age> year old" straight before one of a short list of things is a thing's age, on the show and in
// After Dark alike; anything else (a person, a pet, a doll, an age said any other way) is still refused.
describe("a thing's age", () => {
  const passes = ["I once met a sixteen-year-old fountain.", "We split a twelve year old whisky.", "Her 15 year old car broke down again.", "two fifteen-year-old oaks by the gate"];
  const refused = ["a nine-year-old pointed at it", "a sixteen-year-old girl", "a sixteen year old doll", "the fountain is sixteen years old", "back when she was sixteen", "a 16 year old puppy", "a sixteen-year-old fountain of a girl? no: a sixteen year old"];
  it.each(passes)("passes before a thing: %s", (line) => {
    expect(checkShowText({ line })).toEqual({ ok: true });
    expect(checkAdultText({ line })).toEqual({ ok: true });
  });
  it.each(refused)("is refused for anyone or anything else: %s", (line) => {
    expect(checkShowText({ line })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line })).toMatchObject({ ok: false });
  });
});
