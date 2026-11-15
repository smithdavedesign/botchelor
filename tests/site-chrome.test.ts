// The site's chrome after the 2026-11-14 design audit ("the chrome outweighs the content"): the footer keeps one row of
// what people click and links /everything for the rest (app/everything/page.tsx), and phones get a tab bar of the
// phone-first doors, Watch · Characters · Companions · You (app/PhoneTabBar.tsx), off the full-screen surfaces.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import EverythingPage, { metadata } from "@/app/everything/page";
import PhoneTabBar, { tabBarShowsOn, tabBarTabs } from "@/app/PhoneTabBar";
import { PUBLIC_PATHS } from "@/lib/site";
import { middleware } from "@/middleware";
import { BASE_URL } from "./helpers";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  nav.path = "/";
});

describe("the footer", () => {
  const layout = source("app/layout.tsx");
  const row = layout.slice(layout.indexOf('<nav className="footer-row"'), layout.indexOf("</nav>", layout.indexOf('<nav className="footer-row"')));

  it("is one short row: pricing, the two tools, the rules, two ways to tell us something, and the way to everything else", () => {
    expect(row.match(/<li>/g)?.length).toBeLessThanOrEqual(10);
    for (const href of ["/pricing", "/tools/oc-chemistry-test", "/tools/ship-name-generator", "/terms", "/privacy", "/content-policy", "/report", "/everything"]) {
      expect(row).toContain(`href="${href}"`);
    }
    expect(row).toContain("<FeedbackLink />");
    expect(row).toContain("Everything on Botchelor →");
    // Pricing stays off After Dark's host, as it was.
    expect(row).toContain('{!adHost && <li><Link prefetch={showPrefetch} href="/pricing">Pricing</Link></li>}');
    expect(layout).not.toContain("FooterGroup");
    expect(layout).not.toContain("footer-about");
  });

  it("keeps the safety lines, the letter, the accounts and the © line with Contact", () => {
    expect(layout).toContain("Every character is a fictional adult (18+), and every episode is written by an AI model.");
    expect(layout).toContain("<CrisisResources />");
    expect(layout).toContain("{!adHost && <NewsletterSignup />}");
    expect(layout).toContain("<SocialLinks links={socials}");
    expect(layout).toMatch(/className="footer-legal"[\s\S]*©[\s\S]*href="\/contact">Contact us/);
  });
});

describe("/everything", () => {
  const OLD_FOOTER = [
    "/graph", "/prompts", "/shop", "/pricing",
    "/tools/oc-chemistry-test", "/tools/ship-name-generator", "/agents",
    "/about", "/costs", "/faq", "/press", "/contact", "/security", "/accessibility",
    "/report", "/content-policy", "/terms", "/privacy", "/legal", "/2257", "/cancel",
  ];

  it("lists every link the footer's four groups had, under the same headings, and the footer's old About this show", () => {
    const html = renderToStaticMarkup(createElement(EverythingPage));
    for (const href of OLD_FOOTER) expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain("https://stats.uptimerobot.com/"); // Status
    expect(html).toContain(">Give us feedback</button>");
    for (const heading of ["The show", "Tools", "Company", "Help and legal", "About this show"]) expect(html).toContain(`>${heading}</h2>`);
    expect(html).toContain("Creators stay anonymous unless they agree to reveal themselves.");
    expect(html).toContain("Nothing you buy changes points, badges or rank.");
  });

  it("lists Companions only while they're open", () => {
    expect(renderToStaticMarkup(createElement(EverythingPage))).not.toContain('href="/companion"');
    vi.stubEnv("COMPANION_OPEN", "1");
    expect(renderToStaticMarkup(createElement(EverythingPage))).toContain('href="/companion"');
  });

  it("has its own metadata, is in the sitemap, and the 18+ gate lets a person through", () => {
    expect(metadata.title).toBe("Everything on Botchelor");
    expect(metadata.alternates?.canonical).toBe("/everything");
    expect(PUBLIC_PATHS).toContain("/everything");
    const res = middleware(new NextRequest(`${BASE_URL}/everything`, { headers: { "user-agent": BROWSER } }));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("the phone's tab bar", () => {
  const labels = (html: string) => [...html.matchAll(/class="tabbar-label">([^<]+)</g)].map((m) => m[1]);
  const current = (html: string) => /aria-current="page"[^>]*>[\s\S]*?class="tabbar-label">([^<]+)</.exec(html)?.[1] ?? null;

  it("has four tabs with companions open, three without", () => {
    expect(tabBarTabs(true).map((t) => t.href)).toEqual(["/watch", "/characters", "/companion", "/account"]);
    expect(labels(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toEqual(["Watch", "Characters", "Companions", "You"]);
    expect(labels(renderToStaticMarkup(createElement(PhoneTabBar, { companions: false })))).toEqual(["Watch", "Characters", "You"]);
  });

  it("marks the tab you're on by the header's rule, its pages under it included", () => {
    nav.path = "/watch";
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toBe("Watch");
    nav.path = "/characters/abc";
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toBe("Characters");
    nav.path = "/account";
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toBe("You");
    // The directory is its own tab while companions are open; without one, Characters stays current there, as in the header.
    nav.path = "/companion";
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toBe("Companions");
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: false })))).toBe("Characters");
    nav.path = "/";
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toBeNull();
  });

  it("shows on the show's pages and never on the full-screen surfaces, the gate, After Dark or admin", () => {
    for (const path of ["/", "/watch", "/characters", "/characters/abc", "/companion", "/companion/plan", "/account", "/matches", "/episodes/abc", "/everything", "/step-in"]) {
      expect(tabBarShowsOn(path), path).toBe(true);
    }
    for (const path of ["/watch/abc", "/gate", "/after-dark", "/after-dark/shorts", "/admin", "/admin/x", "/step-in/abc", "/companion/abc", "/swipe", "/messages/a/b", "/create", "/email/x"]) {
      expect(tabBarShowsOn(path), path).toBe(false);
    }
    nav.path = "/watch/abc";
    expect(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true }))).toBe("");
  });

  it("is mounted once in the layout, never on After Dark's host", () => {
    const layout = source("app/layout.tsx");
    expect(layout.match(/<PhoneTabBar /g)).toHaveLength(1);
    expect(layout).toContain("{!adHost && <PhoneTabBar companions={companionOpen()} />}");
  });

  it("is a phone's only (720px), hides with the full-screen views, and lifts what floats at the foot above it", () => {
    const css = source("app/ux/chrome.css");
    expect(css).toMatch(/\.tabbar \{\s*display: none;\s*\}\s*@media \(max-width: 720px\)/);
    expect(css).toMatch(/\.tabbar \{\s*display: block;\s*height: calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
    const hide = /:is\(\s*html\.theater-lock,[\s\S]*?\)\s*\.tabbar \{\s*display: none;\s*\}/.exec(css)?.[0] ?? "";
    for (const where of [".age-gate", ".theater", ".swipe-fullscreen", ".messages-fullscreen", ".companion-fullscreen", ".wizard", '.nav-links[data-open="true"]']) {
      expect(hide, where).toContain(where);
    }
    expect(css).toMatch(/body:has\(\.tabbar-nav\) :is\(\.phone-action-bar, \.beta-toast, \.install-hint, \.feedback-fab\) \{\s*bottom: calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom, 0px\) \+ var\(--space-3\)\);/);
    // A 44px target or more, its label on the type scale (13px and up).
    expect(css).toMatch(/--tabbar-h: 3\.75rem;/);
    expect(css).toMatch(/\.tabbar-tab \{[^}]*min-height: var\(--tabbar-h\);[^}]*font-size: var\(--text-xs\);/);
    // The last stylesheet stays the catalog's (tests/ui-audit-2026-11-08.test.ts); this one sits just before it.
    expect(source("app/layout.tsx")).toContain('import "./ux/chrome.css";\nimport "./ux/catalog.css";');
  });
});
