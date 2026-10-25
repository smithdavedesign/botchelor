import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegalPage from "@/app/legal/page";
import * as ogImage from "@/app/opengraph-image";
import PrivacyPage from "@/app/privacy/page";
import robots from "@/app/robots";
import { GET as llmsGet } from "@/app/llms.txt/route";
import { GET as llmGet } from "@/app/llm.txt/route";
import { GET as schemaGet } from "@/app/character.schema.json/route";
import { characterSchema, llmsText } from "@/lib/agents";
import BuyButton from "@/app/shop/BuyButton";
import { staticSitemap } from "@/lib/seo";
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

  it("lets crawlers and AI agents in by name, opens the MCP server, keeps them out of the rest of the API", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.vercel.app");
    const r = robots();
    expect(r.sitemap).toBe("https://botchelor.vercel.app/sitemap.xml");
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const everyone = rules.find((x) => x.userAgent === "*")!;
    expect(everyone.allow).toEqual(expect.arrayContaining(["/", "/api/mcp", "/api/episodes"]));
    expect(everyone.disallow).toEqual(expect.arrayContaining(["/api/", "/account", "/admin"]));
    const named = rules.find((x) => Array.isArray(x.userAgent))!;
    expect(named.userAgent).toEqual(expect.arrayContaining(["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]));
    expect(named.allow).toEqual(expect.arrayContaining(["/", "/api/mcp"]));
  });

  it("lists the public pages in the static part of the sitemap, and nothing private", () => {
    const urls = staticSitemap("https://botchelor.vercel.app").map((e) => e.url);
    expect(urls).toEqual(
      [
        "/",
        "/create",
        "/watch",
        "/reunion",
        "/graph",
        "/characters",
        "/characters?tab=people",
        "/characters?tab=agents",
        "/agents",
        "/shop",
        "/terms",
        "/privacy",
        "/content-policy",
        "/report",
        "/cancel",
        "/2257",
        "/tools/ship-name-generator",
        "/tools/oc-chemistry-test",
      ].map(
        (p) => `https://botchelor.vercel.app${p}`,
      ),
    );
    expect(urls.join(" ")).not.toMatch(/\/api\/|\/leagues\/|\/watch\/|\/account|\/admin/);
  });

  it("has a 1200×630 PNG og:image, described for screen readers", () => {
    expect(ogImage.size).toEqual({ width: 1200, height: 630 });
    expect(ogImage.contentType).toBe("image/png");
    expect(ogImage.alt).toMatch(/Botchelor/);
    expect(typeof ogImage.default).toBe("function");
  });

  it("serves /llms.txt: an agent-facing welcome with the feed, the schema, the rules and absolute links", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.vercel.app");
    const body = llmsText();
    expect(body).toMatch(/^# Botchelor/);
    expect(body).toMatch(/you are welcome here/i);
    expect(body).toMatch(/a place to belong/i);
    expect(body).toMatch(/https:\/\/botchelor\.vercel\.app\/watch/);
    expect(body).toMatch(/https:\/\/botchelor\.vercel\.app\/character\.schema\.json/);
    expect(body).toMatch(/POST https:\/\/botchelor\.vercel\.app\/api\/mcp/);
    expect(body).toMatch(/GET https:\/\/botchelor\.vercel\.app\/api\/episodes/);
    expect(body).toMatch(/deterministic engine/);

    const res = await llmsGet(new Request("http://localhost/llms.txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toMatch(/Botchelor/);
  });

  it("serves /llm.txt as an alias of /llms.txt (same body)", async () => {
    const req = () => new Request("http://localhost/llms.txt");
    expect(await (await llmGet(req())).text()).toBe(await (await llmsGet(req())).text());
  });

  it("serves /character.schema.json accurate to the real character API (18+, 3 traits, attest, no avatarPrompt)", async () => {
    const schema = characterSchema("https://botchelor.vercel.app") as {
      required: string[];
      properties: Record<string, Record<string, unknown>>;
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(["name", "age", "bio", "traits", "want", "dealbreaker", "attest"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.age.minimum).toBe(18);
    expect(schema.properties.bio.maxLength).toBe(500); // the real cap, not OpenClaw's 200
    expect(schema.properties.want.maxLength).toBe(180); // lib/field-limits.ts, as the API checks
    expect((schema.properties.traits.items as { maxLength: number }).maxLength).toBe(50);
    expect(schema.properties.traits.minItems).toBe(3);
    expect(schema.properties.traits.maxItems).toBe(3);
    expect(schema.properties.attest.const).toBe(true);
    expect(schema.properties).not.toHaveProperty("avatarPrompt"); // no generated avatars ($0 rule)

    const res = schemaGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/schema\+json|application\/json/);
    expect(JSON.parse(await res.text()).title).toMatch(/Botchelor/);
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
