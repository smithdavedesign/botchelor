import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getEngagement } from "@/app/api/admin/engagement/route";
import { POST as beacon } from "@/app/api/e/route";
import { sourceFrom } from "@/app/engagement";
import { cleanBeacon, cleanProps, deviceOf, loadEngagement, MAX_BATCH, MAX_PER_WINDOW, normalizePath, resetBudgetsForTests, sourceOf } from "@/lib/engagement";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// David, 2026-10-31: "Add analytics to track all engagements across the site, get us ready for first visitors and tracking".
const PASSWORD = ["engagement", "route", "pass"].join("-");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetBudgetsForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
  setPlaceForTests({ country: "CA", region: "ON" });
});
afterEach(() => {
  setPlaceForTests(null);
  vi.unstubAllEnvs();
});

const send = (body: unknown, opts: { ua?: string; cookie?: string } = {}) =>
  beacon(
    new Request(`${BASE_URL}/api/e`, {
      method: "POST",
      headers: { "content-type": "text/plain", "user-agent": opts.ua ?? MAC, ...(opts.cookie ? { cookie: opts.cookie } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const rows = async () => (await t.db.query(`select * from web_events order by id`)).rows;
const today = new Date().toISOString().slice(0, 10);

describe("what the beacon keeps", () => {
  it("replaces ids in paths, drops queries, and hides ship names", () => {
    expect(normalizePath("/characters/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab?x=1#y")).toBe("/characters/:id");
    expect(normalizePath("/episodes/12345/watch")).toBe("/episodes/:id/watch");
    expect(normalizePath("/ship/Ada+Bo")).toBe("/ship");
    expect(normalizePath("/c/juniper-a1b2c3d4")).toBe("/c/:id");
    expect(normalizePath("/Watch/")).toBe("/watch");
    expect(normalizePath("")).toBe("/");
  });

  it("keeps small props only", () => {
    const p = cleanProps({ label: "  Make   your character ", seconds: 12.3456, ok: true, "Bad Key": "x", nested: { a: 1 }, to: "/characters/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab", long: "x".repeat(200) });
    expect(p).toEqual({ label: "Make your character", seconds: 12.35, ok: true, to: "/characters/:id", long: "x".repeat(80) });
  });

  it("names where a visit came from", () => {
    expect(sourceOf({ ref_host: "www.google.com" })).toBe("google");
    expect(sourceOf({ ref_host: "old.reddit.com" })).toBe("reddit");
    expect(sourceOf({ ref_host: "t.co" })).toBe("x");
    expect(sourceOf({ ref_host: "chatgpt.com" })).toBe("chatgpt");
    expect(sourceOf({ ref_host: "gemini.google.com" })).toBe("gemini");
    expect(sourceOf({ ref_host: "ad.botchelor.com" })).toBe("direct");
    expect(sourceOf({ ref_host: "someblog.net" })).toBe("other");
    expect(sourceOf({})).toBe("direct");
    expect(sourceOf({ ref: "share" })).toBe("share_link");
    // A tagged link wins over the referrer.
    expect(sourceOf({ ref_host: "www.google.com", utm_source: "Reddit Ads" })).toBe("reddit_ads");
  });

  it("reads the source from the landing address, the 18+ gate included", () => {
    expect(sourceFrom("?utm_source=bsky&utm_medium=social&utm_campaign=launch&utm_content=post1", "/", "https://bsky.app/profile/x", "https://botchelor.com")).toEqual({
      ref_host: "bsky.app",
      utm_source: "bsky",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_content: "post1",
      ref: null,
    });
    // The gate holds the page someone was headed to, query and all, in ?from.
    const gate = sourceFrom(`?from=${encodeURIComponent("/watch?utm_source=reddit&ref=share")}`, "/gate", "", "https://botchelor.com");
    expect(gate).toMatchObject({ utm_source: "reddit", ref: "share", ref_host: null });
    // Our own pages are never a referrer.
    expect(sourceFrom("", "/watch", "https://botchelor.com/", "https://botchelor.com").ref_host).toBeNull();
  });

  it("tells phones, tablets and desktops apart", () => {
    expect(deviceOf(IPHONE)).toBe("phone");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("phone");
    expect(deviceOf(MAC)).toBe("desktop");
  });

  it("refuses a beacon without ids, and drops bad events one by one", () => {
    expect(cleanBeacon({ v: "x", s: S1, events: [{ e: "page_view", path: "/" }] })).toBeNull();
    const b = cleanBeacon({ v: V1, s: S1, events: [{ e: "page_view", path: "/" }, { e: "Bad Name!", path: "/" }, { e: "link_click" }, null] });
    expect(b?.events.map((e) => e.event)).toEqual(["page_view"]);
    expect(cleanBeacon({ v: V1, s: S1, events: Array.from({ length: 60 }, () => ({ e: "page_view", path: "/" })) })?.events).toHaveLength(MAX_BATCH);
  });
});

describe("the beacon route", () => {
  it("stores a batch with its visit's source, the device, the country and who's signed in", async () => {
    const me = userIdOf(newUserCookie());
    const cookie = signedInCookie(me);
    const res = await send(
      {
        v: V1,
        s: S1,
        src: { ref_host: "www.reddit.com", utm_source: null },
        events: [
          { e: "page_view", path: "/watch", t: Date.now() - 5_000 },
          { e: "link_click", path: "/watch", props: { to: "/create", area: "main" } },
          { e: "page_leave", path: "/watch", props: { seconds: 41, scroll: 80 } },
        ],
      },
      { ua: IPHONE, cookie },
    );
    expect(res.status).toBe(204);
    const r = await rows();
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ visitor: V1, session: S1, user_id: me, event: "page_view", path: "/watch", source: "reddit", device: "phone", country: "CA", host: "show" });
    expect(r[1].props).toEqual({ to: "/create", area: "main" });
  });

  it("drops bots, junk and a browser over its budget, always with a 204", async () => {
    expect((await send({ v: V1, s: S1, events: [{ e: "page_view", path: "/" }] }, { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" })).status).toBe(204);
    expect((await send("not json")).status).toBe(204);
    expect((await send({ v: V1 })).status).toBe(204);
    expect(await rows()).toHaveLength(0);
    const batch = { v: V2, s: S2, events: Array.from({ length: MAX_BATCH }, () => ({ e: "button_click", path: "/" })) };
    for (let i = 0; i * MAX_BATCH <= MAX_PER_WINDOW; i++) await send(batch);
    const kept = (await rows()).length;
    expect(kept).toBeLessThanOrEqual(MAX_PER_WINDOW);
    expect(kept).toBeGreaterThan(0);
  });
});

describe("the Engagement tab", () => {
  async function visit(visitor: string, session: string, src: Record<string, string | null>, events: { e: string; path: string; props?: Record<string, unknown> }[], ua = MAC, cookie?: string) {
    expect((await send({ v: visitor, s: session, src, events }, { ua, cookie })).status).toBe(204);
  }

  it("counts visitors, visits, pages, time, sources, clicks and the funnel, our own traffic left out", async () => {
    await visit(V1, S1, { ref_host: "www.google.com" }, [
      { e: "page_view", path: "/" },
      { e: "link_click", path: "/", props: { to: "/create", area: "nav" } },
      { e: "page_leave", path: "/", props: { seconds: 20, scroll: 50 } },
      { e: "create_opened", path: "/create" },
      { e: "page_view", path: "/create" },
      { e: "character_created", path: "/create", props: { open_to_dates: true } },
      { e: "date_started", path: "/create", props: { mode: "blind" } },
      { e: "page_leave", path: "/create", props: { seconds: 100, scroll: 90 } },
    ]);
    // A bounce from a tagged link, on a phone.
    await visit(V2, S2, { utm_source: "reddit", utm_medium: "social", utm_campaign: "launch", utm_content: "sillytavern" }, [
      { e: "page_view", path: "/watch" },
      { e: "page_leave", path: "/watch", props: { seconds: 4, scroll: 10 } },
    ], IPHONE);
    // An admin's browser: left out unless asked for.
    const admin = userIdOf(newUserCookie());
    await t.db.query(`insert into admins (user_id) values ($1)`, [admin]);
    await visit("33333333-3333-4333-8333-333333333333", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", {}, [{ e: "page_view", path: "/admin" }], MAC, signedInCookie(admin));

    const e = await loadEngagement(t.db, { from: today, to: today, includeOurs: false, host: "all" });
    expect(e.totals).toMatchObject({ visitors: 2, new_visitors: 2, sessions: 2, page_views: 3, pages_per_session: 1.5, avg_session_seconds: 62, bounce_rate: 50 });
    expect(e.pages.find((p) => p.path === "/create")).toMatchObject({ views: 1, visitors: 1, avg_seconds: 100, avg_scroll: 90 });
    expect(e.sources.map((s) => [s.source, s.sessions, s.created])).toEqual(expect.arrayContaining([["google", 1, 1], ["reddit", 1, 0]]));
    expect(e.campaigns).toEqual([{ key: "reddit / social / launch / sillytavern", count: 1, visitors: 1 }]);
    expect(e.clicks).toEqual([{ key: "/create · nav", count: 1, visitors: 1 }]);
    expect(e.landing.map((l) => l.key).sort()).toEqual(["/", "/watch"]);
    expect(e.devices.map((d) => d.key).sort()).toEqual(["desktop", "phone"]);
    expect(Object.fromEntries(e.funnel.map((f) => [f.key, f.visitors]))).toMatchObject({ visited: 2, engaged: 1, create_opened: 1, character_created: 1, date_started: 1, sign_up: 0 });
    expect(e.funnel.find((f) => f.key === "date_started")?.of_first).toBe(50);
    expect(e.daily.find((d) => d.day === today)).toMatchObject({ visitors: 2, page_views: 3 });

    const withOurs = await loadEngagement(t.db, { from: today, to: today, includeOurs: true, host: "all" });
    expect(withOurs.totals.visitors).toBe(3);
  });

  it("is owner-only", async () => {
    const get = (headers: Record<string, string>) => getEngagement(new Request(`${BASE_URL}/api/admin/engagement?from=${today}&to=${today}`, { headers }));
    expect((await get({ "x-frontier-key": "wrong" })).status).toBe(403);
    const res = await get({ "x-frontier-key": PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).query).toMatchObject({ from: today, to: today, host: "all", includeOurs: false });
  });
});
