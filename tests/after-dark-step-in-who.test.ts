// Step in's Who card (David, 2026-11-24: "Can we add more details on the step in, like about the person you selected,
// maybe a few images in a small caresol, some locked for premieum subscription how other competitors do"): who they are
// and a few pictures of them; After Dark's locked (server-blurred tiles, the way to the subscription) for a plan without
// pictures. What goes in the carousel and in what order, who sees what locked, the route, and the carousel's markup.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers({ cookie: [...jar.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/step-in",
}));
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
import { createElement } from "react";
import { prerender } from "react-dom/static";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import WhoCarousel from "@/app/after-dark/step-in/WhoCarousel";
import { GET as who } from "@/app/api/admin/after-dark/step-in/who/route";
import { claimAdmin } from "@/lib/admins";
import { ADULT_COOKIE } from "@/lib/age";
import { saveAdultSettings } from "@/lib/adult/settings";
import type { WhoSlide } from "@/lib/adult/step-in-shared";
import { WHO_LOCKED, WHO_PHOTOS, WHO_SUBSCRIBE, whoDetails, whoSlides } from "@/lib/adult/step-in-who";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setPlaceForTests } from "@/lib/place";
import { showcaseViewer } from "@/lib/showcase";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  setPlaceForTests({ country: "US", region: "CA" });
  jar.cookies.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];
const html = async (el: Parameters<typeof prerender>[0]) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");

async function admin(): Promise<string> {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  return id;
}
const cookieOf = (id: string) => `${signedInCookie(id).split(";")[0]}; ${ADULT_COOKIE}=1`;
const ask = (viewer: string, q: string) => who(new Request(`${BASE_URL}/api/admin/after-dark/step-in/who?${q}`, { headers: { cookie: cookieOf(viewer) } }));

/** An admin's published explicit post of A alone: what the locked preview may show. */
async function post(owner: string): Promise<string> {
  await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ($1, $2, 'A creator') on conflict (user_id) do nothing`, [owner, `h${owner.slice(0, 8)}`]);
  const media = randomUUID();
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, 'scene', 'x', 'image/png', $4, 'ready', 'nsfw')`,
    [media, owner, A.id, Buffer.from("png")],
  );
  const id = randomUUID();
  await t.db.query(
    `insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, status, held, published_at) values ($1, $2, 'after_dark', $3, $4, 'nsfw', 'picture', 'live', false, now())`,
    [id, owner, media, A.id],
  );
  return id;
}

describe("the carousel's pictures", () => {
  const s = (kind: WhoSlide["kind"], n: number): WhoSlide[] => Array.from({ length: n }, (_, i) => ({ key: `${kind}${i}`, kind, src: `/${kind}/${i}`, alt: "" }));

  it("the portrait, a few profile photos, then After Dark's; the locked last; each once; eight at most", () => {
    const out = whoSlides({ portrait: s("portrait", 1)[0], photos: s("photo", 5), made: s("made", 2), showcase: s("showcase", 1), locked: [] });
    expect(out.map((x) => x.kind)).toEqual(["portrait", ...Array(WHO_PHOTOS).fill("photo"), "made", "made", "showcase"]);
    const full = whoSlides({ portrait: null, photos: s("photo", 3), made: s("made", 9), showcase: s("showcase", 3), locked: [] });
    expect(full).toHaveLength(8);
    expect(full.filter((x) => x.kind === "showcase")).toHaveLength(0);
    const locked = whoSlides({ portrait: s("portrait", 1)[0], photos: [], made: [], showcase: [], locked: s("locked", 9) });
    expect(locked.filter((x) => x.kind === "locked")).toHaveLength(WHO_LOCKED);
    // The same picture twice (a profile photo that is also on the Showcase) shows once.
    const twice = whoSlides({ portrait: null, photos: [{ key: "p", kind: "photo", src: "/x", alt: "" }], made: [], showcase: [{ key: "s", kind: "showcase", src: "/x", alt: "" }], locked: [] });
    expect(twice).toHaveLength(1);
  });
});

describe("who they are, and what's locked", () => {
  it("a plan without pictures: the portrait, then the blurred tiles of them, each the way to the subscription", async () => {
    const me = await admin();
    const p = await post(me);
    const d = await whoDetails(t.db, me, A.id, { media: false, tiles: true, showcase: null });
    expect(d).toMatchObject({ id: A.id, name: A.name, house: true, mine: false, nights: 0, page: `/after-dark/characters/${A.id}` });
    expect(d!.bio.length).toBeGreaterThan(0);
    expect(d!.slides.map((x) => x.kind)).toEqual(["portrait", "locked"]);
    expect(d!.slides[1].src).toBe(`/api/after-dark/preview/${p}`);
    expect(d!.locked).toEqual({ count: 1, href: WHO_SUBSCRIBE });
    // Where the tiles aren't allowed: the count, no tiles.
    const words = await whoDetails(t.db, me, A.id, { media: false, tiles: false, showcase: null });
    expect(words!.slides.map((x) => x.kind)).toEqual(["portrait"]);
    expect(words!.locked).toEqual({ count: 1, href: WHO_SUBSCRIBE });
    // Nothing of them to lock: nothing said.
    expect((await whoDetails(t.db, me, B.id, { media: false, tiles: true, showcase: null }))!.locked).toBeNull();
  });

  it("a plan with pictures: their own pictures of them, then the Showcase's, nothing locked", async () => {
    const me = await admin();
    const p = await post(await admin());
    const v = await showcaseViewer(t.db, new Request(`${BASE_URL}/x`, { headers: { cookie: cookieOf(me) } }));
    const d = await whoDetails(t.db, me, A.id, { media: true, tiles: false, showcase: v });
    expect(d!.slides.map((x) => x.kind)).toEqual(["portrait", "showcase"]);
    expect(d!.slides[1].src).toContain(p);
    expect(d!.slides[1].src).toMatch(/size=tile$/);
    expect(d!.locked).toBeNull();
    // Their own picture, published: once, as theirs.
    const mine = await post(me);
    const again = await whoDetails(t.db, me, A.id, { media: true, tiles: false, showcase: v });
    expect(again!.slides.map((x) => x.kind)).toEqual(["portrait", "made", "showcase"]);
    expect(again!.slides.some((x) => x.src.includes(mine))).toBe(false);
  });

  it("their profile photos come after the portrait, PG and approved only", async () => {
    const me = await admin();
    for (const [id, rating, status] of [
      ["asset-ok", "pg", "approved"],
      ["asset-sug", "suggestive", "approved"],
      ["asset-wait", "pg", "pending"],
    ]) {
      await t.db.query(
        `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'x', $3, $4, $5)`,
        [id, A.id, `/api/assets/${id}`, status, rating],
      );
      await t.db.query(`insert into profile_photos (character_id, picture_id, asset_id, owner_id) values ($1, $2, $2, $3)`, [A.id, id, me]);
    }
    const d = await whoDetails(t.db, me, A.id, { media: true, tiles: false, showcase: null });
    expect(d!.slides.map((x) => [x.kind, x.src])).toEqual([
      ["portrait", expect.any(String)],
      ["photo", "/api/assets/asset-ok"],
    ]);
  });

  it("nobody After Dark may not pair with them", async () => {
    const me = await admin();
    expect(await whoDetails(t.db, me, "no-such-character", { media: true, tiles: false, showcase: null })).toBeNull();
  });
});

describe("the route", () => {
  it("is for whoever Step in is open to; an admin can see it as a free taste does", async () => {
    const me = await admin();
    await post(await admin());
    const res = await ask(me, `id=${A.id}`);
    expect(res.status).toBe(200);
    const open = await res.json();
    expect(open.locked).toBeNull();
    expect(open.slides.map((x: WhoSlide) => x.kind)).toEqual(["portrait", "showcase"]);
    const asTaste = await (await ask(me, `id=${A.id}&locked=1`)).json();
    expect(asTaste.locked).toEqual({ count: 1, href: WHO_SUBSCRIBE });
    expect(asTaste.slides.map((x: WhoSlide) => x.kind)).toEqual(["portrait", "locked"]);
    expect((await ask(me, "id=nobody")).status).toBe(404);
  });

  it("is not found while Step in is admins only, and `locked` is no way around it", async () => {
    const sub = randomUUID();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    expect((await ask(sub, `id=${A.id}`)).status).toBe(404);
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
    const res = await ask(sub, `id=${A.id}&locked=1`);
    expect(res.status).toBe(200);
  });
});

describe("the carousel", () => {
  it("one picture at a time, where you are, ‹ ›, and a locked one under a 🔒 to the subscription", async () => {
    const slides: WhoSlide[] = [
      { key: "portrait", kind: "portrait", src: "/cast/a.webp", alt: "A" },
      { key: "photo:1", kind: "photo", src: "/api/assets/1", alt: "A photo of A" },
      { key: "locked:p", kind: "locked", src: "/api/after-dark/preview/p", alt: "" },
    ];
    const out = await html(createElement(WhoCarousel, { slides, name: "A", lockedHref: WHO_SUBSCRIBE, first: createElement("img", { src: "/cast/a.webp", className: "avatar" }) }));
    expect(out).toContain('aria-label="Pictures of A"');
    expect(out.match(/data-step-in-slide="/g)).toHaveLength(3);
    expect(out).toMatch(/<span class="ad-si-carousel-at" aria-live="polite">1 \/ 3<\/span>/);
    expect(out).toMatch(/<button type="button" class="ad-si-carousel-go ad-si-carousel-prev" aria-label="Previous picture" disabled="">/);
    expect(out).toContain(`<a class="ad-si-locked" href="${WHO_SUBSCRIBE.replace("&", "&amp;")}" data-step-in-locked="true"><img src="/api/after-dark/preview/p" alt=""`);
    expect(out).toContain("With the subscription");
    // One picture: just it, no carousel.
    const one = await html(createElement(WhoCarousel, { slides: slides.slice(0, 1), name: "A", lockedHref: null, first: createElement("img", { src: "/cast/a.webp" }) }));
    expect(one).not.toContain("data-step-in-carousel");
  });
});

describe("the page, opened on someone (?with=)", () => {
  const signIn = (id: string) => {
    const c = signedInCookie(id).split(";")[0];
    jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
    jar.cookies.set(ADULT_COOKIE, "1");
  };
  const page = async (params: Record<string, string>) => html(await StepInSetupPage({ searchParams: Promise.resolve(params) }));

  it("draws who they are and their pictures with the page; as a taste, the locked ones and the way to them", async () => {
    const me = await admin();
    await post(await admin());
    signIn(me);
    const open = await page({ with: A.id });
    const card = open.slice(open.indexOf(`data-step-in-who="${A.id}"`));
    expect(open).toContain(`class="ad-si-chosen ad-si-chosen-who" data-step-in-who="${A.id}"`);
    expect(card).toContain("data-step-in-carousel");
    expect(card).toMatch(/<span class="ad-si-carousel-at" aria-live="polite">1 \/ 2<\/span>/);
    expect(card).toContain("data-step-in-about");
    expect(card).toContain("House cast");
    expect(card).toMatch(/data-step-in-bio="true">[^<]{20,}/);
    expect(card).toContain(`href="/after-dark/characters/${A.id}"`);
    expect(card).not.toContain("data-step-in-locked");
    const taste = await page({ with: A.id, locked: "1" });
    const locked = taste.slice(taste.indexOf(`data-step-in-who="${A.id}"`));
    expect(locked).toContain('data-step-in-slide="locked"');
    expect(locked).toMatch(/data-step-in-locked-line="true">.*1 picture of [^ ]+ comes with the subscription/);
    // Nobody picked: no card, nothing asked for.
    expect(await page({})).not.toContain("data-step-in-about");
  });
});
