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

describe("the label over the stage: the roleplay and what they're doing, in the writer's words", () => {
  const rp = { id: "blind-date", swap: false };
  it("never a stock phrase for how far it's gone (David, 2026-10-25: 'we can't hard code this')", () => {
    const old = [
      { who: "a" as const, text: "Hi.", stage: 0 },
      { who: "b" as const, text: "*kisses her*", stage: 2 },
    ];
    expect(stageLabel({ lines: old, stage: 2 }, 2)).toBeNull();
    expect(stageLabel({ lines: old, stage: 2, roleplay: rp }, 1)).toBe("🙈 Blind date");
  });
  it("names a new chapter that has no lines yet, and claims nothing before the night's first line", () => {
    expect(stageLabel({ lines: [], stage: 4, chapter: 3 }, 0)).toBe("Chapter 3");
    expect(stageLabel({ lines: [], stage: 0, chapter: 1 }, 0)).toBeNull();
    expect(stageLabel({ lines: [], stage: 0, chapter: 1, roleplay: rp }, 0)).toBe("🙈 Blind date");
  });
  it("says what they're doing at the line on screen, and changes when they do", () => {
    const doing = [
      { who: "a" as const, text: "*slides into the booth* Hi.", stage: 0, doing: "sizing up the smug couple" },
      { who: "b" as const, text: "Hello.", stage: 0, doing: "sizing up the smug couple" },
      { who: "a" as const, text: "*grabs her hand* Run.", stage: 1, doing: "escaping out the back" },
    ];
    expect(stageLabel({ lines: doing, stage: 1, roleplay: rp }, 2)).toBe("🙈 Blind date · sizing up the smug couple");
    expect(stageLabel({ lines: doing, stage: 1, roleplay: rp }, 3)).toBe("🙈 Blind date · escaping out the back");
    expect(stageLabel({ lines: doing, stage: 1 }, 3)).toBe("escaping out the back");
  });
});
