import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as carry } from "@/app/api/auth/carry/route";
import { runAdultTool } from "@/lib/adult/mcp";
import {
  AFTER_DARK_ROBOTS,
  afterDarkBase,
  afterDarkElsewhere,
  afterDarkHref,
  afterDarkNextConfig,
  afterDarkOnly,
  afterDarkOrigin,
  isAfterDarkPage,
} from "@/lib/after-dark-host";
import { signCarry, signSession, verifySession } from "@/lib/auth";
import { getDb, setDbForTests, type Db } from "@/lib/db";
import { requestBase } from "@/lib/site";
import { middleware } from "@/middleware";

// Next's own test helper for next.config's redirects expects the AsyncLocalStorage that Next's server sets up.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
const { unstable_getResponseFromNextConfig: viaNextConfig, getRedirectUrl } = await import("next/experimental/testing/server");

// After Dark on a host of its own (lib/after-dark-host.ts, docs/after-dark-hosting.md). The switch is off unless
// AFTER_DARK_ORIGIN is set, and off means exactly today's behaviour: the first block pins today's responses.
const UID = "0cbfb3b3-1111-4222-8333-444455556666";
const SECRET = ["carry", "test", "secret", "abcdefghij0123456789"].join("-");
const AD = "https://ad.botchelor.com";
const SHOW = "https://botchelor.com";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

afterEach(() => vi.unstubAllEnvs());

/** What a response does, in one line: status, where it sends the browser, whether it passes through, what it sets. */
function fingerprint(res: Response): string {
  const cookies = res.headers.getSetCookie().map((c) => c.split("=")[0]);
  return [res.status, res.headers.get("location") ?? "-", res.headers.get("x-middleware-next") ? "next" : "-", cookies.join(",") || "-"].join(" ");
}
const page = (url: string, headers: Record<string, string> = {}) =>
  fingerprint(middleware(new NextRequest(url, { headers: { "user-agent": CHROME, ...headers } })));

/** Today's answers (captured from main before After Dark could move), for every kind of request the switch touches. */
const TODAY: [string, Record<string, string>, string][] = [
  ["https://botchelor.com/after-dark", {}, "307 https://botchelor.com/gate?from=%2Fafter-dark - -"],
  ["https://botchelor.com/after-dark/house-a/house-b?play=1", { cookie: `bz_adult=1; bz_uid=${UID}` }, "200 - next -"],
  ["https://botchelor.com/admin/after-dark/settings", { cookie: "bz_adult=1" }, "200 - next -"],
  ["https://botchelor.com/admin/after-dark", {}, "307 https://botchelor.com/gate?from=%2Fadmin%2Fafter-dark - -"],
  ["https://botchelor.com/after-dark", { "user-agent": GOOGLEBOT }, "200 - next -"],
  ["https://botchelor.com/after-darkness", { cookie: "bz_adult=1" }, "200 - next -"],
  ["https://botchelor.com/watch", { cookie: "bz_adult=1" }, "200 - next -"],
  ["https://botchelor.com/", {}, "307 https://botchelor.com/gate?from=%2F - -"],
  ["https://botchelor.com/gate?from=/after-dark", {}, "200 - next -"],
  ["https://botchelor.com/llms.txt", {}, "200 - next -"],
  ["https://botchelor.com/robots.txt", {}, "200 - next -"],
  ["https://botchelor.com/after-dark?repohq-notrack=1", {}, "307 https://botchelor.com/gate?from=%2Fafter-dark%3Frepohq-notrack%3D1 - repohq_notrack"],
  ["https://botchelor.vercel.app/after-dark", {}, "308 https://botchelor.com/after-dark - -"],
  ["https://botchelor.vercel.app/after-dark?x=1", { cookie: `bz_uid=${UID}` }, "307 https://botchelor.vercel.app/api/auth/carry?to=%2Fafter-dark%3Fx%3D1 - -"],
  ["https://ad.botchelor.com/after-dark", { cookie: "bz_adult=1" }, "200 - next -"],
  ["https://ad.botchelor.com/watch", {}, "307 https://ad.botchelor.com/gate?from=%2Fwatch - -"],
];

/** The carry route's answers today for the requests the After Dark hop adds meaning to. */
const CARRY_TODAY: [string, Record<string, string>, string][] = [
  ["https://botchelor.com/api/auth/carry?to=/after-dark", {}, "302 /after-dark - -"],
  ["https://botchelor.com/api/auth/carry?to=/after-dark", { cookie: `bz_uid=${UID}` }, "302 /after-dark - -"],
  ["https://botchelor.com/api/auth/carry?n=abcdefghijklmnopqrstuv&to=/after-dark", { cookie: `bz_uid=${UID}` }, "302 https://botchelor.com/after-dark - -"],
  ["https://ad.botchelor.com/api/auth/carry?to=/after-dark", {}, "302 /after-dark - -"],
  ["https://ad.botchelor.com/api/auth/carry?n=abcdefghijklmnopqrstuv&to=/after-dark", { cookie: `bz_uid=${UID}` }, "302 https://botchelor.com/after-dark - -"],
  ["https://ad.botchelor.com/api/auth/carry?t=carry.v2.e30.AAAA&to=/after-dark", { cookie: "bz_carry=abcdefghijklmnopqrstuv" }, "302 /after-dark - bz_carry"],
];

describe("with the switch off (no AFTER_DARK_ORIGIN): exactly today's behaviour", () => {
  it("the middleware answers every request as it did before", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    for (const [url, headers, today] of TODAY) expect(`${url} → ${page(url, headers)}`).toBe(`${url} → ${today}`);
  });

  it("the carry route answers as it did before: botchelor.com never mints, and no host starts an After Dark hop", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    for (const [url, headers, today] of CARRY_TODAY) expect(`${url} → ${fingerprint(await carry(new Request(url, { headers })))}`).toBe(`${url} → ${today}`);
  });

  it("next.config is what it was", async () => {
    vi.stubEnv("AFTER_DARK_ORIGIN", "");
    vi.stubEnv("AFTER_DARK_ONLY", "");
    vi.resetModules();
    const { default: config } = await import("@/next.config");
    expect(config).toEqual({ serverExternalPackages: ["@electric-sql/pglite"] });
    expect(afterDarkNextConfig({}, SHOW)).toEqual({});
    expect(afterDarkNextConfig({ AFTER_DARK_ONLY: "1" }, SHOW)).toEqual({}); // only with an origin
  });

  it("the links, the link base, MCP's After Dark tools and the database are as they were", async () => {
    vi.stubEnv("AFTER_DARK_ORIGIN", "");
    for (const p of ["/after-dark", "/after-dark/a/b", "/admin/after-dark/settings"]) expect(afterDarkHref(p)).toBe(p);
    expect(afterDarkBase(SHOW)).toBe(SHOW);
    expect(requestBase(new Request("http://localhost:4466/api/mcp"))).toBe("http://localhost:4466");
    expect([afterDarkOrigin(), afterDarkOnly(), afterDarkElsewhere()]).toEqual([null, false, null]);
    const db = { query: async () => ({ rows: [] }) } as unknown as Db;
    // after_dark_settings works while After Dark is off; on the show with the switch on, it would refuse (below).
    expect(await runAdultTool(db, "after_dark_pairs", {})).toEqual({ error: "After dark is off: turn it on in its settings (/admin/after-dark/settings)." });
  });
});

describe("the settings", () => {
  it("read the origin as an origin, and After Dark's own host only with one", () => {
    expect(afterDarkOrigin({ AFTER_DARK_ORIGIN: " https://ad.botchelor.com/ " })).toBe(AD);
    expect(afterDarkOrigin({ AFTER_DARK_ORIGIN: "https://ad.botchelor.com/after-dark" })).toBe(AD);
    for (const bad of ["", "ad.botchelor.com", "javascript:alert(1)", "ftp://ad.botchelor.com"]) expect(afterDarkOrigin({ AFTER_DARK_ORIGIN: bad })).toBeNull();
    expect(afterDarkOnly({ AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" })).toBe(true);
    expect(afterDarkOnly({ AFTER_DARK_ONLY: "1" })).toBe(false);
    expect(afterDarkOnly({ AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "true" })).toBe(false);
    expect(afterDarkElsewhere({ AFTER_DARK_ORIGIN: AD })).toBe(AD);
    expect(afterDarkElsewhere({ AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" })).toBeNull();
  });

  it("know After Dark's pages, and nothing that only starts like them", () => {
    for (const p of ["/after-dark", "/after-dark/a/b", "/after-dark/subscribe", "/admin/after-dark", "/admin/after-dark/graph"]) expect(isAfterDarkPage(p)).toBe(true);
    for (const p of ["/after-darkness", "/admin", "/admin/after-darker", "/", "/api/admin/after-dark"]) expect(isAfterDarkPage(p)).toBe(false);
  });

  it("make the show's After Dark links go in through its host's sign-in hop; on that host they stay as they are", () => {
    expect(afterDarkHref("/after-dark/a/b?play=1", { AFTER_DARK_ORIGIN: AD })).toBe(`${AD}/api/auth/carry?to=%2Fafter-dark%2Fa%2Fb%3Fplay%3D1`);
    expect(afterDarkHref("/after-dark", { AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" })).toBe("/after-dark");
    expect(afterDarkBase(SHOW, { AFTER_DARK_ORIGIN: AD })).toBe(AD);
  });
});

/** The show's deployment (Vercel), with After Dark moved out. */
function asShow() {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("AFTER_DARK_ORIGIN", AD);
  vi.stubEnv("AFTER_DARK_ONLY", "");
}
/** After Dark's own deployment (DigitalOcean): not on Vercel, the show's address in SITE_URL. */
function asAfterDark() {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("SITE_URL", SHOW);
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("AFTER_DARK_ORIGIN", AD);
  vi.stubEnv("AFTER_DARK_ONLY", "1");
}

describe("on the show, with After Dark moved out (AFTER_DARK_ORIGIN)", () => {
  it("sends After Dark's pages there: through the sign-in hop with an identity to bring, straight there without", () => {
    asShow();
    expect(page(`${SHOW}/after-dark/a/b?play=1`, { cookie: `bz_adult=1; bz_uid=${UID}` })).toBe(`307 ${AD}/api/auth/carry?to=%2Fafter-dark%2Fa%2Fb%3Fplay%3D1 - -`);
    expect(page(`${SHOW}/admin/after-dark/settings`, { cookie: "bz_sess=v1.x.y" })).toBe(`307 ${AD}/api/auth/carry?to=%2Fadmin%2Fafter-dark%2Fsettings - -`);
    expect(page(`${SHOW}/after-dark/subscribe`)).toBe(`307 ${AD}/after-dark/subscribe - -`);
    expect(page(`${SHOW}/after-dark`, { "user-agent": GOOGLEBOT, cookie: `bz_uid=${UID}` })).toBe(`307 ${AD}/after-dark - -`);
  });

  it("leaves every other page exactly as it was", () => {
    asShow();
    const others = TODAY.filter(([u]) => !isAfterDarkPage(new URL(u).pathname));
    expect(others.length).toBeGreaterThan(5);
    for (const [url, headers, today] of others) expect(`${url} → ${page(url, headers)}`).toBe(`${url} → ${today}`);
    // The old host still moves to botchelor.com first, as before; After Dark's move happens there.
    expect(page("https://botchelor.vercel.app/after-dark")).toBe("308 https://botchelor.com/after-dark - -");
    expect(page("https://botchelor.vercel.app/after-dark?x=1", { cookie: `bz_uid=${UID}` })).toBe("307 https://botchelor.vercel.app/api/auth/carry?to=%2Fafter-dark%3Fx%3D1 - -");
  });

  it("sends After Dark's APIs and look tiles there, method and query kept, and nothing else (next.config)", async () => {
    asShow();
    const config = afterDarkNextConfig(process.env, SHOW);
    expect(config.env).toEqual({ AFTER_DARK_ORIGIN: AD });
    const go = async (path: string) => {
      const res = await viaNextConfig({ url: `${SHOW}${path}`, nextConfig: config });
      return `${res.status} ${getRedirectUrl(res) ?? "-"}`;
    };
    expect(await go("/api/admin/after-dark/media/pic-1?until=9&sig=x")).toBe(`307 ${AD}/api/admin/after-dark/media/pic-1?until=9&sig=x`);
    expect(await go("/api/admin/after-dark")).toBe(`307 ${AD}/api/admin/after-dark`);
    expect(await go("/api/jobs/eval-after-dark")).toBe(`307 ${AD}/api/jobs/eval-after-dark`);
    expect(await go("/api/looks/nsfw-woman-body-curvy")).toBe(`307 ${AD}/api/looks/nsfw-woman-body-curvy`);
    for (const stays of ["/api/looks/pg-woman", "/api/looks/nsfw-x/y", "/api/admin/after-darkness", "/api/jobs/eval", "/api/mcp", "/api/webhooks/stripe", "/api/jobs/daily", "/after-dark"]) {
      expect(`${stays} ${await go(stays)}`).toBe(`${stays} 200 -`);
    }
  });

  it("refuses After Dark's MCP tools, naming the host they run on", async () => {
    asShow();
    const db = { query: async () => ({ rows: [] }) } as unknown as Db;
    for (const tool of ["after_dark_settings", "after_dark_write", "after_dark_reel"]) {
      expect(await runAdultTool(db, tool, { a: "x", b: "y" })).toEqual({ error: `After Dark runs on its own host now: connect to ${AD}/api/mcp (with the admin key) for its tools.` });
    }
  });
});

describe("on After Dark's own host (AFTER_DARK_ONLY=1)", () => {
  it("serves After Dark's pages and the 18+ gate, kept out of search, and sends the show's pages to the show", () => {
    asAfterDark();
    const res = middleware(new NextRequest(`${AD}/after-dark/a/b`, { headers: { "user-agent": CHROME, cookie: "bz_adult=1" } }));
    expect(fingerprint(res)).toBe("200 - next -");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(page(`${AD}/after-dark`)).toBe(`307 ${AD}/gate?from=%2Fafter-dark - -`); // the gate, here, as on the show
    expect(page(`${AD}/gate?from=/after-dark`)).toBe("200 - next -");
    expect(page(`${AD}/admin/after-dark/graph`, { cookie: "bz_adult=1" })).toBe("200 - next -");
    expect(page(`${AD}/`, { cookie: "bz_adult=1" })).toBe(`307 ${SHOW}/ - -`);
    expect(page(`${AD}/characters?tab=people`, { cookie: `bz_adult=1; bz_uid=${UID}` })).toBe(`307 ${SHOW}/characters?tab=people - -`);
    expect(page(`${AD}/after-darkness`)).toBe(`307 ${SHOW}/after-darkness - -`);
    for (const doc of ["/llms.txt", "/sitemap.xml", "/.well-known/mcp.json"]) expect(page(`${AD}${doc}`)).toBe(`307 ${SHOW}${doc} - -`);
  });

  it("tells every crawler to stay out", async () => {
    asAfterDark();
    const res = middleware(new NextRequest(`${AD}/robots.txt`, { headers: { "user-agent": GOOGLEBOT } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(AFTER_DARK_ROBOTS);
    expect(AFTER_DARK_ROBOTS).toBe("User-agent: *\nDisallow: /\n");
  });

  it("keeps its own APIs and the ones its pages call, and sends every other API to the show (next.config)", async () => {
    asAfterDark();
    const config = afterDarkNextConfig(process.env, SHOW);
    expect(config.env).toEqual({ AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" });
    const go = async (path: string) => {
      const res = await viaNextConfig({ url: `${AD}${path}`, nextConfig: config });
      return `${res.status} ${getRedirectUrl(res) ?? "-"}`;
    };
    const kept = [
      "/api/admin/after-dark",
      "/api/admin/after-dark/reel?id=r1",
      "/api/jobs/eval-after-dark",
      "/api/auth/carry?to=/after-dark",
      "/api/auth/logout",
      "/api/age",
      "/api/health",
      "/api/assets/abc",
      "/api/sets/the%20observatory",
      "/api/looks/nsfw-woman",
      "/api/feedback",
      "/api/feedback/prompt",
      "/api/waitlist",
      "/api/mcp",
    ];
    for (const path of kept) expect(`${path} ${await go(path)}`).toBe(`${path} 200 -`);
    const sent = ["/api/episodes/e1/reveal?x=1", "/api/auth/login", "/api/auth/google/start", "/api/auth/carry2", "/api/admin/after-darkness", "/api/webhooks/stripe", "/api/jobs/daily", "/api/me"];
    for (const path of sent) expect(`${path} ${await go(path)}`).toBe(`${path} 307 ${SHOW}${path}`);
  });

  it("refuses to build without the show's address to send things to", () => {
    expect(() => afterDarkNextConfig({ AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" }, "http://localhost:3000")).toThrow(/SITE_URL/);
    expect(() => afterDarkNextConfig({ AFTER_DARK_ORIGIN: AD, AFTER_DARK_ONLY: "1" }, AD)).toThrow(/SITE_URL/);
  });

  it("names its own address in links (behind the platform's proxy, req.url is the server's own)", () => {
    asAfterDark();
    expect(requestBase(new Request("https://0.0.0.0:8080/api/admin/after-dark/reel"))).toBe(AD);
    expect(afterDarkBase(SHOW)).toBe(AD);
  });

  it("never falls back to a database of its own", async () => {
    asAfterDark();
    vi.stubEnv("DATABASE_URL", "");
    setDbForTests(null);
    const cache = globalThis as { __botchelorDb?: unknown };
    const before = cache.__botchelorDb;
    cache.__botchelorDb = undefined;
    try {
      await expect(getDb()).rejects.toThrow(/DATABASE_URL is not configured/);
    } finally {
      cache.__botchelorDb = before;
    }
  });
});

describe("signing in across to After Dark's host (app/api/auth/carry)", () => {
  const nonceOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("bz_carry="))?.split(";")[0].slice("bz_carry=".length);
  const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);
  const at = (url: string, cookie?: string) => carry(new Request(url, { headers: cookie ? { cookie } : {} }));

  /** The way a browser follows it: After Dark's host → botchelor.com → After Dark's host. */
  async function walk(to: string, showCookie: string, adCookie = "") {
    asAfterDark();
    const begin = await at(`${AD}/api/auth/carry?to=${encodeURIComponent(to)}`, adCookie || undefined);
    const nonce = nonceOf(begin)!;
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(begin.headers.getSetCookie().find((c) => c.startsWith("bz_carry="))).toMatch(/Path=\/api\/auth\/carry; Max-Age=300; HttpOnly; SameSite=Lax/);
    const ask = new URL(begin.headers.get("location")!);
    expect(`${ask.origin}${ask.pathname}`).toBe(`${SHOW}/api/auth/carry`);
    expect(ask.searchParams.get("n")).toBe(nonce);
    asShow();
    const minted = await at(ask.toString(), showCookie);
    expect(minted.headers.get("referrer-policy")).toBe("no-referrer");
    const back = new URL(minted.headers.get("location")!);
    asAfterDark();
    const landed = await at(back.toString(), [adCookie, `bz_carry=${nonce}`].filter(Boolean).join("; "));
    return { back, landed };
  }

  it("brings a signed-in admin's session and 18+ confirmation from the show, and opens the page they were headed to", async () => {
    asShow();
    const sess = signSession({ uid: UID, authenticated: true })!;
    const { back, landed } = await walk("/after-dark/a/b?play=1", `bz_sess=${sess}; bz_adult=1`);
    expect(`${back.origin}${back.pathname}`).toBe(`${AD}/api/auth/carry`);
    expect(back.searchParams.get("t")).toMatch(/^carry\.v2\./);
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe("/after-dark/a/b?play=1");
    expect(verifySession(cookieOf(landed, "bz_sess"))).toEqual({ uid: UID, authenticated: true });
    expect(cookieOf(landed, "bz_adult")).toBe("1");
    expect(nonceOf(landed)).toBe(""); // used once, then cleared
  });

  it("asks the show every time, and follows it: an identity already on After Dark's host is replaced by the show's", async () => {
    asShow();
    const stale = signSession({ uid: "99999999-1111-4222-8333-444455556666", authenticated: false })!;
    const sess = signSession({ uid: UID, authenticated: true })!;
    const { landed } = await walk("/after-dark", `bz_sess=${sess}`, `bz_sess=${stale}`);
    expect(verifySession(cookieOf(landed, "bz_sess"))).toEqual({ uid: UID, authenticated: true });
  });

  it("goes straight to the page for a browser the show doesn't know, with nothing set", async () => {
    const { back, landed } = await walk("/after-dark", "");
    expect(back.toString()).toBe(`${AD}/after-dark`);
    expect(back.searchParams.get("t")).toBeNull();
    expect(landed.headers.getSetCookie().some((c) => c.startsWith("bz_sess="))).toBe(false);
  });

  it("never lets someone else's token set an identity on After Dark's host", async () => {
    // The attacker runs the show's step with their own identity and a nonce they know, and hands out the link.
    asShow();
    const attacker = signSession({ uid: "77777777-1111-4222-8333-444455556666", authenticated: true })!;
    const minted = await at(`${SHOW}/api/auth/carry?n=attackerattackerattack&to=/after-dark`, `bz_sess=${attacker}`);
    const link = minted.headers.get("location")!;
    expect(new URL(link).origin).toBe(AD); // the show mints only for After Dark's own address
    asAfterDark();
    for (const victim of [undefined, "bz_carry=victimvictimvictimvict"]) {
      const landed = await at(link, victim);
      expect(landed.headers.get("location")).toBe("/after-dark");
      expect(landed.headers.getSetCookie().some((c) => c.startsWith("bz_sess="))).toBe(false);
    }
    // A forged or stale token sets nothing either.
    const nonce = "abcdefghijklmnopqrstuv";
    expect((await at(`${AD}/api/auth/carry?t=carry.v2.e30.AAAA&to=/after-dark`, `bz_carry=${nonce}`)).headers.getSetCookie().some((c) => c.startsWith("bz_sess="))).toBe(false);
    const stale = signCarry({ uid: UID, authenticated: true, adult: false, nonce }, process.env, Date.now() - 120_000)!;
    expect((await at(`${AD}/api/auth/carry?t=${stale}&to=/after-dark`, `bz_carry=${nonce}`)).headers.getSetCookie().some((c) => c.startsWith("bz_sess="))).toBe(false);
  });

  it("mints only on botchelor.com itself, only for After Dark's address, and only ever returns to a path", async () => {
    asShow();
    const preview = await at(`https://botchelor-git-x-team.vercel.app/api/auth/carry?n=abcdefghijklmnopqrstuv&to=/after-dark`, `bz_uid=${UID}`);
    expect(new URL(preview.headers.get("location")!).searchParams.get("t")).toBeNull();
    asAfterDark();
    // After Dark's host never mints, whatever it's asked.
    const onAd = await at(`${AD}/api/auth/carry?n=abcdefghijklmnopqrstuv&to=/after-dark`, `bz_uid=${UID}`);
    expect(onAd.headers.get("location")).toBe(`${SHOW}/after-dark`);
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const begin = await at(`${AD}/api/auth/carry?to=${encodeURIComponent(bad)}`);
      expect(new URL(begin.headers.get("location")!).searchParams.get("to")).toBe("/");
    }
  });

  it("still moves the old host's players to botchelor.com as before, with After Dark moved out", async () => {
    asShow();
    const start = await at(`https://botchelor.vercel.app/api/auth/carry?to=/feed`, `bz_uid=${UID}`);
    expect(start.headers.get("location")).toBe(`${SHOW}/api/auth/carry?from=botchelor.vercel.app&to=%2Ffeed`);
    const minted = await at(`https://botchelor.vercel.app/api/auth/carry?n=abcdefghijklmnopqrstuv&to=/feed`, `bz_uid=${UID}`);
    expect(new URL(minted.headers.get("location")!).origin).toBe(SHOW);
  });
});
