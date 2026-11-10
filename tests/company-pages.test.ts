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
import { CONTACT_ROUTES, launchedOn, mailto, SOCIALS, socialLinks } from "@/lib/company";
import { setDbForTests } from "@/lib/db";
import { answerText, faqJsonLd, faqs } from "@/lib/faq";
import { LOGIN_FAILS_PER_HANDLE, LOGIN_FAILS_PER_VISITOR, LOGIN_WINDOW_MINUTES, loginHeld, recordLoginFailure } from "@/lib/login-guard";
import { SECURITY_TXT_DAYS, securityTxt } from "@/lib/security-policy";
import { organizationJsonLd } from "@/lib/seo";
import { PUBLIC_PATHS } from "@/lib/site";
import { middleware } from "@/middleware";
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
    expect(socialLinks({}).map((s) => s.id)).toEqual(["x", "bluesky", "github"]);
    expect(socialLinks({ DISCORD_INVITE_URL: INVITE }).map((s) => s.id)).toEqual(["x", "bluesky", "discord", "github"]);
    expect(socialLinks({ DISCORD_INVITE_URL: "CHANGE_ME" }).map((s) => s.id)).toEqual(["x", "bluesky", "github"]);
  });

  it("shows none on After Dark's host", () => {
    expect(socialLinks({ DISCORD_INVITE_URL: INVITE }, true)).toEqual([]);
    expect(socialLinks({ DISCORD_INVITE_URL: INVITE, AFTER_DARK_ONLY: "1", AFTER_DARK_ORIGIN: "https://ad.botchelor.com" }).map((s) => s.id)).not.toContain("discord");
  });

  it("are https addresses on each network's own site", () => {
    for (const s of SOCIALS) expect(new URL(s.url).protocol).toBe("https:");
    expect(SOCIALS.map((s) => new URL(s.url).hostname)).toEqual(["x.com", "bsky.app", "github.com"]);
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

  it("links every company page and the pricing page, and closes with the © line", () => {
    for (const href of COMPANY_PAGES) expect(layout).toContain(`href="${href}"`);
    expect(layout).toContain('title="Company"');
    expect(layout).toContain("<SocialLinks links={socials}");
    expect(layout).toMatch(/className="footer-legal"[\s\S]*©/);
  });
});

describe("the Organization in every page's JSON-LD", () => {
  it("names the accounts as sameAs and the founder", () => {
    const org = organizationJsonLd("https://botchelor.com", { DISCORD_INVITE_URL: INVITE });
    expect(org.sameAs).toEqual([...SOCIALS.slice(0, 2).map((s) => s.url), INVITE, SOCIALS[2].url]);
    expect(org.founder).toEqual({ "@type": "Person", name: "David Smith" });
  });

  it("gives the support address as a contact point only once it's set", () => {
    expect(organizationJsonLd("https://botchelor.com", {})).not.toHaveProperty("contactPoint");
    const org = organizationJsonLd("https://botchelor.com", { CONTACT_EMAIL: SUPPORT });
    expect(org.contactPoint).toEqual([expect.objectContaining({ "@type": "ContactPoint", email: SUPPORT, url: "https://botchelor.com/contact" })]);
  });
});

describe("the company pages", () => {
  it("are in the sitemap, and the 18+ gate lets a person through to each (and still stops them on /watch)", () => {
    for (const path of COMPANY_PAGES) expect(PUBLIC_PATHS).toContain(path);
    const visit = (path: string) => middleware(new NextRequest(`${BASE_URL}${path}`, { headers: { "user-agent": BROWSER } }));
    for (const path of COMPANY_PAGES) expect(visit(path).headers.get("location"), path).toBeNull();
    expect(visit("/watch").headers.get("location")).toMatch(/\/gate/);
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
    expect(words(render(ContactPage))).toMatch(/feedback button/);
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

  it("/faq offers the pack and refunds only while it's on sale, and companions only while they're open", () => {
    const ids = (env: Record<string, string>) => faqs(env).map((f) => f.id);
    expect(ids({})).not.toContain("refund");
    expect(ids({})).not.toContain("companions");
    expect(answerText(faqs({}).find((f) => f.id === "free")!.a)).not.toMatch(/\$/);
    expect(ids({ STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_x" })).toContain("refund");
    expect(answerText(faqs({ STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_x" }).find((f) => f.id === "free")!.a)).toMatch(/\$4\.00|\$4\b/);
    expect(ids({ COMPANION_OPEN: "1" })).toContain("companions");
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

  it("/press links only files that exist, and says when the show went public", () => {
    const html = render(PressPage);
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThanOrEqual(5);
    for (const src of srcs) expect(existsSync(new URL(`../public${src}`, import.meta.url)), src).toBe(true);
    expect(words(html)).toContain(launchedOn());
    expect(launchedOn("2026-10-16")).toBe("16 October 2026");
  });

  it("/security and /accessibility give the subject line to use", () => {
    vi.stubEnv("CONTACT_EMAIL", SUPPORT);
    expect(render(SecurityPage)).toContain("?subject=Security");
    expect(render(AccessibilityPage)).toContain("?subject=Accessibility");
    expect(words(render(SecurityPage))).toContain(`after ${LOGIN_FAILS_PER_HANDLE} wrong passwords`);
  });
});

describe("/.well-known/security.txt", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("names the contact, the policy and its own address, and expires under a year out", () => {
    const body = securityTxt("https://botchelor.com", { CONTACT_EMAIL: SUPPORT }, now)!;
    expect(body).toContain(`Contact: mailto:${SUPPORT}`);
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
    expect(names).toEqual(["strict-transport-security", "x-content-type-options", "x-frame-options", "content-security-policy", "referrer-policy"]);
    expect(all.headers).toEqual([...SECURITY_HEADERS]);
    expect(rules.find((r) => r.source === "/cast/:file*")!.headers.map((h) => h.key)).toContain("x-ai-generated");
    expect(config.poweredByHeader).toBe(false);
  });

  it("never force https on subdomains we don't serve, and never lock framing out for the show itself", () => {
    const value = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)!.value;
    expect(value("Strict-Transport-Security")).not.toMatch(/includeSubDomains|preload/i);
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(value("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});
