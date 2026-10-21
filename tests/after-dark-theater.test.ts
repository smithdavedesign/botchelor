import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AfterDarkTheater, { stageLabel } from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import type { CharacterRef } from "@/lib/game";

const chars: [CharacterRef, CharacterRef] = [
  { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
  { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
];
const scene = { lines: [{ who: "a" as const, text: "*smiles* Hi." }], place: null, stage: 0, dateVenue: null };
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(AfterDarkTheater, { scene, characters: chars, onExit: () => {}, ...props }));

describe("After Dark theater steer (David, 2026-10-21: no direct way to steer from the theater)", () => {
  it("has the page's Nudge/Direct choice beside the steer, showing the one in use", () => {
    const html = render({ onWrite: async () => {}, steerMode: "direct", onSteerMode: () => {} });
    expect(html).toContain('aria-label="How strongly"');
    expect(html).toMatch(/<input type="radio" name="theater-steer-mode" checked=""[^>]*\/> Direct/);
    expect(html).toMatch(/<input type="radio" name="theater-steer-mode"(?! checked)[^>]*\/> Nudge/);
  });

  it("a saved night's playback has no steer at all", () => {
    expect(render({})).not.toContain("theater-steer-mode");
  });
});

describe("the label over the stage follows the line on screen (David, 2026-10-21)", () => {
  const lines = [
    { who: "a" as const, text: "Hi.", stage: 0 },
    { who: "b" as const, text: "Hello.", stage: 0 },
    { who: "a" as const, text: "*kisses her*", stage: 2 },
  ];
  it("climbs with the night in a replay instead of showing its end at hello", () => {
    expect(stageLabel({ lines, stage: 4 }, 1, false)).toBe("talking and flirting");
    expect(stageLabel({ lines, stage: 4 }, 3, true)).toBe("kissing");
  });
  it("shows nothing for old lines until playback catches up, then the night's stage", () => {
    const old = lines.map(({ who, text }) => ({ who, text }));
    expect(stageLabel({ lines: old, stage: 4 }, 1, false)).toBeNull();
    expect(stageLabel({ lines: old, stage: 4 }, 3, true)).toBe("sex");
  });
  it("names a new chapter that has no lines yet, and starts the first one at the beginning", () => {
    expect(stageLabel({ lines: [], stage: 4, chapter: 3 }, 0, true)).toBe("Chapter 3");
    expect(stageLabel({ lines: [], stage: 0, chapter: 1 }, 0, true)).toBe("talking and flirting");
  });
});
