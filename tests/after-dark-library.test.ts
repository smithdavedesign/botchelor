import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ratePost } from "@/app/api/admin/after-dark/ratings/route";
import { LIBRARY_PAGE_SIZE, libraryHref, libraryQuery, listLibrary, madeBy, rateItem } from "@/lib/adult/library";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The After Dark library (lib/adult/library.ts; David, 2026-10-24): every picture, portrait, video and clip, sortable,
// filterable, rated, on pages. Rows here are stand-ins: no media bytes are read.

describe("the library's query", () => {
  it("reads the page's search params, the defaults for anything unknown, and writes them back without the defaults", () => {
    const q = libraryQuery({ sort: "rating", type: "clip", character: "house-rafe", model: "wan-3-0-image-to-video", rated: "low", page: "3" });
    expect(q).toEqual({ sort: "rating", type: "clip", character: "house-rafe", model: "wan-3-0-image-to-video", rated: "low", page: 3 });
    expect(libraryQuery({ sort: "drop table", type: "nope", rated: "1=1", page: "-2" })).toEqual({ sort: "newest", type: null, character: null, model: null, rated: "good", page: 1 });
    expect(libraryHref(q, { page: 4 })).toBe("?sort=rating&type=clip&character=house-rafe&model=wan-3-0-image-to-video&rated=low&page=4");
    expect(libraryHref(libraryQuery({}))).toBe("?");
    expect(madeBy({ model: null, provider: "venice" })).toBe("venice, model not recorded");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const [A, B, C] = HOUSE_CHARACTERS.slice(0, 3).map((h) => h.id);
const nameOf = (id: string) => HOUSE_CHARACTERS.find((h) => h.id === id)!.name;
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
let n = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 0, n++)).toISOString();
async function image(kind: string, a: string, b: string | null, opts: { model?: string | null; provider?: string; mime?: string; status?: string } = {}) {
  const id = `img-${n}`;
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, provider, model, created_at) values ($1, 'owner', $2, $3, $4, 'p', $5, $6, $7, $8, $9)`,
    [id, a, b, kind, opts.mime ?? "image/png", opts.status ?? "ready", opts.provider ?? "venice", opts.model ?? null, at()],
  );
  return id;
}
async function reel(kind: "night" | "clip", a: string, b: string, shots: { status: string; media_id?: string; model?: string }[]) {
  const id = `reel-${n}`;
  await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, shots, kind, provider, created_at) values ($1, 'owner', $2, $3, 'ready', $4::jsonb, $5, 'venice', $6)`, [
    id,
    a,
    b,
    JSON.stringify(shots.map((s, i) => ({ line: i, who: "a", text: `line ${i}`, motion: "m", ...s }))),
    kind,
    at(),
  ]);
  return id;
}

describe("the library", () => {
  it("lists pictures, portraits, videos and clips (never a keyframe, a shot alone, or a video with nothing in it), with who made them", async () => {
    const portrait = await image("baseline", A, null, { model: "lustify-sdxl" });
    const picture = await image("scene", A, B, { model: "qwen-edit-uncensored" });
    const old = await image("scene", B, C, { provider: "fal" });
    await image("frame", A, B);
    await image("video", A, B, { mime: "video/mp4" });
    await image("scene", A, B, { status: "failed" });
    const night = await reel("night", A, B, [{ status: "ready", media_id: "shot-1", model: "wan-3-0-image-to-video" }, { status: "failed" }]);
    const clip = await reel("clip", A, C, [{ status: "ready", media_id: "shot-2", model: "wan-2.2-i2v-fast" }]);
    await reel("night", B, C, [{ status: "failed" }]);
    const lib = await listLibrary(t.db, "viewer", libraryQuery({}));
    expect(lib.items.map((i) => [i.id, i.type, i.model])).toEqual([
      [clip, "clip", "wan-2.2-i2v-fast"],
      [night, "video", "wan-3-0-image-to-video"],
      [old, "picture", null],
      [picture, "picture", "qwen-edit-uncensored"],
      [portrait, "portrait", "lustify-sdxl"],
    ]);
    expect(lib.items[1].shots).toEqual([{ media_id: "shot-1", who: "a", text: "line 0" }]);
    expect(lib.items[2]).toMatchObject({ provider: "fal", a: { id: B, name: nameOf(B) }, b: { id: C, name: nameOf(C) } });
    expect(lib.items[4].b).toBeNull();
    expect(lib.total).toBe(5);
    expect(lib.models).toEqual(["lustify-sdxl", "qwen-edit-uncensored", "wan-2.2-i2v-fast", "wan-3-0-image-to-video"]);
    expect(lib.characters.map((c) => c.id).sort()).toEqual([A, B, C].sort());
  });

  it("filters by type, character and model, and sorts by type, characters, model and rating", async () => {
    const p1 = await image("scene", A, B, { model: "m-b" });
    const p2 = await image("scene", B, C, { model: "m-a" });
    const v = await reel("night", A, C, [{ status: "ready", media_id: "s", model: "m-c" }]);
    const q = (p: Record<string, string>) => listLibrary(t.db, "viewer", libraryQuery(p)).then((l) => l.items.map((i) => i.id));
    expect(await q({ type: "video" })).toEqual([v]);
    expect(await q({ character: C })).toEqual([v, p2]);
    expect(await q({ model: "m-a" })).toEqual([p2]);
    expect(await q({ sort: "model" })).toEqual([p2, p1, v]);
    expect(await q({ sort: "type" })).toEqual([p2, p1, v]);
    const pairName = (x: string, y: string) => [nameOf(x), nameOf(y)].map((s) => s.toLowerCase()).sort().join("|");
    const byPair = [
      [p1, pairName(A, B)],
      [p2, pairName(B, C)],
      [v, pairName(A, C)],
    ].sort((x, y) => (x[1] < y[1] ? -1 : 1));
    expect(await q({ sort: "characters" })).toEqual(byPair.map((x) => x[0]));
    await rateItem(t.db, "u1", p1, 2);
    await rateItem(t.db, "u2", p1, 4);
    await rateItem(t.db, "u1", v, 5);
    expect(await q({ sort: "rating", rated: "all" })).toEqual([v, p1, p2]);
    const mine = (await listLibrary(t.db, "u1", libraryQuery({ sort: "rating", rated: "all" }))).items.map((i) => i.rating);
    expect(mine).toEqual([
      { average: 5, count: 1, mine: 5 },
      { average: 3, count: 2, mine: 2 },
      { average: null, count: 0, mine: null },
    ]);
  });

  it("hides what averages 1–3 stars or has its owner's 👎 by default, and shows each rating on its own when asked", async () => {
    const low = await image("scene", A, B);
    const edge = await image("scene", A, B);
    const good = await image("scene", A, B);
    const down = await image("scene", A, B);
    const up = await image("scene", A, B);
    const none = await image("scene", A, B);
    const v = await reel("night", A, C, [{ status: "ready", media_id: "s" }]);
    await rateItem(t.db, "u1", low, 3);
    // 3 and 4 average 3.5: four stars, as the galleries round it.
    await rateItem(t.db, "u1", edge, 3);
    await rateItem(t.db, "u2", edge, 4);
    await rateItem(t.db, "u1", good, 5);
    await rateItem(t.db, "u1", down, 5);
    await rateItem(t.db, "u1", v, 1);
    await t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ('owner', $1, -1), ('owner', $2, 1)`, [down, up]);
    const q = (rated?: string) => listLibrary(t.db, "viewer", libraryQuery(rated ? { rated } : {})).then((l) => l.items.map((i) => i.id).sort());
    expect(await q()).toEqual([edge, good, up, none].sort());
    expect(await q("liked")).toEqual([edge, good, up].sort());
    expect(await q("unrated")).toEqual([none]);
    expect(await q("low")).toEqual([low, down, v].sort());
    expect(await q("all")).toHaveLength(7);
    // A page past the end still counts under the filter.
    expect((await listLibrary(t.db, "viewer", libraryQuery({ rated: "low", page: "5" }))).total).toBe(3);
  });

  it("pages by LIBRARY_PAGE_SIZE, and a page past the end still knows the total", async () => {
    for (let i = 0; i < LIBRARY_PAGE_SIZE + 3; i++) await image("scene", A, B);
    const one = await listLibrary(t.db, "viewer", libraryQuery({}));
    const two = await listLibrary(t.db, "viewer", libraryQuery({ page: "2" }));
    expect([one.items.length, two.items.length, one.total, one.pages]).toEqual([LIBRARY_PAGE_SIZE, 3, LIBRARY_PAGE_SIZE + 3, 2]);
    expect(new Set([...one.items, ...two.items].map((i) => i.id)).size).toBe(LIBRARY_PAGE_SIZE + 3);
    const past = await listLibrary(t.db, "viewer", libraryQuery({ page: "9", type: "picture" }));
    expect([past.items.length, past.total]).toEqual([0, LIBRARY_PAGE_SIZE + 3]);
  });
});

describe("stars", () => {
  it("are a signed-in admin's only, changed by rating again, taken back with null, and refused for what isn't in the library", async () => {
    const pic = await image("scene", A, B);
    const frame = await image("frame", A, B);
    const post = (body: unknown, cookie?: string) =>
      ratePost(new Request(`${BASE_URL}/api/admin/after-dark/ratings`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
    expect((await post({ id: pic, stars: 4 }, newUserCookie())).status).toBe(404);
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    const cookie = signedIn(id);
    expect((await (await post({ id: pic, stars: 4 }, cookie)).json()).rating).toEqual({ average: 4, count: 1, mine: 4 });
    expect((await (await post({ id: pic, stars: 2 }, cookie)).json()).rating).toEqual({ average: 2, count: 1, mine: 2 });
    expect((await (await post({ id: pic, stars: null }, cookie)).json()).rating).toEqual({ average: null, count: 0, mine: null });
    expect((await post({ id: frame, stars: 3 }, cookie)).status).toBe(404);
    expect((await post({ id: pic, stars: 6 }, cookie)).status).toBe(422);
  });
});
