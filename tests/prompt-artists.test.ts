import { describe, expect, it } from "vitest";
import { artistsNamed, namesArtist, parseArtists } from "@/lib/prompt-artists";
import { ALL_PROMPTS, findPrompts } from "@/lib/prompts-library";

/** Prompts that ask for a real artist's style (lib/prompt-artists.ts): marked, and left out on request; never rewritten. */
describe("prompts that name an artist", () => {
  it("finds the names the datasets repeat, as whole words, in any case", () => {
    expect(namesArtist("portrait of a woman, by Greg Rutkowski and Alphonse Mucha, artstation")).toBe(true);
    expect(artistsNamed("portrait of a woman, by Greg Rutkowski and Alphonse Mucha, artstation")).toEqual(["greg rutkowski", "alphonse mucha"]);
    expect(namesArtist("a muchacho in a hat, wlopsided grin")).toBe(false); // not inside other words
    expect(namesArtist("soft light, oil on canvas, 35mm, warm tones")).toBe(false);
  });

  it("the library counts hundreds of them, and ?artists=hide leaves every one out without touching the texts", () => {
    const naming = ALL_PROMPTS.filter((p) => namesArtist(p.prompt));
    expect(naming.length).toBeGreaterThan(300);
    const kept = findPrompts({ artists: "hide" });
    expect(kept.length).toBe(ALL_PROMPTS.length - naming.length);
    expect(kept.some((p) => namesArtist(p.prompt))).toBe(false);
    // The texts are the datasets' own, unchanged, in both views.
    expect(findPrompts({}).map((p) => p.prompt)).toEqual(ALL_PROMPTS.map((p) => p.prompt));
    expect(parseArtists("hide")).toBe("hide");
    expect(parseArtists(undefined)).toBeNull();
    expect(parseArtists("show")).toBeNull();
  });
});
