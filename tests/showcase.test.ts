import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGet } from "@/app/api/showcase/route";
import { POST as publishPost } from "@/app/api/showcase/posts/route";
import { DELETE as postDelete } from "@/app/api/showcase/posts/[id]/route";
import { GET as mediaGet } from "@/app/api/showcase/[id]/media/route";
import { POST as profilePost } from "@/app/api/creator-profile/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { mediumOf } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// The creator showcase (lib/showcase.ts, docs/PRDs/showcase.md; David's calls 2026-10-29).

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) } });
const profile = (cookie: string, handle: string) => profilePost(req("/api/creator-profile", { method: "POST", cookie, body: JSON.stringify({ handle, display_name: `The ${handle}` }) }));
const publish = (cookie: string, body: unknown) => publishPost(req("/api/showcase/posts", { method: "POST", cookie, body: JSON.stringify(body) }));
const list = async (q = "", cookie?: string) => (await (await listGet(req(`/api/showcase${q}`, { cookie }))).json()) as { posts: { id: string; media_id: string; medium: string; act: string | null }[] };
async function person(opts: { admin?: boolean; entitled?: boolean } = {}) {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: `Mara ${id.slice(0, 5)}` }), raw)).json()).id as string;
  if (opts.admin) await claimAdmin(t.db, id);
  if (opts.entitled) await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [id, character]);
  return { id, cookie: signedInCookie(id), character };
}
const adPicture = async (owner: string, a: string, b: string | null = null, extra: { kind?: string; mime?: string; rating?: string; shoot?: string | null } = {}) => {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating, shoot_id) values ($1, $2, $3, $4, $5, 'p', $6, $7, 'ready', $8, $9)`,
    [id, owner, a, b, extra.kind ?? "scene", extra.mime ?? "image/png", PNG, extra.rating ?? "nsfw", extra.shoot ?? null],
  );
  return id;
};
const pgPicture = async (owner: string, character: string, rating = "pg") => {
  const id = crypto.randomUUID();
  await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, tags) values ($1, $2, $3, 'p', 'image/png', $4, $5, $6::jsonb)`, [id, owner, character, PNG, rating, JSON.stringify([{ kind: "place", value: "park" }])]);
  return id;
};

describe("creator handles", () => {
  it("are 3 to 24 letters, numbers or underscores, one person's each, never a reserved word or past the show's lines", async () => {
    const me = await person();
    expect((await profile(me.cookie, "ab")).status).toBe(422);
    expect((await profile(me.cookie, "admin")).status).toBe(422);
    expect((await profile(me.cookie, "Mara_Makes")).status).toBe(200);
    const other = await person();
    expect((await profile(other.cookie, "mara_makes")).status).toBe(409);
    expect((await profilePost(req("/api/creator-profile", { method: "POST", body: JSON.stringify({ handle: "anon_one", display_name: "x" }) }))).status).toBe(401);
  });
});

describe("publishing", () => {
  it("needs a handle, takes only their own items, and copies what it shows onto the post for the filters", async () => {
    const me = await person({ admin: true });
    const pic = await adPicture(me.id, me.character);
    await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'act', 'kiss', 'choice'), ($1, $2, 'place', 'bar', 'derived'), ($1, $2, 'pov', 'yes', 'choice')`, [pic, me.id]);
    expect((await publish(me.cookie, { source: "after_dark", media_id: pic })).status).toBe(409);
    await profile(me.cookie, "mara");
    const res = await publish(me.cookie, { source: "after_dark", media_id: pic, caption: "Last call." });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "live" });
    const row = (await t.db.query(`select rating, medium, act, place, pov, from_date, caption from showcase_posts where media_id = $1`, [pic])).rows[0];
    expect(row).toEqual({ rating: "nsfw", medium: "picture", act: "kiss", place: "bar", pov: true, from_date: true, caption: "Last call." });
    const stranger = await person({ admin: true });
    await profile(stranger.cookie, "stranger");
    expect((await publish(stranger.cookie, { source: "after_dark", media_id: pic })).status).toBe(404);
  });

  it("waits for the other owner's OK with someone else's character; the house cast needs only the publisher", async () => {
    const me = await person({ admin: true });
    const them = await person({ entitled: true });
    await profile(me.cookie, "mara");
    const [a, b] = pairKey(me.character, them.character);
    const pair = await adPicture(me.id, a, b);
    expect(await (await publish(me.cookie, { source: "after_dark", media_id: pair })).json()).toMatchObject({ status: "pending" });
    expect((await t.db.query(`select owner_id, status from showcase_consents`)).rows).toEqual([{ owner_id: them.id, status: "asked" }]);
    expect((await list("", me.cookie)).posts).toHaveLength(0);
    const [h1, h2] = pairKey(me.character, HOUSE_CHARACTERS[0].id);
    const house = await adPicture(me.id, h1, h2);
    expect(await (await publish(me.cookie, { source: "after_dark", media_id: house })).json()).toMatchObject({ status: "live" });
  });
});

describe("who sees what", () => {
  it("pg for everyone, suggestive signed in, explicit admins only until the switch, then age-checked After Dark viewers", async () => {
    const me = await person({ admin: true });
    await profile(me.cookie, "mara");
    const pg = await pgPicture(me.id, me.character, "pg");
    const sugg = await pgPicture(me.id, me.character, "suggestive");
    const nsfw = await adPicture(me.id, me.character);
    for (const [source, media_id] of [["pg", pg], ["pg", sugg], ["after_dark", nsfw]]) expect((await publish(me.cookie, { source, media_id })).status).toBe(200);
    const ids = async (cookie?: string) => (await list("", cookie)).posts.map((p) => p.media_id).sort();
    const fan = await person({ entitled: true });
    const plain = (await person()).cookie;
    expect(await ids()).toEqual([pg]);
    expect(await ids(plain)).toEqual([pg, sugg].sort());
    expect(await ids(fan.cookie)).toEqual([pg, sugg].sort());
    expect(await ids(me.cookie)).toEqual([pg, sugg, nsfw].sort());
    await saveAdultSettings(t.db, { studio: { showcase: { explicit_open: true } } });
    expect(await ids(fan.cookie)).toEqual([pg, sugg, nsfw].sort());
    expect(await ids(plain)).toEqual([pg, sugg].sort());
    // The bytes follow the same rule.
    const postOf = async (m: string) => (await t.db.query<{ id: string }>(`select id from showcase_posts where media_id = $1`, [m])).rows[0].id;
    const bytes = async (m: string, cookie?: string) => (await mediaGet(req(`/api/showcase/x/media`, { cookie }), { params: Promise.resolve({ id: await postOf(m) }) })).status;
    expect(await bytes(pg)).toBe(200);
    expect(await bytes(nsfw)).toBe(404);
    expect(await bytes(nsfw, plain)).toBe(404);
    expect(await bytes(nsfw, fan.cookie)).toBe(200);
  });
});

describe("taking posts down and filtering", () => {
  it("unpublishes at once; a moderator's removal can't be undone; and the filters narrow by what it is and shows", async () => {
    const me = await person({ admin: true });
    await profile(me.cookie, "mara");
    const kiss = await adPicture(me.id, me.character);
    await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'act', 'kiss', 'choice')`, [kiss, me.id]);
    const clip = await adPicture(me.id, me.character, null, { kind: "video", mime: "video/mp4", shoot: "s1" });
    for (const m of [kiss, clip]) await publish(me.cookie, { source: "after_dark", media_id: m });
    expect((await list("?medium=clip", me.cookie)).posts.map((p) => p.media_id)).toEqual([clip]);
    expect((await list("?act=kiss", me.cookie)).posts.map((p) => p.media_id)).toEqual([kiss]);
    expect((await list("?from=studio", me.cookie)).posts.map((p) => p.media_id)).toEqual([clip]);
    expect((await list("?creator=mara", me.cookie)).posts).toHaveLength(2);
    expect((await list(`?character=${me.character}`, me.cookie)).posts).toHaveLength(2);
    expect((await list("?creator=nobody", me.cookie)).posts).toHaveLength(0);
    const id = (await t.db.query<{ id: string }>(`select id from showcase_posts where media_id = $1`, [kiss])).rows[0].id;
    expect((await postDelete(req(`/api/showcase/posts/${id}`, { method: "DELETE", cookie: me.cookie }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await list("", me.cookie)).posts).toHaveLength(1);
    // A moderator (another admin) takes the clip down: it stays down.
    const mod = await person({ admin: true });
    const cid = (await t.db.query<{ id: string }>(`select id from showcase_posts where media_id = $1`, [clip])).rows[0].id;
    expect((await postDelete(req(`/api/showcase/posts/${cid}`, { method: "DELETE", cookie: mod.cookie }), { params: Promise.resolve({ id: cid }) })).status).toBe(200);
    expect((await publish(me.cookie, { source: "after_dark", media_id: clip })).status).toBe(403);
  });

  it("names a video by how it was made", () => {
    expect(mediumOf({ kind: "scene", derived: null, reel_kind: null })).toBe("picture");
    expect(mediumOf({ kind: "video", derived: "boomerang", reel_kind: "clip" })).toBe("boomerang");
    expect(mediumOf({ kind: "video", derived: null, reel_kind: "night" })).toBe("reel");
    expect(mediumOf({ kind: "video", derived: null, reel_kind: "clip" })).toBe("clip");
    expect(mediumOf({ kind: "video", derived: null, reel_kind: null })).toBe("clip");
  });
});

describe("the grid", () => {
  it("keeps an explicit post blurred until it's tapped, and names who made it", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: ShowcaseGrid } = await import("@/app/showcase/ShowcaseGrid");
    const base = { source: "after_dark" as const, media_id: "m", mime: "image/png", medium: "picture" as const, aspect: null, act: "kiss", place: null, pov: false, from_date: true, caption: null, status: "live", published_at: "", mine: false, creator: { handle: "mara", display_name: "Mara" }, character: { id: "c", name: "Juniper" }, partner: null, likes: 0, liked: false, remixable: false };
    const html = renderToStaticMarkup(createElement(ShowcaseGrid, { posts: [{ ...base, id: "p1", rating: "nsfw" as const }, { ...base, id: "p2", rating: "pg" as const }] }));
    expect(html.match(/showcase-tile veiled/g)).toHaveLength(1);
    expect(html).toContain("After Dark · tap to show");
    expect(html).toContain("@mara");
  });
});
