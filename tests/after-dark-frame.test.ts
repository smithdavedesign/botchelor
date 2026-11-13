import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// After Dark's frame (the design kit's After Dark header, 2026-11-12): on its own host the header is Scenes · Shorts ·
// Gallery · Characters · Account. Who's in and the Studio moved from the hub to Characters; the writer and privacy to
// Account. Nothing dropped: each is one tap from the header, and the hub's row carries them where the header is the show's.
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
  it("is Scenes, Shorts, Gallery, Characters and Account, with the page you're on marked", () => {
    jar.path = "/after-dark/characters";
    const html = renderToStaticMarkup(createElement(Nav, { tokens: 0, meter: "none", adHost: true, hasCharacter: true }));
    const links = navLinks(html).filter(([href]) => href.startsWith("/after-dark"));
    expect(links.map(([, label]) => label)).toEqual(expect.arrayContaining(["Scenes", "Shorts", "Gallery", "Characters", "Account"]));
    expect(current(html, "/after-dark/characters")).toBe(true);
    expect(current(html, "/after-dark")).toBe(false);
    // The show's own links stay on the show.
    expect(navLinks(html).map(([href]) => href)).not.toContain("/watch");
  });

  it("marks Scenes on a pair's night, and Account on the tokens page", () => {
    jar.path = `/after-dark/${HOUSE_CHARACTERS[0].id}/${HOUSE_CHARACTERS[1].id}`;
    expect(current(renderToStaticMarkup(createElement(Nav, { tokens: 0, meter: "none", adHost: true, hasCharacter: true })), "/after-dark")).toBe(true);
    jar.path = "/after-dark/tokens";
    expect(current(renderToStaticMarkup(createElement(Nav, { tokens: 0, meter: "none", adHost: true, hasCharacter: true })), "/after-dark/account")).toBe(true);
  });
});

describe("Characters", () => {
  it("has who's in, theirs Out until switched, and each one's Studio once In", async () => {
    const { id, ines } = await admin();
    let html = renderToStaticMarkup(await AfterDarkCharacters());
    expect(html).toContain("data-whos-in");
    expect(html).toContain("Ines Valdecasas-Rook");
    expect(html).toContain("1 of yours is Out.");
    expect(html).not.toContain(`href="/after-dark/studio/${ines}"`);
    await setAdultSwitch(t.db, id, ines, true);
    html = renderToStaticMarkup(await AfterDarkCharacters());
    expect(html).toContain(`href="/after-dark/studio/${ines}"`);
    expect(html).not.toContain("of yours is Out");
  });

  it("says what to do when there's nobody to switch", async () => {
    const id = randomUUID();
    await claimAdmin(t.db, id);
    const c = signedInCookie(id);
    jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
    setSeasonCastForTests([]);
    const html = renderToStaticMarkup(await AfterDarkCharacters());
    expect(html).toContain("data-whos-in-empty");
    expect(html).toContain('href="/create"');
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
  it("drops what moved, and its row carries Characters and Account where the header is the show's", async () => {
    await admin();
    const html = renderToStaticMarkup(await AfterDarkHome({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("ad-hub-settings");
    expect(html).not.toContain('id="privacy"');
    expect(html).toContain("<h2>Scenes</h2>");
    for (const href of ["/after-dark/shorts", "/after-dark/gallery", "/after-dark/characters", "/after-dark/account", "#shared", "/"])
      expect(html).toContain(`href="${href}"`);
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
