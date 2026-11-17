// The show's clips in the Gallery, and the other links stage 4 adds (the connected-model plan): a clip knows its date and
// its season; the row lists only clips whose date anyone may still see; a character's filter narrows it to their dates;
// the Studio's way in shows one character in several scenes, from what anyone may see; a creator's page lists who they
// made; and a portrait chosen from a Studio picture remembers which.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ShowClips from "@/app/showcase/ShowClips";
import { galleryShowClipsOn, listShowClips, saveHomeClip } from "@/lib/home-clip";
import { setObjectStoreForTests } from "@/lib/object-store";
import { sameCharacterProof } from "@/lib/showcase";
import { backfillEpisodeSeasons, ensureShowSeasons } from "@/lib/show-seasons";
import { setupEpisode, startTestDb } from "./helpers";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 3)]);

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from home_clips");
  setObjectStoreForTests(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setObjectStoreForTests(undefined);
});

/** A public date that aired at `when`, with a clip kept for it. */
async function clipped(when: string) {
  const made = await setupEpisode("second_date");
  await t.db.query(`update episodes set revealed_at = $2, status = 'ready', visibility = 'public' where id = $1`, [made.episode.id, when]);
  await saveHomeClip(t.db, { episode_id: made.episode.id, day: when.slice(0, 10), loop: MP4, poster: JPEG, width: 720, height: 1280, seconds: 8 });
  return made;
}

describe("the show's clips", () => {
  it("each knows its date and, through the date, its season", async () => {
    const a = await clipped("2026-11-10T20:00:00Z");
    await ensureShowSeasons(t.db, new Date("2026-11-16T12:00:00Z"));
    await backfillEpisodeSeasons(t.db);
    const [clip] = await listShowClips(t.db);
    expect(clip).toMatchObject({ episode_id: a.episode.id, watch_href: `/episodes/${a.episode.id}?play=1`, season: "Season 2 · November 2026", day: "2026-11-10" });
    expect(clip.poster_src).toMatch(/^\/api\/home-clip\/[^/]+\/poster\.jpg$/);
    expect(clip.names).toHaveLength(2);
  });

  it("a clip from before the dates were stamped has no season line, and still lists", async () => {
    await clipped("2026-11-10T20:00:00Z");
    await t.db.query(`update episodes set season_id = null`);
    expect((await listShowClips(t.db))[0].season).toBeNull();
  });

  it("lists only clips whose date anyone may still see, newest first", async () => {
    const a = await clipped("2026-11-10T20:00:00Z");
    const b = await clipped("2026-11-12T20:00:00Z");
    expect((await listShowClips(t.db)).map((c) => c.episode_id)).toEqual([b.episode.id, a.episode.id]);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [b.episode.id]);
    expect((await listShowClips(t.db)).map((c) => c.episode_id)).toEqual([a.episode.id]);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [a.character.id]);
    expect(await listShowClips(t.db)).toEqual([]);
  });

  it("a character's filter narrows it to clips of their dates", async () => {
    const a = await clipped("2026-11-10T20:00:00Z");
    const b = await clipped("2026-11-12T20:00:00Z");
    expect((await listShowClips(t.db, { characterId: a.character.id })).map((c) => c.episode_id)).toEqual([a.episode.id]);
    expect((await listShowClips(t.db, { characterId: b.character.id })).map((c) => c.episode_id)).toEqual([b.episode.id]);
    expect(await listShowClips(t.db, { characterId: "nobody" })).toEqual([]);
    expect(await listShowClips(t.db, { limit: 1 })).toHaveLength(1);
  });

  it("the row is the poster and a way into the date, and nothing when there are none", async () => {
    await clipped("2026-11-10T20:00:00Z");
    const clips = await listShowClips(t.db);
    const html = renderToStaticMarkup(createElement(ShowClips, { clips }));
    expect(html).toContain("From the show</h2>");
    expect(html).toContain(`href="${clips[0].watch_href}"`);
    expect(html).toContain(`src="${clips[0].poster_src}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("<video");
    expect(html).toContain("It ended:");
    expect(renderToStaticMarkup(createElement(ShowClips, { clips, of: "Nell" }))).toContain("From Nell&#x27;s dates on the show");
    expect(renderToStaticMarkup(createElement(ShowClips, { clips: [] }))).toBe("");
  });

  it("GALLERY_SHOW_CLIPS=0 turns the row off", () => {
    expect(galleryShowClipsOn({})).toBe(true);
    expect(galleryShowClipsOn({ GALLERY_SHOW_CLIPS: "0" })).toBe(false);
  });
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
