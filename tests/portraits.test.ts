import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterDarkPortrait, characterPortrait, HOUSE_PORTRAIT_IDS, HOUSE_STAGE_PICTURES, showStyleOf, stagePicture, venueBackdrop, VENUES_WITH_BACKDROPS } from "@/lib/portraits";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { EXTRA_VENUES, VENUE_IDS } from "@/lib/venues";

const CAST_DIR = join(process.cwd(), "public", "cast");
const files = new Set(readdirSync(CAST_DIR));

describe("portraits — mapping", () => {
  it("maps a house character to its house-look portrait (v5), and a visitor OC to none", () => {
    expect(characterPortrait("house-rafe")).toBe("/cast/house-rafe-v5.webp");
    expect(characterPortrait("house-nell")).toBe("/cast/house-nell-v5.webp");
    expect(characterPortrait("some-random-oc-id")).toBeNull();
    expect(characterPortrait(null)).toBeNull();
  });

  it("After Dark keeps each house character's portrait from before the house look: v4 for the three redrawn in photoreal, else v3", () => {
    for (const id of ["house-nell", "house-juniper", "house-sable"]) expect(afterDarkPortrait(id)).toBe(`/cast/${id}-v4.webp`);
    expect(afterDarkPortrait("house-rafe")).toBe("/cast/house-rafe-v3.webp");
    expect(afterDarkPortrait("some-random-oc-id")).toBeNull();
    for (const id of HOUSE_PORTRAIT_IDS) {
      expect(afterDarkPortrait(id)).not.toBe(characterPortrait(id));
      expect(files.has(afterDarkPortrait(id)!.replace("/cast/", "")), id).toBe(true);
    }
  });

  it("the show draws the fixed house cast in 2.5D and anyone else in their own style", () => {
    expect(showStyleOf({ id: "house-rafe", extras: null })).toBe("semi_real");
    expect(showStyleOf({ id: "oc-1", extras: { looks: { style: "anime" } } })).toBe("anime");
    expect(showStyleOf({ id: "oc-2", extras: null })).toBe("realistic");
  });

  it("maps a venue to its backdrop; a venue without one yet, or an unknown id, to none", () => {
    expect(venueBackdrop("rooftop_bar")).toBe("/cast/venue-rooftop_bar-v2.webp");
    expect(venueBackdrop("skydive")).toBe("/cast/venue-skydive-v2.webp"); // the twenty-five added 2026-10-18 have theirs now
    expect(venueBackdrop("not_a_venue" as never)).toBeNull();
    expect(venueBackdrop(null)).toBeNull();
  });
});

describe("portraits — in sync with the cast, the venues and the files", () => {
  it("every house character has a reviewed portrait listed and on disk", () => {
    for (const c of [...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS]) {
      expect(HOUSE_PORTRAIT_IDS.has(c.id)).toBe(true);
      expect(files.has(characterPortrait(c.id)!.replace("/cast/", ""))).toBe(true);
    }
  });

  it("a house-look portrait has its stage picture (three-quarter length, for a figure); anything else has none", () => {
    expect(stagePicture("/cast/house-dex-v5.webp")).toBe("/cast/house-dex-v5-stage.webp");
    expect(stagePicture("/cast/house-dex-v5.webp?w=192")).toBe("/cast/house-dex-v5-stage.webp");
    // Only the house look: not After Dark's pre-look face, not a stage picture again, not a served asset or nothing.
    expect(stagePicture("/cast/house-dex-v3.webp")).toBeNull();
    expect(stagePicture("/cast/house-dex-v5-stage.webp")).toBeNull();
    expect(stagePicture("/cast/house-nobody-v5.webp")).toBeNull();
    expect(stagePicture("/api/assets/abc")).toBeNull();
    expect(stagePicture(null)).toBeNull();
  });

  it("every stage picture is on disk beside its house-look portrait (one not made yet: the figure is the portrait)", () => {
    expect(HOUSE_STAGE_PICTURES.size).toBeGreaterThan(0);
    for (const name of HOUSE_STAGE_PICTURES) {
      expect(files.has(`${name}-v5.webp`), name).toBe(true);
      expect(files.has(`${name}-v5-stage.webp`), name).toBe(true);
    }
  });

  it("every listed portrait id is a real house character (no orphans)", () => {
    const castIds = new Set([...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS].map((c) => c.id));
    for (const id of HOUSE_PORTRAIT_IDS) expect(castIds.has(id)).toBe(true);
  });

  it("every venue has a reviewed backdrop (2026-10-18)", () => {
    for (const id of VENUE_IDS) expect(VENUES_WITH_BACKDROPS.has(id)).toBe(true);
  });

  it("every venue listed with a backdrop has its image on disk, and each is a real venue or extra place", () => {
    const real = new Set<string>([...VENUE_IDS, ...EXTRA_VENUES.map((v) => v.id)]);
    for (const id of VENUES_WITH_BACKDROPS) {
      expect(real.has(id)).toBe(true);
      // v2 for the library, v3 for the themed nights (2026-11-17): whatever version venueBackdrop names is on disk.
      expect(files.has(venueBackdrop(id)!.replace(/^\/cast\//, "")), id).toBe(true);
    }
    expect(venueBackdrop("gothic_manor")).toBe("/cast/venue-gothic_manor-v3.webp");
  });
});
