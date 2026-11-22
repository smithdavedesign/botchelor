// After Dark's showcase on After Dark's own pages (lib/showcase-paths.ts; David, 2026-11-18: "can we remove the showcase
// tab because it takes you out of after dark", "consolidate the after dark showcase in ad.botchelor", "keep the reel
// page as is, I like it"). The Gallery's two rooms, who gets the Showcase room, its links staying on After Dark, and its
// reels: the show's own reels page, on After Dark's side.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  // The showcase's viewer reads the request's own cookies (app/showcase/viewer.ts), as a browser sends them.
  headers: async () =>
    new Headers({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      ...(jar.cookies.size ? { cookie: [...jar.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    }),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/showcase",
  useSearchParams: () => new URLSearchParams(),
}));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import AfterDarkGalleryPage from "@/app/after-dark/gallery/page";
import AfterDarkShowcasePage from "@/app/after-dark/showcase/page";
import AfterDarkShowcaseReelsPage from "@/app/after-dark/showcase/reels/page";
import type ReelFeed from "@/app/showcase/reels/ReelFeed";
import { claimAdmin } from "@/lib/admins";
import { ADULT_COOKIE } from "@/lib/age";
import { afterDarkHouseIds } from "@/lib/adult/characters";
import { OWN_VEIL_ATTR } from "@/lib/adult/discreet";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setPlaceForTests } from "@/lib/place";
import { newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

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
  await saveAdultSettings(t.db, { enabled: true });
  jar.cookies.clear();
  setPlaceForTests({ country: "US", region: "CA" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
});

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const none = { searchParams: Promise.resolve({}) };

function signIn(id: string) {
  jar.cookies.set("bz_sess", signedInCookie(id).split("=").slice(1).join("="));
  jar.cookies.set(ADULT_COOKIE, "1");
}

async function admin(): Promise<string> {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return id;
}

/** A member After Dark is open to (an invited beta pass), who isn't an admin. */
async function member(): Promise<string> {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, provider, age_verified_at) values ($1, 'active', 'beta', now())`, [id]);
  return id;
}

/** A live post under a creator handle, with its own file: explicit (After Dark's side) unless said. */
async function post(owner: string, handle: string, opts: { rating?: string; video?: boolean } = {}): Promise<string> {
  await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ($1, $2, 'A creator') on conflict (user_id) do nothing`, [owner, handle]);
  const media = crypto.randomUUID();
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, $4, 'scene', 'x', $5, $6, 'ready', $7)`,
    [media, owner, A.id, B.id, opts.video ? "video/mp4" : "image/png", Buffer.from("x"), opts.rating ?? "nsfw"],
  );
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into showcase_posts (id, owner_id, source, media_id, character_id, character_b, rating, medium, status, published_at) values ($1, $2, 'after_dark', $3, $4, $5, $6, $7, 'live', now())`,
    [id, owner, media, A.id, B.id, opts.rating ?? "nsfw", opts.video ? "clip" : "picture"],
  );
  return id;
}

describe("After Dark's showcase, a room of its Gallery", () => {
  it("shows an admin the explicit posts only, under Yours | Showcase, with no side bar and every link staying on After Dark", async () => {
    const me = await admin();
    const explicit = await post(me, "mara", { video: true });
    const safe = await post(me, "mara", { rating: "pg" });
    signIn(me);
    const page = await html(await AfterDarkShowcasePage(none));
    expect(page).toContain('aria-label="Gallery rooms"');
    expect(page).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/after-dark\/showcase"[^>]*>Showcase<\/a>/);
    expect(page).toContain('href="/after-dark/gallery"');
    expect(page).toContain(`/api/showcase/${explicit}/media`);
    expect(page).not.toContain(`/api/showcase/${safe}/media`);
    // The Gallery's tabs are the way between: no "Safe for work" side bar that would leave After Dark.
    expect(page).not.toContain('aria-label="Which side"');
    expect(page).not.toContain("Safe for work");
    // A creator is a filter here, the reels are After Dark's, and the clip plays by itself once shown.
    expect(page).toContain('href="/after-dark/showcase?creator=mara"');
    expect(page).not.toContain('href="/creators/');
    expect(page).toContain('href="/after-dark/showcase/reels"');
    expect(page).toMatch(/<video[^>]*data-autoplay=""/);
    // After Dark's own blur covers it (the person's privacy setting): no second veil of the grid's own.
    expect(page).not.toContain("After Dark · tap to show");
    expect(page).toContain("after-dark-mode page-full");
  });

  it("sends a member it isn't open to yet to their own Gallery, and someone After Dark isn't open to gets the locked preview", async () => {
    const someone = await member();
    signIn(someone);
    await expect(AfterDarkShowcasePage(none)).rejects.toMatchObject({ digest: expect.stringContaining("/after-dark/gallery") });
    // Their own Gallery has no Showcase room to offer.
    expect(await html(await AfterDarkGalleryPage(none))).not.toContain("Gallery rooms");
    jar.cookies.clear();
    jar.cookies.set(ADULT_COOKIE, "1");
    expect(await html(await AfterDarkShowcasePage(none))).toContain('data-locked-preview="gallery"');
  });

  it("opens to members once explicit posts are open, and the Gallery then has both rooms", async () => {
    await saveAdultSettings(t.db, { studio: { showcase: { explicit_open: true } } });
    const someone = await member();
    await post(await admin(), "mara");
    signIn(someone);
    const showcase = await html(await AfterDarkShowcasePage(none));
    expect(showcase).toContain('aria-label="Gallery rooms"');
    const yours = await html(await AfterDarkGalleryPage(none));
    expect(yours).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/after-dark\/gallery"[^>]*>Yours<\/a>/);
    expect(yours).toContain('href="/after-dark/showcase"');
  });
});

describe("After Dark's showcase reels", () => {
  const reels = async (sp: Record<string, string>) => (await AfterDarkShowcaseReelsPage({ searchParams: Promise.resolve(sp) })) as ReactElement<Record<string, unknown>>;

  it("are the show's reels page on After Dark's side, its way back After Dark's showcase, under the feed's own veil", async () => {
    const me = await admin();
    const explicit = await post(me, "mara");
    await post(me, "mara", { rating: "pg" });
    signIn(me);
    const page = await reels({ medium: "picture", start: explicit });
    // The feed keeps its own one-tap veil; After Dark's per-picture blur steps aside for it.
    expect(page.props[OWN_VEIL_ATTR]).toBe("reels");
    const feed = page.props.children as ReactElement<Parameters<typeof ReelFeed>[0]>;
    expect([feed.props.side, feed.props.explicit, feed.props.start]).toEqual(["after_dark", true, explicit]);
    expect(feed.props.initial.map((p) => p.id)).toEqual([explicit]);
    // The next pages ask for this side; the way back is After Dark's showcase, whose address says the side itself.
    expect(feed.props.query).toBe("medium=picture&side=after_dark");
    expect(feed.props.back).toBe("/after-dark/showcase?medium=picture");
    // Its links stay on After Dark: the reels know they're After Dark's, and who a night can start with (this viewer's cast).
    expect(feed.props.place).toBe("after_dark");
    expect(feed.props.nights).toEqual(expect.arrayContaining(afterDarkHouseIds()));
    expect((await reels({})).props.children).toMatchObject({ props: { back: "/after-dark/showcase" } });
  });

  it("send anyone that side isn't open to the safe side's reels on the show, filters kept", async () => {
    signIn(await member());
    await expect(reels({ medium: "picture", start: "p1" })).rejects.toMatchObject({ digest: expect.stringContaining("/showcase/reels?medium=picture") });
    jar.cookies.clear();
    await expect(reels({})).rejects.toMatchObject({ digest: expect.stringMatching(/;\/showcase\/reels;/) });
  });
});
