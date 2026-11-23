// Search landings (the 2026-11-11 growth plan): one /alternatives template for several chat apps, and the prompt
// library's big PG tags as pages of their own.
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AlternativePage from "@/app/alternatives/AlternativePage";
import {
  ALTERNATIVE_APPS,
  ALTERNATIVE_APPS_CHECKED,
  ALTERNATIVES_FRESH_DAYS,
  ALTERNATIVES_LIST_MIN,
  alternativesFresh,
  botchelorApp,
  checkedDay,
  checkedMonth,
  NAMES_NOTE,
  onOwnSite,
  PAGE_APP_IDS,
  shownFacts,
  type AlternativeApp,
  type FactKind,
} from "@/lib/alternative-apps";
import { ALTERNATIVE_HEADING, ALTERNATIVES, alternativeBySlug, alternativeFaq, alternativePath, alternativeWords, type Alternative } from "@/lib/alternatives";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { COMPANION_FREE_PER_DAY } from "@/lib/companion-shared";
import { indexablePromptTags, promptTagHeading, promptTagPath, TAG_PAGE_MIN, tagCounts } from "@/lib/prompts-library";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { DESCRIPTION_MAX, landingPaths, staticSitemap } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * Two made-up apps on the reserved .example domain (RFC 2606), standing in for the real ones, whose facts are checked
 * on each app's own site before they go in lib/alternative-apps.ts. "Example Talk" takes the place of the app the Chai
 * page is about, so it's left off that page.
 */
const FAKE_APPS: readonly AlternativeApp[] = [
  {
    id: "chai",
    name: "Example Talk",
    home: "https://example-talk.example/",
    domains: ["example-talk.example"],
    about: "A made-up chat app, for this test only.",
    facts: [
      { kind: "age", value: "17", source: "https://help.example-talk.example/age" },
      { kind: "free", value: "Made-up free messages", source: "https://example-talk.example/pricing" },
    ],
  },
  {
    id: "aardvark-example",
    name: "aardvark Example",
    home: "https://www.aardvark.example/",
    domains: ["aardvark.example"],
    about: "Another made-up chat app.",
    aboutSource: "https://www.aardvark.example/about",
    facts: [{ kind: "paid", value: "A made-up plan at $1 a month", source: "https://www.aardvark.example/plans" }],
  },
];

/** Made-up apps, as many as asked: for the counts in titles and headings. */
const madeUp = (n: number): AlternativeApp[] =>
  Array.from({ length: n }, (_, i) => ({ id: `made-up-${i}`, name: `Made-up ${i}`, home: `https://app${i}.example/`, domains: [`app${i}.example`], about: "Made up.", facts: [] }));

const render = (alt: Alternative, apps?: readonly AlternativeApp[]) => text(renderToStaticMarkup(createElement(AlternativePage, { alt, apps })));
const jsonLd = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1].replace(/\\u0026/g, "&")) as Record<string, unknown>[];
/** The list's section, or null when the page has none (nothing nests a section inside it). */
const listSection = (html: string): string | null => {
  const start = html.indexOf('<section class="card alt-apps"');
  return start < 0 ? null : html.slice(start, html.indexOf("</section>", start) + "</section>".length);
};
/** What a person reads, screen-reader text included: the tags gone. */
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const day0 = new Date(`${ALTERNATIVE_APPS_CHECKED}T00:00:00Z`).getTime();
/** A moment this many days after the facts were read. */
const daysAfter = (days: number) => new Date(day0 + days * 86_400_000);
type ItemList = { name: string; itemListOrder: string; numberOfItems: number; itemListElement: { "@type": string; position: number; name: string; url: string }[] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the /alternatives pages", () => {
  it("one per app, each with its FAQ in the page and in its structured data, word for word", () => {
    expect(ALTERNATIVES.map((a) => a.slug)).toEqual(["character-ai", "janitor-ai", "spicychat", "chai"]);
    for (const alt of ALTERNATIVES) {
      const html = text(renderToStaticMarkup(createElement(AlternativePage, { alt })));
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1].replace(/\\u0026/g, "&")) as { "@type": string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }[];
      const faq = ld.find((d) => d["@type"] === "FAQPage")!;
      expect(faq.mainEntity!.map((e) => e.name)).toEqual(alternativeFaq(alt).map((f) => f.q));
      for (const { q, a } of alternativeFaq(alt)) {
        expect(html).toContain(`<dt>${q}</dt>`);
        expect(html).toContain(text(a).replace(/'/g, "'"));
        expect(faq.mainEntity!.find((e) => e.name === q)!.acceptedAnswer.text).toBe(a);
      }
      expect(html).toContain(`Moving from ${alt.name}`);
      expect(html).toContain('href="/import"');
      // Nominative only: nothing compared, nothing claimed, no marks.
      expect(html).not.toMatch(/better than|worse than|official|™|®|partner/i);
      expect(alt.bring.a).toContain(`isn't connected to ${alt.name}`);
    }
  });

  it("the Character.AI page keeps its words and address; the others are in the sitemap", async () => {
    const { default: Page, generateMetadata } = await import("@/app/alternatives/character-ai/page");
    const html = text(renderToStaticMarkup(createElement(Page)));
    expect(html).toContain("<dt>Can I bring a character I made on Character.AI?</dt>");
    expect(html).toContain("Copy its creator fields (Name, Tagline, Description, Greeting, Definition)");
    const metadata = await generateMetadata();
    expect(metadata.alternates?.canonical).toBe("/alternatives/character-ai");
    // Both routes' titles come from the one helper (lib/alternatives.ts alternativeWords).
    expect(metadata.title).toBe(alternativeWords(alternativeBySlug("character-ai")!).title);
    const { generateStaticParams, generateMetadata: slugMetadata } = await import("@/app/alternatives/[slug]/page");
    expect(generateStaticParams().map((p) => p.slug)).toEqual(["janitor-ai", "spicychat", "chai"]);
    const chai = await slugMetadata({ params: Promise.resolve({ slug: "chai" }) });
    expect(chai.title).toBe(alternativeWords(alternativeBySlug("chai")!).title);
    expect(chai.alternates?.canonical).toBe("/alternatives/chai");
    const urls = staticSitemap("https://botchelor.com").map((e) => e.url);
    for (const slug of ["character-ai", "janitor-ai", "spicychat", "chai"]) expect(urls).toContain(`https://botchelor.com${alternativePath(slug)}`);
    expect(urls.filter((u) => u.endsWith("/alternatives/character-ai"))).toHaveLength(1);
  });
});

// The lists (2026-11-23, lib/alternative-apps.ts): the apps people use instead of each page's own, every fact from that
// app's own site with its source and the date it was read, alphabetical, nothing rated or compared. Each test runs on
// the made-up apps above and on whatever lib/alternative-apps.ts lists.
describe("the /alternatives lists", () => {
  it("list every app but the page's own, and Botchelor, alphabetically; the ItemList is the same list", () => {
    expect(Object.keys(PAGE_APP_IDS).sort()).toEqual(ALTERNATIVES.map((a) => a.slug).sort());
    const base = siteUrl();
    let shown = 0;
    for (const apps of [FAKE_APPS, ALTERNATIVE_APPS]) {
      for (const alt of ALTERNATIVES) {
        const expected = [...apps.filter((a) => a.id !== PAGE_APP_IDS[alt.slug]), botchelorApp()];
        const names = expected.map((a) => a.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        const html = render(alt, apps);
        const section = listSection(html);
        const list = jsonLd(html).find((d) => d["@type"] === "ItemList") as ItemList | undefined;
        if (names.length < ALTERNATIVES_LIST_MIN) {
          // Too few to make a list (the Chai page, with the made-up apps): the page stays as it was.
          expect(section, alt.slug).toBeNull();
          expect(list, alt.slug).toBeUndefined();
          expect(html).toContain(`<h1>${ALTERNATIVE_HEADING}</h1>`);
          continue;
        }
        shown++;
        expect([...section!.matchAll(/<h3><a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]), alt.slug).toEqual(names);
        expect(section).toContain(`<h2 id="alt-apps-title">${names.length} apps people use instead of ${alt.name}</h2>`);
        expect(section).not.toMatch(new RegExp(`>${esc(alt.name)}</a></h3>`));
        expect(html).toContain(`<h1>${alt.name} alternatives</h1>`);
        // Right under the hero, before the ribbon of faces.
        expect(html.indexOf('<section class="card alt-apps"')).toBeGreaterThan(html.indexOf("</header>"));
        expect(html.indexOf('<section class="card alt-apps"')).toBeLessThan(html.indexOf("face-ribbon"));
        expect(list!.name).toBe(`${alt.name} alternatives`);
        expect(list!.itemListOrder).toBe("https://schema.org/ItemListOrderAscending");
        expect(list!.numberOfItems).toBe(names.length);
        expect(list!.itemListElement.map((e) => e.name)).toEqual(names);
        expect(list!.itemListElement.map((e) => e.position)).toEqual(names.map((_, i) => i + 1));
        for (const e of list!.itemListElement) {
          const app = expected.find((a) => a.name === e.name)!;
          expect(e["@type"]).toBe("ListItem");
          expect(e.url).toBe(app.self ? `${base}/` : app.home);
        }
        // An app with a page of its own links it, quietly; the page's own app never shows.
        for (const app of expected) {
          const slug = Object.keys(PAGE_APP_IDS).find((s) => PAGE_APP_IDS[s] === app.id);
          if (slug) expect(section).toContain(`<a href="${alternativePath(slug)}">Moving from ${app.name}</a>`);
        }
        expect(section).not.toContain(`href="${alternativePath(alt.slug)}"`);
      }
    }
    expect(shown).toBeGreaterThanOrEqual(3);
  });

  it("take every fact from the app's own site: each source and home on one of its domains, Botchelor's on ours", () => {
    const ids = [...ALTERNATIVE_APPS, botchelorApp()].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const app of [...ALTERNATIVE_APPS, ...FAKE_APPS]) {
      expect(app.self, app.name).toBeFalsy();
      expect(app.domains.length, app.name).toBeGreaterThan(0);
      expect(app.about.trim(), app.name).not.toBe("");
      for (const url of [app.home, app.aboutSource ?? app.home, ...app.facts.map((f) => f.source)]) {
        const { protocol, hostname } = new URL(url);
        expect(protocol, `${app.name}: ${url}`).toBe("https:");
        expect(app.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`)), `${app.name}: ${url}`).toBe(true);
        expect(onOwnSite(app, url)).toBe(true);
      }
      for (const f of app.facts) expect(f.value.trim(), `${app.name} ${f.kind}`).not.toBe("");
    }
    // Botchelor's sources are this site's own pages.
    const self = botchelorApp();
    for (const url of [self.home, self.aboutSource!, ...self.facts.map((f) => f.source)]) {
      expect(onOwnSite(self, url), url).toBe(true);
      expect(existsSync(`app${url === "/" ? "" : url}/page.tsx`), url).toBe(true);
    }
    // A fact from anywhere else is never shown, and a look-alike host isn't the app's own.
    const [, aardvark] = FAKE_APPS;
    const stray: AlternativeApp = { ...aardvark, facts: [...aardvark.facts, { kind: "cards", value: "Made-up export", source: "https://elsewhere.example/aardvark" }] };
    expect(shownFacts(stray)).toEqual(aardvark.facts);
    for (const url of ["http://www.aardvark.example/", "https://aardvark.example.elsewhere.example/", "https://notaardvark.example/", "not a url"]) {
      expect(onOwnSite(aardvark, url), url).toBe(false);
    }
    expect(onOwnSite(self, "https://botchelor.com/pricing")).toBe(false);
    expect(onOwnSite(self, "//elsewhere.example/")).toBe(false);
  });

  it("are dated, picture-free and quiet, with nothing rated, ranked or compared", () => {
    expect(checkedDay("2026-11-23")).toBe("November 23, 2026");
    for (const apps of [FAKE_APPS, ALTERNATIVE_APPS]) {
      for (const alt of ALTERNATIVES) {
        const html = render(alt, apps);
        const section = listSection(html);
        if (!section) continue;
        expect(section).toMatch(new RegExp(`<time [^>]*>${checkedDay()}</time>`));
        expect(section).toContain(ALTERNATIVE_APPS_CHECKED);
        expect(section).toContain("In alphabetical order.");
        expect(section).not.toMatch(/<img|<svg|<picture|<table/i);
        expect(visible(section)).not.toMatch(/\bbest\b|★|☆|\/10\b|\brated\b|\bratings?\b|\bscor(?:e|es|ed|ing)\b| vs\.? /i);
        expect(html).not.toMatch(/better than|worse than|official|™|®|partner/i);
        // Under the list: whose names these are.
        expect(section.indexOf(NAMES_NOTE)).toBeGreaterThan(section.lastIndexOf("</ul>"));
        // The page's one loud button comes first and stays the import; every link in the list is quiet, and another
        // app's site is never followed.
        expect(html.indexOf('class="button"')).toBeLessThan(html.indexOf('<section class="card alt-apps"'));
        expect(section).not.toContain("button");
        for (const [, attrs] of section.matchAll(/<a ([^>]*)>/g)) {
          if (/href="https?:/.test(attrs)) expect(attrs).toContain('rel="nofollow noopener"');
        }
        // No ratings or reviews in the structured data either.
        expect(JSON.stringify(jsonLd(html))).not.toMatch(/Rating|"review"|"@type":"Review"/);
      }
    }
  });

  it("count the apps in the title and heading from the data, and name the month only while the list is fresh", () => {
    expect(checkedMonth("2026-11-23")).toBe("November 2026");
    expect(alternativesFresh(new Date("2027-01-06T23:59:59Z"), "2026-11-23")).toBe(true);
    expect(alternativesFresh(new Date("2027-01-07T00:00:00Z"), "2026-11-23")).toBe(false);
    const cai = alternativeBySlug("character-ai")!;
    const fresh = alternativeWords(cai, { apps: FAKE_APPS, now: daysAfter(1) });
    expect(fresh).toEqual({
      title: `3 Character.AI alternatives, checked ${checkedMonth()} · Botchelor`,
      description: "3 apps people use instead of Character.AI: what's free, prices and rules, each from the app's own site. Or bring your characters here to go on dates.",
      heading: "Character.AI alternatives",
    });
    expect(alternativeWords(cai, { apps: FAKE_APPS, now: new Date(daysAfter(ALTERNATIVES_FRESH_DAYS).getTime() - 1000) }).title).toBe(fresh.title);
    expect(alternativeWords(cai, { apps: FAKE_APPS, now: daysAfter(ALTERNATIVES_FRESH_DAYS) }).title).toBe("3 Character.AI alternatives and what they cost · Botchelor");
    // Ten apps on every page (nine others and Botchelor), then one dropped: the words follow, and fit a search result.
    for (const alt of ALTERNATIVES) {
      for (const [apps, n] of [[madeUp(9), 10], [madeUp(8), 9]] as const) {
        for (const now of [daysAfter(1), daysAfter(ALTERNATIVES_FRESH_DAYS + 30)]) {
          const w = alternativeWords(alt, { apps, now });
          expect(w.title).toMatch(new RegExp(`^${n} ${esc(alt.name)} alternatives`));
          expect(w.title.length, w.title).toBeLessThanOrEqual(65);
          expect(w.description).toMatch(new RegExp(`^${n} apps people use instead of ${esc(alt.name)}:`));
          expect(w.description.length, w.description).toBeLessThanOrEqual(DESCRIPTION_MAX);
        }
        expect(listSection(render(alt, apps))).toContain(`>${n} apps people use instead of ${alt.name}</h2>`);
      }
    }
  });

  it("build Botchelor's own entry from the code's numbers, marked as this site, the PG show only", () => {
    const self = botchelorApp();
    const value = (kind: FactKind) => self.facts.find((f) => f.kind === kind)!.value;
    expect(value("free")).toBe(`${FREE_EPISODES_PER_SEASON} dates a week, and ${COMPANION_FREE_PER_DAY} Companion replies a day with a free account`);
    expect(value("paid")).toBe(`Optional, from ${formatPrice(PACK_5.price_cents)} (${PACK_5.episodes} more dates, paid once)`);
    expect(value("adult")).toBe("The show is PG");
    expect(value("age")).toBe("18");
    expect(value("cards")).toBe("Imports TavernAI cards (V1, V2 or V3, JSON or PNG) and Character.AI creator fields");
    expect(JSON.stringify(self)).not.toMatch(/after.?dark|nsfw|explicit/i);
    // The pages it links say so.
    const says = (file: string) => readFileSync(file, "utf8");
    expect(says("app/pricing/page.tsx")).toContain("{FREE_EPISODES_PER_SEASON} dates a week for your characters");
    expect(says("app/pricing/page.tsx")).toContain("companion replies a day with a free account");
    expect(says("app/pricing/page.tsx")).toContain("packs from ${formatPrice(PACK_5.price_cents)}");
    expect(says("app/import/page.tsx")).toContain("The show is PG");
    expect(says("app/import/page.tsx")).toContain("V1, V2 or V3");
    expect(says("app/legal/sections.tsx")).toContain("Botchelor is for adults (18+)");
    expect(says("app/accessibility/page.tsx")).toContain("We test the main pages in real browsers, at phone and desktop sizes.");
    // On the page: marked as this site, its links ours and followed.
    const html = render(alternativeBySlug("janitor-ai")!, FAKE_APPS);
    const section = listSection(html)!;
    expect(section).toContain('<h3><a href="/">Botchelor</a><span class="muted small"> (this site)</span></h3>');
    for (const kind of ["free", "paid"] as const) {
      expect(section).toMatch(new RegExp(`<dd>${esc(value(kind))} <a (?![^>]*nofollow)[^>]*href="/pricing"[^>]*>source`));
    }
  });

  it("ALTERNATIVES_LIST=0 gives each page as it was: no list or ItemList, and the earlier title, description and h1", async () => {
    const before = ALTERNATIVES.map((alt) => render(alt, []));
    vi.stubEnv("ALTERNATIVES_LIST", "0");
    ALTERNATIVES.forEach((alt, i) => {
      const html = render(alt, FAKE_APPS);
      expect(listSection(html)).toBeNull();
      expect(html).toContain(`<h1>${ALTERNATIVE_HEADING}</h1>`);
      expect(jsonLd(html).map((d) => d["@type"])).toEqual(["BreadcrumbList", "FAQPage"]);
      expect(html).toBe(before[i]);
      expect(alternativeWords(alt, { apps: FAKE_APPS })).toEqual({ title: alt.title, description: alt.description, heading: ALTERNATIVE_HEADING });
    });
    const { generateMetadata } = await import("@/app/alternatives/character-ai/page");
    const meta = await generateMetadata();
    expect(meta.title).toBe("A Character.AI alternative for the characters you made · Botchelor");
    expect(meta.openGraph?.description).toBe(alternativeBySlug("character-ai")!.description);
  });
});

describe("prompt tag pages", () => {
  it("read as plain headings, never \"Close portrait prompts\" or \"Man portrait prompts\"", () => {
    const heading = (id: string) => promptTagHeading(indexablePromptTags().find((t) => t.id === id)!);
    expect(heading("framing.close")).toBe("Close-up portrait prompts");
    expect(heading("subject:man")).toBe("Portrait prompts of men");
    expect(heading("subject:woman")).toBe("Portrait prompts of women");
    expect(heading("expression.smiling")).toBe("Smiling portrait prompts");
    for (const t of indexablePromptTags()) expect(promptTagHeading(t)).toMatch(/portrait prompts/i);
  });

  it("exist for PG tags with enough prompts, and for nothing else", async () => {
    const tags = indexablePromptTags();
    expect(tags.length).toBeGreaterThan(5);
    for (const t of tags) {
      expect(t.nsfw).toBe(false);
      expect(t.count).toBeGreaterThanOrEqual(TAG_PAGE_MIN);
    }
    const small = tagCounts(false).find((t) => t.count < TAG_PAGE_MIN)!;
    expect(small).toBeDefined();
    expect(tags.some((t) => t.id === small.id)).toBe(false);
    expect(tagCounts(true).filter((t) => t.nsfw).some((t) => tags.some((x) => x.id === t.id))).toBe(false);
    const { generateStaticParams, generateMetadata, default: Page } = await import("@/app/prompts/tag/[id]/page");
    expect(generateStaticParams().map((p) => p.id)).toEqual(tags.map((t) => t.id));
    const first = tags[0];
    const meta = await generateMetadata({ params: Promise.resolve({ id: first.id }) });
    expect(meta.alternates?.canonical).toBe(promptTagPath(first.id));
    // Behind the 18+ gate like the library: out of search, links followed.
    expect(meta.robots).toEqual({ index: false, follow: true });
    const heading = promptTagHeading(first);
    expect(String(meta.title)).toContain(`${first.count.toLocaleString("en-US")} ${heading[0].toLowerCase()}${heading.slice(1)}`);
    const html = text(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: first.id }) })));
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html.match(/class="prompt-item"/g)!.length).toBeLessThanOrEqual(24);
    expect(html).toContain('href="/prompts"');
    // A small or NSFW tag has no page, and its metadata is the not-found page's too (not a title of its own).
    await expect(generateMetadata({ params: Promise.resolve({ id: small.id }) })).rejects.toThrow();
    await expect(Page({ params: Promise.resolve({ id: small.id }) })).rejects.toThrow();
    // None in the sitemap (2026-11-22: the library sits behind the 18+ gate).
    for (const t of tags) expect(landingPaths()).not.toContain(promptTagPath(t.id));
  });
});
