import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// After Dark's frame (the design kit's After Dark header, 2026-11-12; its doors 2026-11-15, lib/adult/doors.ts): on its
// own host the header is Scenes · Studio · Gallery · Episodes, and the account as an icon after them (the Showcase door
// became a room of the Gallery on 2026-11-18: it took them out of After Dark, app/after-dark/GalleryTabs.tsx). Who's in
// and the Studio are on the Studio door's page (/after-dark/characters sends there); the writer and privacy on Account.
// Nothing dropped: each is one tap from the header, and the hub's row carries them where the header is the show's.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), path: "/after-dark", adOnly: false }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
// After Dark's own host, as app/after-dark/page.tsx asks it (the real switch also needs the host's address and env).
vi.mock("@/lib/after-dark-host", async (original) => ({
  ...(await original<typeof import("@/lib/after-dark-host")>()),
  afterDarkOnly: () => jar.adOnly,
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => jar.path,
}));
import { renderToStaticMarkup } from "react-dom/server";
import AfterDarkAccount from "@/app/after-dark/account/page";
import AfterDarkCharacters from "@/app/after-dark/characters/page";
import AfterDarkStudio from "@/app/after-dark/studio/page";
import AfterDarkHome from "@/app/after-dark/page";
import Nav from "@/app/Nav";
import { claimAdmin } from "@/lib/admins";
import { setAdultSwitch } from "@/lib/adult/characters";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  jar.path = "/after-dark";
  jar.adOnly = false;
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.unstubAllEnvs();
});

async function admin() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  const ines = randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values ($1, $2, false, 'Ines Valdecasas-Rook', 31, 'Restores clocks.', '["dry"]'::jsonb, 'x', 'x')`,
    [ines, id],
  );
  return { id, ines };
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The `<a>` for this href is the current page. */
const current = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].some((m) => m[0].includes(`href="${href}"`) && m[0].includes('aria-current="page"'));
const navLinks = (html: string) => [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);

describe("the header on After Dark's host", () => {
  const nav = (doors: { studio: boolean; showcase: boolean }) =>
    renderToStaticMarkup(createElement(Nav, { tokens: 0, meter: "none", adHost: true, afterDark: true, hasCharacter: true, adDoors: doors, showHref: "https://show.example" }));

  it("is Scenes, Studio, Gallery and Episodes, then the account, with the page you're on marked", () => {
    jar.path = "/after-dark/studio";
    const html = nav({ studio: true, showcase: true });
    expect(navLinks(html).map(([, label]) => label)).toEqual(expect.arrayContaining(["Scenes", "Studio", "Gallery", "Episodes", "Account"]));
    expect(current(html, "/after-dark/studio")).toBe(true);
    expect(current(html, "/after-dark")).toBe(false);
    // David, 2026-11-18: no door out to the show's showcase ("it takes you out of after dark"); it's the Gallery's room.
    expect(navLinks(html).map(([, label]) => label)).not.toContain("Showcase");
    expect(html).not.toContain("side=after_dark");
    expect(html).not.toContain('href="https://show.example/showcase');
    // Shorts and Characters are Episodes and Studio now, at the same addresses (Characters sends to Studio).
    expect(navLinks(html).map(([, label]) => label)).not.toContain("Shorts");
    expect(html).toContain('href="/after-dark/shorts"');
    // The show's own links stay on the show.
    expect(navLinks(html).map(([href]) => href)).not.toContain("/watch");
  });

  it("where the Studio isn't open to them, the door says Characters, and there's no Showcase", () => {
    jar.path = "/after-dark/characters";
    const html = nav({ studio: false, showcase: false });
    const labels = navLinks(html).map(([, label]) => label);
    expect(labels).toContain("Characters");
    expect(labels).not.toContain("Studio");
    expect(labels).not.toContain("Showcase");
    expect(current(html, "/after-dark/studio")).toBe(true);
  });

  it("marks Gallery on its Showcase room and that room's reels, not Scenes", () => {
    for (const path of ["/after-dark/showcase", "/after-dark/showcase/reels"]) {
      jar.path = path;
      const html = nav({ studio: true, showcase: true });
      expect(current(html, "/after-dark/gallery"), path).toBe(true);
      expect(current(html, "/after-dark"), path).toBe(false);
    }
  });

  it("marks Scenes on a pair's night, the Studio door on a Studio, and Account on the tokens page", () => {
    jar.path = `/after-dark/${HOUSE_CHARACTERS[0].id}/${HOUSE_CHARACTERS[1].id}`;
    expect(current(nav({ studio: true, showcase: false }), "/after-dark")).toBe(true);
    jar.path = `/after-dark/studio/${HOUSE_CHARACTERS[0].id}`;
    expect(current(nav({ studio: true, showcase: false }), "/after-dark/studio")).toBe(true);
    expect(current(nav({ studio: true, showcase: false }), "/after-dark")).toBe(false);
    jar.path = "/after-dark/tokens";
    expect(current(nav({ studio: true, showcase: false }), "/after-dark/account")).toBe(true);
  });
});

describe("the Studio door", () => {
  it("has a card per character whose Studio is theirs once In, then who's in, theirs Out until switched", async () => {
    const { id, ines } = await admin();
    let html = renderToStaticMarkup(await AfterDarkStudio());
    expect(html).toContain("<h1>Studio</h1>");
    expect(html).toContain("data-whos-in");
    // One "Who's in" heading (the switches' card), holding the anchor the pair page links to; its own rows, not the
    // Account page's tiles that ran its states into the next column (David's screenshot, 2026-11-15).
    expect(html.match(/<h2[^>]*>Who&#x27;s in<\/h2>/g)).toHaveLength(1);
    expect(html).toContain('<h2 id="ad-whos-in">');
    expect(html).toContain('class="ad-whos-in-row"');
    expect(html).not.toContain("account-character");
    expect(html).toContain("Ines Valdecasas-Rook");
    expect(html).toContain("1 of yours is Out.");
    expect(html).not.toContain(`href="/after-dark/studio/${ines}"`);
    await setAdultSwitch(t.db, id, ines, true);
    html = renderToStaticMarkup(await AfterDarkStudio());
    expect(html).toContain(`data-studio-card="${ines}"`);
    expect(html).toContain(`href="/after-dark/studio/${ines}"`);
    expect(html).toContain("Pick their face first");
    expect(html).not.toContain("of yours is Out");
  });

  it("says what to do when there's nobody to switch", async () => {
    const id = randomUUID();
    await claimAdmin(t.db, id);
    const c = signedInCookie(id);
    jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
    setSeasonCastForTests([]);
    const html = renderToStaticMarkup(await AfterDarkStudio());
    expect(html).toContain("data-whos-in-empty");
    expect(html).toContain('href="/create"');
  });

  it("is where the old Characters page sends", () => {
    let digest = "";
    try {
      AfterDarkCharacters();
    } catch (e) {
      digest = String((e as { digest?: string }).digest);
    }
    expect(digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/after-dark\/studio;/);
  });
});

describe("Account", () => {
  it("has the subscription and tokens, privacy (the theater's #privacy link lands on it), the writer, and the show's Account", async () => {
    await admin();
    const html = renderToStaticMarkup(await AfterDarkAccount());
    expect(html).toContain("Open to you as an admin: nothing to pay.");
    expect(html).toContain('href="/after-dark/tokens"');
    expect(html).toMatch(/<div id="privacy"><details class="card settings ad-privacy"/);
    expect(html).toContain('id="writer"');
    expect(html).toContain('href="/account"');
  });
});

describe("the hub", () => {
  it("drops what moved, and its row carries the header's doors and Account where the header is the show's", async () => {
    await admin();
    const html = renderToStaticMarkup(await AfterDarkHome({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("ad-hub-settings");
    expect(html).not.toContain('id="privacy"');
    expect(html).toContain("<h2>Scenes</h2>");
    for (const href of ["/after-dark/studio", "/after-dark/gallery", "/after-dark/shorts", "/after-dark/account", "#shared", "/"])
      expect(html).toContain(`href="${href}"`);
    // The showcase's After Dark side is a room of the Gallery now, not a button here that left After Dark.
    expect(html).not.toContain("side=after_dark");
    expect(text(html)).not.toContain("🌟 Showcase");
    expect(text(html)).toContain("Episodes");
  });

  it("on After Dark's own host, leaves the header's pages to the header", async () => {
    jar.adOnly = true;
    await admin();
    const row = renderToStaticMarkup(await AfterDarkHome({ searchParams: Promise.resolve({}) })).match(/<nav class="ad-hub-links"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(row).toContain('href="#shared"');
    expect(row).toContain("Back to the show");
    expect(row).not.toContain('href="/after-dark/shorts"');
    expect(row).not.toContain('href="/after-dark/account"');
  });
});

// The home's "Your latest" (2026-11-15): what they made last, a tap from the Gallery; nothing when there's nothing.
describe("the home's latest", () => {
  const home = async () => renderToStaticMarkup(await AfterDarkHome({ searchParams: Promise.resolve({}) }));

  it("shows their newest pictures and videos, marked new, each opening the Gallery on its tab", async () => {
    const { id } = await admin();
    expect(await home()).not.toContain("Your latest");
    const add = (mid: string, kind: string, at: string) =>
      t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, created_at) values ($1, $2, $3, $4, $5, 'x', 'image/png', 'ready', $6)`, [
        mid,
        id,
        HOUSE_CHARACTERS[0].id,
        HOUSE_CHARACTERS[1].id,
        kind,
        at,
      ]);
    await add("old-picture", "scene", "2026-01-01T00:00:00Z");
    await add("new-video", "video", new Date().toISOString());
    await add("a-face", "baseline", new Date().toISOString());
    const html = await home();
    expect(html).toContain("Your latest");
    expect(html).toContain('data-latest-item="new-video"');
    expect(html).toContain('data-latest-item="old-picture"');
    expect(html).not.toContain('data-latest-item="a-face"');
    expect(html).toContain('href="/after-dark/gallery?tab=videos"');
    expect(html).toContain('href="/after-dark/gallery?tab=pictures"');
    expect(html).toContain("New video");
  });
});

// The kit's After Dark home: a hero that says what it is, and one tap back into the latest night.
describe("the home's hero", () => {
  const home = async () => renderToStaticMarkup(await AfterDarkHome({ searchParams: Promise.resolve({}) }));

  it("with no night under way, asks for a pair, and shows no latest night", async () => {
    await admin();
    const html = await home();
    expect(html).toContain("data-ad-hero");
    expect(html).toContain('<a class="button" href="#scenes">Pick a pair</a>');
    expect(html).not.toContain("data-latest-night");
    expect(html).toContain('<section id="scenes"><h2>Scenes</h2>');
  });

  it("picks up the latest played night, and leads into the scenes", async () => {
    const { id } = await admin();
    const [A, B, C] = HOUSE_CHARACTERS;
    const scene = (sid: string, a: string, b: string, text: string, at: string) =>
      t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines, updated_at) values ($1, $2, $3, $4, $5::jsonb, $6)`, [
        sid,
        id,
        a,
        b,
        JSON.stringify([{ who: "a", text: "Hello." }, { who: "b", text }]),
        at,
      ]);
    await scene("older", A.id, C.id, "An older night.", "2026-11-01T00:00:00Z");
    // A pair's scene is keyed by its two ids in order (this season's pair: the two in the cast).
    const [x, y] = [A.id, B.id].sort();
    await scene("newer", x, y, "Stay a while.", "2026-11-10T00:00:00Z");
    const html = await home();
    const path = `/after-dark/${x}/${y}`;
    expect(html).toMatch(new RegExp(`<a class="button" data-latest-night="${path}" title="[^"]+" href="${path}">▶ Pick up where they left off</a>`));
    // The hero leads into the scenes, the row of other pages under them.
    expect(html.indexOf("data-ad-hero")).toBeLessThan(html.indexOf('<section id="scenes">'));
    expect(html.indexOf('<section id="scenes">')).toBeLessThan(html.indexOf('class="ad-hub-links"'));
  });
});
