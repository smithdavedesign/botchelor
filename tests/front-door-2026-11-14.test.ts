// The front door (2026-11-14, "build 1-7": item 5): the hero says what the product is now, "Give your character a love
// life.", and the old line ("Send your OC on a blind date. Then just watch.") is gone from the page, the gate's backdrop,
// the share cards and the site description.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { SHARE_IMAGE_ALT, SITE_DESCRIPTION } from "@/lib/seo";
import { startTestDb } from "./helpers";

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
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const OLD = "Send your OC on a blind date";

describe("the hero", () => {
  it("the page as it was (HOME_OPEN=0) promises your character a love life, keeps the three doors and the trust line", async () => {
    vi.stubEnv("HOME_OPEN", "0");
    const Home = (await import("@/app/page")).default;
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    vi.unstubAllEnvs();
    expect(html).toContain('<p class="kicker">Your character&#x27;s love life</p>');
    expect(html).toContain('<h1 class="hero-title">Give your character a love life.</h1>');
    expect(html).toContain("They go on blind dates nobody steers, text you how it went, and take your advice into the next one.");
    expect(html).toContain("free, no");
    expect(html).toContain('href="/create">Make your character</a>');
    // One "Make your character" above the fold and one at the end (the 2026-11-20 mobile audit, A2).
    expect(html).toContain('id="hero-cta"');
    expect(html.match(/>Make your character<\/a>/g)?.length).toBe(2);
    expect(html.indexOf('class="cta-row cta-final"')).toBeGreaterThan(html.indexOf('class="faq"'));
    expect(html).toContain('href="/create?sample=1"');
    expect(html).toContain("Bring your character");
    expect(html).toContain('<p class="trust-micro">Fictional characters only, no real people. Every date is written by AI.</p>');
    expect(html).not.toContain(OLD);
    expect(html).not.toContain("For OC roleplayers");
  });

  it("a first visit gets one screen with one job, and a page that ends on its questions (2026-11-21)", async () => {
    const Home = (await import("@/app/page")).default;
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    // The screen: the promise, the sentence box and the clip. The trust line is on it.
    expect(html).toContain('class="home-open home-open--one');
    expect(html).toContain('<form class="home-express" action="/create" method="get">');
    expect(html).toContain('class="home-open-clip"');
    expect(html).toContain('<p class="home-open-fine">Fictional characters only, no real people. Every date is written by AI.</p>');
    // No second hero, and none of the seven first steps but the box and the way to watch.
    expect(html).not.toContain("Your character&#x27;s love life");
    expect(html).not.toContain('id="hero-cta"');
    expect(html).not.toContain('href="/create?sample=1"');
    expect(html).not.toContain("Bring your character");
    expect(html).not.toContain('data-track="open-watch"');
    expect(html).not.toContain("phone-action-bar");
    // Tonight's workings, the cast, the map and the tools wait until they have a character (or are a click away in the
    // header and the footer): no band, no vote, no cast grid, no other show's teaser.
    expect(html).not.toContain("tonight-band");
    expect(html).not.toContain('id="situation"');
    expect(html).not.toContain("This season&#x27;s cast");
    expect(html).not.toContain("home-shows-link");
    expect(html).not.toContain('href="/graph"');
    expect(html).not.toContain('href="/swipe"');
    // What stays under the screen: how it works, three questions, and the way in again, once.
    expect(html).toContain("<h2>How it works</h2>");
    expect(html).toContain('class="faq"');
    expect(html.match(/>Make your character<\/a>/g)?.length).toBe(1);
    expect(html.indexOf('class="cta-row cta-final"')).toBeGreaterThan(html.indexOf('class="faq"'));
    expect(html).not.toContain(OLD);
  });

  it("the gate's backdrop, the share cards and the site description say the same", () => {
    expect(SITE_DESCRIPTION).toContain("Give your original character a love life");
    expect(SITE_DESCRIPTION).not.toContain(OLD);
    expect(SHARE_IMAGE_ALT).toContain("give your character a love life");
    // The site card is drawn in app/site-card.tsx (app/opengraph-image.tsx and app/share-card.png/route.tsx serve it).
    for (const file of ["app/gate/page.tsx", "app/site-card.tsx", "app/characters/[id]/opengraph-image.tsx", "app/page.tsx"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toContain(OLD);
      expect(src, file).toContain("Give your character a love life.");
    }
  });
});
