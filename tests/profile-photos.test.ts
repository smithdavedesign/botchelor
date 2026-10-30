import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pinPhoto, profilePhotos, PROFILE_PHOTOS_MAX, sendPhoto, unpinPhoto } from "@/lib/studio/profile-photos";
import { deletePgPicture } from "@/lib/studio/pg";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

// The PG Studio's uses (2026-10-30): pinned profile photos anyone can see, and a photo sent in their texts.
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

const OWNER = "owner-photos";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function character(id: string, owner = OWNER): Promise<void> {
  await t.db.query(
    `insert into characters (id, name, age, bio, traits, want, dealbreaker, owner_id, pronouns) values ($1, $2, 30, 'A bio.', '{}', 'Someone kind.', 'Rudeness.', $3, 'she/her')`,
    [id, `Name ${id}`, owner],
  );
}
async function picture(id: string, characterId = "mine", rating = "pg", owner = OWNER): Promise<void> {
  await t.db.query(
    `insert into studio_pg_pictures (id, owner_id, character_id, mime, data, content_rating, model) values ($1, $2, $3, 'image/png', $4, $5, 'test-model')`,
    [id, owner, characterId, PNG, rating],
  );
}

describe("profile photos", () => {
  it("pins a pg picture: an approved pg copy anyone can be served, in the order they were put up", async () => {
    await character("mine");
    await picture("p1");
    await picture("p2");
    expect((await pinPhoto(t.db, OWNER, "p1")).ok).toBe(true);
    const r = await pinPhoto(t.db, OWNER, "p2");
    expect(r.ok && r.photos.map((p) => p.picture_id)).toEqual(["p1", "p2"]);
    const asset = (await t.db.query<{ review_status: string; content_rating: string; kind: string }>(`select review_status, content_rating, kind from character_assets where id = $1`, [r.ok ? r.photos[0].asset_id : ""])).rows[0];
    expect(asset).toEqual({ review_status: "approved", content_rating: "pg", kind: "photo" });
    // Pinned again: still one of it.
    await pinPhoto(t.db, OWNER, "p1");
    expect(await profilePhotos(t.db, "mine")).toHaveLength(2);
  });

  it("never takes a suggestive picture, someone else's, or more than the profile shows", async () => {
    await character("mine");
    await picture("sug", "mine", "suggestive");
    expect(await pinPhoto(t.db, OWNER, "sug")).toMatchObject({ ok: false, error: "not_pg" });
    expect(await pinPhoto(t.db, "someone-else", "sug")).toMatchObject({ ok: false, status: 404 });
    for (let i = 0; i < PROFILE_PHOTOS_MAX; i++) {
      await picture(`n${i}`);
      expect((await pinPhoto(t.db, OWNER, `n${i}`)).ok).toBe(true);
    }
    await picture("one-more");
    expect(await pinPhoto(t.db, OWNER, "one-more")).toMatchObject({ ok: false, error: "full" });
  });

  it("taken down, or deleted from the Studio, and its copy stops being served", async () => {
    await character("mine");
    await picture("p1");
    await picture("p2");
    const a = await pinPhoto(t.db, OWNER, "p1");
    await pinPhoto(t.db, OWNER, "p2");
    expect(await unpinPhoto(t.db, OWNER, "p1")).toBe(true);
    const status = async (id: string) => (await t.db.query<{ review_status: string }>(`select review_status from character_assets where id = $1`, [id])).rows[0]?.review_status;
    expect(await status(a.ok ? a.photos[0].asset_id : "")).toBe("rejected");
    expect(await deletePgPicture(t.db, OWNER, "p2")).toBe(true);
    expect(await profilePhotos(t.db, "mine")).toEqual([]);
  });
});

describe("a photo in their texts", () => {
  it("goes to a character theirs has dated, as a 📷 text with the pg copy", async () => {
    await character("mine");
    await character("theirs", "other-owner");
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility)
       values ('ep-1', 'someone', 'mine', 'theirs', 'the lighthouse', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'public')`,
    );
    await picture("p1");
    expect(await sendPhoto(t.db, OWNER, { picture_id: "p1", to_character: HOUSE_CHARACTERS[0].id })).toMatchObject({ ok: false, error: "not_a_partner" });
    expect(await sendPhoto(t.db, OWNER, { picture_id: "p1", to_character: "theirs" })).toEqual({ ok: true, to_character: "theirs" });
    const text = (await t.db.query<{ text: string; photo: string | null }>(`select text, photo from couple_texts`)).rows[0];
    expect(text.text).toBe("📷");
    expect(text.photo).toBeTruthy();
  });
});
