import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The page's viewer: someone signed out, on a browser.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" }),
}));

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as reelsGet } from "@/app/api/showcase/reels/route";
import { POST as seenPost } from "@/app/api/showcase/reels/seen/route";
import ReelFeed from "@/app/showcase/reels/ReelFeed";
import ReelsPage from "@/app/showcase/reels/page";
import { CARD_EVERY, feedOf, motionOf, REEL_PAGE, reelsQuery } from "@/app/showcase/reels/reel-shared";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { afterDarkCounts, listShowcase, MIX_RUN, publish, saveCreatorProfile, seenFilters, type Post, type ShowcaseViewer } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// The showcase as reels (app/showcase/reels; David, 2026-10-29: "an infinite reel / video, scroll-swipe… a safe image of
// the person animated with cta to see all their content with a paywall after").

describe("the feed's shape", () => {
  it("puts a card after every few posts, taking turns, and After Dark's only when it's asked for", () => {
    const posts = Array.from({ length: CARD_EVERY * 3 }, (_, i) => i);
    const kinds = (f: ReturnType<typeof feedOf<number>>) => f.filter((x) => x.kind === "card").map((x) => (x.kind === "card" ? x.card : ""));
    const both = feedOf(posts, { afterDarkCard: true });
    expect(both).toHaveLength(CARD_EVERY * 3 + 3);
    expect(both[CARD_EVERY]).toMatchObject({ kind: "card", card: "create" });
    expect(kinds(both)).toEqual(["create", "after_dark", "create"]);
    expect(kinds(feedOf(posts, { afterDarkCard: false }))).toEqual(["create", "create", "create"]);
    expect(feedOf([1, 2], { afterDarkCard: true }).every((x) => x.kind === "post")).toBe(true);
    // A still never moves the same way as the one before it.
    for (let i = 0; i < 8; i++) expect(motionOf(i)).not.toBe(motionOf(i + 1));
    expect(reelsQuery({ place: "bar", page: "3", start: "p1", side: ["after_dark"] }, { creator: "mara" })).toBe("?place=bar&side=after_dark&creator=mara");
    expect(reelsQuery({})).toBe("");
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
const ADMIN: ShowcaseViewer = { id: "an-admin", admin: true, ratings: ["pg", "suggestive", "nsfw"] };
const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };

/** Mara with `pg` safe pictures, and two explicit ones (one with a house character). */
async function world(pg: number) {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  const house = HOUSE_CHARACTERS[0].id;
  for (let i = 0; i < pg; i++) {
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ($1, $2, $3, 'p', 'image/png', $4, 'pg')`, [`pg-${i}`, me, mara, PNG]);
    const r = await publish(t.db, me, { source: "pg", media_id: `pg-${i}` });
    if (!r.ok) throw new Error(r.message);
  }
  const [a, b] = pairKey(mara, house);
  for (const [id, x, y] of [["ad-1", mara, null], ["ad-2", a, b]] as const) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready', 'nsfw')`, [id, me, x, y, PNG]);
    const r = await publish(t.db, me, { source: "after_dark", media_id: id });
    if (!r.ok) throw new Error(r.message);
  }
  return { me, mara, house };
}

describe("the reels' posts", () => {
  it("come a small page at a time, safe for work unless After Dark is asked for, with how many more are after dark", async () => {
    const w = await world(REEL_PAGE + 2);
    const get = async (q: string) => (await reelsGet(new Request(`${BASE_URL}/api/showcase/reels${q}`))).json();
    const one = await get("");
    expect(one.posts).toHaveLength(REEL_PAGE);
    expect(one.more).toBe(true);
    expect(one.posts.every((p: Post) => p.rating === "pg")).toBe(true);
    // Mara has two after dark (one with the house character), the house character one.
    expect(one.locked).toEqual({ [w.mara]: 2 });
    // Most liked this week first.
    const liked = one.posts[3].id;
    await t.db.query(`insert into showcase_likes (post_id, user_id) values ($1, 'fan-1'), ($1, 'fan-2')`, [liked]);
    expect((await get("")).posts[0].id).toBe(liked);
    const two = await get("?page=2");
    expect([two.posts.length, two.more]).toEqual([2, false]);
    expect(new Set([...one.posts, ...two.posts].map((p: Post) => p.id)).size).toBe(REEL_PAGE + 2);
    // Nobody but an admin (for now) gets After Dark's side; anyone else asking for it gets the safe side.
    const asked = await get("?side=after_dark");
    expect([asked.posts.length, asked.posts.every((p: Post) => p.rating === "pg")]).toEqual([REEL_PAGE, true]);
    expect(seenFilters(ADMIN, { side: "after_dark" })).toEqual({ side: "after_dark" });
    expect((await listShowcase(t.db, ADMIN, { side: "after_dark" }, { pageSize: REEL_PAGE })).posts.map((p) => p.media_id).sort()).toEqual(["ad-1", "ad-2"]);
  });

  it("come in runs: a few of one character together, then the next creator's, each creator's characters before any one again", async () => {
    // David, 2026-10-29: not 30 screens of one creator; 2026-10-30: "sort them by creator and by character so it's not
    // jumping around". Mara posts four of herself, then Sam two each of three characters, all newer.
    const w = await world(4);
    const raw = newUserCookie();
    const sam = userIdOf(raw);
    await saveCreatorProfile(t.db, sam, { handle: "sam", display_name: "Sam" });
    const chars: string[] = [];
    for (const name of ["Ada Vale", "Bo Reyes", "Cy Lund"]) {
      const id = (await (await api.createCharacter(validCharacter({ name }), raw)).json()).id as string;
      chars.push(id);
      for (const k of [1, 2]) {
        await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ($1, $2, $3, 'p', 'image/png', $4, 'pg')`, [`${id}-${k}`, sam, id, PNG]);
        const r = await publish(t.db, sam, { source: "pg", media_id: `${id}-${k}` });
        if (!r.ok) throw new Error(r.message);
      }
    }
    const get = async (q: string) => (await (await reelsGet(new Request(`${BASE_URL}/api/showcase/reels${q}`))).json()).posts as Post[];
    const all = [...(await get("")), ...(await get("?page=2"))];
    expect(all).toHaveLength(10);
    expect(new Set(all.map((p) => p.id)).size).toBe(10);
    // Sam's newest character's two, Mara's first three (MIX_RUN), Sam's next character's two, Mara's last, Sam's last two.
    expect(MIX_RUN).toBe(3);
    expect(all.map((p) => p.creator.handle)).toEqual(["sam", "sam", "mara", "mara", "mara", "sam", "sam", "mara", "sam", "sam"]);
    const sams = all.filter((p) => p.creator.handle === "sam").map((p) => p.character.id);
    expect(sams).toEqual([chars[2], chars[2], chars[1], chars[1], chars[0], chars[0]]);
    expect(all.filter((p) => p.creator.handle === "mara").every((p) => p.character.id === w.mara)).toBe(true);
    // The grid keeps plain newest first.
    expect((await listShowcase(t.db, ANYONE, {})).posts.slice(0, 6).every((p) => p.creator.handle === "sam")).toBe(true);
  });

  it("put what this browser has seen last, longest-ago seen first, and keep a feed's pages as of when it began", async () => {
    // David, 2026-10-30: "if a user has seen the asset it goes to the bottom of the queue… if they reload or come back
    // it isn't the same assets from the start".
    await world(REEL_PAGE + 2);
    const raw = newUserCookie();
    const me = { cookie: raw, "content-type": "application/json" };
    const get = async (q: string, headers: Record<string, string> = me) => (await (await reelsGet(new Request(`${BASE_URL}/api/showcase/reels${q}`, { headers }))).json()).posts as Post[];
    const before = (await get("")).map((p) => p.id);
    for (const id of before.slice(0, 2)) {
      const r = await seenPost(new Request(`${BASE_URL}/api/showcase/reels/seen`, { method: "POST", headers: me, body: JSON.stringify({ post_id: id }) }));
      expect(r.status).toBe(200);
      await new Promise((ok) => setTimeout(ok, 5));
    }
    const asOf = encodeURIComponent(new Date().toISOString());
    const again = [...(await get(`?as_of=${asOf}`)), ...(await get(`?page=2&as_of=${asOf}`))].map((p) => p.id);
    expect(again).toHaveLength(REEL_PAGE + 2);
    // The unseen first, in their turn; the two seen at the back, the first seen first.
    expect(again.slice(0, REEL_PAGE).filter((id) => before.includes(id))).toEqual(before.slice(2));
    expect(again.slice(-2)).toEqual(before.slice(0, 2));
    // A feed begun before they were seen keeps them where they were; someone else's feed doesn't change.
    expect((await get(`?as_of=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`)).map((p) => p.id)).toEqual(before);
    expect((await get("", { cookie: newUserCookie() })).map((p) => p.id)).toEqual(before);
    // A post that isn't there is nothing to mark.
    const gone = await seenPost(new Request(`${BASE_URL}/api/showcase/reels/seen`, { method: "POST", headers: me, body: JSON.stringify({ post_id: "no-such" }) }));
    expect(gone.status).toBe(200);
    expect((await t.db.query(`select count(*)::int as n from showcase_views`)).rows[0].n).toBe(2);
  });

  it("counts After Dark's posts only for someone who can't see them, never for a bot, and never one held or taken down", async () => {
    const w = await world(1);
    expect(await afterDarkCounts(t.db, ANYONE, [w.mara, w.house])).toEqual({ [w.mara]: 2, [w.house]: 1 });
    expect(await afterDarkCounts(t.db, ADMIN, [w.mara])).toEqual({});
    expect(await afterDarkCounts(t.db, { ...ANYONE, bot: true }, [w.mara])).toEqual({});
    await t.db.query(`update showcase_posts set held = true where media_id = 'ad-1'`);
    await t.db.query(`update showcase_posts set status = 'removed' where media_id = 'ad-2'`);
    expect(await afterDarkCounts(t.db, ANYONE, [w.mara, w.house])).toEqual({});
  });
});

describe("the reels' page", () => {
  const render = (props: Partial<Parameters<typeof ReelFeed>[0]> & { initial: Post[] }) =>
    renderToStaticMarkup(createElement(ReelFeed, { more: false, locked: {}, query: "", side: "pg", explicit: false, start: null, asOf: new Date().toISOString(), back: "/showcase", ...props }));

  it("asks one thing of each post first (a date), then see all of them, then how many more are after dark; and a card every few", async () => {
    const w = await world(CARD_EVERY + 1);
    const posts = (await listShowcase(t.db, ANYONE, { sort: "trending" }, { pageSize: REEL_PAGE })).posts;
    const html = render({ initial: posts, locked: { [w.mara]: 2 } });
    // Mara isn't open to dates: her page, to meet her. Once she is, a date.
    expect(html.match(/Meet Mara/g)).toHaveLength(CARD_EVERY + 1);
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [w.mara]);
    const open = (await listShowcase(t.db, ANYONE, { sort: "trending" }, { pageSize: REEL_PAGE })).posts;
    expect(render({ initial: open }).match(/💘 Date Mara/g)).toHaveLength(CARD_EVERY + 1);
    expect(html).toContain(`href="/characters/${w.mara}"`);
    expect(html).toContain(`href="/showcase?character=${w.mara}"`);
    expect(html).toContain("🌙 2 more of Mara after dark");
    expect(html).toContain('href="/after-dark/subscribe"');
    expect(html).toContain("Make your own character");
    // The end, for now: start again, or make one.
    expect(html).toContain("That&#x27;s everything here, for now");
    // No side tabs for someone who can't see After Dark, and nothing blurred.
    expect(html).not.toContain("Which side");
    expect(html).not.toContain("Show them");
  });

  it("gives an admin the side tabs and no After Dark upsell, and keeps After Dark's side blurred until they say", async () => {
    const w = await world(2);
    const safe = (await listShowcase(t.db, ADMIN, {}, { pageSize: REEL_PAGE })).posts;
    const html = render({ initial: safe, explicit: true, locked: { [w.mara]: 2 } });
    expect(html).toContain('aria-label="Which side"');
    expect(html).not.toContain("more of Mara after dark");
    const dark = (await listShowcase(t.db, ADMIN, { side: "after_dark" }, { pageSize: REEL_PAGE })).posts;
    const ad = render({ initial: dark, explicit: true, side: "after_dark" });
    expect(ad).toContain("Show them");
    expect(ad).toContain("Safe for work instead");
    expect(ad).not.toContain("Make your own character</a><button");
  });

  it("starts a new feed for each set of filters, and opens the safe side for anyone After Dark isn't open to", async () => {
    // David, 2026-10-29: "on the reels the safe for work when you come in doesn't do anything". The feed's posts and
    // veil are its own state, and Next keeps it across a change of the query alone: only a new key starts it again.
    await world(2);
    const page = async (sp: Record<string, string>) => (await ReelsPage({ searchParams: Promise.resolve(sp) })) as ReactElement<Parameters<typeof ReelFeed>[0]>;
    const safe = await page({});
    const asked = await page({ side: "after_dark", medium: "picture", start: "a-post" });
    expect([safe.key, asked.key]).toEqual(["", "medium=picture"]);
    // A shared After Dark reel, signed out: the safe side, no veil, and no After Dark in the next pages' query.
    expect([asked.props.side, asked.props.query, asked.props.initial.length]).toEqual(["pg", "medium=picture", 2]);
    expect(asked.props.initial.every((p) => p.rating === "pg")).toBe(true);
    expect(renderToStaticMarkup(asked)).not.toContain("Show them");
  });
});
