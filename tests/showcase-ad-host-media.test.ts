import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The reels page's viewer: someone signed out, on a browser.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" }),
}));
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as mediaGet } from "@/app/api/showcase/[id]/media/route";
import ShowcaseGrid from "@/app/showcase/ShowcaseGrid";
import ReelsPage from "@/app/showcase/reels/page";
import type ReelFeed from "@/app/showcase/reels/ReelFeed";
import { REEL_PAGE } from "@/app/showcase/reels/reel-shared";
import { saveAdultSettings } from "@/lib/adult/settings";
import { MEDIA_GRANT_TTL_SECONDS, signMediaGrant, verifyMediaGrant } from "@/lib/auth";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { listShowcase, publish, saveCreatorProfile, type ShowcaseViewer } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// David, 2026-11-01: "a character's video doesn't show on the gallery … and when you open it, it says watch in reels,
// which when clicked doesn't even take you to the video". Every After Dark clip on the show was a blank tile: its file is
// in After Dark's store (Bunny), which only After Dark's host can read, and the show presigned a link to its own bucket.
// And the reels put a post this browser had seen last, so "from here" opened somewhere else.

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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CLIP = Buffer.from("not really an mp4");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const AD = "https://ad.example.com";

/** Mara's clips made in After Dark (one safe for work, one suggestive, one with a poster) and a PG Studio picture. */
async function world() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ('frame-1', $1, $2, 'frame', 'p', 'image/png', $3, 'ready', 'pg')`, [me, mara, PNG]);
  for (const [id, rating, from] of [["clip-pg", "pg", null], ["clip-sugg", "suggestive", null], ["clip-poster", "pg", "frame-1"]] as const) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating, source_image) values ($1, $2, $3, 'video', 'p', 'video/mp4', $4, 'ready', $5, $6)`, [id, me, mara, CLIP, rating, from]);
  }
  await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ('pg-1', $1, $2, 'p', 'image/png', $3, 'pg')`, [me, mara, PNG]);
  const ids: Record<string, string> = {};
  for (const [source, media_id] of [["after_dark", "clip-pg"], ["after_dark", "clip-sugg"], ["after_dark", "clip-poster"], ["pg", "pg-1"]] as const) {
    const r = await publish(t.db, me, { source, media_id });
    if (!r.ok) throw new Error(r.message);
    ids[media_id] = r.post_id;
  }
  return { me, mara, ids };
}
const get = (id: string, q = "", cookie?: string) =>
  mediaGet(new Request(`${BASE_URL}/api/showcase/${id}/media${q}`, { headers: { "user-agent": UA, ...(cookie ? { cookie } : {}) } }), { params: Promise.resolve({ id }) });

describe("a showcase file made in After Dark, on the show", () => {
  it("sends the browser to After Dark's host for it: as it is when anyone may see it, with the show's OK otherwise", async () => {
    const w = await world();
    vi.stubEnv("AFTER_DARK_ORIGIN", AD);
    const pg = await get(w.ids["clip-pg"], "?size=tile");
    expect([pg.status, pg.headers.get("location"), pg.headers.get("cache-control")]).toEqual([302, `${AD}/api/showcase/${w.ids["clip-pg"]}/media?size=tile`, "public, max-age=3600"]);
    // A suggestive one: signed in on the show, with a grant for that post alone, kept for less than it lasts.
    const viewer = signedInCookie(userIdOf(newUserCookie()));
    const sugg = await get(w.ids["clip-sugg"], "", viewer);
    expect(sugg.status).toBe(302);
    const to = new URL(sugg.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(`${AD}/api/showcase/${w.ids["clip-sugg"]}/media`);
    expect(verifyMediaGrant(to.searchParams.get("g"), w.ids["clip-sugg"])).toBe(true);
    expect(verifyMediaGrant(to.searchParams.get("g"), w.ids["clip-pg"])).toBe(false);
    expect(sugg.headers.get("cache-control")).toBe("private, max-age=600");
    // Someone who may not see it gets nothing, not a way round: the show decides first.
    expect((await get(w.ids["clip-sugg"])).status).toBe(404);
    // A PG Studio picture is the show's own: served here as before.
    expect((await get(w.ids["pg-1"])).status).toBe(200);
  });

  it("is served on After Dark's host to whoever brings the show's OK for it, and to nobody with a wrong or spent one", async () => {
    const w = await world();
    vi.stubEnv("AFTER_DARK_ORIGIN", AD);
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    vi.stubEnv("SITE_URL", "https://show.example.com");
    const id = w.ids["clip-sugg"];
    // Signed out on this host: the grant is what lets them in.
    expect((await get(id)).status).toBe(404);
    const ok = await get(id, `?g=${encodeURIComponent(signMediaGrant(id)!)}`);
    expect([ok.status, Buffer.from(await ok.arrayBuffer()).equals(CLIP)]).toEqual([200, true]);
    expect((await get(id, `?g=${encodeURIComponent(signMediaGrant(w.ids["clip-pg"])!)}`)).status).toBe(404);
    const spent = signMediaGrant(id, process.env, Date.now() - (MEDIA_GRANT_TTL_SECONDS + 5) * 1000)!;
    expect((await get(id, `?g=${encodeURIComponent(spent)}`)).status).toBe(404);
    const forged = signMediaGrant(id, { SESSION_SECRET: "another-secret-entirely" })!;
    expect((await get(id, `?g=${encodeURIComponent(forged)}`)).status).toBe(404);
    // Anyone's file needs no grant here, and isn't sent on anywhere.
    expect((await get(w.ids["clip-pg"])).status).toBe(200);
  });

  it("with After Dark on the same host, nothing changes", async () => {
    const w = await world();
    const res = await get(w.ids["clip-pg"]);
    expect([res.status, Buffer.from(await res.arrayBuffer()).equals(CLIP)]).toEqual([200, true]);
  });
});

describe("a clip's tile", () => {
  it("shows the picture it was filmed from, or its first frame: never an empty box", async () => {
    const w = await world();
    const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };
    const { posts } = await listShowcase(t.db, ANYONE, { medium: "clip" });
    expect(Object.fromEntries(posts.map((p) => [p.media_id, p.poster]))).toEqual({ "clip-pg": false, "clip-poster": true });
    const html = renderToStaticMarkup(createElement(ShowcaseGrid, { posts }));
    expect(html).toContain(`src="/api/showcase/${w.ids["clip-pg"]}/media#t=0.1"`);
    expect(html).toMatch(new RegExp(`<video[^>]*src="/api/showcase/${w.ids["clip-poster"]}/media"[^>]*poster="/api/showcase/${w.ids["clip-poster"]}/media\\?size=tile"`));
  });
});

describe("the reels opened at a post", () => {
  it("open on that post, wherever the feed's order would put it, and only one this viewer may see", async () => {
    const w = await world();
    // More than a page, so a post can be off the first one.
    for (let i = 0; i < REEL_PAGE + 2; i++) {
      await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ($1, $2, $3, 'p', 'image/png', $4, 'pg')`, [`more-${i}`, w.me, w.mara, PNG]);
      const r = await publish(t.db, w.me, { source: "pg", media_id: `more-${i}` });
      if (!r.ok) throw new Error(r.message);
    }
    const page = async (sp: Record<string, string>) => (await ReelsPage({ searchParams: Promise.resolve(sp) })) as ReactElement<Parameters<typeof ReelFeed>[0]>;
    const plain = (await page({})).props.initial.map((p) => p.id);
    const last = Object.values(w.ids).find((id) => !plain.includes(id))!;
    expect(last).toBeTruthy();
    const opened = (await page({ start: last })).props;
    expect([opened.initial[0].id, opened.start, opened.initial.filter((p) => p.id === last).length]).toEqual([last, last, 1]);
    // One that's on the first page already isn't there twice.
    expect((await page({ start: plain[3] })).props.initial.filter((p) => p.id === plain[3])).toHaveLength(1);
    // Signed out, a suggestive post isn't theirs to open on.
    expect((await page({ start: w.ids["clip-sugg"] })).props.initial.map((p) => p.id)).not.toContain(w.ids["clip-sugg"]);
  });
});
