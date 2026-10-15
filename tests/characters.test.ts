import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_COOKIE } from "@/lib/http";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, newUserCookie, setupEpisode, startTestDb, validCharacter } from "./helpers";

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

const userCharacters = () => t.count("characters", "not is_house");

describe("POST /api/characters: age check (exit criterion)", () => {
  it("rejects a 17-year-old character with 422 and stores nothing", async () => {
    const res = await api.createCharacter(validCharacter({ age: 17 }), newUserCookie());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_character");
    expect(body.issues.map((i: { field: string }) => i.field)).toContain("age");
    expect(await userCharacters()).toBe(0);
  });

  it("accepts an 18-year-old character with 201 and stores it", async () => {
    const res = await api.createCharacter(validCharacter({ age: 18 }), newUserCookie());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      name: "Mira Quell",
      age: 18,
      traits: ["curious", "stubborn", "warm"],
      house: false,
    });
    expect(typeof body.id).toBe("string");
    expect(await userCharacters()).toBe(1);
  });

  it.each([
    ["a string age", "18"],
    ["a fractional age", 18.5],
    ["an age over 1000", 1001],
    ["a negative age", -18],
  ])("rejects %s with 422 and stores nothing", async (_label, age) => {
    const res = await api.createCharacter(validCharacter({ age }), newUserCookie());
    expect(res.status).toBe(422);
    expect(await userCharacters()).toBe(0);
  });

  it("accepts the 1000-year-old upper bound for immortal OCs", async () => {
    const res = await api.createCharacter(validCharacter({ age: 1000 }), newUserCookie());
    expect(res.status).toBe(201);
  });
});

describe("POST /api/characters: content filter (exit criterion)", () => {
  it("rejects a bio containing a real-person name from the blocklist with 422", async () => {
    const res = await api.createCharacter(
      validCharacter({ bio: "Has been secretly texting Taylor Swift for years." }),
      newUserCookie(),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_rejected", reason: "real_person", field: "bio" });
    expect(await userCharacters()).toBe(0);
  });

  it("rejects a bio containing a sexual-content term with 422", async () => {
    const res = await api.createCharacter(
      validCharacter({ bio: "Works nights writing erotic poetry for strangers." }),
      newUserCookie(),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_rejected", reason: "sexual", field: "bio" });
    expect(await userCharacters()).toBe(0);
  });

  it.each([
    ["leetspeak sexual term", { bio: "The most s3xy baker in town." }, "sexual", "bio"],
    ["uppercase sexual term", { bio: "Only posts NSFW sketches." }, "sexual", "bio"],
    ["accented real name", { bio: "Former backup dancer for Beyoncé." }, "real_person", "bio"],
    ["squashed real name", { bio: "Runs the biggest elonmusk fan forum." }, "real_person", "bio"],
    ["real name as the character name", { name: "Barack Obama" }, "real_person", "name"],
    ["sexual term in a trait", { traits: ["kind", "kinky", "loud"] }, "sexual", "traits"],
    ["sexual term in the want", { want: "A one night stand, nothing more" }, "sexual", "want"],
    ["real name in the dealbreaker", { dealbreaker: "Anyone who likes Kanye West" }, "real_person", "dealbreaker"],
    ["stated minor age", { bio: "She is 16 years old and new in town." }, "minor", "bio"],
    ["short minor age", { bio: "shes 15 but acts older" }, "minor", "bio"],
    ["high school student", { bio: "A high school student with big dreams." }, "minor", "bio"],
    ["minor-coded term", { bio: "A shy teenager who loves trains." }, "minor", "bio"],
  ])("rejects a %s with 422", async (_label, overrides, reason, field) => {
    const res = await api.createCharacter(validCharacter(overrides), newUserCookie());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_rejected", reason, field });
    expect(await userCharacters()).toBe(0);
  });
});

describe("POST /api/characters: input handling", () => {
  it("requires the 18+ and own-original-character attestation", async () => {
    const { attest: _omit, ...withoutAttest } = validCharacter();
    const res = await api.createCharacter(withoutAttest, newUserCookie());
    expect(res.status).toBe(422);
    expect(await userCharacters()).toBe(0);
  });

  it.each([
    ["two traits", { traits: ["kind", "loud"] }],
    ["four traits", { traits: ["kind", "loud", "odd", "brave"] }],
    ["an empty name", { name: "   " }],
    ["a 41-character name", { name: "A".repeat(41) }],
    ["a six-word name", { name: "Lady Seraphina Mae Anne Blackwood Smith" }],
    ["a 501-character bio", { bio: "a".repeat(501) }],
  ])("rejects %s with 422", async (_label, overrides) => {
    const res = await api.createCharacter(validCharacter(overrides), newUserCookie());
    expect(res.status).toBe(422);
    expect(await userCharacters()).toBe(0);
  });

  it("returns 400 for a body that is not valid JSON", async () => {
    const res = await api.createCharacter("{not json", newUserCookie());
    expect(res.status).toBe(400);
  });

  it("returns 415 when the body is not sent as JSON", async () => {
    const res = await api.createCharacter(JSON.stringify(validCharacter()), newUserCookie(), "text/plain");
    expect(res.status).toBe(415);
    expect(await userCharacters()).toBe(0);
  });

  it("returns 413 for an oversized body", async () => {
    const res = await api.createCharacter(validCharacter({ padding: "x".repeat(20_000) }), newUserCookie());
    expect(res.status).toBe(413);
  });

  it("issues an anonymous session cookie when there is none and never returns a user id", async () => {
    const res = await api.createCharacter(validCharacter());
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${USER_COOKIE}=[0-9a-f-]{36};`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const body = await res.json();
    expect(body).not.toHaveProperty("owner_id");
    expect(body).not.toHaveProperty("user_id");
  });

  it("keeps the existing session cookie instead of issuing a new one", async () => {
    const res = await api.createCharacter(validCharacter(), newUserCookie());
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/characters: pronouns and voice (M15)", () => {
  it("stores and returns pronouns and a voice, and the date's sheet carries them", async () => {
    const cookie = newUserCookie();
    const voice = "Dry and deadpan: short sentences, long pauses, never laughs at her own jokes.";
    const res = await api.createCharacter(validCharacter({ pronouns: "she/her", voice }), cookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ pronouns: "she/her", voice });
    const { rows } = await t.db.query<{ pronouns: string; voice: string }>(`select pronouns, voice from characters where id = $1`, [body.id]);
    expect(rows[0]).toEqual({ pronouns: "she/her", voice });
  });

  it("both are optional", async () => {
    const res = await api.createCharacter(validCharacter(), newUserCookie());
    expect(res.status).toBe(201);
    const { rows } = await t.db.query<{ pronouns: string | null; voice: string | null }>(
      `select pronouns, voice from characters where id = $1`,
      [(await res.json()).id],
    );
    expect(rows[0]).toEqual({ pronouns: null, voice: null });
  });

  it("rejects pronouns outside the list, and a voice over the limit", async () => {
    expect((await api.createCharacter(validCharacter({ pronouns: "xe/xem" }), newUserCookie())).status).toBe(422);
    expect((await api.createCharacter(validCharacter({ voice: "x".repeat(201) }), newUserCookie())).status).toBe(422);
  });

  it("runs the voice through the same content filter as the rest of the sheet", async () => {
    const res = await api.createCharacter(validCharacter({ voice: "Talks like a porn star narrating a shoot." }), newUserCookie());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_rejected", field: "voice" });
  });

  it("every house character has pronouns and a voice in the database", async () => {
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from characters where is_house and (pronouns is null or voice is null)`);
    expect(rows[0].n).toBe(0);
  });
});

describe("ownership: a creator edits and deletes only their own characters (M16)", () => {
  const make = async (cookie: string, overrides = {}) => (await api.createCharacter(validCharacter(overrides), cookie)).json();
  const sheet = async (id: string) =>
    (await t.db.query<{ name: string; want: string; voice: string | null; owner_id: string | null }>(
      `select name, want, voice, owner_id from characters where id = $1`,
      [id],
    )).rows[0];

  it("the owner can change their character's characteristics any time", async () => {
    const owner = newUserCookie();
    const { id } = await make(owner);
    const res = await api.editCharacter(id, { name: "Mira Vale", want: "someone who reads maps upside down", voice: "Warm, quick, talks with her hands." }, owner);
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toEqual(expect.arrayContaining(["name", "want", "voice"]));
    expect(await sheet(id)).toMatchObject({ name: "Mira Vale", want: "someone who reads maps upside down", voice: "Warm, quick, talks with her hands." });
  });

  it("can set and clear the soul through the same edit", async () => {
    const owner = newUserCookie();
    const { id } = await make(owner);
    await api.editCharacter(id, { soul: { values: "honesty, even when it costs her", local_only: false } }, owner);
    expect((await t.db.query(`select 1 from souls where character_id = $1`, [id])).rows).toHaveLength(1);
    await api.editCharacter(id, { soul: { values: "", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "" } }, owner);
    expect((await t.db.query(`select 1 from souls where character_id = $1`, [id])).rows).toHaveLength(0);
  });

  it("can't touch someone else's character, or a house character (both 404, unchanged)", async () => {
    const owner = newUserCookie();
    const stranger = newUserCookie();
    const { id } = await make(owner);
    const before = await sheet(id);
    expect((await api.editCharacter(id, { name: "Hijacked" }, stranger)).status).toBe(404);
    expect((await api.deleteCharacter(id, stranger)).status).toBe(404);
    expect(await sheet(id)).toEqual(before);
    const house = HOUSE_CHARACTERS[0].id;
    expect((await api.editCharacter(house, { name: "Nope" }, owner)).status).toBe(404);
  });

  it("content-filters an edit (no minors, real people or sexual content)", async () => {
    const owner = newUserCookie();
    const { id } = await make(owner);
    const res = await api.editCharacter(id, { bio: "A high school student with big dreams." }, owner);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_rejected", field: "bio" });
  });

  it("hard-deletes a character that never went on a date", async () => {
    const owner = newUserCookie();
    const { id } = await make(owner);
    const res = await api.deleteCharacter(id, owner);
    expect(await res.json()).toMatchObject({ deleted: true, anonymized: false });
    expect(await sheet(id)).toBeUndefined();
  });

  it("keeps a character that already aired, but strips its soul and owner link (a tombstone)", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    await api.editCharacter(character.id, { soul: { values: "guarded but kind", local_only: false } }, creator);
    const res = await api.deleteCharacter(character.id, creator);
    expect(await res.json()).toMatchObject({ deleted: false, anonymized: true });
    const row = await sheet(character.id);
    expect(row.owner_id).toBe("deleted"); // detached, fictional sheet kept
    expect((await t.db.query(`select 1 from souls where character_id = $1`, [character.id])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from episodes where id = $1`, [episode.id])).rows).toHaveLength(1); // episode intact
  });
});
