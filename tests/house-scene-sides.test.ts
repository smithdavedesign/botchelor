/**
 * A house scene reads as a back-and-forth (David 2026-11-17): each voice keeps a side by who spoke first, the first on
 * the left, the second on the right, a third back on the left. Pure render of app/HouseScene.tsx, no database.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HouseScene from "@/app/HouseScene";
import type { HouseSceneView, SceneFace } from "@/lib/house-scenes";

const face = (id: string, name: string): SceneFace => ({ id, name, hue: 200, portrait: null, house: true });
const JUNIPER = face("house-juniper", "Juniper");
const NELL = face("house-nell", "Nell");
const DEX = face("house-dex", "Dex");

const scene = (speakers: SceneFace[]): HouseSceneView => ({
  id: "scene-test",
  day: "2026-11-16",
  kind: "confrontation",
  place: { id: "laundry", label: "the laundry room", at: "in the laundry room", when: "folding other people's towels" },
  code: "S2 · Night 16",
  written_at: "2026-11-16T18:20:00Z",
  cast: [...new Map(speakers.map((s) => [s.id, s])).values()],
  lines: speakers.map((s, i) => ({ ...s, n: i + 1, text: `Line ${i + 1}.` })),
  about: [],
  result: null,
});

/** Each line's side, in order, from the rendered list items. */
const sides = (html: string) => [...html.matchAll(/<li class="cast-chat-line( is-right)?"/g)].map((m) => (m[1] ? "right" : "left"));

describe("house scene sides", () => {
  it("two voices: the first on the left, the second on the right, whoever speaks twice in a row", () => {
    const html = renderToStaticMarkup(createElement(HouseScene, { scene: scene([JUNIPER, NELL, JUNIPER, JUNIPER, NELL, JUNIPER]), report: false }));
    expect(sides(html)).toEqual(["left", "right", "left", "left", "right", "left"]);
    expect(html).toContain('class="cast-chat-thread house-lines"');
  });

  it("goes by who spoke first, not by the cast's order", () => {
    const html = renderToStaticMarkup(createElement(HouseScene, { scene: { ...scene([NELL, JUNIPER, NELL]), cast: [JUNIPER, NELL] }, report: false }));
    expect(sides(html)).toEqual(["left", "right", "left"]);
    expect(html.indexOf("Line 1.")).toBeLessThan(html.indexOf("Line 2.")); // the reading order is the scene's
  });

  it("a third voice goes back on the left", () => {
    const html = renderToStaticMarkup(createElement(HouseScene, { scene: scene([JUNIPER, NELL, DEX, NELL, JUNIPER]), report: false }));
    expect(sides(html)).toEqual(["left", "right", "left", "right", "left"]);
  });
});
