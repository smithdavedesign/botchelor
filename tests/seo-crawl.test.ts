/**
 * SEO, 2026-11-19. Search Console's crawl stats had half of Googlebot's requests on the framework's prefetch payloads
 * (`?_rsc=`) while /pricing, /faq, /import and the /alternatives pages waited in "Discovered - currently not indexed".
 * The free tools (the pages that match what people search: "oc ship generator", "shipping name") had no page of their
 * own, and two of the four no footer link. Pinned here: robots.txt keeps crawlers off `_rsc`; the hub (/tools) links
 * every tool and their own landings; every tool, the chemistry result and every ship page link the others and the hub.
 */
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import MoreTools from "@/app/tools/MoreTools";
import NamesPage from "@/app/tools/oc-name-generator/page";
import QuestionsPage from "@/app/tools/oc-questions/page";
import ToolsPage, { metadata } from "@/app/tools/page";
import { RSC_PREFETCH } from "@/lib/bots";
import { CHEMISTRY_TEST_PATH } from "@/lib/chemistry-test";
import { OC_NAME_STYLES, OC_NAMES_PATH, ocNamesHref } from "@/lib/oc-names";
import { OC_QUESTION_THEMES, OC_QUESTIONS_PATH } from "@/lib/oc-questions";
import { staticSitemap } from "@/lib/seo";
import { PUBLIC_PATHS } from "@/lib/site";
import { CHEMISTRY_TOOL_PATH, FREE_TOOLS, SHIP_TOOL_PATH, TOOLS_PATH } from "@/lib/tools";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const words = (html: string) => text(html).replace(/<[^>]+>/g, "");
const sp = () => ({ searchParams: Promise.resolve({}) });

/** Google's robots.txt matching: `*` is any run of characters, and the longest matching rule wins (Allow on a tie). */
function crawlable(url: string, allow: readonly string[], disallow: readonly string[]): boolean {
  const matches = (rule: string) => new RegExp(`^${rule.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`).test(url);
  const longest = (rules: readonly string[]) => Math.max(-1, ...rules.filter(matches).map((rule) => rule.length));
  return longest(allow) >= longest(disallow);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots.txt and the framework's prefetch requests", () => {
  it("keeps every crawler off `_rsc`, first query or not, and still lets every page and picture through", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    const r = robots();
    const groups = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(groups).toHaveLength(2); // everyone, and the AI crawlers by name
    for (const group of groups) {
      const allow = [group.allow ?? []].flat();
      const disallow = [group.disallow ?? []].flat();
      expect(disallow).toContain(RSC_PREFETCH);
      // Search Console's own examples (crawl stats, "Other file type", 2026-11-09).
      for (const url of ["/tools/oc-chemistry-test?_rsc=Ddlz2elKnae4623i", "/showcase?medium=clip&_rsc=hkL1iE7Z3Y3tw3fi", "/?_rsc=WzUDN3am5ctH078F", "/api/whatever", "/api/assets/abc/teaser"]) {
        expect(crawlable(url, allow, disallow), url).toBe(false);
      }
      for (const url of ["/", "/tools", "/tools/oc-chemistry-test", "/episodes/abc", "/import?from=cai&utm_source=reddit", "/api/og/episode/abc", "/api/assets/abc", "/api/mcp"]) {
        expect(crawlable(url, allow, disallow), url).toBe(true);
      }
    }
  });
});

describe("the free tools hub (/tools, lib/tools.ts)", () => {
  it("lists tools that exist, each in the sitemap with the hub", () => {
    expect(CHEMISTRY_TOOL_PATH).toBe(CHEMISTRY_TEST_PATH);
    expect(FREE_TOOLS.map((t) => t.path)).toEqual([OC_NAMES_PATH, OC_QUESTIONS_PATH, SHIP_TOOL_PATH, CHEMISTRY_TOOL_PATH]);
    const sitemap = staticSitemap("https://botchelor.com").map((e) => new URL(e.url).pathname);
    for (const path of [TOOLS_PATH, ...FREE_TOOLS.map((t) => t.path)]) {
      expect(PUBLIC_PATHS, path).toContain(path);
      expect(sitemap, path).toContain(path);
      expect(existsSync(new URL(`../app${path}/page.tsx`, import.meta.url)), path).toBe(true);
    }
  });

  it("links every tool, the name styles, the question themes and /create, with the list as structured data", () => {
    const raw = renderToStaticMarkup(createElement(ToolsPage));
    const html = text(raw);
    expect(html).toContain("<h1>Free tools for original characters</h1>");
    for (const t of FREE_TOOLS) expect(html).toContain(`<a href="${t.path}">${t.name}</a>`);
    for (const s of OC_NAME_STYLES) expect(html).toContain(`href="${ocNamesHref(s)}"`);
    for (const theme of OC_QUESTION_THEMES) expect(html).toContain(`href="${OC_QUESTIONS_PATH}#${theme.id}"`);
    expect(html).toContain('href="/ship/juniper/dex"');
    expect(html).toContain('href="/create"');
    const ld = JSON.parse(raw.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]) as Record<string, unknown>[];
    const list = ld.find((d) => d["@type"] === "ItemList") as { itemListElement: { url: string }[] };
    expect(list.itemListElement.map((i) => new URL(i.url).pathname)).toEqual(FREE_TOOLS.map((t) => t.path));
    expect(ld.find((d) => d["@type"] === "BreadcrumbList")).toBeTruthy();
  });

  it("has its own title, canonical and share card, and says what's true of all four (no sign-up, no AI)", () => {
    expect(String(metadata.title)).toMatch(/^Free OC tools: /);
    expect(String(metadata.description)).toContain("No sign-up, no AI");
    expect(metadata.alternates?.canonical).toBe(TOOLS_PATH);
    expect(existsSync(new URL("../app/tools/opengraph-image.tsx", import.meta.url))).toBe(true);
    // A tool under /tools never takes the hub's card: each draws or names its own.
    for (const t of FREE_TOOLS) {
      const own = existsSync(new URL(`../app${t.path}/opengraph-image.tsx`, import.meta.url)) || /images: \[CARD\]/.test(source(`app${t.path}/page.tsx`));
      expect(own, t.path).toBe(true);
    }
  });

  it("is in every page's footer, after the two tools the design system lists", () => {
    const layout = source("app/layout.tsx");
    expect(layout).toContain('<li><Link prefetch={showPrefetch} href="/tools" className="footer-all">All free tools →</Link></li>');
    expect(source("app/everything/page.tsx")).toContain('<Link href="/tools">All the free OC tools</Link>');
  });
});

describe("each tool links the others and the hub (app/tools/MoreTools.tsx)", () => {
  it("names the other three and the hub, never the page it's on", () => {
    for (const t of FREE_TOOLS) {
      const html = text(renderToStaticMarkup(createElement(MoreTools, { current: t.path })));
      for (const other of FREE_TOOLS) expect(html.includes(`href="${other.path}"`), `${t.path} links ${other.path}`).toBe(other.path !== t.path);
      expect(html).toContain(`href="${TOOLS_PATH}"`);
    }
    expect(words(renderToStaticMarkup(createElement(MoreTools, { current: SHIP_TOOL_PATH })))).toBe(
      "More free tools: the OC name generator, the questions to ask your OC and the OC chemistry test. All the free OC tools.",
    );
  });

  it("ends each tool's page, the chemistry result and every ship page", async () => {
    for (const [file, current] of [
      ["app/tools/ship-name-generator/page.tsx", "SHIP_TOOL_PATH"],
      ["app/tools/oc-chemistry-test/page.tsx", "CHEMISTRY_TEST_PATH"],
      ["app/tools/oc-chemistry-test/result/page.tsx", "CHEMISTRY_TEST_PATH"],
      ["app/tools/oc-questions/page.tsx", "OC_QUESTIONS_PATH"],
      ["app/tools/oc-name-generator/NamesView.tsx", "OC_NAMES_PATH"],
      ["app/ship/[a]/[b]/page.tsx", "SHIP_TOOL_PATH"],
    ]) {
      expect(source(file), file).toContain(`<MoreTools current={${current}} />`);
    }
    for (const html of [renderToStaticMarkup(await QuestionsPage(sp())), renderToStaticMarkup(await NamesPage(sp()))]) {
      expect(html).toContain('<p class="muted small more-tools">');
      expect(html).toContain(`href="${TOOLS_PATH}"`);
    }
  });
});
