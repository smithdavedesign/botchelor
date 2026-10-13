import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_COOKIE } from "@/lib/http";
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
