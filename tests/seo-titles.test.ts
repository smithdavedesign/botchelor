/**
 * What a search result shows of the show (2026-11-22 audit): titles that say "AI", the word in every search in this
 * space; descriptions that fit a result; the brand once per title; the RSS feed and llms.txt named on every page; and
 * structured data for the tools, the portraits and the logo.
 */
import { readFileSync } from "node:fs";
import type { Metadata } from "next";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The root layout reads the viewer from next/headers (an anonymous visitor here), and its nav the page it's on.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import RootLayout, { metadata as rootMetadata } from "@/app/layout";
import ShipPage, { generateMetadata as shipMetadata } from "@/app/ship/[a]/[b]/page";
import { ALTERNATIVES } from "@/lib/alternatives";
import { shareDescription } from "@/lib/episode-share";
import { characterJsonLd, DESCRIPTION_MAX, fitDescription, pageMetadata, SITE_FEEDS, SITE_TITLE, toolJsonLd } from "@/lib/seo";
import { seasonLiveMeta } from "@/lib/season-page";
import { seasonRef } from "@/lib/season-ref";
import { FREE_TOOLS, TOOLS_PATH } from "@/lib/tools";
import { startTestDb } from "./helpers";

const source = (path: string) => readFileSync(path, "utf8");
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("descriptions fit a search result (fitDescription)", () => {
  it("leaves one that fits as it is", () => {
    const short = "A blind date nobody steers.";
    expect(fitDescription(short)).toBe(short);
    expect(fitDescription(`  two  spaces\nand a line  `)).toBe("two spaces and a line");
  });

  it("keeps whole sentences when the first ones say enough, else cuts at a word with an ellipsis", () => {
    const sentences = `${"One sentence that says what the page is for, plainly, in about ninety characters or so."} ${"A second one adds a little."} ${"A third would run well past the limit, so it is the one that goes, all of it, every word."}`;
    const fit = fitDescription(sentences);
    expect(fit).toBe("One sentence that says what the page is for, plainly, in about ninety characters or so. A second one adds a little.");
    const words = "word ".repeat(60).trim();
    const cut = fitDescription(words);
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(cut).toMatch(/word…$/);
    // No dangling comma or dash before the ellipsis.
    expect(fitDescription(`${"a".repeat(150)}, ${"b".repeat(20)}`)).toBe(`${"a".repeat(150)}…`);
  });

  it("is what pageMetadata puts in the description tag; the share cards keep the whole text", () => {
    const long = `${"Every price on one page, from the free dates to the packs and the plan, and what each one buys you here. ".repeat(3)}`.trim();
    const m = pageMetadata({ title: "Pricing · Botchelor", description: long, path: "/pricing" });
    expect(String(m.description).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(m.openGraph?.description).toBe(long);
  });
});

describe("titles that say what people search for", () => {
  it("the home page: an AI blind-date show, in a title that fits", () => {
    expect(SITE_TITLE).toMatch(/\bAI\b/);
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
    expect(source("app/HomeOpen.tsx")).toContain("An AI blind-date show where nobody steers.");
  });

  it("the landings Google left unindexed say AI, or the app people are leaving, and none says Botchelor twice", async () => {
    const titles: [string, Metadata][] = [
      ["/create", (await import("@/app/create/page")).metadata],
      ["/pricing", (await import("@/app/pricing/page")).metadata],
      ["/faq", (await import("@/app/faq/page")).metadata],
      ["/seasons", (await import("@/app/seasons/page")).metadata],
      ["/press", (await import("@/app/press/page")).metadata],
    ];
    for (const [path, m] of titles) {
      const title = String(m.title);
      expect(title, path).toMatch(/\bAI\b/);
      expect(title.match(/Botchelor/g), path).toHaveLength(1);
      expect(title.length, path).toBeLessThanOrEqual(65);
    }
    for (const alt of ALTERNATIVES) expect(alt.title).toMatch(new RegExp(`^An? ${alt.name.replace(/\./g, "\\.")} alternative`));
    for (const [path, m] of [
      ["/contact", (await import("@/app/contact/page")).metadata],
      ["/security", (await import("@/app/security/page")).metadata],
    ] as [string, Metadata][]) {
      expect(String(m.title), path).not.toMatch(/^(Contact|Security) · Botchelor$/);
      expect(String(m.title).match(/Botchelor/g), path).toHaveLength(1);
    }
  });

  it("a season whose format is named for the show says Botchelor once", () => {
    const season = seasonRef("2026-12-01");
    const named = seasonLiveMeta(season, { title: "The Botchelor", pitch: "Roses." } as never, "season").title;
    expect(named).toBe(`Season ${season.number}, ${season.label}: The Botchelor`);
    const other = seasonLiveMeta(season, { title: "The Mixer", pitch: "Drinks." } as never, "season").title;
    expect(other).toBe(`Season ${season.number}, ${season.label}: The Mixer · Botchelor`);
  });

  it("the show's own creator profile says Botchelor once", () => {
    expect(source("app/creators/[handle]/page.tsx")).toContain("/botchelor/i.test(c.display_name)");
  });

  it("the pages of each character, date, couple, creator and ship pair fit their descriptions too", async () => {
    for (const [page, call] of [
      ["app/characters/[id]/page.tsx", "description: fitDescription(`${c.name}, a contestant on Botchelor: ${c.bio} Wants: ${c.want}`),"],
      ["app/episodes/[id]/page.tsx", "description: wentWell ? fitDescription(description) : shareDescription(names, episode.setting, episode.revealed, DESCRIPTION_MAX),"],
      ["app/couples/[a]/[b]/page.tsx", "description: fitDescription(`${ca.name} and ${cb.name} on Botchelor:"],
      ["app/creators/[handle]/page.tsx", "description: fitDescription(c.bio ?? `Pictures and clips by @${c.handle}.`),"],
    ]) {
      expect(source(page), page).toContain(call);
    }
    const long = await shipMetadata({ params: Promise.resolve({ a: "bartholomew-alexander", b: "maximiliana-rosalind" }) });
    expect(String(long.description).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    // A date's: the setting is what gets cut, so the invitation stays in the search result too.
    const date = shareDescription(["Mira Quell", "Rafe Calloway"], `A night market ${"with one more lantern ".repeat(8)}and a fortune teller.`, false, DESCRIPTION_MAX);
    expect(date.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(date).toMatch(/^Mira Quell meets Rafe Calloway\. A night market .*… Guess how it ends before the finale airs, for free points\.$/);
  });
});

describe("every page of the show: the RSS feed and llms.txt in its head, every free tool in its footer", () => {
  it("are links in the root head, not layout metadata a page's own canonical replaces", async () => {
    expect(SITE_FEEDS).toEqual({ "application/rss+xml": "/feed.xml", "text/plain": "/llms.txt" });
    // On the show the layout's metadata names no alternates (a page's canonical replaced them); the head carries them.
    expect(rootMetadata.alternates).toBeUndefined();
    const html = renderToStaticMarkup(await RootLayout({ children: null }));
    const head = html.slice(0, html.indexOf("<body"));
    expect(head).toContain('<link rel="alternate" type="application/rss+xml" href="/feed.xml"/>');
    expect(head).toContain('<link rel="alternate" type="text/plain" href="/llms.txt"/>');
    const footer = html.slice(html.indexOf('<footer class="site-footer"'));
    for (const tool of FREE_TOOLS) expect(footer, tool.path).toContain(`href="${tool.path}"`);
    expect(footer).toContain('href="/import"');
  });
});

describe("structured data", () => {
  it("each free tool is a free web app under the tools hub, and each tool's page carries it", () => {
    for (const tool of FREE_TOOLS) {
      const [app, crumbs] = toolJsonLd(tool.path, "https://b.test") as Record<string, any>[];
      expect(app).toMatchObject({ "@type": "WebApplication", name: tool.name, url: `https://b.test${tool.path}`, isAccessibleForFree: true, offers: { price: "0" } });
      expect(crumbs["@type"]).toBe("BreadcrumbList");
      expect(crumbs.itemListElement.map((i: { item: string }) => new URL(i.item).pathname)).toEqual(["/", TOOLS_PATH, tool.path]);
    }
    expect(toolJsonLd("/not-a-tool")).toEqual([]);
    for (const page of ["app/tools/random-oc-generator/page.tsx", "app/tools/oc-name-generator/page.tsx", "app/tools/oc-questions/page.tsx", "app/tools/ship-name-generator/page.tsx", "app/tools/random-ship-generator/page.tsx", "app/tools/oc-chemistry-test/page.tsx"]) {
      expect(source(page), page).toMatch(/<JsonLd data=\{toolJsonLd\([A-Z_]+\)\} \/>/);
    }
  });

  it("a character's profile names their portrait when they have one, as a full address", () => {
    const c = { id: "c-1", name: "Ira Fenn", bio: "Bakes at night.", house: false };
    const person = (ld: Record<string, any>) => ld.mainEntity as Record<string, unknown>;
    expect(person(characterJsonLd(c, "https://b.test", "/api/assets/a-1.webp?w=384")).image).toBe("https://b.test/api/assets/a-1.webp?w=384");
    expect(person(characterJsonLd(c, "https://b.test")).image).toBeUndefined();
    expect(source("app/characters/[id]/page.tsx")).toContain("characterJsonLd(c, undefined, faceSrc)");
  });

  it("an episode's publisher logo is the raster one, and a running season is named without an address that moves", () => {
    const page = source("app/episodes/[id]/page.tsx");
    expect(page).toContain("logo: logoJsonLd(base)");
    expect(page).not.toContain("/icon.svg");
    expect(page).toContain("...(season.closed ? { url: `${base}${season.path}` } : {})");
    expect(source("app/couples/[a]/[b]/page.tsx")).toContain('{ name: "Characters", path: "/characters" }');
  });

  it("a ship pair's page sits under the free tools, at the pair's one address whichever order it was typed in", async () => {
    for (const [a, b] of [
      ["juniper", "dex"],
      ["dex", "juniper"],
    ]) {
      const html = renderToStaticMarkup(await ShipPage({ params: Promise.resolve({ a, b }) }));
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, any>);
      const crumbs = blocks.flat().find((d) => d["@type"] === "BreadcrumbList");
      expect(crumbs, `${a}/${b}`).toBeTruthy();
      expect(crumbs?.itemListElement.map((i: { item: string }) => new URL(i.item).pathname)).toEqual(["/", TOOLS_PATH, "/tools/ship-name-generator", "/ship/dex/juniper"]);
    }
  });
});
