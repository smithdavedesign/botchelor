// The Character.AI rescue front door (2026-11-14): the home hero's "Bring your character" line for a visitor with no
// character, /import?from=cai with its three steps, the events the page sends, the landing's words, and how search
// engines hear of both pages (sitemap priority, IndexNow once).
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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as beacon } from "@/app/api/e/route";
import AlternativePage from "@/app/alternatives/AlternativePage";
import ImportPage, { generateMetadata } from "@/app/import/page";
import { alternativeBySlug } from "@/lib/alternatives";
import { loadEngagement, resetBudgetsForTests } from "@/lib/engagement";
import { CAI_SOURCE, IMPORT_CAI_PATH, IMPORT_PATH } from "@/lib/import-character";
import { importDoor, importedEvent, importFailedEvent } from "@/lib/import-events";
import { changedLandingUrls, LANDING_CHANGES, recentPublicUrls } from "@/lib/indexnow";
import { staticSitemap } from "@/lib/seo";
import { api, BASE_URL, newUserCookie, startTestDb, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetBudgetsForTests();
  jar.cookies.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};
const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the home hero's rescue line", () => {
  it("offers the import door on the page as it was (HOME_OPEN=0), on the hero and in the phone bar; a first visit's one screen keeps to one field", async () => {
    as(null);
    const Home = (await import("@/app/page")).default;
    // The one screen (2026-11-21): seven first steps were too many, and this door had one click from home in a month.
    // It stays on /everything, in the outreach posts' own links, and on the old page.
    const first = text(renderToStaticMarkup(await Home(sp())));
    expect(first).not.toContain("Leaving Character.AI?");
    expect(first).not.toContain("hero-import");
    vi.stubEnv("HOME_OPEN", "0");
    const html = text(renderToStaticMarkup(await Home(sp())));
    vi.unstubAllEnvs();
    expect(IMPORT_CAI_PATH).toBe("/import?from=cai");
    expect(html).toContain("Leaving Character.AI?");
    // Both links carry the same name, so the funnel reads them as one door.
    expect(html.split('data-track="hero-import"').length - 1).toBe(2);
    expect(html.split(`href="${IMPORT_CAI_PATH}"`).length - 1).toBe(2);
    // The sample line stays, above it.
    expect(html.indexOf("Start from a sample character")).toBeLessThan(html.indexOf("Leaving Character.AI?"));
  });

  it("says nothing of it to a creator, whose hero has no sample line either", async () => {
    const owner = newUserCookie();
    expect((await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).status).toBe(201);
    as(owner);
    const Home = (await import("@/app/page")).default;
    const html = renderToStaticMarkup(await Home(sp()));
    expect(html).not.toContain("hero-import");
    expect(html).not.toContain("Leaving Character.AI?");
  });
});

describe("/import?from=cai", () => {
  it("shows the three steps and the promise; the plain page is unchanged", async () => {
    const cai = text(renderToStaticMarkup(await ImportPage(sp({ from: CAI_SOURCE }))));
    expect(cai).toContain("<h1>Bring your Character.AI character to Botchelor</h1>");
    const steps = cai.match(/<ol class="import-how-list import-cai-steps"[^>]*>(.*?)<\/ol>/)![1];
    expect(steps.split("<li>").length - 1).toBe(3);
    expect(steps).toMatch(/Edit character/);
    expect(steps).toMatch(/<code>Name:<\/code>/);
    expect(steps).toMatch(/<code>Greeting:<\/code>/);
    expect(steps).toMatch(/<code>Definition:<\/code>/);
    expect(cai).toContain("Then a speed date with the cast, right away.");
    expect(cai).toContain("Botchelor isn't connected to Character.AI.");
    // Nominative only, and nothing about the other company's affairs.
    expect(cai).not.toMatch(/official|partner|affiliated|endorsed|bankrupt|chapter 11|shut(?:ting)? down/i);
    // The other formats stay on the page.
    expect(cai).toMatch(/first_mes/);
    expect(cai).toMatch(/SillyTavern/);

    const plain = text(renderToStaticMarkup(await ImportPage(sp())));
    expect(plain).toContain("<h1>Bring a character you made in another app</h1>");
    expect(plain).not.toContain("import-cai-steps");
    expect(plain).not.toContain("Leaving Character.AI?");
    // An unknown or malformed door is the plain page too.
    expect(text(renderToStaticMarkup(await ImportPage(sp({ from: "https://x.example" }))))).not.toContain("import-cai-steps");
  });

  // The 2026-11-22 audit: on a phone the band's clip and a 60-word lede put the paste box on the second screen.
  it("puts the paste box right under a short heading band, with no clip in it", async () => {
    for (const q of [sp(), sp({ from: CAI_SOURCE })]) {
      const html = text(renderToStaticMarkup(await ImportPage(q)));
      expect(html).toContain('<header class="set-hero set-hero--booth is-flush" data-set="booth">');
      expect(html).not.toContain("home-clip");
      expect(html.indexOf('id="import-text"')).toBeGreaterThan(html.indexOf("</header>"));
    }
    const lede = /<p class="lede">(.*?)<\/p>/.exec(text(renderToStaticMarkup(await ImportPage(sp()))))![1].replace(/<[^>]+>/g, "");
    expect(lede.split(/\s+/).length).toBeLessThanOrEqual(30);
  });

  it("has its own title, on the same canonical address", async () => {
    const meta = await generateMetadata(sp({ from: CAI_SOURCE }));
    expect(meta.title).toBe("Bring your Character.AI character to Botchelor");
    expect(meta.alternates?.canonical).toBe(IMPORT_PATH);
    expect((await generateMetadata(sp())).title).toBe("Bring your character from another app · Botchelor");
  });
});

describe("the import events", () => {
  it("name the format, who read it, whether it can date, and the door", () => {
    expect(importedEvent("labelled", null, true, "cai")).toEqual({ name: "imported", props: { format: "labelled", read_by: "parser", ready: true, from: "cai" } });
    expect(importedEvent("free_text", "model", false)).toEqual({ name: "imported", props: { format: "free_text", read_by: "model", ready: false, from: null } });
    expect(importedEvent("chara_card_v2", "fallback", false, "")).toEqual({ name: "imported", props: { format: "chara_card_v2", read_by: "fallback", ready: false, from: null } });
    expect(importFailedEvent("minor", "cai")).toEqual({ name: "import_failed", props: { reason: "minor", from: "cai" } });
    expect(importFailedEvent("storage")).toEqual({ name: "import_failed", props: { reason: "storage", from: null } });
  });

  it("read the door from the address: a short word or nothing", () => {
    expect(importDoor("cai")).toBe("cai");
    expect(importDoor(["cai", "x"])).toBe("cai");
    expect(importDoor(undefined)).toBeNull();
    expect(importDoor("")).toBeNull();
    expect(importDoor("https://evil.example/?x")).toBeNull();
    expect(importDoor("a".repeat(40))).toBeNull();
  });

  it("are kept by the beacon with their props, and import_opened sits in the events table", async () => {
    const V = "11111111-1111-4111-8111-111111111111";
    const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ok = importedEvent("labelled", null, true, "cai");
    const bad = importFailedEvent("minor", "cai");
    const res = await beacon(
      new Request(`${BASE_URL}/api/e`, {
        method: "POST",
        headers: { "content-type": "text/plain", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" },
        body: JSON.stringify({
          v: V,
          s: S,
          src: { utm_source: "reddit", utm_campaign: "cai_rescue" },
          events: [
            { e: "page_view", path: "/import?from=cai" },
            { e: "import_opened", path: "/import?from=cai" },
            { e: ok.name, path: "/import?from=cai", props: ok.props },
            { e: bad.name, path: "/import?from=cai", props: bad.props },
          ],
        }),
      }),
    );
    expect(res.status).toBe(204);
    const rows = (await t.db.query<{ event: string; path: string; props: Record<string, unknown> }>(`select event, path, props from web_events order by id`)).rows;
    expect(rows.map((r) => r.event)).toEqual(["page_view", "import_opened", "imported", "import_failed"]);
    // The query string never reaches the table; the door rides the props instead.
    expect(rows.every((r) => r.path === "/import")).toBe(true);
    expect(rows[2].props).toEqual({ format: "labelled", read_by: "parser", ready: true, from: "cai" });
    expect(rows[3].props).toEqual({ reason: "minor", from: "cai" });
    const day = new Date().toISOString().slice(0, 10);
    const e = await loadEngagement(t.db, { from: day, to: day, includeOurs: true, host: "all" });
    expect(Object.fromEntries(e.events.map((r) => [r.key, r.count]))).toMatchObject({ import_opened: 1, imported: 1, import_failed: 1 });
    expect(e.sources.find((s) => s.source === "reddit")?.visitors).toBe(1);
  });
});

describe("the Character.AI landing", () => {
  it("speaks to moving now, sends people through the rescue door first, and keeps its FAQ words", () => {
    const alt = alternativeBySlug("character-ai")!;
    expect(alt.lede).toMatch(/new home for the characters you made/);
    expect(alt.now).toMatch(/speed date|first date/);
    expect(alt.now).toMatch(/texts you/);
    expect(alt.importHref).toBe(IMPORT_CAI_PATH);
    const html = text(renderToStaticMarkup(createElement(AlternativePage, { alt })));
    const button = html.indexOf(`href="${IMPORT_CAI_PATH}"`);
    expect(button).toBeGreaterThan(0);
    expect(button).toBeLessThan(html.indexOf("What your character does here"));
    expect(html).toContain('href="/import"');
    expect(html).toContain("Copy its creator fields (Name, Tagline, Description, Greeting, Definition)");
    expect(html).not.toMatch(/bankrupt|chapter 11|shut(?:ting)? down/i);
    // The switching pages link each other, never themselves.
    expect(html).toContain('href="/alternatives/janitor-ai"');
    expect(html).not.toContain('href="/alternatives/character-ai"');
    // The other landings keep the plain door.
    expect(alternativeBySlug("janitor-ai")!.importHref).toBeUndefined();
  });
});

describe("how search engines hear of the door", () => {
  it("ranks /import and the landing with the agents page in the sitemap", () => {
    const map = new Map(staticSitemap("https://botchelor.com").map((e) => [e.url, e.priority]));
    expect(map.get("https://botchelor.com/import")).toBe(0.8);
    expect(map.get("https://botchelor.com/alternatives/character-ai")).toBe(0.8);
    expect(map.get("https://botchelor.com/agents")).toBe(0.8);
    expect(map.get("https://botchelor.com/shop")).toBe(0.5);
  });

  it("IndexNow hears of a rewritten landing once: in the daily window that covers its date, not before or after", async () => {
    const base = "https://botchelor.com";
    const changed = new Date("2026-11-15T00:00:00Z");
    for (const c of LANDING_CHANGES) expect(new Date(c.changedAt).getTime()).toBeGreaterThan(0);
    // The job at 16:20 UTC the next day: since = 26 hours before.
    const window = (runAt: string) => changedLandingUrls(new Date(new Date(runAt).getTime() - 26 * 3600_000), base, new Date(runAt), [{ path: "/import", changedAt: changed.toISOString() }]);
    expect(window("2026-11-14T16:20:00Z")).toEqual([]);
    expect(window("2026-11-15T16:20:00Z")).toEqual([`${base}/import`]);
    expect(window("2026-11-16T16:20:00Z")).toEqual([]);
    expect(changedLandingUrls(new Date("2026-11-14T14:20:00Z"), base, new Date("2026-11-15T16:20:00Z"))).toEqual([`${base}/import`, `${base}/alternatives/character-ai`]);
    // The daily job's own list carries them through recentPublicUrls.
    const recent = await recentPublicUrls(t.db, new Date("2026-11-14T14:20:00Z"), base, new Date("2026-11-15T16:20:00Z"));
    expect(recent).toEqual(expect.arrayContaining([`${base}/import`, `${base}/alternatives/character-ai`]));
    expect(await recentPublicUrls(t.db, new Date("2026-11-20T14:20:00Z"), base, new Date("2026-11-21T16:20:00Z"))).not.toContain(`${base}/import`);
  });
});
