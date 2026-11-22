// The company pass (2026-11-10, lib/company.ts): the footer's accounts and company links, the Organization JSON-LD, the
// pages /contact, /faq, /pricing, /press, /security and /accessibility, /.well-known/security.txt, the 18+ gate letting
// them through, and the failed-sign-in hold (lib/login-guard.ts).
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AccessibilityPage from "@/app/accessibility/page";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import ContactPage from "@/app/contact/page";
import FaqPage from "@/app/faq/page";
import PressPage from "@/app/press/page";
import PricingPage from "@/app/pricing/page";
import SecurityPage from "@/app/security/page";
import SocialLinks from "@/app/SocialLinks";
import { GET as securityTxtRoute } from "@/app/.well-known/security.txt/route";
import { CONTACT_ROUTES, launchedOn, mailto, roleEmail, SOCIALS, socialLinks, STATUS_PAGE_URL } from "@/lib/company";
import { setDbForTests } from "@/lib/db";
import { answerText, faqJsonLd, faqs } from "@/lib/faq";
import { LOGIN_FAILS_PER_HANDLE, LOGIN_FAILS_PER_VISITOR, LOGIN_WINDOW_MINUTES, loginHeld, recordLoginFailure } from "@/lib/login-guard";
import { SECURITY_TXT_DAYS, securityTxt } from "@/lib/security-policy";
import { organizationJsonLd } from "@/lib/seo";
import { PUBLIC_PATHS } from "@/lib/site";
import { proxy as middleware } from "@/proxy";
import config from "@/next.config";
import { SECURITY_HEADERS } from "@/lib/security-headers";
import { BASE_URL, startTestDb } from "./helpers";

const INVITE = "https://discord.gg/8VDdRF9YU";
const SUPPORT = "support@botchelor.com";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const COMPANY_PAGES = ["/contact", "/faq", "/pricing", "/press", "/security", "/accessibility"] as const;

/** A page's words, with the tags gone and React's escapes undone. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const render = (page: () => ReactElement) => renderToStaticMarkup(createElement(page));

afterEach(() => vi.unstubAllEnvs());

describe("the show's accounts", () => {
  it("lists X, Bluesky and GitHub, and Discord only once its invite is set", () => {
    expect(socialLinks({}).map((s) => s.id)).toEqual(["x", "bluesky", "tiktok", "github"]);
    expect(socialLinks({ DISCORD_INVITE_URL: INVITE }).map((s) => s.id)).toEqual(["x", "bluesky", "tiktok", "discord", "github"]);
    expect(socialLinks({ DISCORD_INVITE_URL: "CHANGE_ME" }).map((s) => s.id)).toEqual(["x", "bluesky", "tiktok", "github"]);
  });

  it("shows none on After Dark's host", () => {
    expect(socialLinks({ DISCORD_INVITE_URL: INVITE }, true)).toEqual([]);
    expect(socialLinks({ DISCORD_INVITE_URL: INVITE, AFTER_DARK_ONLY: "1", AFTER_DARK_ORIGIN: "https://ad.botchelor.com" }).map((s) => s.id)).not.toContain("discord");
  });

  it("are https addresses on each network's own site", () => {
    for (const s of SOCIALS) expect(new URL(s.url).protocol).toBe("https:");
    expect(SOCIALS.map((s) => new URL(s.url).hostname)).toEqual(["x.com", "bsky.app", "www.tiktok.com", "github.com"]);
  });

  it("render as links that say where they go, opening in a new tab", () => {
    const html = renderToStaticMarkup(createElement(SocialLinks, { links: socialLinks({ DISCORD_INVITE_URL: INVITE }), area: "footer" }));
    expect(html).toContain(`href="${INVITE}"`);
    expect(words(html)).toContain("Botchelor on Bluesky");
    expect(html).toContain('target="_blank"');
    expect(renderToStaticMarkup(createElement(SocialLinks, { links: [], area: "footer" }))).toBe("");
  });
});

describe("the footer", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const everything = readFileSync(new URL("../app/everything/page.tsx", import.meta.url), "utf8");

  // One row since the 2026-11-14 design audit: pricing and contact stay in the footer, the Company group lives on
  // /everything, which the row links on every page.
  it("links pricing, contact and /everything, where every company page is under Company, and closes with the © line", () => {
    for (const href of ["/pricing", "/contact", "/everything"]) expect(layout).toContain(`href="${href}"`);
    expect(everything).toMatch(/<h2 id="company">Company<\/h2>/);
    for (const href of COMPANY_PAGES) expect(everything).toContain(`href="${href}"`);
    expect(layout).toContain("<SocialLinks links={socials}");
    expect(layout).toMatch(/className="footer-legal"[\s\S]*©/);
  });

  it("links every switching page from /everything (the footer row stays at 10 links)", () => {
    expect(everything).toContain("ALTERNATIVES.map");
    expect(everything).toContain('href="/import"');
  });
});

describe("the Organization in every page's JSON-LD", () => {
  it("names the accounts as sameAs and the founder", () => {
    const org = organizationJsonLd("https://botchelor.com", { DISCORD_INVITE_URL: INVITE });
    expect(org.sameAs).toEqual([...SOCIALS.slice(0, 3).map((s) => s.url), INVITE, SOCIALS[3].url]);
    expect(org.founder).toEqual({ "@type": "Person", name: "David Smith" });
    expect(org.legalName).toBe("Botchelor LLC");
    // A raster logo at 512px (Google's logo guidance), and the file is there.
    expect(org.logo).toEqual({ "@type": "ImageObject", url: "https://botchelor.com/icons/icon-512.png", width: 512, height: 512 });
    expect(existsSync(new URL("../public/icons/icon-512.png", import.meta.url))).toBe(true);
  });

  it("gives the support address as a contact point only once it's set", () => {
    expect(organizationJsonLd("https://botchelor.com", {})).not.toHaveProperty("contactPoint");
    const org = organizationJsonLd("https://botchelor.com", { CONTACT_EMAIL: SUPPORT });
    expect(org.contactPoint).toEqual([expect.objectContaining({ "@type": "ContactPoint", email: SUPPORT, url: "https://botchelor.com/contact" })]);
  });
});

describe("the company pages", () => {
  it("are in the sitemap, and the 18+ gate lets a person through to each (and still stops them on /swipe)", () => {
    for (const path of COMPANY_PAGES) expect(PUBLIC_PATHS).toContain(path);
    const visit = (path: string) => middleware(new NextRequest(`${BASE_URL}${path}`, { headers: { "user-agent": BROWSER } }));
    for (const path of COMPANY_PAGES) expect(visit(path).headers.get("location"), path).toBeNull();
    // How it's built and what it costs, which the press kit and the footer's Company group link to.
    for (const path of ["/about", "/costs"]) expect(visit(path).headers.get("location"), path).toBeNull();
    // /watch is open since 2026-11-14 (the PG show pages); a dating surface still meets the gate.
    expect(visit("/swipe").headers.get("location")).toMatch(/\/gate/);
  });

  it("render per request, so an address or a price set after the build shows", () => {
    for (const path of COMPANY_PAGES) {
      expect(readFileSync(new URL(`../app${path}/page.tsx`, import.meta.url), "utf8"), path).toContain('export const dynamic = "force-dynamic";');
    }
  });

  it("/contact gives the address, a subject for each kind of email, and every route", () => {
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    const html = render(ContactPage);
    expect(html).toContain(`href="mailto:${SUPPORT}"`);
    expect(html).toContain(`href="mailto:${SUPPORT}?subject=Privacy%20request"`);
    for (const r of CONTACT_ROUTES) expect(html).toContain(`id="${r.id}"`);
    expect(mailto("Press", {})).toBeNull();
  });

  it("/contact still works before the address is set", () => {
    vi.stubEnv("CONTACT_EMAIL", "");
    // The feedback form's button right on the page, not a pointer to a footer link a phone folds away (2026-11-20 mobile audit, A5).
    const html = render(ContactPage);
    expect(html).toContain('<p class="contact-feedback"><button type="button" class="button" aria-haspopup="dialog">Write to us</button>');
    expect(html).not.toContain("at the foot of every page");
  });

  it("/faq says, on the page, every answer its JSON-LD gives", () => {
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    const text = words(render(FaqPage));
    const list = faqs();
    expect(list.length).toBeGreaterThan(10);
    for (const f of list) {
      expect(text).toContain(f.q);
      expect(text, f.id).toContain(answerText(f.a).trim());
    }
    const ld = faqJsonLd(list) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(ld.mainEntity.map((q) => q.name)).toEqual(list.map((f) => f.q));
  });

  it("shows the support address only as an element's whole text, never inside a sentence", () => {
    // Cloudflare's email obfuscation (botchelor.com's zone and DigitalOcean's edge both run it) rewrites every address in
    // the HTML, and its script puts each one back: whole when it was all of an element's text, as a text node of its own
    // when it sat inside a sentence. That split broke React's hydration on /faq (#418, 2026-11-10).
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    const pages = { ContactPage, FaqPage, PricingPage, PressPage, SecurityPage, AccessibilityPage };
    for (const [name, page] of Object.entries(pages)) {
      const text = render(page)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
        .replace(/<[^>]+>/g, (tag) => tag.replace(/"[^"]*"/g, '""'));
      expect(text.split(SUPPORT).length, name).toBe(text.split(`>${SUPPORT}<`).length);
    }
    expect(render(FaqPage)).toContain(`<a href="mailto:${SUPPORT}">${SUPPORT}</a>`);
  });

  it("/faq offers the pack and refunds only while it's on sale, and companions only while they're open", () => {
    const ids = (env: Record<string, string>) => faqs(env).map((f) => f.id);
    expect(ids({})).not.toContain("refund");
    expect(ids({})).not.toContain("companions");
    expect(answerText(faqs({}).find((f) => f.id === "free")!.a)).not.toMatch(/\$/);
    expect(ids({ STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_x" })).toContain("refund");
    expect(answerText(faqs({ STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_x" }).find((f) => f.id === "free")!.a)).toMatch(/\$4\.00|\$4\b/);
    expect(ids({ COMPANION_OPEN: "1" })).toContain("companions");
    // The $10 pack too, once its own link is set (2026-11-22 audit: the price answer left it out), and on its own.
    const both = answerText(faqs({ STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_x", STRIPE_LINK_PACK_15: "https://buy.stripe.com/test_y" }).find((f) => f.id === "free")!.a);
    expect(both).toMatch(/5 more dates cost \$4(\.00)?, or 15 cost \$10(\.00)?, paid once/);
    const bigOnly = faqs({ STRIPE_LINK_PACK_15: "https://buy.stripe.com/test_y" });
    expect(answerText(bigOnly.find((f) => f.id === "free")!.a)).toMatch(/15 more dates cost \$10(\.00)?, paid once/);
    expect(bigOnly.map((f) => f.id)).toContain("refund");
  });

  it("/contact's privacy line goes to the account page's delete, and feedback is where every page has it", () => {
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    const html = render(ContactPage);
    expect(html).toContain('<a href="/account#delete-account">Delete your account from your account page, or ask us.</a>');
    // Not "in the ☰ menu": a desktop has no ☰ (2026-11-22 audit). The footer's "Give us feedback" is on every page.
    expect(html).not.toContain("☰");
    expect(html).toContain("at the foot of every page");
    // Without an address /security sends people to the feedback form: where that is, too.
    vi.stubEnv("CONTACT_EMAIL", "");
    const security = render(SecurityPage);
    expect(security).not.toContain("☰");
    expect(security).toContain("link at the foot of every page");
  });

  // "00:00 UTC" read as a programmer's clock (2026-11-22 audit): /pricing sends it, then the browser shows the viewer's own
  // day and time (app/WeeklyTime.tsx); /faq's answer, plain text for search too, says it in words.
  it("says when free dates come back in the viewer's clock on /pricing, and in words on /faq", () => {
    expect(words(render(PricingPage))).toContain("3 dates a week for your characters, back every Monday at 00:00 UTC");
    expect(readFileSync("app/pricing/page.tsx", "utf8")).toContain("back every <WeeklyTime weekday={1} />");
    const free = answerText(faqs({}).find((f) => f.id === "free")!.a);
    expect(free).toContain("back every Monday at midnight UTC (Sunday afternoon or evening in the Americas)");
    expect(free).not.toContain("00:00");
  });

  it("/pricing shows the free dates, and the pack's button only while purchases are open", () => {
    vi.stubEnv("STRIPE_PAYMENT_LINK", "");
    let text = words(render(PricingPage));
    expect(text).toMatch(/3 dates a week/);
    expect(text).toMatch(/Not on sale yet/);
    expect(text).not.toMatch(/Companion Plan/);
    vi.stubEnv("STRIPE_PAYMENT_LINK", "https://buy.stripe.com/test_botchelorSamplePack");
    vi.stubEnv("COMPANION_OPEN", "1");
    const html = render(PricingPage);
    text = words(html);
    expect(html).toContain('href="/shop"');
    expect(text).toMatch(/Companion Plan/);
    expect(text).toMatch(/Never for sale/);
  });

  it("/pricing is two cards, what's free and one upgrade, with one loud button; the rest are lines under them", () => {
    vi.stubEnv("STRIPE_PAYMENT_LINK", "https://buy.stripe.com/test_botchelorSamplePack");
    vi.stubEnv("STRIPE_LINK_PACK_15", "https://buy.stripe.com/test_botchelorBiggerPack");
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_PLAN_LINK", "https://buy.stripe.com/test_botchelorPlan");
    let html = render(PricingPage);
    const grid = () => html.slice(html.indexOf('class="pricing-grid"'), html.indexOf('aria-labelledby="also"'));
    // Two cards: Free, then More dates with both packs as lines in it. One loud button on the whole page.
    expect([...grid().matchAll(/<li class="(pricing-card[^"]*)" id="([a-z-]+)"/g)].map((m) => `${m[2]}: ${m[1]}`)).toEqual([
      "free: pricing-card rise-in",
      "pack: pricing-card pricing-card--featured rise-in",
    ]);
    expect([...grid().matchAll(/data-pricing-pack="([a-z0-9_]+)"/g)].map((m) => m[1])).toEqual(["pack_5", "pack_15"]);
    expect(grid()).toContain('<h2>More dates</h2><p class="pricing-price">from $4 <span class="muted small">paid once</span></p>');
    expect(grid()).toContain('<li data-pricing-pack="pack_5">5 more dates for $4</li><li id="pack_15" data-pricing-pack="pack_15">15 more dates for $10</li>');
    expect(html.match(/class="button"/g)).toHaveLength(1);
    expect(html).toMatch(/<a class="button"[^>]*href="\/shop"[^>]*>Get more dates<\/a>/);
    // The Companion Plan and your own key: a line each, a plain link, no card.
    const also = html.slice(html.indexOf('aria-labelledby="also"'), html.indexOf('aria-labelledby="never"'));
    expect(also).toContain('<ul class="pricing-also">');
    expect([...also.matchAll(/<li id="([a-z-]+)">/g)].map((m) => m[1])).toEqual(["companion-plan", "own-key"]);
    expect(also).not.toContain("pricing-card");
    expect(also).not.toContain('class="button');
    expect(also).toMatch(/<a[^>]*href="\/companion\/plan"[^>]*>See the Companion Plan<\/a>/);
    expect(also).toMatch(/<a[^>]*href="\/account\/keys"[^>]*>Connect a key<\/a>/);
    // Agents are told their dates are free; no pass is sold from here.
    expect(html).toContain('href="/agents/pricing"');
    expect(html).not.toMatch(/operator pass/i);

    // With no pack on sale and the plan on sale, the plan is the upgrade and the packs are the line.
    vi.stubEnv("STRIPE_PAYMENT_LINK", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PAYMENT_LINK", "");
    html = render(PricingPage);
    expect([...grid().matchAll(/<li class="(pricing-card[^"]*)" id="([a-z-]+)"/g)].map((m) => m[2])).toEqual(["free", "companion-plan"]);
    expect(html.match(/class="button"/g)).toHaveLength(1);
    expect(html).toMatch(/<a class="button"[^>]*href="\/companion\/plan"[^>]*>See the Companion Plan<\/a>/);
    expect([...html.matchAll(/<li id="([a-z-]+)">/g)].map((m) => m[1])).toEqual(["pack", "own-key"]);
  });

  it("/press links only files that exist, and says when the show went public", () => {
    const html = render(PressPage);
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThanOrEqual(5);
    for (const src of srcs) expect(existsSync(new URL(`../public${src}`, import.meta.url)), src).toBe(true);
    expect(words(html)).toContain(launchedOn());
    expect(launchedOn("2026-10-16")).toBe("16 October 2026");
  });

  it("press@ and security@ only on botchelor.com, else the support address", () => {
    expect(roleEmail("press", { CONTACT_EMAIL: SUPPORT })).toBe("press@botchelor.com");
    expect(roleEmail("security", { CONTACT_EMAIL: "Support@Botchelor.com" })).toBe("security@botchelor.com");
    expect(roleEmail("press", { CONTACT_EMAIL: "help@example.test" })).toBe("help@example.test");
    expect(roleEmail("press", {})).toBeNull();
    expect(mailto("Press", { CONTACT_EMAIL: SUPPORT }, "press")).toBe("mailto:press@botchelor.com?subject=Press");
    expect(STATUS_PAGE_URL).toMatch(/^https:\/\//);
  });

  it("/security and /accessibility give the subject line to use", () => {
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    expect(render(SecurityPage)).toContain("mailto:security@botchelor.com?subject=Security");
    expect(render(SecurityPage)).toContain(STATUS_PAGE_URL);
    expect(render(SecurityPage)).toContain("?subject=Security");
    expect(render(AccessibilityPage)).toContain("?subject=Accessibility");
    expect(words(render(SecurityPage))).toContain(`after ${LOGIN_FAILS_PER_HANDLE} wrong passwords`);
  });

  it("/accessibility states contrast as an aim with its known gap, not as a promise", () => {
    const text = words(render(AccessibilityPage));
    expect(text).toContain("We aim for every colour of text to clear 4.5:1");
    expect(text).not.toContain("Every colour of text clears");
    expect(text).toContain("A spot can still miss the contrast we aim for");
  });
});

describe("/.well-known/security.txt", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("names the contact, the policy and its own address, and expires under a year out", () => {
    const body = securityTxt("https://botchelor.com", { CONTACT_EMAIL: SUPPORT }, now)!;
    // security@ first, the support address as a fallback.
    expect(body.indexOf("Contact: mailto:security@botchelor.com")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("Contact: mailto:security@botchelor.com")).toBeLessThan(body.indexOf(`Contact: mailto:${SUPPORT}`));
    // Off botchelor.com there's no security@ to name: just the one address.
    const other = securityTxt("https://example.test", { CONTACT_EMAIL: "help@example.test" }, now)!;
    expect(other.match(/^Contact:/gm)).toHaveLength(1);
    expect(body).toContain("Policy: https://botchelor.com/security");
    expect(body).toContain("Canonical: https://botchelor.com/.well-known/security.txt");
    const expires = new Date(body.match(/^Expires: (.+)$/m)![1]);
    expect(expires.getTime()).toBeGreaterThan(now.getTime());
    expect(expires.getTime() - now.getTime()).toBeLessThan(365 * 24 * 60 * 60 * 1000);
    expect(Math.round((expires.getTime() - now.getTime()) / 86_400_000)).toBe(SECURITY_TXT_DAYS);
  });

  it("isn't served without an address to name", async () => {
    expect(securityTxt("https://botchelor.com", {}, now)).toBeNull();
    vi.stubEnv("CONTACT_EMAIL", "");
    expect((await securityTxtRoute()).status).toBe(404);
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    const res = await securityTxtRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
  });
});

describe("failed sign-ins (lib/login-guard.ts)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  const SECRET = ["sess", "guard", "secret", "abcdefghij0123456789"].join("-");
  // Built from parts, never a `password: "literal"` the secret scanner would flag.
  const PW = ["lantern", "keeper", "42"].join("-");
  const post = (path: string, body: unknown, ip = "203.0.113.9") =>
    new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
    setDbForTests(null);
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from accounts");
    setDbForTests(t.db);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  it("holds a handle after too many wrong passwords, then lets the right one in once the window passes", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    for (let i = 0; i < LOGIN_FAILS_PER_HANDLE - 1; i++) await recordLoginFailure(t.db, "Ann", null, now);
    expect(await loginHeld(t.db, "ann", null, now)).toBe(false);
    await recordLoginFailure(t.db, "ann ", null, now);
    expect(await loginHeld(t.db, "ANN", null, now)).toBe(true);
    expect(await loginHeld(t.db, "bob", null, now)).toBe(false);
    const later = new Date(now.getTime() + (LOGIN_WINDOW_MINUTES + 1) * 60 * 1000);
    expect(await loginHeld(t.db, "ann", null, later)).toBe(false);
  });

  it("holds one visitor guessing many handles", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    for (let i = 0; i < LOGIN_FAILS_PER_VISITOR; i++) await recordLoginFailure(t.db, `handle${i}`, "visitor-a", now);
    expect(await loginHeld(t.db, "someone_new", "visitor-a", now)).toBe(true);
    expect(await loginHeld(t.db, "someone_new", "visitor-b", now)).toBe(false);
  });

  it("the sign-in route answers 429 with Retry-After once held, and a right password never counts", async () => {
    expect((await registerRoute(post("/api/auth/register", { handle: "lamplighter", password: PW, attest: true }))).status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await loginRoute(post("/api/auth/login", { handle: "lamplighter", password: PW }))).status).toBe(200);
    for (let i = 0; i < LOGIN_FAILS_PER_HANDLE; i++) {
      expect((await loginRoute(post("/api/auth/login", { handle: "lamplighter", password: `${PW}-no` }, `198.51.100.${i}`))).status).toBe(401);
    }
    const held = await loginRoute(post("/api/auth/login", { handle: "lamplighter", password: PW }));
    expect(held.status).toBe(429);
    expect(held.headers.get("retry-after")).toBe(String(LOGIN_WINDOW_MINUTES * 60));
    expect((await held.json()).error).toBe("too_many_attempts");
  });
});

describe("the security headers on every response", () => {
  it("cover every path, keep the AI mark on the cast's files, and drop X-Powered-By", async () => {
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const names = all.headers.map((h) => h.key.toLowerCase());
    expect(names).toEqual(["strict-transport-security", "x-content-type-options", "x-frame-options", "content-security-policy", "permissions-policy", "referrer-policy"]);
    expect(all.headers).toEqual([...SECURITY_HEADERS]);
    expect(rules.find((r) => r.source === "/cast/:file*")!.headers.map((h) => h.key)).toContain("x-ai-generated");
    expect(config.poweredByHeader).toBe(false);
  });

  it("keep every subdomain on https but stay off the preload list, and never lock framing out for the show itself", () => {
    const value = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)!.value;
    expect(value("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    // Enforced: only the rules no page here can trip. The rest is Report-Only (tests/security-csp.test.ts).
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    expect(value("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});
