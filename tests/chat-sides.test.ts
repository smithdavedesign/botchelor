/**
 * Cast transcripts read as a back-and-forth (David 2026-11-17): each voice keeps a side by the order they first speak,
 * the first on the left, the second on the right, a third back on the left (app/chat-sides.ts, .cast-chat-sides). On
 * /house's scenes (app/HouseScene.tsx) and the morning-after group chat (app/CastChat.tsx). Pure renders, no database.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CastChat from "@/app/CastChat";
import HouseScene from "@/app/HouseScene";
import { rightSide } from "@/app/chat-sides";
import type { CastChat as Chat } from "@/lib/cast-chat";
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

const chat = (speakers: SceneFace[]): Chat => ({
  day: "2026-11-17",
  code: "S2 · Night 16",
  written_at: "2026-11-17T08:00:00Z",
  lines: speakers.map((s, i) => ({ character_id: s.id, name: s.name, hue: s.hue, portrait: null, text: `Message ${i + 1}.` })),
});

/** Each line's side, in order, from the rendered list items. */
const sides = (html: string) => [...html.matchAll(/<li class="cast-chat-line( is-right)?"/g)].map((m) => (m[1] ? "right" : "left"));

describe("rightSide", () => {
  it("goes by the order voices first speak, alternating, a speaker keeping theirs", () => {
    expect(rightSide([])).toEqual([]);
    expect(rightSide(["a"])).toEqual([false]);
    expect(rightSide(["a", "b", "a", "a", "b"])).toEqual([false, true, false, false, true]);
    expect(rightSide(["b", "a", "b"])).toEqual([false, true, false]);
    expect(rightSide(["a", "b", "c", "d", "c", "b"])).toEqual([false, true, false, true, false, true]);
  });
});

describe("house scene sides", () => {
  it("two voices: the first on the left, the second on the right, whoever speaks twice in a row", () => {
    const html = renderToStaticMarkup(createElement(HouseScene, { scene: scene([JUNIPER, NELL, JUNIPER, JUNIPER, NELL, JUNIPER]), report: false }));
    expect(sides(html)).toEqual(["left", "right", "left", "left", "right", "left"]);
    expect(html).toContain('class="cast-chat-thread cast-chat-sides house-lines"');
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

describe("morning-after chat sides", () => {
  it("the group chat alternates the same way, each voice on its own side", () => {
    const html = renderToStaticMarkup(createElement(CastChat, { chat: chat([JUNIPER, NELL, DEX, JUNIPER]) }));
    expect(html).toContain('class="cast-chat-thread cast-chat-sides"');
    expect(sides(html)).toEqual(["left", "right", "left", "left"]);
    expect(html).toContain("The morning after Season 2, Night 16");
  });
});
