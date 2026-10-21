import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
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
