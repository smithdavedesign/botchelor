import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { avatarPalette, initials } from "@/lib/avatar";
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
