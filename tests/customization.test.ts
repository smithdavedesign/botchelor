import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { avatarPalette, hueFromPixels, initials } from "@/lib/avatar";
import { getPublicCharacter } from "@/lib/game";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

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

describe("character customization: appearance and avatar hue", () => {
  it("stores an appearance line and a chosen avatar hue", async () => {
    const res = await api.createCharacter(validCharacter({ appearance: "tall, freckled, always in a yellow raincoat", avatar_hue: 275 }), newUserCookie());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hue).toBe(275);
    const { rows } = await t.db.query<{ appearance: string; avatar_hue: number }>(
      "select appearance, avatar_hue from characters where id = $1",
      [body.id],
    );
    expect(rows[0]).toMatchObject({ appearance: "tall, freckled, always in a yellow raincoat", avatar_hue: 275 });
  });

  it("treats avatar hue 0 as auto (null) and keeps appearance optional", async () => {
    const res = await api.createCharacter(validCharacter({ avatar_hue: 0 }), newUserCookie());
    const body = await res.json();
    expect(body.hue).toBeNull();
    const { rows } = await t.db.query<{ appearance: string | null; avatar_hue: number | null }>(
      "select appearance, avatar_hue from characters where id = $1",
      [body.id],
    );
    expect(rows[0]).toEqual({ appearance: null, avatar_hue: null });
  });

  it("content-filters the appearance line (no real people)", async () => {
    const res = await api.createCharacter(validCharacter({ appearance: "looks exactly like Taylor Swift" }), newUserCookie());
    expect(res.status).toBe(422);
    expect((await res.json()).field).toBe("appearance");
    expect(await t.count("characters", "not is_house")).toBe(0);
  });
});

describe("avatars are deterministic", () => {
  it("derives a stable palette from the seed and honours a hue override", () => {
    expect(avatarPalette("abc")).toEqual(avatarPalette("abc"));
    expect(avatarPalette("abc", 210).hue).toBe(210);
    expect(avatarPalette("abc", 0).hue).toBe(avatarPalette("abc").hue); // 0 = auto
    expect(initials("Mira Quell")).toBe("MQ");
    expect(initials("Rafe")).toBe("R");
  });
});

describe("styling an avatar from an image (in-browser, nothing uploaded)", () => {
  const solid = (r: number, g: number, b: number, n = 100) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      a[i * 4] = r;
      a[i * 4 + 1] = g;
      a[i * 4 + 2] = b;
      a[i * 4 + 3] = 255;
    }
    return a;
  };

  it("reads a dominant vivid hue, and returns null for a grey image", () => {
    const blue = hueFromPixels(solid(0, 0, 255));
    expect(blue).not.toBeNull();
    expect(blue!).toBeGreaterThanOrEqual(240);
    expect(blue!).toBeLessThanOrEqual(270);
    expect(hueFromPixels(solid(128, 128, 128))).toBeNull(); // grey → stays "auto"
    expect(hueFromPixels(solid(255, 255, 255))).toBeNull(); // white → auto
  });
});

describe("the public contestant card", () => {
  it("exposes the public persona but not the dealbreaker or the soul", async () => {
    const owner = newUserCookie();
    const body = await (
      await api.createCharacter(
        validCharacter({ appearance: "a coat of stars", avatar_hue: 160, soul: { values: "secret inner self" }, dealbreaker: "secret dealbreaker text" }),
        owner,
      )
    ).json();
    const card = await getPublicCharacter(t.db, body.id);
    expect(card).toMatchObject({ id: body.id, name: "Mira Quell", appearance: "a coat of stars", hue: 160, house: false });
    expect(card).toHaveProperty("want");
    const json = JSON.stringify(card);
    expect(json).not.toContain("secret dealbreaker text");
    expect(json).not.toContain("secret inner self");
    expect(await getPublicCharacter(t.db, "nope")).toBeNull();
  });
});
