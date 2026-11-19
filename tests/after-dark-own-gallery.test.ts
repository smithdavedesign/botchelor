import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GALLERY_MAX, GALLERY_PAGE, galleryCounts, galleryLimit, galleryTab, galleryVideos, reelItem } from "@/lib/adult/gallery";
import { typeOf } from "@/lib/media-filter";
import { characterMedia, listMedia, ownMedia } from "@/lib/adult/media";
import { ownReels } from "@/lib/adult/reels";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark's Gallery (app/after-dark/gallery): everything one person made, from every pair and shoot, with names.
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

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];

describe("ownMedia", () => {
  it("lists only this person's own pictures and videos, newest first, with who's in each, and no keyframes or voices", async () => {
    const me = userIdOf(newUserCookie());
    const other = userIdOf(newUserCookie());
    const add = (id: string, owner: string, kind: string, b: string | null, at: string) =>
      t.db.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, created_at) values ($1, $2, $3, $4, $5, 'x', 'image/png', 'ready', $6)`,
        [id, owner, A.id, b, kind, at],
      );
    await add("pair-old", me, "scene", B.id, "2026-11-01T00:00:00Z");
    await add("solo-new", me, "baseline", null, "2026-11-02T00:00:00Z");
    await add("a-keyframe", me, "frame", B.id, "2026-11-03T00:00:00Z");
    await add("a-voice", me, "audio", B.id, "2026-11-03T00:00:00Z");
    await add("not-mine", other, "scene", B.id, "2026-11-04T00:00:00Z");

    const items = await ownMedia(t.db, me);
    expect(items.map((m) => m.id)).toEqual(["solo-new", "pair-old"]);
    expect(items[1]).toMatchObject({ character_id: A.id, character_b: B.id, a_name: A.name, b_name: B.name });
    expect(items[0]).toMatchObject({ character_b: null, a_name: A.name, b_name: null });
  });

  it("leaves out a version another was kept over", async () => {
    const me = userIdOf(newUserCookie());
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, status) values ('kept', $1, $2, 'scene', 'x', 'image/png', 'ready'), ('old', $1, $2, 'scene', 'x', 'image/png', 'ready')`,
      [me, A.id],
    );
    await t.db.query(`update adult_images set superseded_by = 'kept' where id = 'old'`);
    expect((await ownMedia(t.db, me)).map((m) => m.id)).toEqual(["kept"]);
  });
});

// The Gallery's tabs (2026-11-15, lib/adult/gallery.ts): Videos (reels as one each, then the clips), Pictures, Faces.
describe("the Gallery's tabs", () => {
  const add = (id: string, owner: string, kind: string, b: string | null, at: string) =>
    t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, created_at) values ($1, $2, $3, $4, $5, 'x', 'image/png', 'ready', $6)`, [
      id,
      owner,
      A.id,
      b,
      kind,
      at,
    ]);
  const reel = (id: string, owner: string, status: string, kind: string | null, shots: object[], at = "2026-11-05T00:00:00Z") =>
    t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, shots, kind, created_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`, [
      id,
      owner,
      A.id,
      B.id,
      status,
      JSON.stringify(shots),
      kind,
      at,
    ]);

  async function seed(me: string) {
    await add("pic", me, "scene", B.id, "2026-11-01T00:00:00Z");
    await add("face", me, "baseline", null, "2026-11-01T01:00:00Z");
    await add("shot-1", me, "video", B.id, "2026-11-02T00:00:00Z");
    await add("shot-2", me, "video", B.id, "2026-11-02T00:01:00Z");
    await add("shot-out", me, "video", B.id, "2026-11-02T00:02:00Z");
    await add("a-clip", me, "video", B.id, "2026-11-03T00:00:00Z");
    await add("studio-clip", me, "video", null, "2026-11-04T00:00:00Z");
    // A night's video: two shots that play and one taken out into the Archive.
    await reel("night", me, "ready", "night", [
      { media_id: "shot-1", status: "ready" },
      { media_id: "shot-2", status: "ready" },
      { media_id: "shot-out", status: "ready", archived_at: "2026-11-02T01:00:00Z" },
    ]);
    // A clip is a reel of one shot: it stays with the clips.
    await reel("clip", me, "ready", "clip", [{ media_id: "a-clip", status: "ready" }]);
  }

  it("Videos leaves out the shots its reels play (not one taken out), Pictures and Faces their own kinds", async () => {
    const me = userIdOf(newUserCookie());
    await seed(me);
    const ids = async (tab: "videos" | "pictures" | "faces") => (await ownMedia(t.db, me, 120, { withArchived: true, tab })).map((m) => m.id);
    expect(await ids("videos")).toEqual(["studio-clip", "a-clip", "shot-out"]);
    expect(await ids("pictures")).toEqual(["pic"]);
    expect(await ids("faces")).toEqual(["face"]);
  });

  it("counts each tab as it lists them, a reel counting once under Videos", async () => {
    const me = userIdOf(newUserCookie());
    await seed(me);
    expect(await galleryCounts(t.db, me)).toEqual({ videos: 4, pictures: 1, faces: 1, reels: 1, clips: 3 });
    expect(await galleryCounts(t.db, userIdOf(newUserCookie()))).toEqual({ videos: 0, pictures: 0, faces: 0, reels: 0, clips: 0 });
  });

  it("lists each night's video once, with the two in it: not clips, drafts, others' or one with nothing left to play", async () => {
    const me = userIdOf(newUserCookie());
    const other = userIdOf(newUserCookie());
    await seed(me);
    await reel("being-made", me, "making", "night", [{ status: "queued" }], "2026-11-06T00:00:00Z");
    await reel("all-out", me, "ready", "night", [{ media_id: "x", status: "ready", archived_at: "2026-11-02T01:00:00Z" }]);
    await reel("failed-empty", me, "failed", "night", [{ status: "failed" }]);
    await reel("theirs", other, "ready", "night", [{ media_id: "y", status: "ready" }]);
    const reels = await ownReels(t.db, me);
    expect(reels.map((r) => r.id)).toEqual(["being-made", "night"]);
    expect(reels[1]).toMatchObject({ a: A.id, b: B.id, a_name: A.name, b_name: B.name, kind: "night" });
    expect(reels[1].shots).toHaveLength(3);
  });

  // David, 2026-11-18: "we have reels and clips, really they are the same thing ... have one combined section ... still
  // offer the filtering at the top": a night's video is one of the Videos, among the clips, under the same filters.
  it("makes each night's video one of the videos: a reel of the shots it plays, made on their night, with what they show and its stars", async () => {
    const me = userIdOf(newUserCookie());
    await seed(me);
    const tag = (id: string, kind: string, value: string, removed = false) =>
      t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source, removed) values ($1, $2, $3, $4, 'model', $5)`, [id, me, kind, value, removed]);
    await tag("shot-1", "act", "kiss");
    await tag("shot-2", "act", "kiss");
    await tag("shot-2", "place", "hotel");
    await tag("shot-1", "act", "oral", true);
    // The shot taken out of the video shows nothing for it any more.
    await tag("shot-out", "place", "pool");
    await t.db.query(`insert into adult_media_ratings (user_id, item_id, item_kind, rating) values ($1, 'night', 'reel', 4), ('someone', 'night', 'reel', 5)`, [me]);
    const [reel] = await ownReels(t.db, me);
    expect(reel.show_tags).toEqual([
      { kind: "act", value: "kiss" },
      { kind: "place", value: "hotel" },
    ]);
    expect(reel.stars).toBe(4.5);
    const item = reelItem(reel);
    expect(item).toMatchObject({ id: "night", kind: "video", status: "ready", made_in: "night", reel_shots: 2, character_id: A.id, character_b: B.id, a_name: A.name, archived: false });
    expect(item.shows).toBe("A slow kiss · Hotel");
    expect(typeOf(item)).toBe("reel");
    expect(reelItem({ ...reel, status: "making", shots: [] })).toMatchObject({ status: "pending", reel_shots: 0 });
  });

  it("lists the clips and the nights' videos as one, the newest first, a page at a time", async () => {
    const me = userIdOf(newUserCookie());
    await seed(me);
    await reel("later-night", me, "ready", "night", [{ media_id: "shot-1", status: "ready" }], "2026-11-03T12:00:00Z");
    const clips = await ownMedia(t.db, me, 120, { withArchived: true, tab: "videos" });
    const reels = await ownReels(t.db, me);
    const all = galleryVideos(clips, reels, 120);
    // The night's video (Nov 5), the Studio's clip (Nov 4), the later night's (Nov 3, noon), the clip (Nov 3), the shot taken out (Nov 2).
    expect(all.map((m) => m.id)).toEqual(["night", "studio-clip", "later-night", "a-clip", "shot-out"]);
    expect(all.map((m) => typeOf(m))).toEqual(["reel", "clip", "reel", "clip", "clip"]);
    expect(galleryVideos(clips, reels, 2).map((m) => m.id)).toEqual(["night", "studio-clip"]);
  });
});

// David, 2026-11-18: "There are PG videos on after dark, can we move them out?" They were the living portraits
// (lib/showcase-loops.ts): PG clips made for the show's Gallery and Reels, stored in After Dark's media store. No After
// Dark gallery lists them now: not the Gallery (any tab, or its counts), not a night's, not a character's (an admin
// sees everyone's, the show's own included).
describe("living portraits stay on the show", () => {
  const add = (id: string, owner: string, kind: string, b: string | null, at: string, mime = "image/png") =>
    t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, created_at) values ($1, $2, $3, $4, $5, 'x', $6, 'ready', $7)`, [
      id,
      owner,
      A.id,
      b,
      kind,
      mime,
      at,
    ]);
  const loop = (media: string, owner: string, source: "post" | "portrait") =>
    t.db.query(`insert into showcase_loops (id, owner_id, source, source_id, character_id, status, media_id) values ($1, $2, $3, $4, $5, 'ready', $1)`, [
      media,
      owner,
      source,
      `src-${media}`,
      A.id,
    ]);

  it("leaves them out of every After Dark listing, and keeps the clips beside them", async () => {
    const me = userIdOf(newUserCookie());
    await t.db.query("insert into admins (user_id) values ($1)", [me]);
    await add("my-clip", me, "video", null, "2026-11-01T00:00:00Z", "video/mp4");
    await add("my-portrait-loop", me, "video", null, "2026-11-02T00:00:00Z", "video/mp4");
    await add("show-loop", "botchelor-show", "video", null, "2026-11-03T00:00:00Z", "video/mp4");
    await add("my-pair-pic", me, "scene", B.id, "2026-11-04T00:00:00Z");
    await loop("my-portrait-loop", me, "post");
    await loop("show-loop", "botchelor-show", "portrait");

    const ids = (items: { id: string }[]) => items.map((m) => m.id);
    expect(ids(await ownMedia(t.db, me))).toEqual(["my-pair-pic", "my-clip"]);
    expect(ids(await ownMedia(t.db, me, 120, { tab: "videos" }))).toEqual(["my-clip"]);
    expect(await galleryCounts(t.db, me)).toEqual({ videos: 1, pictures: 1, faces: 0, reels: 0, clips: 1 });
    expect(await galleryCounts(t.db, "botchelor-show")).toMatchObject({ videos: 0, clips: 0 });
    expect(ids(await listMedia(t.db, [A.id, B.id], me))).toEqual(["my-pair-pic", "my-clip"]);
    expect(ids(await characterMedia(t.db, A.id, me))).toEqual(["my-pair-pic", "my-clip"]);
  });
});

describe("the Gallery's pure rules", () => {
  it("opens on the tab asked for, else Videos when there are any, else Pictures", () => {
    expect(galleryTab("faces", { videos: 3 })).toBe("faces");
    expect(galleryTab("nonsense", { videos: 3 })).toBe("videos");
    expect(galleryTab(undefined, { videos: 0 })).toBe("pictures");
  });

  it("shows whole pages, one at least and GALLERY_MAX at most", () => {
    expect(galleryLimit(undefined)).toBe(GALLERY_PAGE);
    expect(galleryLimit("-5")).toBe(GALLERY_PAGE);
    expect(galleryLimit(String(GALLERY_PAGE + 1))).toBe(GALLERY_PAGE * 2);
    expect(galleryLimit("999999")).toBe(GALLERY_MAX);
  });

});
