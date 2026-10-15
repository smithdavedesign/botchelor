import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExtrasInput, extrasFields, normaliseExtras } from "@/lib/extras";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { HOUSE_KITS } from "@/lib/house-kits";
import { checkFields } from "@/lib/safety";
import { startTestDb } from "./helpers";

describe("the house cast's voice kits", () => {
  it("every house character has one, valid and within the show's rules", () => {
    expect(Object.keys(HOUSE_KITS).sort()).toEqual(ALL_HOUSE_CHARACTERS.map((c) => c.id).sort());
    for (const [id, kit] of Object.entries(HOUSE_KITS)) {
      expect(ExtrasInput.safeParse(kit).success, id).toBe(true);
      expect(normaliseExtras(kit), id).toEqual(kit); // nothing blank or duplicated
      expect(checkFields(extrasFields(kit)).ok, id).toBe(true);
      expect(Object.keys(kit.lines ?? {}).length, id).toBeGreaterThanOrEqual(3);
      expect(Object.keys(kit.tells ?? {}).length, id).toBe(4);
    }
  });

  it("tells carry no pronouns (they read “they …” on the card and “you …” in the character's own prompt)", () => {
    for (const [id, kit] of Object.entries(HOUSE_KITS)) {
      for (const tell of Object.values(kit.tells ?? {})) expect(tell, id).not.toMatch(/\b(he|she|his|her|hers|him|himself|herself)\b/i);
    }
  });

  describe("seeded with the cast", () => {
    let t: Awaited<ReturnType<typeof startTestDb>>;
    beforeAll(async () => {
      t = await startTestDb();
    });
    afterAll(async () => {
      await t.close();
    });
    it("lands on each house character's public details", async () => {
      const { rows } = await t.db.query<{ id: string; extras: Record<string, unknown> }>(`select id, extras from characters where is_house`);
      for (const r of rows) expect(r.extras, r.id).toEqual(HOUSE_KITS[r.id]);
    });
  });
});

describe("the builder's sample characters", () => {
  it("their tells carry no pronouns either", async () => {
    const src = (await import("node:fs")).readFileSync("app/create/CreateWizard.tsx", "utf8");
    const tells = [...src.matchAll(/tells: \{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    expect(tells.length).toBeGreaterThanOrEqual(8);
    for (const tell of tells) expect(tell).not.toMatch(/\b(he|she|his|her|hers|him|himself|herself)\b/i);
  });
});
