import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGet } from "@/app/api/showcase/route";
import { POST as publishPost } from "@/app/api/showcase/posts/route";
import { DELETE as postDelete } from "@/app/api/showcase/posts/[id]/route";
import { POST as likePost } from "@/app/api/showcase/posts/[id]/like/route";
import { GET as mediaGet } from "@/app/api/showcase/[id]/media/route";
import { GET as requestsGet, POST as requestsPost } from "@/app/api/showcase/requests/route";
import { POST as followPost } from "@/app/api/creators/[handle]/follow/route";
import { POST as profilePost } from "@/app/api/creator-profile/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { pairKey } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// The showcase's people (lib/showcase-social.ts): the other owner's OK, likes, follows.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) } });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
async function person(handle?: string) {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: `Mara ${id.slice(0, 5)}` }), raw)).json()).id as string;
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [id, character]);
  const cookie = signedInCookie(id);
  if (handle) await profilePost(req("/api/creator-profile", { method: "POST", cookie, body: JSON.stringify({ handle, display_name: handle }) }));
  return { id, cookie, character };
}
const picture = async (owner: string, a: string, b: string | null, rating = "nsfw") => {
  const id = crypto.randomUUID();
  await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready', $6)`, [id, owner, a, b, PNG, rating]);
  return id;
};
const publish = async (cookie: string, media_id: string) => (await (await publishPost(req("/api/showcase/posts", { method: "POST", cookie, body: JSON.stringify({ source: "after_dark", media_id }) }))).json()) as { post_id: string; status: string };
const kinds = async (user: string) => (await t.db.query<{ kind: string }>(`select kind from notifications where user_id = $1 order by created_at`, [user])).rows.map((r) => r.kind);
const status = async (post: string) => (await t.db.query<{ status: string }>(`select status from showcase_posts where id = $1`, [post])).rows[0]?.status ?? null;

describe("the other owner's OK", () => {
  it("asks once in neutral words, shows them what it is, and goes live on yes (the publisher told)", async () => {
    await saveAdultSettings(t.db, { studio: { showcase: { explicit_open: true } } });
    const me = await person("mara");
    const them = await person();
    const [a, b] = pairKey(me.character, them.character);
    const post = await publish(me.cookie, await picture(me.id, a, b));
    expect(post.status).toBe("pending");
    expect(await kinds(them.id)).toEqual(["showcase_request"]);
    const title = (await t.db.query<{ title: string }>(`select title from notifications where user_id = $1`, [them.id])).rows[0].title;
    expect(title).toMatch(/^📣 Someone wants to share a picture with /);
    const waiting = (await (await requestsGet(req("/api/showcase/requests", { cookie: them.cookie }))).json()).requests;
    expect(waiting).toHaveLength(1);
    expect((await mediaGet(req("/x", { cookie: them.cookie }), params({ id: post.post_id }))).status).toBe(200);
    // Nobody else sees a post that's waiting.
    expect((await mediaGet(req("/x", { cookie: (await person()).cookie }), params({ id: post.post_id }))).status).toBe(404);
    expect(await (await requestsPost(req("/api/showcase/requests", { method: "POST", cookie: them.cookie, body: JSON.stringify({ post_id: post.post_id, yes: true }) }))).json()).toMatchObject({ status: "live" });
    expect(await status(post.post_id)).toBe("live");
    expect(await kinds(me.id)).toContain("showcase_answer");
    // Either of them can take it down.
    expect((await postDelete(req("/x", { method: "DELETE", cookie: them.cookie }), params({ id: post.post_id }))).status).toBe(200);
    expect(await status(post.post_id)).toBeNull();
  });

  it("takes it down on no", async () => {
    const me = await person("mara");
    const them = await person();
    const [a, b] = pairKey(me.character, them.character);
    const post = await publish(me.cookie, await picture(me.id, a, b));
    expect(await (await requestsPost(req("/api/showcase/requests", { method: "POST", cookie: them.cookie, body: JSON.stringify({ post_id: post.post_id, yes: false }) }))).json()).toMatchObject({ status: "declined" });
    expect(await status(post.post_id)).toBeNull();
    // Only the asked owner answers.
    expect((await requestsPost(req("/api/showcase/requests", { method: "POST", cookie: (await person()).cookie, body: JSON.stringify({ post_id: post.post_id, yes: true }) }))).status).toBe(404);
  });
});

describe("likes and follows", () => {
  it("like what they can see (never what they can't), and Trending puts the most liked this week first", async () => {
    const me = await person("mara");
    const older = await publish(me.cookie, await picture(me.id, me.character, null, "pg"));
    const newer = await publish(me.cookie, await picture(me.id, me.character, null, "pg"));
    const hidden = await publish(me.cookie, await picture(me.id, me.character, null, "nsfw"));
    const fan = await person();
    const like = (cookie: string, id: string, on = true) => likePost(req("/x", { method: "POST", cookie, body: JSON.stringify({ on }) }), params({ id }));
    expect((await like(fan.cookie, older.post_id)).status).toBe(200);
    expect((await like(fan.cookie, hidden.post_id)).status).toBe(404);
    expect((await likePost(req("/x", { method: "POST", body: JSON.stringify({ on: true }) }), params({ id: older.post_id }))).status).toBe(401);
    const list = async (q: string, cookie?: string) => (await (await listGet(req(`/api/showcase${q}`, { cookie }))).json()).posts as { id: string; likes: number; liked: boolean }[];
    expect((await list("", fan.cookie)).map((p) => p.id)).toEqual([newer.post_id, older.post_id]);
    expect((await list("?sort=trending", fan.cookie)).map((p) => p.id)).toEqual([older.post_id, newer.post_id]);
    expect((await list("", fan.cookie)).find((p) => p.id === older.post_id)).toMatchObject({ likes: 1, liked: true });
    await like(fan.cookie, older.post_id, false);
    expect((await list("", fan.cookie)).find((p) => p.id === older.post_id)).toMatchObject({ likes: 0, liked: false });
  });

  it("follow a creator: Following shows only theirs, and a post tells followers at most once a day", async () => {
    const me = await person("mara");
    const other = await person("zed");
    const fan = await person();
    const follow = (cookie: string, handle: string, on = true) => followPost(req("/x", { method: "POST", cookie, body: JSON.stringify({ on }) }), params({ handle }));
    expect(await (await follow(fan.cookie, "mara")).json()).toMatchObject({ followers: 1, following: true });
    expect((await follow(me.cookie, "mara")).status).toBe(404);
    await publish(me.cookie, await picture(me.id, me.character, null, "pg"));
    await publish(me.cookie, await picture(me.id, me.character, null, "pg"));
    await publish(other.cookie, await picture(other.id, other.character, null, "pg"));
    expect((await kinds(fan.id)).filter((k) => k === "showcase_post")).toHaveLength(1);
    const following = (await (await listGet(req("/api/showcase?following=1", { cookie: fan.cookie }))).json()).posts as { creator: { handle: string } }[];
    expect(following.map((p) => p.creator.handle)).toEqual(["mara", "mara"]);
  });
});
