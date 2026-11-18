import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drawnStyleOf } from "@/lib/adult/characters";
import { showPortrait } from "@/lib/adult/media";
import { artStyleSql, HOUSE_LOOK_VERSION, HOUSE_LOOK_WORDS } from "@/lib/art-style";
import { loadCharacter } from "@/lib/character";
import { houseBackdrop, houseLookPrompt } from "@/lib/house-look";
import { showStyleSql } from "@/lib/portrait-sql";
import { afterDarkPortrait, characterPortrait } from "@/lib/portraits";
import { startTestDb } from "./helpers";

// The house look (PRD styles-and-storylines phase 3): the show draws its own cast in 2.5D from a house-look portrait,
// while After Dark, which only draws photographs, keeps them and keeps starting from the face they had before.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** An approved PG portrait in the ledger, `minutes` from now so the order is the one written. */
async function portrait(characterId: string, promptVersion: string, url: string, minutes: number): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `insert into character_assets (id, character_id, kind, source_type, source_model, prompt_version, url, content_rating, review_status, created_at)
     values ($1, $2, 'portrait', 'generated', 'm', $3, $4, 'pg', 'approved', now() + make_interval(mins => $5::int))`,
    [id, characterId, promptVersion, url, minutes],
  );
  return id;
}
const showStyle = async (id: string) => (await t.db.query<{ s: string }>(`select ${showStyleSql("c")} as s from characters c where c.id = $1`, [id])).rows[0].s;
const ownStyle = async (id: string) => (await t.db.query<{ s: string }>(`select ${artStyleSql("c")} as s from characters c where c.id = $1`, [id])).rows[0].s;

describe("the redraw's prompt", () => {
  it("keeps the person and their skin, in the house look, on a backdrop in their own colour", () => {
    const p = houseLookPrompt({ look: "a woman in her mid-thirties with deep brown skin and short natural hair.", age: 35, hue: 200 });
    expect(p).toContain(HOUSE_LOOK_WORDS);
    expect(p).toContain("the same face, skin tone, hair, age and outfit");
    expect(p).toContain("They are a woman in her mid-thirties with deep brown skin and short natural hair, 35 years old.");
    expect(p).toContain("Keep their skin exactly as light or dark as in image 0");
    expect(p).toContain("soft steel blue studio backdrop");
    expect(p).toMatch(/Adult proportions, mature features\. No text, no logo, no watermark, fully clothed\.$/);
  });

  it("picks the backdrop's colour band from the hue, wrapping round the wheel", () => {
    expect(houseBackdrop(0)).toBe("warm red");
    expect(houseBackdrop(60)).toBe("golden yellow");
    expect(houseBackdrop(345)).toBe("deep rose");
    expect(houseBackdrop(370)).toBe("warm red");
    expect(houseBackdrop(null)).toBe("burnt orange");
  });
});

describe("how the show draws them", () => {
  it("draws the fixed house cast in 2.5D from their committed house-look file", async () => {
    expect(characterPortrait("house-rafe")).toBe("/cast/house-rafe-v5.webp");
    expect(await showStyle("house-rafe")).toBe("semi_real");
  });

  it("goes by their face in the ledger: an older portrait newest means a photograph's style, a house-look one 2.5D", async () => {
    await portrait("house-rafe", "portrait-v3", "/cast/house-rafe-v3.webp", 0);
    expect(await showStyle("house-rafe")).toBe("realistic");
    await portrait("house-rafe", HOUSE_LOOK_VERSION, "/cast/house-rafe-v5.webp", 1);
    expect(await showStyle("house-rafe")).toBe("semi_real");
  });

  it("draws a person's character in their own style, whatever their portraits", async () => {
    const id = randomUUID();
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, extras) values ($1, $2, false, 'Tsukiha Aoi', 30, 'x', '[]'::jsonb, 'x', 'x', '{"looks":{"style":"anime"}}'::jsonb)`,
      [id, randomUUID()],
    );
    await portrait(id, HOUSE_LOOK_VERSION, "data:image/png;base64,AAAA", 0);
    expect(await showStyle(id)).toBe("anime");
  });
});

describe("After Dark keeps them as photographs", () => {
  it("leaves their own style unset, so its gate still lets them in", async () => {
    await portrait("house-rafe", HOUSE_LOOK_VERSION, "/cast/house-rafe-v5.webp", 0);
    expect(await ownStyle("house-rafe")).toBe("realistic");
    expect(await drawnStyleOf(t.db, "house-rafe")).toBeNull();
  });

  it("starts the fixed house cast from their portrait before the house look", async () => {
    for (const [id, file] of [
      ["house-rafe", "/cast/house-rafe-v3.webp"],
      ["house-nell", "/cast/house-nell-v4.webp"],
    ] as const) {
      expect(afterDarkPortrait(id)).toBe(file);
      expect(await showPortrait(t.db, (await loadCharacter(t.db, id))!)).toBe(file);
    }
  });

  it("starts a newcomer from their photograph, never the house-look portrait drawn after it", async () => {
    const id = "house-odessa";
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values ($1, null, true, 'Odessa Brine', 41, 'A ferry captain.', '[]'::jsonb, 'x', 'x')`,
      [id],
    );
    const photo = await portrait(id, "season-gen-v1", "data:image/png;base64,AAAA", 0);
    await portrait(id, HOUSE_LOOK_VERSION, "data:image/png;base64,BBBB", 1);
    expect(await showStyle(id)).toBe("semi_real");
    expect(await showPortrait(t.db, (await loadCharacter(t.db, id))!)).toBe(`/api/assets/${photo}`);
  });
});
