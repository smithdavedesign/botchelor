// The site's chrome: the footer as the design system draws it (four groups that fold on a phone, 2026-11-16; the
// 2026-11-14 audit's /everything keeps every other page, app/everything/page.tsx), and phones get a tab bar of the
// phone-first doors, Watch · Chat · Characters · You (app/PhoneTabBar.tsx), off the full-screen surfaces.
import { readdirSync, readFileSync } from "node:fs";
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
// Whether the model league has its rates yet (lib/model-league.ts leagueShown reads the database; tests/model-league.test.ts
// covers it): /everything links it only then.
const league = vi.hoisted(() => ({ shown: false }));
vi.mock("@/lib/model-league", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/model-league")>()), leagueShown: async () => league.shown }));

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  nav.path = "/";
  league.shown = false;
});

describe("the footer", () => {
  const layout = source("app/layout.tsx");
  const groups = layout.slice(layout.indexOf('<nav className="footer-groups"'), layout.indexOf("</nav>", layout.indexOf('<nav className="footer-groups"')));
  const group = (title: string) => groups.slice(groups.indexOf(`<FooterGroup title="${title}"`), groups.indexOf("</FooterGroup>", groups.indexOf(`<FooterGroup title="${title}"`)));

  // The design system's SiteFooter (David 2026-11-16, "our footer should match the designs"), back from the 2026-11-14
  // audit's one row: four groups, columns on a wide screen and rows that fold on a phone (app/FooterGroup.tsx).
  it("is the design system's four groups, in its order, with its links", () => {
    expect([...groups.matchAll(/<FooterGroup title="([^"]+)"[^>]*>/g)].map((m) => m[1])).toEqual(["The show", "Tools", "Company", "Help and legal"]);
    const hrefs = (g: string) => [...group(g).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs("The show")).toEqual(["/watch", "/graph", "/shop", "/pricing", "/everything"]);
    // Plus the free tools' hub (SEO, 2026-11-19): the newer tools and the hub get a link from every page (tests/seo-crawl.test.ts).
    expect(hrefs("Tools")).toEqual(["/tools/random-oc-generator", "/tools/oc-chemistry-test", "/tools/ship-name-generator", "/tools", "/agents", "/llms.txt"]);
    expect(hrefs("Company")).toEqual(["/about", "/costs", "/faq", "/press", "/contact", "/security", "/accessibility"]);
    expect(hrefs("Help and legal")).toEqual(["/report", "/content-policy", "/safety", "/terms", "/privacy", "/legal", "/2257", "/cancel"]);
    expect(group("Help and legal")).toContain("<FeedbackLink />");
    // The prompts library stays on /everything (design review 2026-11-16, D-15), not in every page's footer.
    expect(groups).not.toContain('href="/prompts"');
    // After Dark's host: no Pricing or agents' door, and never the show's shop (Stripe's checkout; the 2026-11-22 audit).
    expect(group("The show")).toContain('{!adHost && <li><Link prefetch={false} href="/shop">More dates</Link></li>}');
    expect(group("The show")).toContain('{!adHost && <li><Link prefetch={false} href="/pricing">Pricing</Link></li>}');
    expect(group("The show")).not.toContain("Tokens");
    // …and its Help and legal never folds there: Report and the 2257 statement stay in the open on a phone.
    expect(groups).toContain('<FooterGroup title="Help and legal" keepOpen={adHost}>');
    expect(group("Tools")).toContain('{!adHost && <li><Link prefetch={false} href="/agents">For AI agents</Link></li>}');
    expect(layout).not.toContain("footer-row");
  });

  it("folds each group on a phone and holds it open as a column on a wide screen", () => {
    const fg = source("app/FooterGroup.tsx");
    expect(fg).toContain('const PHONE = "(max-width: 640px)";');
    expect(fg).toContain('<details ref={ref} className={keepOpen ? "footer-group footer-group--open" : "footer-group"} open>');
    expect(fg).toContain("const folds = phone.matches && !keepOpen;");
    expect(fg).toContain('<Icon name="chevronRight" className="footer-chev" />');
    const css = source("app/ux/chrome.css");
    expect(css).toMatch(/\.footer-groups \{\s*display: grid;\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\/\*[^*]*\*\/\s*\.footer-groups \{\s*grid-template-columns: 1fr;/);
    // "Give us feedback" (a button: it opens a dialog) reads as one of the quiet links, not an accent link.
    expect(css).toMatch(/\.site-footer \.footer-links button\.link-button \{[^}]*color: var\(--muted\);\s*font-weight: inherit;\s*text-decoration: none;/);
  });

  it("keeps its content in the page's wide column under an edge-to-edge rule, with every footer rule in one place (chrome.css)", () => {
    const css = source("app/ux/chrome.css");
    const base = css.match(/\n\.site-footer \{([^}]*)\}/)?.[1] ?? "";
    expect(base).toMatch(/margin: 0;/);
    // David 2026-11-17, "keep it contained within content wrapper": the content starts and ends where a wide page's does
    // (--page-wide less main's gutters), the gutter on a narrow screen; the box itself, and its rule, stay full width.
    expect(base).toMatch(/padding: var\(--space-5\) max\(var\(--gutter\), calc\(\(100% - var\(--page-wide\)\) \/ 2 \+ var\(--gutter\)\)\) var\(--space-6\);/);
    expect(base).toMatch(/border-top: 1px solid var\(--line\);/);
    expect(base).not.toMatch(/max-width/);
    // The letter and the accounts as the left column beside the groups, one column on a narrower screen.
    expect(css).toMatch(/\.footer-main:has\(> \.footer-side > \*\) \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2\.2fr\);/);
    expect(css).toMatch(/@media \(max-width: 1100px\) \{\s*\.footer-main:has\(> \.footer-side > \*\) \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    // No other sheet sizes or dresses the footer: only the full-screen surfaces that hide it name it.
    const sheets = ["app/globals.css", ...readdirSync(new URL("../app/ux", import.meta.url)).filter((f) => f.endsWith(".css") && f !== "chrome.css").map((f) => `app/ux/${f}`)];
    for (const sheet of sheets) {
      const rules = [...source(sheet).matchAll(/([^{}]*\.site-footer[^{}]*)\{([^}]*)\}/g)];
      for (const [, selector, body] of rules) expect(body.trim(), `${sheet}: ${selector.trim()}`).toBe("display: none;");
    }
  });

  it("keeps the letter beside the accounts, then the safety lines and the fine print at the very bottom", () => {
    expect(layout).toContain("Every character is a fictional adult (18+), and every episode is written by an AI model.");
    expect(layout).toContain("<CrisisResources />");
    expect(layout).toMatch(/<div className="footer-main">[\s\S]*\{!adHost && \(\s*<div className="footer-side">\s*<NewsletterSignup \/>\s*<SocialLinks links=\{socials\} labels area="footer" \/>/);
    // On After Dark's host the show's line about points gives way to one about what's there (2026-11-22 audit).
    // The support address last, never whole in the markup (app/SupportEmail.tsx: Cloudflare's email obfuscation).
    expect(layout).toMatch(/className="footer-legal"[\s\S]*Adults \(18\+\) only · No real people · \{adHost \? "Every character is AI-generated fiction" : "Points are free and can't be bought"\} · ©[\s\S]*<SupportEmail address=\{support\} \/>/);
    // David 2026-11-17: the legal lines after the links. The groups, then the adults line, the help lines, the © line.
    const at = (s: string) => layout.indexOf(s);
    expect(at('<nav className="footer-groups"')).toBeGreaterThan(at('<div className="footer-side">'));
    expect(at('<p className="footer-adults">')).toBeGreaterThan(at("</nav>"));
    expect(at("<CrisisResources />")).toBeGreaterThan(at('<p className="footer-adults">'));
    expect(at('<p className="footer-legal">')).toBeGreaterThan(at("<CrisisResources />"));
  });
});

describe("/everything", () => {
  const OLD_FOOTER = [
    "/graph", "/prompts", "/shop", "/pricing",
    "/tools/oc-chemistry-test", "/tools/ship-name-generator", "/agents",
    "/about", "/costs", "/faq", "/press", "/contact", "/security", "/accessibility",
    "/report", "/content-policy", "/terms", "/privacy", "/legal", "/2257", "/cancel",
  ];

  const everything = async () => renderToStaticMarkup(await EverythingPage());

  it("lists every link the footer's four groups had, under the same headings, and the footer's old About this show", async () => {
    const html = await everything();
    for (const href of OLD_FOOTER) expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain("https://stats.uptimerobot.com/"); // Status
    expect(html).toContain(">Give us feedback</button>");
    for (const heading of ["The show", "Tools", "Company", "Help and legal", "About this show"]) expect(html).toContain(`>${heading}</h2>`);
    expect(html).toContain("Creators stay anonymous unless they agree to reveal themselves.");
    expect(html).toContain("Nothing you buy changes points, badges or rank.");
  });

  // David 2026-11-17, "add anything that's missing": the show's own doors, a person's own pages and the agents' pages.
  it("lists the show's doors, a person's own pages and every agents' page, in four columns on a wide page", async () => {
    league.shown = true;
    const html = await everything();
    const added = [
      "/watch", "/house", "/reunion", "/characters", "/showcase",
      "/create", "/swipe", "/matches", "/chat", "/studio", "/notifications", "/account",
      "/agents/tools", "/agents/league", "/agents/changelog", "/agents/pricing",
    ];
    for (const href of added) expect(html, href).toContain(`href="${href}"`);
    for (const heading of ["Your characters", "For AI agents", "Coming from another app"]) expect(html).toContain(`>${heading}</h2>`);
    expect(html).toContain('class="legal-page company-page everything-page page-wide"');
    const css = source("app/ux/chrome.css");
    expect(css).toMatch(/\.everything-groups \{\s*columns: 4;/);
    expect(css).toMatch(/\.legal-page\.company-page \.everything-groups section \{[^}]*break-inside: avoid;/);
  });

  it("lists Companions only while they're open", async () => {
    expect(await everything()).not.toContain('href="/companion"');
    expect(await everything()).not.toContain('href="/companion/plan"');
    vi.stubEnv("COMPANION_OPEN", "1");
    expect(await everything()).toContain('href="/companion"');
  });

  it("links the model league only once it has its rates", async () => {
    expect(await everything()).not.toContain('href="/agents/league"');
    league.shown = true;
    expect(await everything()).toContain('href="/agents/league"');
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

  it("has five tabs, always: Watch · Chat · Characters · Studio · You, the header's doors", () => {
    expect(tabBarTabs(true).map((t) => t.href)).toEqual(["/watch", "/chat", "/characters", "/studio", "/account"]);
    expect(tabBarTabs(false).map((t) => t.href)).toEqual(["/watch", "/chat", "/characters", "/studio", "/account"]);
    expect(labels(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })))).toEqual(["Watch", "Chat", "Characters", "Studio", "You"]);
    expect(labels(renderToStaticMarkup(createElement(PhoneTabBar, {})))).toEqual(["Watch", "Chat", "Characters", "Studio", "You"]);
  });

  it("marks the tab you're on by the header's rule: Chat on every list of threads", () => {
    const here = () => current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true })));
    nav.path = "/watch";
    expect(here()).toBe("Watch");
    nav.path = "/characters/abc";
    expect(here()).toBe("Characters");
    nav.path = "/account";
    expect(here()).toBe("You");
    for (const path of ["/chat", "/matches", "/companion", "/companion/plan"]) {
      nav.path = path;
      expect(here(), path).toBe("Chat");
    }
    // The show's own tabs and a season's page are the Watch door (app/ShowTabs.tsx).
    for (const path of ["/house", "/reunion", "/shows", "/shows/botchelor", "/seasons/october-2026"]) {
      nav.path = path;
      expect(here(), path).toBe("Watch");
    }
    nav.path = "/";
    expect(here()).toBeNull();
  });

  it("dots Chat while there are unread texts", () => {
    nav.path = "/watch";
    const html = renderToStaticMarkup(createElement(PhoneTabBar, { unread: 3 }));
    expect(html).toMatch(/href="\/chat"[^>]*>(?:(?!<\/a>)[\s\S])*<span class="tabbar-dot" aria-label="3 unread"><\/span>/);
    expect(html.match(/tabbar-dot/g)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(PhoneTabBar, { unread: 0 }))).not.toContain("tabbar-dot");
  });

  it("NAV_CHAT=0 (chat: false) is the bar as it was: Companions a tab while they're open, three without", () => {
    expect(tabBarTabs(true, false).map((t) => t.href)).toEqual(["/watch", "/characters", "/companion", "/account"]);
    expect(labels(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true, chat: false })))).toEqual(["Watch", "Characters", "Companions", "You"]);
    expect(labels(renderToStaticMarkup(createElement(PhoneTabBar, { companions: false, chat: false })))).toEqual(["Watch", "Characters", "You"]);
    nav.path = "/companion";
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: true, chat: false })))).toBe("Companions");
    expect(current(renderToStaticMarkup(createElement(PhoneTabBar, { companions: false, chat: false })))).toBe("Characters");
    nav.path = "/";
  });

  it("shows on the show's pages and never on the full-screen surfaces, the gate, After Dark or admin", () => {
    for (const path of ["/", "/watch", "/characters", "/characters/abc", "/companion", "/companion/plan", "/account", "/matches", "/chat", "/episodes/abc", "/everything", "/step-in"]) {
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
    expect(layout).toContain("{!adHost && <PhoneTabBar companions={companionOpen()} chat={navChat} unread={texts} hasCharacter={hasCharacter} />}");
  });

  it("is a phone's only (720px), hides with the full-screen views, and lifts what floats at the foot above it", () => {
    const css = source("app/ux/chrome.css");
    expect(css).toMatch(/\.tabbar \{\s*display: none;\s*\}\s*@media \(max-width: 720px\)/);
    expect(css).toMatch(/\.tabbar \{\s*display: block;\s*height: calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
    const hide = /:is\(\s*html\.theater-lock,[\s\S]*?\)\s*\.tabbar \{\s*display: none;\s*\}/.exec(css)?.[0] ?? "";
    for (const where of [".age-gate", ".theater", ".swipe-fullscreen", ".messages-fullscreen", ".companion-fullscreen", ".wizard", '.nav-links[data-open="true"]']) {
      expect(hide, where).toContain(where);
    }
    expect(css).toMatch(/body:has\(\.tabbar-nav\) :is\(\.phone-action-bar, \.beta-toast, \.install-hint, \.feedback-fab, \.studio-select-bar\) \{\s*bottom: calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom, 0px\) \+ var\(--space-3\)\);/);
    // One bottom bar at a time (the 2026-11-20 mobile audit, A2): the floating action bar stays away while the tab bar shows.
    expect(css).toMatch(/body:has\(\.tabbar-nav\) \.phone-action-bar \{\s*display: none;\s*\}/);
    // A 44px target or more, its label on the type scale (13px and up).
    expect(css).toMatch(/--tabbar-h: 3\.75rem;/);
    expect(css).toMatch(/\.tabbar-tab \{[^}]*min-height: var\(--tabbar-h\);[^}]*font-size: var\(--tabbar-label\);/);
    // Smaller only where five labels don't fit, and never under the eyebrow step (13px on a phone): D-09, 2026-11-16.
    expect(css).toContain("--tabbar-label: min(var(--text-xs), max(var(--text-eyebrow), 3.4vw));");
    // The last stylesheet stays the catalog's (tests/ui-audit-2026-11-08.test.ts); this one sits just before it.
    expect(source("app/layout.tsx")).toContain('import "./ux/chrome.css";\nimport "./ux/catalog.css";');
  });
});

// UX audit 2026-11-22: axe's link-name on every phone page with the header. The After Dark door hid its word with
// display: none, which a screen reader skips too, so the link had no name; out of sight is the .sr-only rule instead.
// A long name in a heading's switch wraps inside its button, its "'s" still kept with it (/studio was 32 px too wide).
describe("the header and headings on a phone", () => {
  it("keeps the After Dark door's name for a screen reader", () => {
    const css = source("app/globals.css");
    const rule = /\.nav a\.nav-ad-link span,\s*\.moon-badge span \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/position: absolute;/);
    expect(rule).toMatch(/clip: rect\(0, 0, 0, 0\);/);
    expect(rule).not.toMatch(/display: none/);
    expect(source("app/Nav.tsx")).toMatch(/<Icon name="moon" \/>\s*<span>After Dark<\/span>/);
  });

  it("lets a long name wrap inside a heading's switch", () => {
    const css = source("app/ux/chrome.css");
    expect(css).toMatch(/\.heading-switch-keep \{\s*white-space: nowrap;\s*\}/);
    const inner = /\.heading-switch-keep \.heading-switch \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(inner).toMatch(/max-width: calc\(100% - 1em\);/);
    expect(inner).toMatch(/white-space: normal;/);
    expect(inner).toMatch(/overflow-wrap: anywhere;/);
  });
});
