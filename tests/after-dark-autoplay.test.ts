import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { autoplayStop } from "@/lib/adult/autoplay";
import type { CharacterRef } from "@/lib/game";

const chars: [CharacterRef, CharacterRef] = [
  { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
  { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
];
const scene = { lines: [{ who: "a" as const, text: "*smiles* Hi." }], place: null, stage: 0, dateVenue: null };
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(AfterDarkTheater, { scene, characters: chars, onExit: () => {}, ...props }));

describe("autoplay stops by itself (David, 2026-10-22: the full conversation, no human intervention)", () => {
  it("carries on while each step brings new lines in the same chapter", () => {
    expect(autoplayStop({ chapter: 1 }, { chapter: 1 }, 4)).toBeNull();
  });

  it("rests when the chapter is filed as a saved night", () => {
    expect(autoplayStop({ chapter: 2 }, { chapter: 3 }, 5)).toMatch(/Chapter 2 is done/);
  });

  it("rests when a step brings nothing new, so dropped lines can't spend forever", () => {
    expect(autoplayStop({ chapter: 1 }, { chapter: 1 }, 0)).toMatch(/Nothing new/);
  });
});

describe("the theater's autoplay switch", () => {
  it("sits in the steer bar, showing whether it's on", () => {
    expect(render({ onWrite: async () => {}, autoplay: true, onAutoplay: () => {} })).toMatch(/<input type="checkbox" checked=""\/> Autoplay/);
    expect(render({ onWrite: async () => {}, autoplay: false, onAutoplay: () => {} })).toMatch(/<input type="checkbox"\/> Autoplay/);
  });

  it("a saved night's playback has no autoplay switch", () => {
    expect(render({ onAutoplay: () => {} })).not.toContain("Autoplay");
  });
});
