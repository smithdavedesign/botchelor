import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegalPage from "@/app/legal/page";
import * as ogImage from "@/app/opengraph-image";
import PrivacyPage from "@/app/privacy/page";
import robots from "@/app/robots";
import BuyButton from "@/app/shop/BuyButton";
import sitemap from "@/app/sitemap";
import TermsPage from "@/app/terms/page";
import { siteUrl } from "@/lib/site";

afterEach(() => {
  vi.unstubAllEnvs();
});

const render = (page: () => React.ReactElement) => renderToStaticMarkup(createElement(page));

describe("terms and privacy pages (REVENUE.md: must exist before charging)", () => {
  it("has terms with who it's for, free points, what you can buy through Stripe's Payment Link, and refunds", () => {
    const html = render(TermsPage);
    expect(html).toMatch(/<h1>Terms<\/h1>/);
    expect(html).toMatch(/adults \(18\+\)/);
    expect(html).toMatch(/Points are free/);
    expect(html).toMatch(/can(&#x27;|')t be bought/);
    expect(html).toMatch(/5 more dates/);
    expect(html).toMatch(/Payment Link/);
    expect(html).toMatch(/refund you in full/);
    expect(html).not.toMatch(/Stripe Checkout/);
  });

  it("has a privacy notice with what is stored, what Stripe gets, and who processes it", () => {
    const html = render(PrivacyPage);
    expect(html).toMatch(/<h1>Privacy<\/h1>/);
    expect(html).toMatch(/anonymous random ID in a cookie/);
    expect(html).toMatch(/checkout ID links your purchases in this browser to your Stripe receipt/);
    expect(html).toMatch(/random order reference, never your cookie/);
    expect(html).toMatch(/Gemini/);
    expect(html).toMatch(/waitlist/i);
  });

  it("shows the CONTACT_EMAIL on both, and says so plainly when it isn't set", () => {
    vi.stubEnv("CONTACT_EMAIL", "help@botchelor.example");
    for (const page of [TermsPage, PrivacyPage]) expect(render(page)).toContain('href="mailto:help@botchelor.example"');
    vi.stubEnv("CONTACT_EMAIL", "");
    for (const page of [TermsPage, PrivacyPage]) expect(render(page)).toMatch(/contact address will be posted here/i);
  });

  it("renders both per request (so a CONTACT_EMAIL added later shows), and /legal still has everything", async () => {
    expect((await import("@/app/terms/page")).dynamic).toBe("force-dynamic");
    expect((await import("@/app/privacy/page")).dynamic).toBe("force-dynamic");
    const legal = render(LegalPage);
    expect(legal).toMatch(/Who Botchelor is for/);
    expect(legal).toMatch(/What we store/);
    expect(legal).toContain('href="/terms"');
    expect(legal).toContain('href="/privacy"');
  });

  it("links terms and privacy from the site footer", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('href="/terms"');
    expect(layout).toContain('href="/privacy"');
  });
});

describe("launch checks: robots.txt, sitemap and og:image", () => {
  it("uses the Vercel production URL as the site's address, and localhost elsewhere", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "botchelor.vercel.app" })).toBe("https://botchelor.vercel.app");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });

  it("lets crawlers in, keeps them out of the API, and points them at the sitemap", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.vercel.app");
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://botchelor.vercel.app/sitemap.xml",
    });
  });

  it("lists the public pages in the sitemap, and nothing private", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.vercel.app");
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual(["/", "/feed", "/shop", "/terms", "/privacy"].map((p) => `https://botchelor.vercel.app${p}`));
    expect(urls.join(" ")).not.toMatch(/\/api\/|\/leagues\/|\/episodes\//);
  });

  it("has a 1200×630 PNG og:image, described for screen readers", () => {
    expect(ogImage.size).toEqual({ width: 1200, height: 630 });
    expect(ogImage.contentType).toBe("image/png");
    expect(ogImage.alt).toMatch(/Botchelor/);
    expect(typeof ogImage.default).toBe("function");
  });
});

describe("the shop's Buy button (Stripe Payment Link)", () => {
  it("shows the owner's price label, and asks for the 18+ and terms checkbox", () => {
    const html = renderToStaticMarkup(createElement(BuyButton, { sku: "pack_5", label: "5 more dates · $4", disabled: false }));
    expect(html).toContain("5 more dates · $4");
    expect(html).toMatch(/name="attest"/);
    expect(html).toMatch(/18 or older/);
    expect(html).toContain('href="/terms"');
    expect(html).not.toMatch(/disabled=""/);
  });

  it("is disabled while purchases aren't open", () => {
    const html = renderToStaticMarkup(createElement(BuyButton, { sku: "pack_5", label: "Buy for $4", disabled: true }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
