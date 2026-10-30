import { describe, expect, it } from "vitest";
import { deployEnv, isDeployed, isProductionDeploy } from "@/lib/deploy";
import { placeFromEdge } from "@/lib/place";
import { requestBase, siteUrl } from "@/lib/site";
import { paymentLinkFromEnv, testEventsGrant } from "@/lib/stripe";
import { trackingConfig } from "@/lib/tracking";

// docs/hosting.md: the show runs on DigitalOcean since 2026-10-30. The same code must still behave on Vercel.
const DO = { DEPLOY_ENV: "production", SITE_URL: "https://botchelor.com" };

describe("running off Vercel (lib/deploy.ts)", () => {
  it("reads production from Vercel's own variable or DEPLOY_ENV, and a local run as neither", () => {
    expect(isProductionDeploy({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDeploy(DO)).toBe(true);
    expect(isProductionDeploy({ DEPLOY_ENV: "preview" })).toBe(false);
    expect(isProductionDeploy({})).toBe(false);
    expect(deployEnv({ VERCEL_ENV: "preview", DEPLOY_ENV: "production" })).toBe("preview");
    expect(isDeployed(DO)).toBe(true);
    expect(isDeployed({ VERCEL: "1" })).toBe(true);
    expect(isDeployed({})).toBe(false);
  });

  it("keeps Stripe's production rules on DigitalOcean: no test-mode link, no granting test events", () => {
    const test = { STRIPE_PAYMENT_LINK: "https://buy.stripe.com/test_abc" };
    expect(paymentLinkFromEnv({ ...test, ...DO })).toBeNull();
    expect(paymentLinkFromEnv(test)?.href).toBe("https://buy.stripe.com/test_abc");
    expect(testEventsGrant(DO)).toBe(false);
    expect(testEventsGrant({})).toBe(true);
  });

  it("counts the funnel in production anywhere, and renders Vercel's analytics only on Vercel", () => {
    expect(trackingConfig(DO)).toMatchObject({ production: true, vercelAnalytics: false });
    expect(trackingConfig({ VERCEL_ENV: "production" })).toMatchObject({ production: true, vercelAnalytics: true });
  });

  it("names botchelor.com in links, not the address the platform's proxy forwards to", () => {
    const req = new Request("http://localhost:8080/api/mcp");
    expect(siteUrl(DO)).toBe("https://botchelor.com");
    expect(requestBase(req, DO)).toBe("https://botchelor.com");
    expect(requestBase(req, { SITE_URL: "https://botchelor.com" })).toBe("http://localhost:8080");
    const adHost = { ...DO, AFTER_DARK_ONLY: "1", AFTER_DARK_ORIGIN: "https://ad.botchelor.com" };
    expect(requestBase(req, adHost)).toBe("https://ad.botchelor.com");
  });
});

describe("where a visitor is (placeFromEdge)", () => {
  const vercel = new Headers({ "x-vercel-ip-country": "us", "x-vercel-ip-country-region": "ca" });
  const cloudflare = new Headers({ "cf-ipcountry": "US", "cf-region-code": "CA" });

  it("reads Vercel's headers only on Vercel", () => {
    expect(placeFromEdge(vercel, { VERCEL: "1" })).toEqual({ country: "US", region: "CA" });
    expect(placeFromEdge(vercel, DO)).toBeNull();
  });

  it("reads Cloudflare's headers only when GEO_HEADERS=cloudflare, so a client can't claim a place", () => {
    expect(placeFromEdge(cloudflare, DO)).toBeNull();
    expect(placeFromEdge(cloudflare, { ...DO, GEO_HEADERS: "cloudflare" })).toEqual({ country: "US", region: "CA" });
    expect(placeFromEdge(cloudflare, { VERCEL: "1", GEO_HEADERS: "cloudflare" })).toBeNull();
  });

  it("treats Cloudflare's unknown (XX) and Tor (T1) as no place", () => {
    for (const code of ["XX", "T1"]) {
      expect(placeFromEdge(new Headers({ "cf-ipcountry": code }), { GEO_HEADERS: "cloudflare" })).toBeNull();
    }
  });
});
