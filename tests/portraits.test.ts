import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { characterPortrait, HOUSE_PORTRAIT_IDS, venueBackdrop } from "@/lib/portraits";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { VENUE_IDS } from "@/lib/venues";

const CAST_DIR = join(process.cwd(), "public", "cast");
const files = new Set(readdirSync(CAST_DIR));

describe("portraits — mapping", () => {
  it("maps a house character to its portrait, and a visitor OC to none", () => {
    expect(characterPortrait("house-rafe")).toBe("/cast/house-rafe-v3.webp");
    expect(characterPortrait("some-random-oc-id")).toBeNull();
    expect(characterPortrait(null)).toBeNull();
  });

  it("maps a venue to its backdrop, and an unknown id to none", () => {
    expect(venueBackdrop("rooftop_bar")).toBe("/cast/venue-rooftop_bar-v2.webp");
    expect(venueBackdrop("not_a_venue" as never)).toBeNull();
    expect(venueBackdrop(null)).toBeNull();
  });
});

describe("portraits — in sync with the cast, the venues and the files", () => {
  it("every house character has a reviewed portrait listed and on disk", () => {
    for (const c of [...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS]) {
      expect(HOUSE_PORTRAIT_IDS.has(c.id)).toBe(true);
      expect(files.has(`${c.id}-v3.webp`)).toBe(true);
    }
  });

  it("every listed portrait id is a real house character (no orphans)", () => {
    const castIds = new Set([...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS].map((c) => c.id));
    for (const id of HOUSE_PORTRAIT_IDS) expect(castIds.has(id)).toBe(true);
  });

  it("every venue has a backdrop image on disk", () => {
    for (const id of VENUE_IDS) expect(files.has(`venue-${id}-v2.webp`)).toBe(true);
  });
});
