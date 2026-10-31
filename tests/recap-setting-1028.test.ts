// #1028 (the 2026-10-30 prod loop): a recap set somewhere the date never was gets a note naming where it was.
import { describe, expect, it } from "vitest";
import { recapSettingNote } from "@/lib/own-date";

describe("the recap's setting (#1028)", () => {
  it("notes a setting that names none of the date's places, and lets a matching one through", () => {
    expect(recapSettingNote("A crowded speed-dating hall, bells ringing", ["A pottery class"])).toMatch(/A pottery class/);
    expect(recapSettingNote("The pottery wheel room, clay everywhere", ["A pottery class"])).toBeNull();
    expect(recapSettingNote("The night market's noodle stall", ["A rooftop bar", "The night market"])).toBeNull();
  });
});
