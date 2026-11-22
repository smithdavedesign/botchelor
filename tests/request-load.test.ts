// The 2026-11-22 load audit. One page view sent 17 to 39 prefetch requests to the app before anyone clicked anything (two
// a link as it scrolled into view: the route's tree and its data, which renders the root layout), most of them
// for the header, the phone's tab bar, the show's tabs and the footer, on every page. Every wrong address was a full
// render of the site's layout. And Cloudflare's email obfuscation rewrote the footer's support address on every page,
// adding a script that throws on pages with links inside an SVG. Pinned here: the chrome's links prefetch on intent only
// (app/IntentLink.tsx) or never (the footer), a wrong address gets a page built once (app/global-not-found.tsx), and the
// footer's address is never whole in the markup (app/SupportEmail.tsx). Crawlers and /create: tests/seo-crawl.test.ts.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every <Link> rendered, with the prefetch it was given (undefined: Next's default, as soon as it's on screen). */
const seen = vi.hoisted(() => ({ links: [] as { href: string; prefetch: unknown }[] }));
vi.mock("next/link", async (original) => {
  const { createElement: h } = await import("react");
  const Real = (await original<typeof import("next/link")>()).default;
  return {
    default: (props: { href: unknown; prefetch?: unknown }) => {
      seen.links.push({ href: String(props.href), prefetch: props.prefetch });
      return h(Real, props as never);
    },
  };
});
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => "/",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

import CharactersTabs from "@/app/characters/CharactersTabs";
import ViewSwitch from "@/app/characters/ViewSwitch";
import WatchPartyLaunch from "@/app/episodes/[id]/WatchPartyLaunch";
import GlobalNotFound from "@/app/global-not-found";
import IntentLink from "@/app/IntentLink";
import Nav from "@/app/Nav";
import PhoneTabBar from "@/app/PhoneTabBar";
import SeasonBanner from "@/app/SeasonBanner";
import ShowTabs from "@/app/ShowTabs";
import SupportEmail from "@/app/SupportEmail";
import config from "@/next.config";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

beforeEach(() => {
  seen.links = [];
});

describe("the links on every page prefetch on intent only", () => {
  it("renders each as a plain link, given no prefetch until it's hovered or focused from the keyboard", () => {
    const html = render(
      createElement("div", null, [
        createElement(Nav, { key: "newcomer", tokens: 3, hasCharacter: false, personal: false }),
        createElement(Nav, { key: "owner", tokens: 3, hasCharacter: true, unread: 2, companions: true, chat: false }),
        createElement(PhoneTabBar, { key: "tabs", hasCharacter: true }),
        createElement(ShowTabs, { key: "show", active: "/watch" }),
        createElement(SeasonBanner, { key: "arc", now: new Date("2026-11-15T12:00:00Z") }),
        createElement(SeasonBanner, { key: "recap", now: new Date("2026-11-03T12:00:00Z") }),
        createElement(CharactersTabs, { key: "who", current: "cast", companions: true, yours: true }),
        createElement(ViewSwitch, { key: "view", current: "cards", spot: "cast" }),
      ]),
    );
    const hrefs = seen.links.map((l) => l.href);
    for (const href of ["/shop", "/create", "/watch", "/characters", "/account", "/notifications", "/companion", "/house", "/reunion", "/characters?tab=people", "/graph?origin=cast"]) {
      expect(hrefs, href).toContain(href);
    }
    for (const link of seen.links) expect(link.prefetch, link.href).toBe(false);
    // Still crawlable links in the markup, no script needed.
    expect(html).toContain('<nav class="tabs show-tabs" aria-label="The show"><a aria-current="page" href="/watch">Watch</a>');
    expect(html).toContain('class="season-arc"');
  });

  it("starts from Next's default once there's intent, and never takes a tap (or a tap's focus) for intent", () => {
    expect(render(createElement(IntentLink, { href: "/watch", className: "tab" }, "Watch"))).toBe('<a class="tab" href="/watch">Watch</a>');
    expect(seen.links).toEqual([{ href: "/watch", prefetch: false }]);
    const intent = source("app/IntentLink.tsx");
    expect(intent).toContain("prefetch={prefetch === false || !intent ? false : prefetch}");
    expect(intent).toContain('if (e.pointerType !== "touch") setIntent(true);');
    expect(intent).toContain('return el.matches(":focus-visible");');
  });

  it("leaves After Dark's own header as it was on its own host, and the show's links there never prefetch", () => {
    render(createElement(Nav, { tokens: 0, adHost: true, prefetchShow: false, afterDark: true, personal: true, meter: "tokens" }));
    const doors = seen.links.filter((l) => l.href.startsWith("/after-dark"));
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) expect(door.prefetch, door.href).toBeUndefined();
    expect(seen.links.filter((l) => !l.href.startsWith("/after-dark")).every((l) => l.prefetch === false)).toBe(true);
  });

  it("prefetches nothing in the footer, the letter's link included, nor the episode's watch party room", () => {
    const layout = source("app/layout.tsx");
    const footer = layout.slice(layout.indexOf('<footer className="site-footer">'), layout.indexOf("</footer>"));
    const links = footer.match(/<Link [^>]*>/g) ?? [];
    // 24 in the source: the free tools are one <Link> mapped over lib/tools.ts FREE_TOOLS (five on the page).
    expect(links.length).toBe(24);
    for (const link of links) expect(link).toContain("prefetch={false}");
    expect(source("app/NewsletterSignup.tsx")).toContain('<Link href="/newsletter" prefetch={false}>');
    // The wordmark is the header's: intent only on the show, never on After Dark's host (showPrefetch is false there).
    expect(layout).toContain('<IntentLink prefetch={showPrefetch} href={adHost ? "/after-dark" : "/"} className="logo">');
    expect(render(createElement(WatchPartyLaunch, { episodeId: "e1", isHost: false, partyId: "p1" }))).toContain('href="/watch/p1"');
    expect(seen.links.find((l) => l.href === "/watch/p1")?.prefetch).toBe(false);
  });
});

describe("a wrong address", () => {
  it("gets a page built once: its own document, the way back, and nothing read per request", () => {
    expect(config.experimental?.globalNotFound).toBe(true);
    const html = render(createElement(GlobalNotFound));
    expect(html.startsWith('<html lang="en">')).toBe(true);
    expect(html).toContain('<body><header class="site-header"><a href="/" class="logo">Botchelor</a></header>');
    expect(html).toContain('<main id="main"><article class="not-found"><p class="kicker">404</p><h1>This page isn&#x27;t on the show</h1>');
    expect(html).toContain('<a class="button" href="/">Back to the show</a><a class="button secondary" href="/characters">See the characters</a>');
    // No cookies, no headers, no database: only the stylesheet and a type.
    expect(source("app/global-not-found.tsx").match(/^import .*$/gm)).toEqual(['import type { Metadata } from "next";', 'import "./globals.css";']);
    // A page that calls notFound() keeps the site's layout and the same words.
    expect(source("app/not-found.tsx")).toContain("<h1>This page isn&apos;t on the show</h1>");
  });

  it("is one page everywhere: no route has a not-found of its own (2026-11-22: a missing date and its report card had a second, with only a plain link back)", async () => {
    const { globSync } = await import("node:fs");
    expect(globSync("app/**/not-found.tsx").sort()).toEqual(["app/not-found.tsx"]);
  });

  it("says noindex and nothing else to search engines: the layout's index, follow (and Google's copy of it) is replaced", async () => {
    const { metadata } = await import("@/app/not-found");
    expect(metadata.title).toBe("Not found · Botchelor");
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});

describe("the footer's support address", () => {
  it("is never whole in the markup, where Cloudflare's obfuscation would rewrite it, and links to /contact until the page loads", () => {
    const html = render(createElement(SupportEmail, { address: "support@botchelor.com" }));
    expect(html).toBe('<a href="/contact">support<wbr/>@botchelor.com</a>');
    expect(html).not.toContain("support@botchelor.com");
    expect(html).not.toContain("mailto:");
    expect(render(createElement(SupportEmail, { address: "not-an-address" }))).toBe("");
    expect(source("app/SupportEmail.tsx")).toContain("useEffect(() => setHref(`mailto:${address}`), [address]);");
    const layout = source("app/layout.tsx");
    expect(layout).toContain("· <SupportEmail address={support} />");
    expect(layout).not.toContain("mailto:");
  });
});
