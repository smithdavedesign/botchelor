import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as carry } from "@/app/api/auth/carry/route";
import { safeFrom } from "@/lib/age";
import { signCarry, signSession, verifyCarry, verifySession } from "@/lib/auth";
import { config, middleware } from "@/middleware";

// The old address (botchelor.vercel.app) moves to the canonical one (botchelor.com): middleware.ts moveToCanonical
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

describe("carry tokens (lib/auth)", () => {
  const env = { SESSION_SECRET: SECRET };
  it("round-trip, expire after a minute, and never stand in for a session (or the reverse)", () => {
    const now = Date.now();
    const token = signCarry({ uid: UID, authenticated: true, adult: true }, env, now)!;
    expect(verifyCarry(token, env, now)).toEqual({ uid: UID, authenticated: true, adult: true });
    expect(verifyCarry(token, env, now + 61_000)).toBeNull();
    expect(verifyCarry(token, { SESSION_SECRET: SECRET + "-x" }, now)).toBeNull();
    expect(verifyCarry(token.replace(/\.[^.]+$/, ".AAAA"), env, now)).toBeNull();
    expect(verifySession(token, env)).toBeNull();
    expect(verifyCarry(signSession({ uid: UID, authenticated: true }, env), env, now)).toBeNull();
    expect(signCarry({ uid: UID, authenticated: false, adult: false }, {})).toBeNull(); // no secret, no carry
  });
});

describe("the carry route (app/api/auth/carry)", () => {
  const OLD = "https://botchelor.vercel.app/api/auth/carry";
  const NEW = "https://botchelor.com/api/auth/carry";

  it("hands a signed-in player, and their 18+ confirmation, to botchelor.com and lands them where they were going", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const sess = signSession({ uid: UID, authenticated: true })!;
    const out = await carry(new Request(`${OLD}?to=${encodeURIComponent("/shop?checkout=success")}`, { headers: { cookie: `bz_sess=${sess}; bz_adult=1` } }));
    expect(out.status).toBe(302);
    const hop = new URL(out.headers.get("location")!);
    expect(hop.origin + hop.pathname).toBe(NEW);
    expect(hop.searchParams.get("to")).toBe("/shop?checkout=success");
    expect(out.headers.get("referrer-policy")).toBe("no-referrer");

    const landed = await carry(new Request(hop.toString()));
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe("/shop?checkout=success");
    expect(verifySession(cookieValue(landed, "bz_sess"))).toEqual({ uid: UID, authenticated: true });
    expect(cookieValue(landed, "bz_adult")).toBe("1");
  });

  it("carries an anonymous player's legacy cookie too, so their characters come with them", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const out = await carry(new Request(`${OLD}?to=/account`, { headers: { cookie: `bz_uid=${UID}` } }));
    const landed = await carry(new Request(out.headers.get("location")!));
    expect(verifySession(cookieValue(landed, "bz_sess"))).toEqual({ uid: UID, authenticated: false });
    expect(cookieValue(landed, "bz_adult")).toBeUndefined(); // they hadn't confirmed 18+, so they still will
  });

  it("never replaces an identity already on botchelor.com, and ignores a forged or stale token", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = signCarry({ uid: UID, authenticated: true, adult: true })!;
    const mine = signSession({ uid: "99999999-1111-4222-8333-444455556666", authenticated: false })!;
    const kept = await carry(new Request(`${NEW}?t=${token}&to=/feed`, { headers: { cookie: `bz_sess=${mine}` } }));
    expect(kept.headers.getSetCookie()).toEqual([]);
    expect(kept.headers.get("location")).toBe("/feed");
    const forged = await carry(new Request(`${NEW}?t=carry.v1.e30.AAAA&to=/feed`));
    expect(forged.headers.getSetCookie()).toEqual([]);
    const stale = signCarry({ uid: UID, authenticated: true, adult: false }, process.env, Date.now() - 120_000)!;
    expect((await carry(new Request(`${NEW}?t=${stale}&to=/feed`))).headers.getSetCookie()).toEqual([]);
  });

  it("only ever returns to a path on our own site", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    vi.stubEnv("SESSION_SECRET", SECRET);
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/gate?from=/x"]) {
      const res = await carry(new Request(`${NEW}?t=x&to=${encodeURIComponent(bad)}`));
      expect(res.headers.get("location")).toBe("/");
    }
    const noIdentity = await carry(new Request(`${OLD}?to=/feed`));
    expect(noIdentity.headers.get("location")).toBe("https://botchelor.com/feed");
    expect(safeFrom("/\\evil.example")).toBe("/");
  });
});
