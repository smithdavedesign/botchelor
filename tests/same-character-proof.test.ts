// The Studio's way in on the Gallery (lib/showcase.ts sameCharacterProof): one character in several scenes, from what
// anyone may see. (This file once also held the Gallery's "From the show" row of the show's own date clips, removed
// 2026-11-18: David, "remove the clips from the show, no one cares in the asset gallery".)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sameCharacterProof } from "@/lib/showcase";
import { setupEpisode, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("one character, several pictures (the Studio's way in)", () => {
  /** A live Gallery post of a PG Studio picture of `character`, made in `shoot` (or, without one, at `at`). */
  const post = async (id: string, character: string, over: Partial<{ rating: string; medium: string; status: string; held: boolean; character_b: string | null; shoot: string | null; at: string }> = {}) => {
    if (over.shoot) await t.db.query(`insert into studio_pg_shoots (id, owner_id, character_id, choices, model) values ($1, 'maker', $2, '{}'::jsonb, 'test') on conflict (id) do nothing`, [over.shoot, character]);
    await t.db.query(
      `insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, content_rating, created_at)
       values ($1, 'maker', $2, $3, 'p', 'image/png', '\\x00'::bytea, 'pg', $4::timestamptz)`,
      [id, character, over.shoot ?? null, over.at ?? "2026-11-10T10:00:00Z"],
    );
    await t.db.query(
      `insert into showcase_posts (id, owner_id, source, media_id, character_id, character_b, rating, medium, status, held, published_at, tags)
       values ($1, 'maker', 'pg', $1, $2, $3, $4, $5, $6, $7, now(), '[]'::jsonb)`,
      [id, character, over.character_b ?? null, over.rating ?? "pg", over.medium ?? "picture", over.status ?? "live", over.held ?? false],
    );
  };

  it("is a public character's safe Studio pictures alone, and never anything a visitor may not see", async () => {
    const a = await setupEpisode();
    const b = await setupEpisode();
    await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ('maker', 'maker', 'Maker')`);
    expect(await sameCharacterProof(t.db)).toBeNull();
    for (const id of ["a1", "a2"]) await post(id, a.character.id);
    // Two is not several; a suggestive one, a clip, a pending one, a held one and a picture of two don't count.
    await post("a3", a.character.id, { rating: "suggestive" });
    await post("a4", a.character.id, { medium: "clip" });
    await post("a5", a.character.id, { status: "pending" });
    await post("a6", a.character.id, { held: true });
    await post("a7", a.character.id, { character_b: b.character.id });
    expect(await sameCharacterProof(t.db)).toBeNull();
    await post("a8", a.character.id);
    // Three pictures, all made in the same hour with no shoot id: one shoot, and it says so.
    expect(await sameCharacterProof(t.db)).toMatchObject({ character_id: a.character.id, shoots: 1, posts: expect.arrayContaining(["a1", "a2", "a8"]) });
    // A private character is nobody's proof, and a hidden creator's work isn't shown.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [a.character.id]);
    expect(await sameCharacterProof(t.db)).toBeNull();
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [a.character.id]);
    await t.db.query(`update creator_profiles set hidden = true where user_id = 'maker'`);
    expect(await sameCharacterProof(t.db)).toBeNull();
  });

  it("prefers the character whose pictures span the most shoots, and shows one from each before a second from any", async () => {
    const a = await setupEpisode();
    const b = await setupEpisode();
    await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ('maker', 'maker', 'Maker')`);
    // Five pictures of one shoot against four pictures across three shoots: the three shoots win.
    for (const id of ["a1", "a2", "a3", "a4", "a5"]) await post(id, a.character.id, { shoot: "shoot-a" });
    await post("b1", b.character.id, { shoot: "shoot-1" });
    await post("b2", b.character.id, { shoot: "shoot-1" });
    await post("b3", b.character.id, { shoot: "shoot-2" });
    await post("b4", b.character.id, { shoot: "shoot-3" });
    const proof = await sameCharacterProof(t.db, 3);
    expect(proof).toMatchObject({ character_id: b.character.id, shoots: 3 });
    expect(proof!.posts).toHaveLength(3);
    expect(proof!.posts).toEqual(expect.arrayContaining(["b3", "b4"]));
    expect(proof!.posts.filter((id) => id === "b1" || id === "b2")).toHaveLength(1);
    expect((await sameCharacterProof(t.db, 4))!.posts).toHaveLength(4);
  });
});
