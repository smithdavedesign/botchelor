// The locked preview (David, 2026-11-16): After Dark's Gallery and Studio for someone it isn't open to show blurred tiles
// of an admin's published explicit posts and the way in, instead of not-found; and My studio (the PG Studio) carries a
// door to the After Dark Studio. What the pool holds, who gets tiles, that only blurred bytes ever leave, and the pages.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ua: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(jar.ua ? { "user-agent": jar.ua } : {}),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/gallery",
  useSearchParams: () => new URLSearchParams(),
}));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import AfterDarkGalleryPage from "@/app/after-dark/gallery/page";
import StudioPage from "@/app/after-dark/studio/[id]/page";
import AfterDarkStudioPage from "@/app/after-dark/studio/page";
import { GET as previewTile } from "@/app/api/after-dark/preview/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { ADULT_COOKIE } from "@/lib/age";
import { PG_STUDIO_SOURCE, PREVIEW_TILES, previewOf, previewTilesAllowed } from "@/lib/adult/preview";
import { lockedStudioHref, studioDoorFor } from "@/lib/adult/studio-door";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setPlaceForTests } from "@/lib/place";
import { checkFields } from "@/lib/safety";
import { TEASER_HEIGHT, TEASER_WIDTH } from "@/lib/teaser-image";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

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
  jar.cookies.clear();
  jar.ua = "";
  setPlaceForTests({ country: "US", region: "CA" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
});

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

async function png(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width: 64, height: 80, channels: 3, background: "#c36" } }).png().toBuffer();
}

async function adminId(): Promise<string> {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return id;
}

/** A published post with its own picture (or clip): the defaults are what the preview may show. */
async function post(
  owner: string,
  opts: { rating?: string; status?: string; held?: boolean; medium?: string; b?: string | null; character?: string; hidden?: boolean; source?: string } = {},
): Promise<{ post: string; media: string }> {
  await t.db.query(`insert into creator_profiles (user_id, handle, display_name, hidden) values ($1, $2, 'A creator', $3) on conflict (user_id) do nothing`, [
    owner,
    `h${owner.slice(0, 8)}`,
    opts.hidden ?? false,
  ]);
  const media = crypto.randomUUID();
  const video = ["clip", "reel", "boomerang", "loop"].includes(opts.medium ?? "picture");
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, $4, 'scene', 'x', $5, $6, 'ready', 'nsfw')`,
    [media, owner, opts.character ?? A.id, opts.b === undefined ? B.id : opts.b, video ? "video/mp4" : "image/png", video ? Buffer.from("not really a video") : await png()],
  );
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into showcase_posts (id, owner_id, source, media_id, character_id, character_b, rating, medium, status, held, published_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [id, owner, opts.source ?? "after_dark", media, opts.character ?? A.id, opts.b === undefined ? B.id : opts.b, opts.rating ?? "nsfw", opts.medium ?? "picture", opts.status ?? "live", opts.held ?? false],
  );
  return { post: id, media };
}

const tileReq = (id: string, opts: { cookie?: string; ua?: string } = {}) =>
  previewTile(new Request(`${BASE_URL}/api/after-dark/preview/${id}`, { headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.ua ? { "user-agent": opts.ua } : {}) } }), {
    params: Promise.resolve({ id }),
  });
const ADULT = `${ADULT_COOKIE}=1`;

describe("who gets tiles (pure)", () => {
  it("only someone who said they're 18+, not a crawler, where After Dark's pictures are allowed", () => {
    expect(previewTilesAllowed({ bot: false, attested: true, mode: "open" })).toBe(true);
    expect(previewTilesAllowed({ bot: true, attested: true, mode: "open" })).toBe(false);
    expect(previewTilesAllowed({ bot: false, attested: false, mode: "open" })).toBe(false);
    expect(previewTilesAllowed({ bot: false, attested: true, mode: "text_only" })).toBe(false);
    expect(previewTilesAllowed({ bot: false, attested: true, mode: "blocked" })).toBe(false);
  });
});

describe("the pool (lib/adult/preview.ts)", () => {
  it("holds only an admin's live, unheld, explicit After Dark posts of a character that isn't private, and counts pictures and videos", async () => {
    const admin = await adminId();
    const person = userIdOf(newUserCookie());
    const pic = await post(admin);
    const clip = await post(admin, { medium: "clip" });
    await post(person); // not an admin's
    await post(admin, { rating: "suggestive" }); // the safe side
    await post(admin, { status: "removed" });
    await post(admin, { held: true }); // held by a report
    const p = await previewOf(t.db, "gallery");
    expect(p).toMatchObject({ pictures: 1, videos: 1 });
    expect(p.tiles.map((x) => x.id).sort()).toEqual([pic.post, clip.post].sort());
    expect(p.tiles.find((x) => x.id === clip.post)?.video).toBe(true);

    // A private character's posts are left out (the house cast isn't reset between tests: put it back).
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [A.id]);
    try {
      expect(await previewOf(t.db, "gallery")).toMatchObject({ pictures: 0, videos: 0, tiles: [] });
    } finally {
      await t.db.query(`update characters set visibility = 'public' where id = $1`, [A.id]);
    }
  });

  it("leaves out a hidden creator's posts", async () => {
    const admin = await adminId();
    await post(admin, { hidden: true });
    expect((await previewOf(t.db, "gallery")).tiles).toEqual([]);
  });

  it("the Studio's prefers one character alone, and falls back to every post when there are none", async () => {
    const admin = await adminId();
    const pair = await post(admin);
    expect((await previewOf(t.db, "studio")).tiles.map((x) => x.id)).toEqual([pair.post]);
    const alone = await post(admin, { b: null });
    const studio = await previewOf(t.db, "studio");
    expect(studio.tiles.map((x) => x.id)).toEqual([alone.post]);
    expect(studio).toMatchObject({ pictures: 1, videos: 0 });
  });

  it("shows at most a page's worth, and none when asked for the counts only", async () => {
    const admin = await adminId();
    for (let i = 0; i < PREVIEW_TILES.studio + 2; i++) await post(admin, { b: null });
    expect((await previewOf(t.db, "studio")).tiles).toHaveLength(PREVIEW_TILES.studio);
    expect(await previewOf(t.db, "studio", { tiles: false })).toMatchObject({ pictures: PREVIEW_TILES.studio + 2, tiles: [] });
  });
});

describe("a tile (app/api/after-dark/preview/[id])", () => {
  it("is the blurred teaser, never the picture, for an 18+ visitor in an open place, signed in or not", async () => {
    const admin = await adminId();
    const { post: id } = await post(admin);
    const res = await tileReq(id, { cookie: ADULT });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([TEASER_WIDTH, TEASER_HEIGHT]);
    const signedIn = `${ADULT}; ${signedInCookie(userIdOf(newUserCookie()))}`;
    expect((await tileReq(id, { cookie: signedIn })).status).toBe(200);
  });

  it("is not found for a crawler, without the 18+ answer, where After Dark is blocked or text only, and for a post outside the pool", async () => {
    const admin = await adminId();
    const { post: id } = await post(admin);
    const { post: someones } = await post(userIdOf(newUserCookie()));
    expect((await tileReq(id, { cookie: ADULT, ua: GOOGLEBOT })).status).toBe(404);
    expect((await tileReq(id)).status).toBe(404);
    expect((await tileReq(someones, { cookie: ADULT })).status).toBe(404);
    expect((await tileReq("nope", { cookie: ADULT })).status).toBe(404);
    setPlaceForTests({ country: "US", region: "TX" });
    expect((await tileReq(id, { cookie: ADULT })).status).toBe(404);
    setPlaceForTests({ country: "GB", region: null });
    expect((await tileReq(id, { cookie: ADULT })).status).toBe(404);
  });

  it("a clip's tile is its still blurred, and a clip with no still has no tile", async () => {
    const admin = await adminId();
    const clip = await post(admin, { medium: "clip" });
    expect((await tileReq(clip.post, { cookie: ADULT })).status).toBe(404);
    const still = crypto.randomUUID();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ($1, $2, $3, 'scene', 'x', 'image/png', $4, 'ready')`, [
      still,
      admin,
      A.id,
      await png(),
    ]);
    await t.db.query(`update adult_images set source_image = $2 where id = $1`, [clip.media, still]);
    const res = await tileReq(clip.post, { cookie: ADULT });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});

describe("the pages", () => {
  it("the Gallery shows someone After Dark isn't open to the counts, blurred tiles and the way in, and nothing else", async () => {
    const admin = await adminId();
    const { post: id, media } = await post(admin);
    jar.cookies.set(ADULT_COOKIE, "1");
    const page = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain('data-locked-preview="gallery"');
    expect(page).toContain("1 picture so far");
    expect(page).toContain(`/api/after-dark/preview/${id}`);
    expect(page).toContain('href="/after-dark/subscribe?source=gallery"');
    expect(page).toContain("Sign up for After Dark");
    expect(page).toContain("Already in? Sign in");
    // Never the picture itself, by any route.
    expect(page).not.toContain(media);
    expect(page).not.toContain("/api/showcase/");
    expect(page).not.toContain("/api/after-dark/media");

    // Signed in: no sign-in link.
    jar.cookies.set("bz_sess", signedInCookie(userIdOf(newUserCookie())).split("=").slice(1).join("="));
    expect(await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({}) }))).not.toContain("Already in? Sign in");
  });

  it("without the 18+ answer, or where only the scenes are allowed, it's the words and the way in, no tiles", async () => {
    const admin = await adminId();
    const { post: id } = await post(admin);
    let page = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain("Sign up for After Dark");
    expect(page).not.toContain(`/api/after-dark/preview/${id}`);
    jar.cookies.set(ADULT_COOKIE, "1");
    setPlaceForTests({ country: "GB", region: null });
    page = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain("Sign up for After Dark");
    expect(page).not.toContain(`/api/after-dark/preview/${id}`);
    expect(page).not.toContain("so far");
  });

  it("is still not found for a crawler", async () => {
    await post(await adminId());
    jar.cookies.set(ADULT_COOKIE, "1");
    jar.ua = GOOGLEBOT;
    await expect(html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({}) }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("an admin still gets their own Gallery", async () => {
    const admin = await adminId();
    jar.cookies.set("bz_sess", signedInCookie(admin).split("=").slice(1).join("="));
    jar.cookies.set(ADULT_COOKIE, "1");
    const page = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({}) }));
    expect(page).not.toContain("data-locked-preview");
    expect(page).toContain("ad-gallery-page");
  });

  it("the Studio's door shows the locked Studio, carrying where they came from; a character's Studio sends them there", async () => {
    const admin = await adminId();
    const { post: id } = await post(admin, { b: null });
    jar.cookies.set(ADULT_COOKIE, "1");
    const page = await html(await AfterDarkStudioPage({ searchParams: Promise.resolve({ source: PG_STUDIO_SOURCE }) }));
    expect(page).toContain('data-locked-preview="studio"');
    expect(page).toContain(`/api/after-dark/preview/${id}`);
    expect(page).toContain(`href="/after-dark/subscribe?source=${PG_STUDIO_SOURCE}"`);
    expect(await html(await AfterDarkStudioPage({ searchParams: Promise.resolve({}) }))).toContain('href="/after-dark/subscribe?source=studio"');
    await expect(StudioPage({ params: Promise.resolve({ id: A.id }) })).rejects.toMatchObject({ digest: expect.stringContaining("/after-dark/studio") });
  });
});

describe("My studio's door to the After Dark Studio (lib/adult/studio-door.ts)", () => {
  const cookieStore = (m: Record<string, string> = {}) => ({ get: (name: string) => (name in m ? { value: m[name] } : undefined) });
  const signed = (id: string) => ({ userId: id, authenticated: true });

  it("someone not in yet who said they're 18+, in an open place: the way in, to the locked Studio", async () => {
    const me = userIdOf(newUserCookie());
    const door = await studioDoorFor(t.db, signed(me), new Headers(), cookieStore(), true, A.id);
    expect(door).toEqual({ state: "way_in", href: lockedStudioHref(), inviteOnly: true });
    expect(door!.href).toContain(`/after-dark/studio?source=${PG_STUDIO_SOURCE}`);
  });

  it("nothing without the 18+ answer, signed out, for a crawler, where blocked or text only, with the bridge off, or after a declined invite", async () => {
    const me = userIdOf(newUserCookie());
    expect(await studioDoorFor(t.db, signed(me), new Headers(), cookieStore(), false, A.id)).toBeNull();
    expect(await studioDoorFor(t.db, null, new Headers(), cookieStore(), true, A.id)).toBeNull();
    expect(await studioDoorFor(t.db, signed(me), new Headers({ "user-agent": GOOGLEBOT }), cookieStore(), true, A.id)).toBeNull();
    setPlaceForTests({ country: "US", region: "TX" });
    expect(await studioDoorFor(t.db, signed(me), new Headers(), cookieStore(), true, A.id)).toBeNull();
    setPlaceForTests({ country: "GB", region: null });
    expect(await studioDoorFor(t.db, signed(me), new Headers(), cookieStore(), true, A.id)).toBeNull();
    setPlaceForTests({ country: "US", region: "CA" });
    expect(await studioDoorFor(t.db, signed(me), new Headers(), cookieStore(), true, A.id, { ...process.env, AD_BRIDGE: "0" })).toBeNull();
    await t.db.query(`insert into adult_invites (user_id, email, status) values ($1, 'me@example.com', 'declined')`, [me]);
    expect(await studioDoorFor(t.db, signed(me), new Headers(), cookieStore(), true, A.id)).toBeNull();
  });

  it("someone in: the character's own After Dark Studio when it's in their After Dark, else the switches; nothing for a character the Studio isn't theirs on", async () => {
    const admin = await adminId();
    // The house cast is in everyone's After Dark: an admin's Studio for it opens straight away.
    expect(await studioDoorFor(t.db, signed(admin), new Headers(), cookieStore(), true, A.id)).toEqual({
      state: "open",
      href: `/after-dark/studio/${A.id}`,
      inviteOnly: false,
    });
    // Their own, still Out: the Studio door's "Who's in".
    const mine = crypto.randomUUID();
    const character = (id: string, owner: string, name: string) =>
      t.db.query(
        `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values ($1, $2, false, $3, 31, 'Restores clocks.', '["dry"]'::jsonb, 'x', 'x')`,
        [id, owner, name],
      );
    await character(mine, admin, "Ambrose Test");
    expect(await studioDoorFor(t.db, signed(admin), new Headers(), cookieStore(), true, mine)).toEqual({ state: "switch_in", href: "/after-dark/studio#ad-whos-in", inviteOnly: false });
    // Someone else's: no card.
    const theirs = crypto.randomUUID();
    await character(theirs, userIdOf(newUserCookie()), "Not Mine");
    expect(await studioDoorFor(t.db, signed(admin), new Headers(), cookieStore(), true, theirs)).toBeNull();
  });

  it("the card's words pass the show's text check", () => {
    for (const line of [
      "After Dark Studio",
      "Private shoots of Nell for adults, in After Dark.",
      "Private shoots of Nell for adults, in After Dark. Add Nell to After Dark there first.",
      "Add Nell to After Dark",
      "Private shoots of your own characters, for adults only. It's invite only while it's in beta.",
      "See the After Dark Studio",
    ]) {
      expect(checkFields({ line }).ok, line).toBe(true);
    }
  });
});
