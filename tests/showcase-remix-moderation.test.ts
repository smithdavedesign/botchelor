import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGet } from "@/app/api/showcase/route";
import { POST as publishPost } from "@/app/api/showcase/posts/route";
import { GET as remixGet } from "@/app/api/showcase/posts/[id]/remix/route";
import { POST as reportPostRoute } from "@/app/api/showcase/posts/[id]/report/route";
import { GET as mediaGet } from "@/app/api/showcase/[id]/media/route";
import { GET as modGet, POST as modPost } from "@/app/api/admin/showcase/route";
import { POST as profilePost } from "@/app/api/creator-profile/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Remix ("Shoot like this") and moderation on the showcase (lib/showcase.ts remixOf, lib/showcase-moderation.ts).

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
  vi.spyOn(console, "log").mockImplementation(() => {});
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
async function person(handle?: string, admin = false) {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: `Mara ${id.slice(0, 5)}` }), raw)).json()).id as string;
  if (admin) await claimAdmin(t.db, id);
  const cookie = signedInCookie(id);
  if (handle) await profilePost(req("/api/creator-profile", { method: "POST", cookie, body: JSON.stringify({ handle, display_name: handle }) }));
  return { id, cookie, character };
}
/** A PG Studio shoot's picture, as the PG Studio keeps one: its shoot's choices carry the picks and their own words. */
async function pgShot(owner: string, character: string) {
  const shoot = crypto.randomUUID();
  await t.db.query(`insert into studio_pg_shoots (id, owner_id, character_id, choices, status) values ($1, $2, $3, $4::jsonb, 'ready')`, [shoot, owner, character, JSON.stringify({ shot: "candid", place: "park", custom: "my secret words", format: "story" })]);
  const id = crypto.randomUUID();
  await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, content_rating) values ($1, $2, $3, $4, 'p', 'image/png', $5, 'pg')`, [id, owner, character, shoot, PNG]);
  return id;
}
const publish = async (cookie: string, media_id: string, source = "pg") => (await (await publishPost(req("/api/showcase/posts", { method: "POST", cookie, body: JSON.stringify({ source, media_id }) }))).json()) as { post_id: string };

describe("Shoot like this", () => {
  it("carries a post's menu picks and shape, never the creator's own words; nothing for one made on a date", async () => {
    const me = await person("mara");
    const post = await publish(me.cookie, await pgShot(me.id, me.character));
    const fan = await person();
    const r = await (await remixGet(req("/x", { cookie: fan.cookie }), params({ id: post.post_id }))).json();
    expect(r.remix).toEqual({ studio: "pg", kind: "shoot", choices: { shot: "candid", place: "park" }, format: "story", creator: "mara" });
    expect(JSON.stringify(r)).not.toContain("secret");
    const listed = (await (await listGet(req("/api/showcase"))).json()).posts[0];
    expect(listed.remixable).toBe(true);
    // A picture from a date (no shoot): nothing to remix.
    const admin = await person("dee", true);
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [admin.id, admin.character]);
    const date = crypto.randomUUID();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready', 'pg')`, [date, admin.id, admin.character, PNG]);
    const datePost = await publish(admin.cookie, date, "after_dark");
    expect((await remixGet(req("/x", { cookie: admin.cookie }), params({ id: datePost.post_id }))).status).toBe(404);
  });
});

describe("reports and takedowns", () => {
  it("a serious report holds a post out of sight until an admin releases it or removes it for good", async () => {
    const me = await person("mara");
    const post = await publish(me.cookie, await pgShot(me.id, me.character));
    const report = (category: string) => reportPostRoute(req("/x", { method: "POST", body: JSON.stringify({ category, details: "looks off" }) }), params({ id: post.post_id }));
    expect(await (await report("other")).json()).toMatchObject({ ok: true, held: false });
    expect((await (await listGet(req("/api/showcase"))).json()).posts).toHaveLength(1);
    expect(await (await report("real_person")).json()).toMatchObject({ held: true });
    expect((await (await listGet(req("/api/showcase"))).json()).posts).toHaveLength(0);
    expect((await mediaGet(req("/x"), params({ id: post.post_id }))).status).toBe(404);
    // The creator still sees their own.
    expect((await mediaGet(req("/x", { cookie: me.cookie }), params({ id: post.post_id }))).status).toBe(200);
    expect((await t.db.query(`select 1 from content_reports where target = $1`, [`/showcase?post=${post.post_id}`])).rows).toHaveLength(2);
    const admin = await person(undefined, true);
    expect((await modGet(req("/x", { cookie: me.cookie }))).status).toBe(403);
    const queue = (await (await modGet(req("/x", { cookie: admin.cookie }))).json()).posts;
    expect(queue).toMatchObject([{ id: post.post_id, held: true, reports: 2 }]);
    expect((await modPost(req("/x", { method: "POST", cookie: admin.cookie, body: JSON.stringify({ post_id: post.post_id, decision: "release" }) }))).status).toBe(200);
    expect((await (await listGet(req("/api/showcase"))).json()).posts).toHaveLength(1);
    expect((await t.db.query<{ status: string }>(`select status from content_reports where target = $1`, [`/showcase?post=${post.post_id}`])).rows.every((r) => r.status === "resolved")).toBe(true);
    await modPost(req("/x", { method: "POST", cookie: admin.cookie, body: JSON.stringify({ post_id: post.post_id, decision: "remove" }) }));
    expect((await (await listGet(req("/api/showcase"))).json()).posts).toHaveLength(0);
  });
});

describe("the viewer's tools", () => {
  it("offers Shoot like this only when there are picks, and Report on every post", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: RemixButton } = await import("@/app/showcase/RemixButton");
    const { default: ReportPost } = await import("@/app/showcase/ReportPost");
    const post = { id: "p", source: "pg" as const, media_id: "m", mime: "image/png", rating: "pg" as const, medium: "picture" as const, aspect: null, act: null, place: null, pov: false, from_date: false, caption: null, status: "live", published_at: "", mine: false, creator: { handle: "mara", display_name: "Mara" }, character: { id: "c", name: "J" }, partner: null, likes: 0, liked: false, remixable: true };
    expect(renderToStaticMarkup(createElement(RemixButton, { post }))).toContain("Shoot like this");
    expect(renderToStaticMarkup(createElement(RemixButton, { post: { ...post, remixable: false } }))).toBe("");
    expect(renderToStaticMarkup(createElement(ReportPost, { postId: "p" }))).toContain("Report");
  });
});
