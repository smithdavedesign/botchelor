// The season's promo cuts (scripts/clips/season-promo.mjs): the cast reveal's props from the public cast JSON, the
// trailer's end card, the caption. Pure parts only; rendering runs on the Mac.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script, no types
import { castCaption, castProps, clockOf, defaultSlug, imageOf, trailerCard } from "../scripts/clips/season-promo.mjs";

const BASE = "https://botchelor.com";
const CAST = {
  season: { id: "2026-12-01", number: 3, label: "December 2026", month: "December", path: "/seasons/december-2026", phase: "preseason", title: "The Botchelor", pitch: "…", places: 5, arc: null },
  lead: { id: "house-rafe", name: "Rafe Calloway", line: "Cooks for twelve.", portrait: "/cast/house-rafe-v5.webp", rose: "/api/shots/abc.webp", hue: 20 },
  faces: [
    { id: "p-ana", name: "Ana Vale", line: "A suitor with a story.", portrait: "/api/assets/x1", hue: 300 },
    { id: "p-bo", name: "Bo Reyes", line: "", portrait: null, hue: null },
  ],
  faces_are: "auditions",
};

describe("the season promo", () => {
  it("builds the cast reveal from the public cast: the lead's rose shot, each face's line, the season's words", () => {
    const p = castProps(CAST, BASE);
    expect(p).toMatchObject({ kicker: "Season 3 · December", title: "The Botchelor", sub: "One lead. Five suitors. A rose ceremony every Sunday.", facesAre: "auditions", clock: "Starts Tuesday, December 1", url: "botchelor.com/december" });
    expect(p.lead).toEqual({ name: "Rafe Calloway", line: "Cooks for twelve.", image: `${BASE}/api/shots/abc.webp`, hue: 20 });
    expect(p.suitors.map((s: { image: string | null }) => s.image)).toEqual([`${BASE}/api/assets/x1`, null]);
  });

  it("uses the show's own art from public/, counts the nights once it runs, and picks next month's season late in the month", () => {
    expect(imageOf("/cast/house-nell-v5.webp", BASE)).toBe("cast/house-nell-v5.webp");
    expect(clockOf({ ...CAST.season, phase: "season", arc: { night: 5, nights: 31 } })).toBe("Night 5 of 31");
    expect(defaultSlug(new Date("2026-11-27T12:00:00Z"))).toBe("december-2026");
    expect(defaultSlug(new Date("2026-12-05T12:00:00Z"))).toBe("december-2026");
  });

  it("closes the trailer on the season, and the caption names the cast without spoiling anything", () => {
    const p = castProps(CAST, BASE);
    expect(trailerCard(p)).toMatchObject({ endLines: ["The Botchelor.", "Starts Tuesday, December 1.", "Who gets the rose?"], url: "botchelor.com/december" });
    const caption = castCaption(p, BASE, CAST.season.path);
    expect(caption).toContain("Rafe Calloway is the lead.");
    expect(caption).toContain("Top of casting so far: Ana, Bo.");
    expect(caption).toContain(`${BASE}/seasons/december-2026`);
  });
});
