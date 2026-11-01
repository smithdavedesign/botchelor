import { existsSync } from "node:fs";
import type { Metadata } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The shop reads the viewer from next/headers: an anonymous visitor here.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));

import { trackConversion } from "@/app/conversion";
import { configureFunnel, isProductionBuild, NOTRACK_KEY, sendFunnel, SIGNAL_URL } from "@/app/funnel";
import JsonLd from "@/app/JsonLd";
import { metadata as rootMetadata } from "@/app/layout";
import * as ogImage from "@/app/opengraph-image";
import PrivacyPage from "@/app/privacy/page";
import robots from "@/app/robots";
import ShopPage from "@/app/shop/page";
import sitemap from "@/app/sitemap";
import TermsPage from "@/app/terms/page";
import { setDbForTests, type Db } from "@/lib/db";
import { SHARE_IMAGE, siteJsonLd, siteOffers } from "@/lib/seo";
import { PUBLIC_PATHS } from "@/lib/site";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** React escapes quotes and apostrophes; tests compare against the plain text. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

type PageModule = { metadata?: Metadata; generateMetadata?: (props: never) => Promise<Metadata> };
/** A page's own metadata: its static export, or what generateMetadata says for these search params. */
const meta = (load: () => Promise<PageModule>, search: Record<string, string> = {}) => async (): Promise<Metadata> => {
  const page = await load();
  if (page.metadata) return page.metadata;
  return page.generateMetadata!({ searchParams: Promise.resolve(search) } as never);
};

/** Every public page (the sitemap's static part, and /legal) and where its metadata comes from. */
const PAGES: Record<(typeof PUBLIC_PATHS)[number] | "/legal", () => Promise<Metadata>> = {
  "/": meta(() => import("@/app/page")),
  "/create": meta(() => import("@/app/create/page")),
  "/watch": meta(() => import("@/app/watch/page")),
  "/reunion": meta(() => import("@/app/reunion/page")),
  "/graph": meta(() => import("@/app/graph/page")),
  "/characters": meta(() => import("@/app/characters/page")),
  "/characters?tab=people": meta(() => import("@/app/characters/page"), { tab: "people" }),
  "/characters?tab=agents": meta(() => import("@/app/characters/page"), { tab: "agents" }),
  "/agents": meta(() => import("@/app/agents/page")),
  "/reviews": meta(() => import("@/app/reviews/page")),
  "/shop": meta(() => import("@/app/shop/page")),
  "/terms": meta(() => import("@/app/terms/page")),
  "/privacy": meta(() => import("@/app/privacy/page")),
  "/content-policy": meta(() => import("@/app/content-policy/page")),
  "/report": meta(() => import("@/app/report/page")),
  "/cancel": meta(() => import("@/app/cancel/page")),
  "/2257": meta(() => import("@/app/2257/page")),
  "/tools/ship-name-generator": meta(() => import("@/app/tools/ship-name-generator/page")),
  "/tools/oc-chemistry-test": meta(() => import("@/app/tools/oc-chemistry-test/page")),
  "/prompts": meta(() => import("@/app/prompts/page")),
  "/about": meta(() => import("@/app/about/page")),
  "/safety": meta(() => import("@/app/safety/page")),
  "/agents/pricing": meta(() => import("@/app/agents/pricing/page")),
  "/showcase": meta(() => import("@/app/showcase/page")),
  "/legal": meta(() => import("@/app/legal/page")),
};

type Og = { url?: string; type?: string; siteName?: string; images?: { url: string; width?: number; height?: number }[] };

describe("search and sharing: every public page", () => {
  it("covers every page in the sitemap", () => {
    expect(Object.keys(PAGES)).toEqual(expect.arrayContaining([...PUBLIC_PATHS]));
  });

  it("has its own title and description, a canonical URL, Open Graph and a large Twitter card", async () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const [path, load] of Object.entries(PAGES)) {
      const m = await load();
      const title = String(m.title ?? "");
      const description = String(m.description ?? "");
      expect(title, path).toMatch(/Botchelor/);
      expect(description.length, `${path} description`).toBeGreaterThan(50);
      expect(titles.get(title), `${path} shares its title with ${titles.get(title)}`).toBeUndefined();
      expect(descriptions.get(description), `${path} shares its description with ${descriptions.get(description)}`).toBeUndefined();
      titles.set(title, path);
      descriptions.set(description, path);

      expect(m.alternates?.canonical, path).toBe(path);
      const og = m.openGraph as Og | undefined;
      expect(og?.url, path).toBe(path);
      expect(og?.siteName, path).toBe("Botchelor");
      expect(m.openGraph?.title, path).toBeTruthy();
      expect((m.twitter as { card?: string } | undefined)?.card, path).toBe("summary_large_image");
      // The share card: named here at 1200×630, or drawn by an opengraph-image file beside the page (which Next uses
      // only when the page's openGraph names no image).
      if (og?.images) {
        expect(og.images[0], path).toMatchObject({ width: 1200, height: 630 });
      } else {
        const own = new URL(`../app${path.split("?")[0]}/opengraph-image.tsx`, import.meta.url);
        expect(existsSync(own), `${path} has no share image`).toBe(true);
      }
    }
  });

  it("names the site's 1200×630 card with the card's own size and alt", () => {
    expect(ogImage.size).toEqual({ width: SHARE_IMAGE.width, height: SHARE_IMAGE.height });
    expect(SHARE_IMAGE).toMatchObject({ url: "/opengraph-image", width: 1200, height: 630, alt: ogImage.alt });
  });

  it("leaves og:title and twitter:title to each page, so a page that sets neither never borrows the home page's", () => {
    expect(rootMetadata.openGraph).toEqual({ type: "website", siteName: "Botchelor", locale: "en_US" });
    expect(rootMetadata.twitter).toEqual({ card: "summary_large_image" });
  });
});

describe("JSON-LD: the show as a SoftwareApplication with its price", () => {
  const app = (env: Record<string, string | undefined>) => {
    const [doc] = siteJsonLd("https://botchelor.com", env) as { "@graph": Record<string, unknown>[] }[];
    return doc["@graph"].find((node) => node["@type"] === "SoftwareApplication") as { offers: Record<string, unknown>[] };
  };

  it("offers the $4 pack, once, while purchases are open, beside the free dates", () => {
    const { offers } = app({ STRIPE_PAYMENT_LINK: "https://example.com/pay" });
    expect(offers).toEqual([
      expect.objectContaining({ "@type": "Offer", price: "0", priceCurrency: "USD" }),
      expect.objectContaining({ "@type": "Offer", name: "5 more dates", price: "4.00", priceCurrency: "USD", url: "https://botchelor.com/shop" }),
    ]);
    expect(String(offers[1].description)).toMatch(/\$4, paid once\. Not a subscription\./);
  });

  it("lists only the free dates while there's no Payment Link (nothing to buy yet)", () => {
    expect(siteOffers({}, "https://botchelor.com")).toEqual([expect.objectContaining({ price: "0" })]);
  });

  it("renders as one ld+json script that a character's text can't close", () => {
    const html = renderToStaticMarkup(createElement(JsonLd, { data: siteJsonLd("https://botchelor.com", {}) }));
    expect(html).toMatch(/^<script type="application\/ld\+json">/);
    expect(html).toContain('"@type":"SoftwareApplication"');
  });
});

describe("robots.txt and sitemap.xml", () => {
  it("both exist as the framework's own routes", () => {
    expect(existsSync(new URL("../app/robots.ts", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../app/sitemap.ts", import.meta.url))).toBe(true);
  });

  it("robots.txt allows indexing, lets crawlers fetch the share cards, and points at the sitemap", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    const r = robots();
    const everyone = (Array.isArray(r.rules) ? r.rules : [r.rules]).find((rule) => rule.userAgent === "*")!;
    expect(everyone.allow).toEqual(expect.arrayContaining(["/", "/api/og/"]));
    expect(everyone.disallow).not.toContain("/");
    expect(r.sitemap).toBe("https://botchelor.com/sitemap.xml");
  });

  it("sitemap.xml lists the public pages, the policy pages among them, even when the database is down", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    const down: Db = {
      async query() {
        throw new Error("connection refused");
      },
      async exec() {},
    };
    setDbForTests(down);
    try {
      const urls = (await sitemap()).map((entry) => entry.url);
      expect(urls).toEqual(PUBLIC_PATHS.map((path) => `https://botchelor.com${path}`));
      expect(urls).toEqual(expect.arrayContaining(["https://botchelor.com/privacy", "https://botchelor.com/terms", "https://botchelor.com/shop"]));
    } finally {
      setDbForTests(null);
    }
  });
});

describe("the shop's Buy button", () => {
  const renderShop = async () => text(renderToStaticMarkup(await ShopPage({ searchParams: Promise.resolve({}) })));
  const noPaymentEnv = () => {
    for (const key of ["STRIPE_PAYMENT_LINK", "NEXT_PUBLIC_STRIPE_PAYMENT_LINK", "STRIPE_PRICE_LABEL", "SESSION_SECRET", "AFTER_DARK_ONLY", "VERCEL_ENV", "DEPLOY_ENV"]) {
      vi.stubEnv(key, "");
    }
  };

  it("is shown but disabled while STRIPE_PAYMENT_LINK is unset, under the notice", async () => {
    noPaymentEnv();
    const html = await renderShop();
    expect(html).toContain("Purchases open soon");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toMatch(/<input(?=[^>]*name="attest")[^>]*disabled=""/);
  });

  it("shows once the link is set, with the price, and never puts the link itself in the page", async () => {
    noPaymentEnv();
    vi.stubEnv("STRIPE_PAYMENT_LINK", "https://example.com/pay");
    const html = await renderShop();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Buy 5 more dates for \$4<\/button>/);
    expect(html).toContain('name="attest"');
    expect(html).not.toContain("Purchases open soon");
    // /api/checkout hands the link out with an order reference; the page never carries it.
    expect(html).not.toContain("example.com/pay");
  });

  it("reads NEXT_PUBLIC_STRIPE_PAYMENT_LINK as well", async () => {
    noPaymentEnv();
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PAYMENT_LINK", "https://example.com/pay");
    expect(await renderShop()).toMatch(/>Buy 5 more dates for \$4</);
  });
});

describe("privacy and terms, plainly", () => {
  it("the privacy notice names the beacon's three events, says no cookies, and when the referrer goes", () => {
    const html = text(renderToStaticMarkup(createElement(PrivacyPage)));
    expect(html).toContain("<code>visit</code> (once per browser session)");
    expect(html).toContain("<code>activate</code> (the first date this browser starts, once)");
    expect(html).toContain("<code>checkout</code> (a click on Buy)");
    expect(html).toMatch(/three events, with no cookies/);
    expect(html).toMatch(/only when it's another site, never one of our own pages/);
    expect(html).toMatch(/Give us feedback/);
  });

  it("the terms say no warranty, the price once, and the refund", () => {
    const html = text(renderToStaticMarkup(createElement(TermsPage)));
    expect(html).toMatch(/<h2 id="disclaimers">No warranties<\/h2>/);
    expect(html).toMatch(/“as is” and “as\s+available”/);
    expect(html).toContain("It costs <strong>$4 once</strong>");
    expect(html).toMatch(/isn't a subscription/);
    expect(html).toMatch(/within 14 days of buying it, email us with your Stripe receipt and we'll refund you in full/);
  });
});

describe("the visit beacon (RepoHQ)", () => {
  const SITE = "https://botchelor.com";
  function browserAt(path: string, referrer = "", { webdriver = false } = {}) {
    const store = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    };
    const url = new URL(path, SITE);
    const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    const local = store();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { cookie: "", referrer });
    vi.stubGlobal("location", { origin: url.origin, pathname: url.pathname, search: url.search });
    vi.stubGlobal("navigator", { webdriver });
    vi.stubGlobal("sessionStorage", store());
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("fetch", send);
    configureFunnel({ production: true, consentDefault: true });
    const beacons = () => send.mock.calls.filter(([to]) => to === SIGNAL_URL);
    return { local, beacons, kinds: () => beacons().map(([, init]) => JSON.parse(String(init.body)).kind) };
  }

  it("POSTs {slug, kind, referrer} fire-and-forget: keepalive, no cookies", () => {
    const { beacons } = browserAt("/watch", "https://www.reddit.com/r/CharacterAI/");
    sendFunnel("visit");
    const [[url, init]] = beacons();
    expect(url).toBe(SIGNAL_URL);
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(JSON.parse(String(init.body))).toMatchObject({ slug: "botchelor", kind: "visit", referrer: "https://www.reddit.com/r/CharacterAI/" });
  });

  it("sends visit once a session, activate once a browser, and checkout on every Buy click", () => {
    const { kinds } = browserAt("/shop");
    sendFunnel("visit");
    sendFunnel("visit");
    sendFunnel("activate");
    sendFunnel("activate");
    sendFunnel("checkout");
    sendFunnel("checkout");
    expect(kinds()).toEqual(["visit", "activate", "checkout", "checkout"]);
  });

  it("activate is starting a date, the show's core action", () => {
    const { kinds } = browserAt("/create");
    trackConversion("date_started", { mode: "partner" });
    expect(kinds()).toEqual(["activate"]);
  });

  it("sends null as the referrer for our own pages, so a shared link never leaves the page", () => {
    const { beacons } = browserAt("/watch", `${SITE}/episodes/ep-1?ref=share`);
    sendFunnel("visit");
    expect(JSON.parse(String(beacons()[0][1].body)).referrer).toBeNull();
  });

  it("sends nothing from an automated browser, the owner's browser, or anything but the production build", () => {
    const bot = browserAt("/", "", { webdriver: true });
    sendFunnel("visit");
    expect(bot.beacons()).toHaveLength(0);

    const owner = browserAt("/");
    owner.local.setItem(NOTRACK_KEY, "1");
    sendFunnel("visit");
    expect(owner.beacons()).toHaveLength(0);

    const preview = browserAt("/");
    configureFunnel({ production: false, consentDefault: true });
    sendFunnel("visit");
    expect(preview.beacons()).toHaveLength(0);
  });

  it("counts only the production build: NEXT_PUBLIC_DEPLOY_ENV, else NEXT_PUBLIC_VERCEL_ENV, else the server's say", () => {
    expect(isProductionBuild({ NEXT_PUBLIC_DEPLOY_ENV: "production" }, false)).toBe(true); // the Cloudflare build
    expect(isProductionBuild({ NEXT_PUBLIC_DEPLOY_ENV: "preview", NEXT_PUBLIC_VERCEL_ENV: "production" }, true)).toBe(false);
    expect(isProductionBuild({ NEXT_PUBLIC_VERCEL_ENV: "production" }, false)).toBe(true); // Vercel production
    expect(isProductionBuild({ NEXT_PUBLIC_VERCEL_ENV: "preview" }, true)).toBe(false); // a Vercel preview
    expect(isProductionBuild({}, true)).toBe(true); // DigitalOcean: DEPLOY_ENV=production on the server
    expect(isProductionBuild({}, false)).toBe(false); // a local run
  });
});
