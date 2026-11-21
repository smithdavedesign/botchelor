/**
 * The house's rooms (lib/house-rooms.ts; the visual pop audit's pass 3): one empty room per place a scene happens
 * (lib/house-scenes.ts HOUSE_PLACES), drawn free like the show's sets, and each scene on /house over its room with the
 * house camera's REC light and clock. Pure renders, no database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HouseScene from "@/app/HouseScene";
import { HOUSE_PLACES, type HouseSceneView } from "@/lib/house-scenes";
import { HOUSE_ROOM_PLATES, houseCamTime, houseRoom, houseRoomBackground, houseRoomPath } from "@/lib/house-rooms";

const root = join(__dirname, "..");
const files = new Set(readdirSync(join(root, "public", "cast")));
const css = readFileSync(join(root, "app", "ux", "show.css"), "utf8");

const scene = (place: (typeof HOUSE_PLACES)[number]): HouseSceneView => ({
  id: "scene-rooms",
  day: "2026-11-20",
  kind: "daily",
  place: { ...place },
  code: "S2 · Night 20",
  written_at: "2026-11-20T18:20:00Z",
  cast: [],
  lines: [
    { id: "house-juniper", name: "Juniper", hue: 200, portrait: null, house: true, n: 1, text: "Line one." },
    { id: "house-barnaby", name: "Barnaby", hue: 30, portrait: null, house: true, n: 2, text: "Line two." },
  ],
  about: [],
  result: null,
});

describe("the house's rooms", () => {
  it("has a room for every place a scene happens, each a reviewed file on disk", () => {
    expect(Object.keys(HOUSE_ROOM_PLATES).sort()).toEqual(HOUSE_PLACES.map((p) => p.id).sort());
    for (const p of HOUSE_PLACES) {
      expect(houseRoomPath(p.id)).toBe(`/cast/house-${p.id}-v1.webp`);
      expect(files.has(`house-${p.id}-v1.webp`), p.id).toBe(true);
    }
  });

  it("draws every room empty: nobody in it and no lettering", () => {
    for (const [room, plate] of Object.entries(HOUSE_ROOM_PLATES)) {
      expect(plate, room).toMatch(/^(an|the) empty\b/);
      expect(plate, room).not.toMatch(/\b(couple|crowd|people|person|man|woman|cast|contestants?)\b/i);
      expect(plate, room).not.toMatch(/\b(sign|logo|letters?|text|words?)\b/i);
    }
  });

  it("treats an unknown place as the kitchen, as housePlace does", () => {
    expect(houseRoom("attic")).toBe("kitchen");
    expect(houseRoom("toString")).toBe("kitchen");
    expect(houseRoomPath("attic")).toBe("/cast/house-kitchen-v1.webp");
  });

  it("darkens a room toward the bottom, never past 0.94", () => {
    expect(houseRoomBackground("pool", 0.35)).toMatch(/rgba\(14,8,20,0\.35\) 0%, rgba\(14,8,20,0\.65\) 100%\), url\(\/cast\/house-pool-v1\.webp\)/);
    expect(houseRoomBackground("pool", 0.8)).toContain("rgba(14,8,20,0.94) 100%");
  });

  it("gives the house camera a clock in the room's hour that a scene always keeps", () => {
    expect(houseCamTime("terrace", "abc")).toMatch(/^22:[0-5]\d$/);
    expect(houseCamTime("stairs", "abc")).toMatch(/^00:[0-5]\d$/);
    expect(houseCamTime("terrace", "abc")).toBe(houseCamTime("terrace", "abc"));
  });
});

describe("a scene over its room (app/HouseScene.tsx)", () => {
  it("runs the lines over the room's picture, with the REC light and clock as set dressing", () => {
    const html = renderToStaticMarkup(createElement(HouseScene, { scene: scene(HOUSE_PLACES[1]), lead: true, report: false }));
    expect(html).toMatch(/<div class="house-room is-lead" data-rec="REC · 22:\d\d">/);
    expect(html).toContain('class="house-room-art" aria-hidden="true"');
    expect(html).toContain("url(/cast/house-terrace-v1.webp)");
    // The lines are still the transcript, inside the room.
    expect(html).toMatch(/house-room[^>]*>.*<ol class="cast-chat-thread cast-chat-sides house-lines">.*Line one\..*Line two\./s);
  });

  it("keeps the camera's words from screen readers and only moves where motion is welcome", () => {
    expect(css).toMatch(/\.house-room::before \{\s*content: attr\(data-rec\);\s*content: attr\(data-rec\) \/ "";/);
    const still = css.split("@media (prefers-reduced-motion: no-preference)");
    const outside = still[0] + still.slice(1).map((b) => b.slice(b.indexOf("\n}") + 2)).join("");
    expect(outside).not.toMatch(/\.house-room[^{]*\{[^}]*animation/);
    expect(css).toMatch(/\.house-room-art \{\s*animation: set-push-in/);
  });
});
