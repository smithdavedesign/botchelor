import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as confirmAge } from "@/app/api/age/route";
import { POST as postCharacter } from "@/app/api/characters/route";
import { ADULT_COOKIE, ADULT_COOKIE_MAX_AGE, adultCookie, hasAdultCookie } from "@/lib/age";
import { MCP_CALL_URL } from "@/lib/http";
import { middleware } from "@/middleware";
import { api, BASE_URL, startTestDb, validCharacter } from "./helpers";

// David, 2026-11-14: the PG show pages open without the 18+ interstitial (the plan's Phase 0 "18+ gate" call, reversing
// 2026-10-16's "whole site gated"); the gate stays in front of dating, chat and money, and a creator attests in the
// builder instead: a saved character with its 18+ box ticked sets the gate's own cookie.
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const page = (path: string, cookie?: string) =>
  middleware(new NextRequest(`https://botchelor.com${path}`, { headers: { "user-agent": CHROME, ...(cookie ? { cookie } : {}) } }));
const passes = (res: Response) => res.status === 200 && res.headers.get("x-middleware-next") === "1" && res.headers.get("location") === null;
const gateFrom = (res: Response): string | null => {
  const location = res.headers.get("location");
  if (!location || res.status !== 307) return null;
  const url = new URL(location);
  return url.pathname === "/gate" ? url.searchParams.get("from") : null;
};

/** The spectator and creation pages: a person with no cookie at all reads and builds without the interstitial. */
const OPEN = [
  "/",
  "/watch",
  "/watch?tab=tonight",
  "/episodes/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab",
  "/episodes/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab?play=1",
  "/seasons/2026-11",
  "/couples/aaaa/bbbb",
  "/characters",
  "/characters?tab=people",
  "/characters/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab",
  "/creators/juniper",
  "/reunion",
  "/house",
  "/house?scene=2026-11-15-gossip",
  "/casting",
  "/vote",
  "/calls",
  "/import",
  "/import?from=cai",
  "/create",
  // Step into the date's picker and start screen (2026-11-15): its own 18+ box is the answer, as the builder's is.
  "/step-in",
  "/step-in?with=house-juniper",
  "/agents",
  "/agents/pricing",
  "/agents/league",
  "/agents/some-handle",
];

/** Dating, chat and money, and every After Dark page: the gate still stands, and remembers where they were headed. */
const GATED = [
  "/swipe",
  "/matches",
  "/chat",
  "/messages",
  "/messages/aaaa/bbbb",
  "/companion",
  "/companion/plan",
  "/companions",
  // A step-in date once it's started (the start sets the cookie).
  "/step-in/abc",
  "/shop",
  "/account",
  "/account/settings",
  "/notifications",
  "/mixers",
  "/mixers/abc",
  "/double/abc123",
  "/after-dark",
  "/after-dark/a/b",
  "/after-dark/subscribe",
  "/admin/after-dark/settings",
  "/feed",
  "/admin",
];

describe("the 18+ gate opens the PG show (middleware)", () => {
  it("lets every spectator and creation page through without the cookie", () => {
    for (const p of OPEN) expect(passes(page(p)), p).toBe(true);
  });

  it("still sends a person to the gate from every dating, chat, money and After Dark page, remembering where they were headed", () => {
    for (const p of GATED) expect(gateFrom(page(p)), p).toBe(p);
    // The query travels too, so confirming drops them back on the same view.
    expect(gateFrom(page("/swipe?deck=house"))).toBe("/swipe?deck=house");
  });

  it("opens all of them once the cookie is there, whoever set it (the gate or a saved character)", () => {
    for (const p of [...OPEN, ...GATED]) expect(passes(page(p, `${ADULT_COOKIE}=1`)), p).toBe(true);
  });

  it("a prefix covers the page itself and what's under it, and nothing that merely starts with the same letters", () => {
    expect(passes(page("/episodes"))).toBe(true);
    expect(passes(page("/seasons"))).toBe(true);
    expect(passes(page("/creators"))).toBe(true);
    // /charactersx is not /characters: an unknown page meets the gate like any other.
    expect(gateFrom(page("/charactersx"))).toBe("/charactersx");
    expect(gateFrom(page("/agentsx"))).toBe("/agentsx");
  });
});

describe("one cookie wherever it's set (lib/age.ts)", () => {
  it("reads the Cookie header as middleware does", () => {
    expect(hasAdultCookie("bz_adult=1")).toBe(true);
    expect(hasAdultCookie("bz_uid=abc; bz_adult=1; bz_sess=x")).toBe(true);
    expect(hasAdultCookie("bz_adult=0")).toBe(false);
    expect(hasAdultCookie("bz_adultx=1")).toBe(false);
    expect(hasAdultCookie(null)).toBe(false);
  });

  it("the gate's confirm sets exactly the shared cookie, a year long, Secure on https only", async () => {
    const http = await confirmAge(new Request(`${BASE_URL}/api/age`, { method: "POST", body: new URLSearchParams({ from: "/swipe" }) }));
    expect(http.status).toBe(303);
    expect(http.headers.get("location")).toBe("/swipe");
    expect(http.headers.getSetCookie()).toEqual([adultCookie(false)]);
    expect(adultCookie(false)).toBe(`bz_adult=1; Path=/; Max-Age=${ADULT_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`);
    expect(ADULT_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
    const https = await confirmAge(new Request("https://botchelor.com/api/age", { method: "POST", body: new URLSearchParams({ from: "/swipe" }) }));
    expect(https.headers.getSetCookie()).toEqual([adultCookie(true)]);
    expect(adultCookie(true).endsWith("; Secure")).toBe(true);
  });
});

describe("the builder's 18+ box is the creator's attestation (POST /api/characters)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it("sets the gate's cookie on a successful save from a browser that has none, next to the new session cookie", async () => {
    const res = await api.createCharacter(validCharacter());
    expect(res.status).toBe(201);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toContain(adultCookie(false));
    expect(cookies.some((c) => c.startsWith("bz_uid=") || c.startsWith("bz_sess="))).toBe(true);
    // From there the swipe deck opens without the interstitial.
    expect(passes(page("/swipe", cookies.map((c) => c.split(";")[0]).join("; ")))).toBe(true);
  });

  it("leaves the cookie alone when the browser already has it", async () => {
    const res = await api.createCharacter(validCharacter(), `${ADULT_COOKIE}=1`);
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${ADULT_COOKIE}=`))).toBe(false);
  });

  it("sets nothing when the save is refused, on a check, or for an agent's call", async () => {
    const refused = await api.createCharacter({ ...validCharacter(), attest: false });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.headers.getSetCookie().some((c) => c.startsWith(`${ADULT_COOKIE}=`))).toBe(false);
    const checked = await api.createCharacter({ ...validCharacter(), check_only: true });
    expect(checked.status).toBe(200);
    expect(checked.headers.getSetCookie().some((c) => c.startsWith(`${ADULT_COOKIE}=`))).toBe(false);
    // An MCP tool call (lib/http isMcpCall) runs the same handler; an agent carries no cookies, so it gets none.
    const mcp = await postCharacter(new Request(MCP_CALL_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keep_name: true, ...validCharacter() }) }));
    expect(mcp.status).toBe(201);
    expect(mcp.headers.getSetCookie().some((c) => c.startsWith(`${ADULT_COOKIE}=`))).toBe(false);
  });
});
