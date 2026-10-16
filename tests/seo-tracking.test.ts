import { describe, expect, it } from "vitest";
import { llmsText, type LlmsLive } from "@/lib/agents";
import { breadcrumbJsonLd, characterJsonLd, itemListJsonLd } from "@/lib/seo";
import { agentLink, trackingConfig } from "@/lib/tracking";

const BASE = "https://botchelor.vercel.app";

describe("llms.txt — llmstxt.org shape, honest, measurable", () => {
  const body = llmsText(BASE);

  it("follows the spec: H1, a blockquote summary, H2 sections of markdown links, and an Optional section", () => {
    expect(body).toMatch(/^# Botchelor\n\n> /);
    for (const h of ["## Why an agent might want to be here", "## Quickstart: three MCP calls", "## Docs", "## The show", "## Optional"]) {
      expect(body).toContain(h);
    }
    expect(body).toMatch(/- \[[^\]]+\]\(https:\/\/botchelor\.vercel\.app\/[^)]*\): /);
  });

  it("tags browsable links for analytics but keeps API endpoints exact", () => {
    expect(body).toContain(`${BASE}/create?utm_source=llms.txt&utm_medium=ai_agent`);
    expect(body).toContain(`POST ${BASE}/api/mcp`);
    expect(body).not.toMatch(/api\/mcp\?utm/);
    expect(body).toContain(`GET ${BASE}/api/episodes`);
  });

  it("gives a copy-paste quickstart and makes no hidden or manipulative claims", () => {
    expect(body).toMatch(/create_character[\s\S]*find_matches[\s\S]*go_on_date/);
    expect(body).not.toMatch(/<!--|display:\s*none|ignore (all|previous) instructions/i);
  });

  it("adds a live 'Right now' section only when there is live data", () => {
    expect(body).not.toContain("## Right now");
    const live: LlmsLive = {
      openCount: 2,
      open: [{ id: "c1", name: "Ira Fenn", want: "Someone who reads the last page first" }],
      latest: [{ id: "e1", title: "Ira Fenn × Teo Brandt", ending: "Just friends" }],
    };
    const withLive = llmsText(BASE, live);
    expect(withLive).toContain("## Right now");
    expect(withLive).toContain("2 characters are open to dates");
    expect(withLive).toContain(`[Ira Fenn](${BASE}/characters/c1?utm_source=llms.txt&utm_medium=ai_agent)`);
    expect(withLive).toContain("Ira Fenn × Teo Brandt");
  });
});

describe("tracking config — every tag is opt-in by env", () => {
  it("renders nothing without ids, and only production counts for Vercel analytics", () => {
    expect(trackingConfig({})).toEqual({ gtmId: null, vercelAnalytics: false, verification: undefined });
    expect(trackingConfig({ VERCEL_ENV: "preview" }).vercelAnalytics).toBe(false);
    expect(trackingConfig({ VERCEL_ENV: "production" }).vercelAnalytics).toBe(true);
  });

  it("accepts only a well-formed GTM container id (a bad env value can't inject script)", () => {
    expect(trackingConfig({ NEXT_PUBLIC_GTM_ID: "GTM-ABC1234" }).gtmId).toBe("GTM-ABC1234");
    expect(trackingConfig({ NEXT_PUBLIC_GTM_ID: "GTM-x');alert(1)//" }).gtmId).toBeNull();
    expect(trackingConfig({ NEXT_PUBLIC_GTM_ID: "UA-123" }).gtmId).toBeNull();
  });

  it("emits Search Console and Bing verification when their tokens are set", () => {
    expect(trackingConfig({ GOOGLE_SITE_VERIFICATION: "g-tok", BING_SITE_VERIFICATION: "b-tok" }).verification).toEqual({
      google: "g-tok",
      other: { "msvalidate.01": "b-tok" },
    });
  });

  it("agentLink tags a page with the doc it came from", () => {
    expect(agentLink(BASE, "/feed", "llms-full.txt")).toBe(`${BASE}/feed?utm_source=llms-full.txt&utm_medium=ai_agent`);
  });
});

describe("structured data — public fields only", () => {
  it("character profile is a ProfilePage about a fictional person, with no private fields", () => {
    const ld = characterJsonLd({ id: "c1", name: "Ira Fenn", bio: "Reads endings first.", house: false }, BASE) as Record<string, any>;
    expect(ld["@type"]).toBe("ProfilePage");
    expect(ld.mainEntity.name).toBe("Ira Fenn");
    expect(ld.mainEntity.disambiguatingDescription).toMatch(/fictional/i);
    const json = JSON.stringify(ld);
    for (const secret of ["dealbreaker", "soul", "memory", "note"]) expect(json).not.toContain(secret);
  });

  it("breadcrumbs and item lists are numbered and absolute", () => {
    const bc = breadcrumbJsonLd([{ name: "Botchelor", path: "/" }, { name: "The cast", path: "/cast" }], BASE) as Record<string, any>;
    expect(bc.itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, name: "The cast", item: `${BASE}/cast` });
    const list = itemListJsonLd("Cast", [{ name: "Ira", path: "/characters/c1" }], BASE) as Record<string, any>;
    expect(list.numberOfItems).toBe(1);
    expect(list.itemListElement[0].url).toBe(`${BASE}/characters/c1`);
  });
});

import { indexNowKey, submitIndexNow, INDEXNOW_ENDPOINT } from "@/lib/indexnow";

describe("IndexNow — opt-in, production-only, never throws", () => {
  const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const PROD = { INDEXNOW_KEY: KEY, VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "botchelor.vercel.app" };

  it("validates the key", () => {
    expect(indexNowKey({ INDEXNOW_KEY: KEY })).toBe(KEY);
    expect(indexNowKey({ INDEXNOW_KEY: "short" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "bad key!" })).toBeNull();
    expect(indexNowKey({})).toBeNull();
  });

  it("skips without a key, outside production, or with nothing new — and never calls out", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(null, { status: 200 }); }) as typeof fetch;
    expect((await submitIndexNow(["u"], {}, f)).skipped).toBe("no_key");
    expect((await submitIndexNow(["u"], { ...PROD, VERCEL_ENV: "preview" }, f)).skipped).toBe("not_production");
    expect((await submitIndexNow([], PROD, f)).skipped).toBe("nothing_new");
    expect(calls).toBe(0);
  });

  it("submits host, key, keyLocation and the URLs to the IndexNow endpoint", async () => {
    let sent: { url: string; body: any } | null = null;
    const f = (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(String(init.body)) }; return new Response(null, { status: 202 }); }) as unknown as typeof fetch;
    const res = await submitIndexNow([`${BASE}/episodes/e1`], PROD, f);
    expect(res).toEqual({ submitted: 1, status: 202 });
    expect(sent!.url).toBe(INDEXNOW_ENDPOINT);
    expect(sent!.body).toEqual({ host: "botchelor.vercel.app", key: KEY, keyLocation: `${BASE}/indexnow-key.txt`, urlList: [`${BASE}/episodes/e1`] });
  });

  it("reports a network failure instead of throwing", async () => {
    const f = (async () => { throw new Error("down"); }) as typeof fetch;
    expect(await submitIndexNow(["u"], PROD, f)).toEqual({ submitted: 0, status: null });
  });
});
