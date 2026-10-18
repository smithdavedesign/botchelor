import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { characterPortrait, HOUSE_PORTRAIT_IDS, venueBackdrop, VENUES_WITH_BACKDROPS } from "@/lib/portraits";
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

  it("maps a venue to its backdrop; a venue without one yet, or an unknown id, to none", () => {
    expect(venueBackdrop("rooftop_bar")).toBe("/cast/venue-rooftop_bar-v2.webp");
    expect(venueBackdrop("skydive")).toBeNull(); // paints its gradient until its plate is made and reviewed
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

  it("every venue listed with a backdrop has its image on disk, and each is a real venue", () => {
    for (const id of VENUES_WITH_BACKDROPS) {
      expect(VENUE_IDS).toContain(id);
      expect(files.has(`venue-${id}-v2.webp`)).toBe(true);
    }
  });
});
