import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageTraits, traitsFromPalette } from "@/lib/avatar";
import { deterministicEngine, type CharacterSheet, type SideSetup, type SoulSignals } from "@/lib/engine";
import { ALL_HOUSE_CHARACTERS, HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { LOOK_GALLERY, LOOK_PRESETS, lookById, resolveLook } from "@/lib/presets";
import { checkFields } from "@/lib/safety";
import { api, newUserCookie, startTestDb } from "./helpers";

/** The seeded house cast: the competitor report's "generate a house cast of 12-20 characters". */
describe("the house cast", () => {
  it("covers 12-20 characters, free plus premium", () => {
    expect(HOUSE_CHARACTERS.length).toBeGreaterThanOrEqual(12);
    expect(ALL_HOUSE_CHARACTERS.length).toBeLessThanOrEqual(20);
    expect(ALL_HOUSE_CHARACTERS).toHaveLength(HOUSE_CHARACTERS.length + PREMIUM_HOUSE_CHARACTERS.length);
  });

  it("gives every character a distinct id, name and archetype", () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(ALL_HOUSE_CHARACTERS.map((c) => c.id))).toBe(true);
    expect(unique(ALL_HOUSE_CHARACTERS.map((c) => c.name))).toBe(true);
    // The point of a cast this size is personality spread, so two characters may not share a temperament.
    expect(unique(ALL_HOUSE_CHARACTERS.map((c) => c.archetype))).toBe(true);
  });

  it("gives every character a complete, adult sheet and a curated look", () => {
    for (const c of ALL_HOUSE_CHARACTERS) {
      expect(c.id.startsWith("house-")).toBe(true);
      expect(c.age).toBeGreaterThanOrEqual(18);
      expect(c.traits).toHaveLength(3);
      for (const trait of c.traits) expect(trait.trim().length).toBeGreaterThan(0);
      for (const field of [c.name, c.bio, c.want, c.dealbreaker, c.archetype, c.appearance]) {
        expect(field.trim().length).toBeGreaterThan(0);
      }
      // 1..360: 0 would mean "auto" (lib/avatar.ts), which would throw the curated look away.
      expect(c.hue).toBeGreaterThan(0);
      expect(c.hue).toBeLessThanOrEqual(360);
    }
  });

  it("spreads the cast's avatar hues around the wheel", () => {
    const hues = ALL_HOUSE_CHARACTERS.map((c) => c.hue);
    expect(new Set(hues).size).toBe(hues.length);
    // Every quadrant of the wheel is used, so the gallery is not fifteen shades of one colour.
    for (const [lo, hi] of [[0, 90], [90, 180], [180, 270], [270, 360]]) {
      expect(hues.some((h) => h >= lo && h < hi)).toBe(true);
    }
  });

  // The cast is seed data that reaches both the model and the audience, so it goes through the same
  // content filter a creator's sheet does — dealbreakers, archetypes and appearance lines included.
  it("passes the content filter on every field", () => {
    for (const c of ALL_HOUSE_CHARACTERS) {
      expect(
        checkFields({
          name: c.name,
          bio: c.bio,
          traits: c.traits,
          want: c.want,
          dealbreaker: c.dealbreaker,
          archetype: c.archetype,
          appearance: c.appearance,
        }),
      ).toEqual({ ok: true });
    }
  });

  it("prices every premium character and ties it to a SKU", () => {
    for (const c of PREMIUM_HOUSE_CHARACTERS) {
      expect(c.sku.length).toBeGreaterThan(0);
      expect(c.price_cents).toBeGreaterThan(0);
    }
  });
});

/** The curated look gallery: the $0 stand-in for the report's "pick a portrait from a gallery". */
describe("the look gallery", () => {
  it("offers a dozen distinct looks", () => {
    expect(LOOK_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(LOOK_PRESETS.map((p) => p.id)).size).toBe(LOOK_PRESETS.length);
    expect(new Set(LOOK_PRESETS.map((p) => p.label)).size).toBe(LOOK_PRESETS.length);
    expect(LOOK_GALLERY).toHaveLength(LOOK_PRESETS.length);
  });

  it("resolves each look into an appearance line, 2-3 traits and in-range signals", () => {
    for (const look of LOOK_GALLERY) {
      expect(look.appearance.trim().length).toBeGreaterThan(0);
      expect(look.traits.length).toBeGreaterThanOrEqual(2);
      expect(look.traits.length).toBeLessThanOrEqual(3);
      expect(new Set(look.traits).size).toBe(look.traits.length);
      for (const value of Object.values(look.signals)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      if (look.hue !== null) {
        expect(look.hue).toBeGreaterThan(0);
        expect(look.hue).toBeLessThanOrEqual(360);
      }
    }
  });

  it("covers the guarded and the open end of the behaviour range", () => {
    // A gallery where every look behaves the same would train nothing: dark/muted has to read as
    // guarded, bright/varied as open, or picking a look is only picking a colour.
    expect(LOOK_GALLERY.some((l) => l.signals.guardedness >= 0.6)).toBe(true);
    expect(LOOK_GALLERY.some((l) => l.signals.openness >= 0.8)).toBe(true);
    expect(LOOK_GALLERY.some((l) => l.signals.warmth >= 0.7)).toBe(true);
    expect(LOOK_GALLERY.some((l) => l.signals.warmth <= 0.2)).toBe(true);
  });

  it("is resolved purely from its palette", () => {
    for (const preset of LOOK_PRESETS) {
      const read = traitsFromPalette(preset.palette);
      expect(resolveLook(preset)).toEqual({
        id: preset.id,
        label: preset.label,
        hue: read.hue,
        appearance: read.descriptor,
        traits: read.traits,
        signals: read.signals,
      });
    }
  });

  it("finds a look by id, and nothing for an unknown one", () => {
    expect(lookById(LOOK_PRESETS[0].id)?.label).toBe(LOOK_PRESETS[0].label);
    expect(lookById("no-such-look")).toBeUndefined();
  });
});

/** Solid-colour RGBA pixels for an hsl() colour, so a preset and a read image can be compared. */
function solidImage(h: number, s: number, l: number, pixels = 256): number[] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const rgb = [r1, g1, b1].map((v) => Math.round((v + m) * 255));
  return Array.from({ length: pixels }, () => [rgb[0], rgb[1], rgb[2], 255]).flat();
}

describe("a picked look and a read image agree", () => {
  // Both roads go through traitsFromPalette, which is the point: picking "Golden hour" has to land
  // exactly where uploading a golden-hour photo would, or the gallery is a different product.
  it.each([
    [45, 0.6, 0.7],
    [225, 0.46, 0.28],
    [315, 0.16, 0.6],
  ])("reads hsl(%i, %f, %f) the same way the gallery does", (hue, saturation, lightness) => {
    const fromImage = imageTraits(solidImage(hue, saturation, lightness));
    const fromPalette = traitsFromPalette({ hue: fromImage.hue, lightness, saturation, variety: 1 });
    expect(fromImage.signals).toEqual(fromPalette.signals);
    expect(fromImage.traits).toEqual(fromPalette.traits);
    expect(fromImage.descriptor).toEqual(fromPalette.descriptor);
  });
});

/**
 * The house cast's seeded temperaments: they exist for the engine and for nobody else. A house
 * character has no owner, so there is no one the API may ever hand its soul row to.
 */
describe("the house cast's seeded souls", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("stores one engine-only soul per house character, with the curated signals and no text", async () => {
    const { rows } = await t.db.query<{ character_id: string; local_only: boolean; signals: SoulSignals; text: string }>(
      `select s.character_id, s.local_only, s.signals,
              s.values || s.insecurities || s.humor || s.boundaries || s.romantic || s.communication as text
         from souls s join characters c on c.id = s.character_id where c.is_house`,
    );
    expect(rows).toHaveLength(ALL_HOUSE_CHARACTERS.length);
    const byId = new Map(rows.map((r) => [r.character_id, r]));
    for (const c of ALL_HOUSE_CHARACTERS) {
      const row = byId.get(c.id);
      expect(row?.signals).toEqual(c.signals);
      // Engine-only: no prose to leak, and flagged so it is never sent to any model.
      expect(row?.local_only).toBe(true);
      expect(row?.text).toBe("");
    }
  });

  it("never hands a house character's soul to anybody", async () => {
    // Nobody owns a house character, so the owner-only route has no owner to answer.
    const res = await api.getSoul(HOUSE_CHARACTERS[0].id, newUserCookie());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "character_not_found" });
  });

  it("reaches the engine: a warm house temperament beats a guarded one, all else equal", () => {
    const oc: CharacterSheet = {
      name: "Mira Quell",
      age: 27,
      bio: "A cartographer who maps cities that only exist on Tuesdays.",
      traits: ["curious", "stubborn", "warm"],
      want: "Someone who can read a map upside down",
      dealbreaker: "People who dislike a detour",
      house: false,
    };
    // One partner sheet, used for both runs, so the only thing that changes is the temperament. (Pairing
    // two real sheets would confound it: half the cast trips somebody's dealbreaker, which is the point
    // of the cast, but not what this test is about.)
    const partner: CharacterSheet = {
      name: "Partner",
      age: 30,
      bio: "Keeps a quiet shop and closes it early on Thursdays.",
      traits: ["steady", "private", "wry"],
      want: "An evening with no agenda",
      dealbreaker: "Being hurried",
      house: true,
    };
    const side = (sheet: CharacterSheet, signals: SoulSignals): SideSetup => ({
      sheet,
      signals,
      autonomy: "guided",
      strategy: "genuine_chemistry",
      agendaId: "keep_it_light",
      note: null,
      gameBudget: 25,
    });
    const withSignals = (id: string) => {
      const h = ALL_HOUSE_CHARACTERS.find((c) => c.id === id)!;
      return deterministicEngine.decide(
        { a: side(oc, { warmth: 0.6, openness: 0.6, guardedness: 0.1, humor: 0.5 }), b: side(partner, h.signals) },
        4242,
      ).variables;
    };
    // Sable is the cast's warmest, most open extrovert; Orin its most guarded sceptic.
    const warm = withSignals("house-sable");
    const guarded = withSignals("house-orin");
    expect(warm.chemistry.final).toBeGreaterThan(guarded.chemistry.final);
    expect(warm.trust.final).toBeGreaterThan(guarded.trust.final);
    expect(warm.awkwardness.final).toBeLessThan(guarded.awkwardness.final);
  });
});
