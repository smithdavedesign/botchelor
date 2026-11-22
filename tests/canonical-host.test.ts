import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as carry } from "@/app/api/auth/carry/route";
import { safeFrom } from "@/lib/age";
import { signCarry, signSession, verifyCarry, verifySession } from "@/lib/auth";
import { config, proxy as middleware } from "@/proxy";

// The old address (botchelor.vercel.app) moves to the canonical one (botchelor.com): proxy.ts moveToCanonical
// and app/api/auth/carry. Built from parts so no literal secret sits in the repo (GitGuardian scans every commit).
const SECRET = ["carry", "test", "secret", "abcdefghij0123456789"].join("-");
const UID = "0cbfb3b3-1111-4222-8333-444455556666";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const page = (url: string, headers: Record<string, string> = {}) => middleware(new NextRequest(url, { headers: { "user-agent": CHROME, ...headers } }));
const cookieValue = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);

afterEach(() => vi.unstubAllEnvs());

describe("the old address moves to botchelor.com (middleware)", () => {
  it("sends a cookieless visitor or crawler there for good, path and query kept", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    for (const ua of [CHROME, GOOGLEBOT]) {
      const res = page("https://botchelor.vercel.app/characters/house-nell?utm_source=x", { "user-agent": ua });
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://botchelor.com/characters/house-nell?utm_source=x");
    }
  });

  it("sends a player with an identity cookie through the carry route first, temporarily", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    for (const cookie of ["bz_sess=v1.x.y", "bz_uid=" + UID]) {
      const res = page("https://botchelor.vercel.app/shop?checkout=success", { cookie });
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.host).toBe("botchelor.vercel.app");
      expect(location.pathname).toBe("/api/auth/carry");
      expect(location.searchParams.get("to")).toBe("/shop?checkout=success");
    }
  });

  it("moves www pages the same way, but never its API or files (MCP clients and Glama call www directly)", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    const res = page("https://www.botchelor.com/characters?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://botchelor.com/characters?x=1");
    expect(page("https://www.botchelor.com/feed", { cookie: "bz_uid=" + UID }).status).toBe(307);
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/api/mcp", "/.well-known/glama.json"]) expect(matcher.test(path)).toBe(false);
    expect(matcher.test("/characters")).toBe(true);
  });

  it("leaves botchelor.com, preview deployments and a misconfigured production URL alone", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    expect(page("https://botchelor.com/feed", { cookie: "bz_adult=1" }).headers.get("location")).toBeNull();
    expect(page("https://botchelor-git-x-team.vercel.app/feed", { cookie: "bz_adult=1" }).headers.get("location")).toBeNull();
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.vercel.app"); // never a loop onto itself
    expect(page("https://botchelor.vercel.app/feed", { cookie: "bz_adult=1" }).headers.get("location")).toBeNull();
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", ""); // unset: siteUrl() is localhost, so nothing moves
    expect(page("https://botchelor.vercel.app/feed", { cookie: "bz_adult=1" }).headers.get("location")).toBeNull();
  });
});

// The app's own DigitalOcean address reached it without Cloudflare and served an indexable copy of every page
// (2026-11-22 audit); staging.botchelor.com points at the app too. proxy.ts moveFromOtherHost.
describe("the app's other addresses: the platform's own moves to botchelor.com, and no copy is crawled", () => {
  const DO = "https://botchelor-show-t9g76.ondigitalocean.app";
  const onDigitalOcean = () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("SITE_URL", "https://botchelor.com");
  };

  it("moves the DigitalOcean address's pages there for good, path and query kept, for anyone", () => {
    onDigitalOcean();
    const visitors: Record<string, string>[] = [{}, { cookie: `bz_adult=1; bz_uid=${UID}` }, { "user-agent": GOOGLEBOT }];
    for (const headers of visitors) {
      const res = page(`${DO}/characters/house-nell?utm_source=x`, headers);
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://botchelor.com/characters/house-nell?utm_source=x");
    }
    expect(page(`${DO}/`).headers.get("location")).toBe("https://botchelor.com/");
  });

  it("answers robots.txt on any host but botchelor.com with Disallow, and leaves botchelor.com's and www's as they were", async () => {
    onDigitalOcean();
    for (const host of [DO, "https://staging.botchelor.com", "http://203.0.113.9"]) {
      const res = page(`${host}/robots.txt`, { "user-agent": GOOGLEBOT });
      expect(res.status, host).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
    }
    expect(page("https://botchelor.com/robots.txt").headers.get("x-middleware-next")).toBe("1"); // app/robots.ts
    expect(page("https://www.botchelor.com/robots.txt").headers.get("location")).toBe("https://botchelor.com/robots.txt");
  });

  it("never moves /api (DigitalOcean's health check), staging's pages, After Dark's app or a server on this machine", () => {
    onDigitalOcean();
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/api/health", "/api/mcp", "/api/jobs/lobby"]) expect(matcher.test(path), path).toBe(false);
    expect(page("https://staging.botchelor.com/watch", { cookie: "bz_adult=1" }).headers.get("x-middleware-next")).toBe("1");
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://ad.botchelor.com");
    expect(page("https://clownfish-app-x.ondigitalocean.app/after-dark", { cookie: "bz_adult=1; bz_place_tried=1" }).headers.get("location")).toBeNull();
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("SITE_URL", ""); // no address of its own: localhost, as in dev and the tests
    expect(page(`${DO}/watch`, { cookie: "bz_adult=1" }).headers.get("x-middleware-next")).toBe("1");
    expect(page("http://127.0.0.1:3000/robots.txt").headers.get("x-middleware-next")).toBe("1");
  });
});

describe("carry tokens (lib/auth)", () => {
  const env = { SESSION_SECRET: SECRET };
  const nonce = "abcdefghijklmnopqrstuv";
  it("round-trip with their nonce, expire after a minute, and never stand in for a session (or the reverse)", () => {
    const now = Date.now();
    const token = signCarry({ uid: UID, authenticated: true, adult: true, nonce }, env, now)!;
    expect(verifyCarry(token, env, now)).toEqual({ uid: UID, authenticated: true, adult: true, nonce });
    expect(verifyCarry(token, env, now + 61_000)).toBeNull();
    expect(verifyCarry(token, { SESSION_SECRET: SECRET + "-x" }, now)).toBeNull();
    expect(verifyCarry(token.replace(/\.[^.]+$/, ".AAAA"), env, now)).toBeNull();
    expect(verifySession(token, env)).toBeNull();
    expect(verifyCarry(signSession({ uid: UID, authenticated: true }, env), env, now)).toBeNull();
    expect(signCarry({ uid: UID, authenticated: false, adult: false, nonce }, {})).toBeNull(); // no secret, no carry
    expect(signCarry({ uid: UID, authenticated: false, adult: false, nonce: "short" }, env)).toBeNull(); // no nonce, no carry
  });
});

describe("the carry route (app/api/auth/carry)", () => {
  const OLD = "https://botchelor.vercel.app/api/auth/carry";
  const NEW = "https://botchelor.com/api/auth/carry";
  const ATTACKER = "77777777-1111-4222-8333-444455556666";
  const nonceOf = (res: Response) => cookieValue(res, "bz_carry");

  /** The whole handshake, the way a browser follows it: old host → botchelor.com → old host → botchelor.com. */
  async function walk(to: string, oldCookie: string) {
    const start = await carry(new Request(`${OLD}?to=${encodeURIComponent(to)}`, { headers: { cookie: oldCookie } }));
    const begin = new URL(start.headers.get("location")!);
    expect(begin.origin + begin.pathname).toBe(NEW);
    expect(begin.searchParams.get("from")).toBe("botchelor.vercel.app");
    const issued = await carry(new Request(begin.toString()));
    const nonce = nonceOf(issued)!;
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const back = new URL(issued.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(OLD);
    const minted = await carry(new Request(back.toString(), { headers: { cookie: oldCookie } }));
    const hop = new URL(minted.headers.get("location")!);
    expect(hop.origin + hop.pathname).toBe(NEW);
    expect(minted.headers.get("referrer-policy")).toBe("no-referrer");
    const landed = await carry(new Request(hop.toString(), { headers: { cookie: `bz_carry=${nonce}` } }));
    return { hop, landed };
  }

  it("hands a signed-in player, and their 18+ confirmation, to botchelor.com and lands them where they were going", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const sess = signSession({ uid: UID, authenticated: true })!;
    const { hop, landed } = await walk("/shop?checkout=success", `bz_sess=${sess}; bz_adult=1`);
    expect(hop.searchParams.get("to")).toBe("/shop?checkout=success");
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe("/shop?checkout=success");
    expect(verifySession(cookieValue(landed, "bz_sess"))).toEqual({ uid: UID, authenticated: true });
    expect(cookieValue(landed, "bz_adult")).toBe("1");
    expect(nonceOf(landed)).toBe(""); // used once, then cleared
  });

  it("carries an anonymous player's legacy cookie too, so their characters come with them", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const { landed } = await walk("/account", `bz_uid=${UID}`);
    expect(verifySession(cookieValue(landed, "bz_sess"))).toEqual({ uid: UID, authenticated: false });
    expect(cookieValue(landed, "bz_adult")).toBeUndefined(); // they hadn't confirmed 18+, so they still will
  });

  it("never lets someone else's token set an identity: no nonce, or the wrong one, sets nothing", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    // The attacker runs the old-host step themselves, with their own identity (or a uid they picked) and a nonce they know.
    const theirNonce = "attackerattackerattack";
    for (const identity of [`bz_uid=${ATTACKER}`, `bz_sess=${signSession({ uid: ATTACKER, authenticated: true })}`]) {
      const minted = await carry(new Request(`${OLD}?n=${theirNonce}&to=/create`, { headers: { cookie: identity } }));
      const hop = minted.headers.get("location")!;
      expect(new URL(hop).searchParams.get("t")).toBeTruthy();
      // A fresh visitor sent straight to that link, with no nonce or with their own: nothing set.
      for (const victim of [{}, { cookie: "bz_carry=victimvictimvictimvict" }] as Record<string, string>[]) {
        const landed = await carry(new Request(hop, { headers: victim }));
        expect(landed.headers.get("location")).toBe("/create");
        expect(cookieValue(landed, "bz_sess")).toBeUndefined();
      }
    }
    // Minting only happens on the old host.
    const onNew = await carry(new Request(`${NEW}?n=${theirNonce}&to=/create`, { headers: { cookie: `bz_uid=${ATTACKER}` } }));
    expect(new URL(onNew.headers.get("location")!).searchParams.get("t")).toBeNull();
  });

  it("never replaces an identity already on botchelor.com, and ignores a forged or stale token", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const nonce = "abcdefghijklmnopqrstuv";
    const mine = signSession({ uid: "99999999-1111-4222-8333-444455556666", authenticated: false })!;
    // botchelor.com doesn't even start the handshake for a browser it already knows.
    const begin = await carry(new Request(`${NEW}?from=botchelor.vercel.app&to=/feed`, { headers: { cookie: `bz_sess=${mine}` } }));
    expect(begin.headers.get("location")).toBe("/feed");
    expect(nonceOf(begin)).toBeUndefined();
    const token = signCarry({ uid: UID, authenticated: true, adult: true, nonce })!;
    const kept = await carry(new Request(`${NEW}?t=${token}&to=/feed`, { headers: { cookie: `bz_sess=${mine}; bz_carry=${nonce}` } }));
    expect(cookieValue(kept, "bz_sess")).toBeUndefined();
    expect(kept.headers.get("location")).toBe("/feed");
    const forged = await carry(new Request(`${NEW}?t=carry.v2.e30.AAAA&to=/feed`, { headers: { cookie: `bz_carry=${nonce}` } }));
    expect(cookieValue(forged, "bz_sess")).toBeUndefined();
    const stale = signCarry({ uid: UID, authenticated: true, adult: false, nonce }, process.env, Date.now() - 120_000)!;
    expect(cookieValue(await carry(new Request(`${NEW}?t=${stale}&to=/feed`, { headers: { cookie: `bz_carry=${nonce}` } })), "bz_sess")).toBeUndefined();
  });

  it("only ever returns to a path on our own site, and only hands off to our own old hosts", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/gate?from=/x"]) {
      const res = await carry(new Request(`${NEW}?t=x&to=${encodeURIComponent(bad)}`));
      expect(res.headers.get("location")).toBe("/");
    }
    for (const from of ["evil.example", "botchelor.vercel.app.evil.example", ""]) {
      const res = await carry(new Request(`${NEW}?from=${encodeURIComponent(from)}&to=/feed`));
      expect(res.headers.get("location")).toBe("/feed");
      expect(nonceOf(res)).toBeUndefined();
    }
    const noIdentity = await carry(new Request(`${OLD}?n=abcdefghijklmnopqrstuv&to=/feed`));
    expect(noIdentity.headers.get("location")).toBe("https://botchelor.com/feed");
    expect(safeFrom("/\\evil.example")).toBe("/");
  });
});

describe("a pair's page has one address, as a real 308 (2026-11-04: those pages stream a loading screen)", () => {
  it("sends the higher id first to the lower first, query kept, before the age gate; leaves the sorted one alone", async () => {
    const { canonicalPairPath } = await import("@/proxy");
    expect(canonicalPairPath("/couples/house-sable/abc")).toBe("/couples/abc/house-sable");
    expect(canonicalPairPath("/messages/zed/amy")).toBe("/messages/amy/zed");
    expect(canonicalPairPath("/couples/abc/house-sable")).toBeNull();
    expect(canonicalPairPath("/couples/abc")).toBeNull();
    expect(canonicalPairPath("/couples/%E0%A4%A/x")).toBeNull(); // not a valid escape: left to the page
    const res = page("https://botchelor.com/messages/zed/amy?as=amy");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://botchelor.com/messages/amy/zed?as=amy");
  });
});

describe("a route's loading screen (app/PageLoading.tsx)", () => {
  it("says what's loading, for everyone, over an outline screen readers skip", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: PageLoading } = await import("@/app/PageLoading");
    for (const shape of ["profile", "date", "couple", "list"] as const) {
      const html = renderToStaticMarkup(createElement(PageLoading, { shape, label: "Opening the date…" }));
      expect(html).toContain('<p class="page-skeleton-status" role="status">');
      expect(html).toContain("Opening the date…");
      expect(html).toContain('<div class="page-skeleton-body" aria-hidden="true">');
      expect(html).toContain('aria-busy="true"');
    }
  });

  // 2026-11-22 audit: a layout shift of about 0.8 on Watch and an episode at 1280×900, from the swap of this screen for
  // the page. The outline sat in the reading column under a wide page, and the footer jumped from mid-screen past it.
  it("takes its page's width, so main keeps its width when the page arrives", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: PageLoading } = await import("@/app/PageLoading");
    const rootClass = (width?: "wide" | "full") =>
      /^<div class="([^"]*)"/.exec(renderToStaticMarkup(createElement(PageLoading, { shape: "list", label: "Loading…", width })))?.[1];
    expect(rootClass()).toBe("page-skeleton page-skeleton-list");
    expect(rootClass("wide")).toBe("page-skeleton page-skeleton-list page-wide");
    expect(rootClass("full")).toBe("page-skeleton page-skeleton-list page-full");
  });

  it("is as wide as its page on every route: what loading.tsx says matches the class that widens main there", () => {
    // main:has(> .x) widens main for a page whose root wears one of these (app/ux/catalog.css; an episode, a couple and
    // the watch room by their own rules).
    const WIDE = new Set(["page-wide", "episode-page", "couple-page", "watch"]);
    const FULL = new Set(["page-full"]);
    const loadings: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "loading.tsx") loadings.push(path);
      }
    };
    walk("app");
    expect(loadings.length).toBeGreaterThan(20);
    // Every class named in a className, quoted or in a {…} expression's strings, in the route's own files.
    const classesIn = (src: string) =>
      [...src.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((m) =>
        (m[1] ?? [...m[2].matchAll(/["'`]([^"'`]*)["'`]/g)].map((s) => s[1]).join(" ")).split(/\s+/),
      );
    const wrong = loadings.flatMap((file) => {
      const dir = dirname(file);
      const own = readdirSync(dir).filter((f) => f.endsWith(".tsx") && f !== "loading.tsx");
      const classes = new Set(own.flatMap((f) => classesIn(readFileSync(join(dir, f), "utf8"))));
      const page = [...classes].some((c) => FULL.has(c)) ? "full" : [...classes].some((c) => WIDE.has(c)) ? "wide" : "read";
      const said = /width="(wide|full)"/.exec(readFileSync(file, "utf8"))?.[1] ?? "read";
      return said === page ? [] : [`${dir}: loading screen ${said}, page ${page}`];
    });
    expect(wrong).toEqual([]);
  });

  it("keeps the footer below the fold while it shows, and after a short page arrives", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\nmain \{[^}]*min-height: calc\(100svh - 4rem\);/);
    expect(css).toMatch(/\.page-skeleton-status \{[^}]*margin: 0 auto var\(--space-4\);/);
    // The companion chat fits the screen by its own height and has no footer: no minimum there.
    expect(readFileSync("app/ux/companion.css", "utf8")).toMatch(/main:has\(> \.companion-fullscreen\) \{[^}]*min-height: 0;/);
  });
});
