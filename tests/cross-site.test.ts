import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postAge } from "@/app/api/age/route";
import { POST as vote } from "@/app/api/casting/route";
import { crisisAware } from "@/lib/crisis";
import { crossSiteBrowserRequest, handle, json } from "@/lib/http";
import { BASE_URL, startTestDb } from "./helpers";

// 2026-11-22 audit: a form on any site could post to an API route. The browser left the SameSite=Lax identity cookie
// off that request but kept the cookie its answer set, so a fresh identity replaced the visitor's. Requests a browser
// marks as another site's are refused before anything runs.

const req = (headers: Record<string, string>, method = "POST", url = `${BASE_URL}/api/casting`) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify({ character_id: "made-up" }) });

describe("crossSiteBrowserRequest", () => {
  beforeEach(() => {
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://ad.botchelor.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("goes by Sec-Fetch-Site when the browser sends it: only another site's request is refused", () => {
    expect(crossSiteBrowserRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(crossSiteBrowserRequest(req({ "sec-fetch-site": "Cross-Site" }))).toBe(true);
    for (const site of ["same-origin", "same-site", "none"]) expect(crossSiteBrowserRequest(req({ "sec-fetch-site": site }))).toBe(false);
    // The header wins over Origin: After Dark's host is the same site as the show.
    expect(crossSiteBrowserRequest(req({ "sec-fetch-site": "same-site", origin: "https://ad.botchelor.com" }))).toBe(false);
  });

  it("without it, by Origin: the show, its subdomains, After Dark's host and the host asked are ours", () => {
    for (const origin of ["https://botchelor.com", "https://www.botchelor.com", "https://staging.botchelor.com", "https://ad.botchelor.com", "http://localhost:3000"]) {
      expect(crossSiteBrowserRequest(req({ origin })), origin).toBe(false);
    }
    for (const origin of ["https://evil.example", "https://botchelor.com.evil.example", "https://notbotchelor.com", "null", "not a url"]) {
      expect(crossSiteBrowserRequest(req({ origin })), origin).toBe(true);
    }
  });

  it("never refuses what isn't a page in a browser, or doesn't change anything", () => {
    expect(crossSiteBrowserRequest(req({}))).toBe(false); // an agent, a webhook, a job: no Origin, no Sec-Fetch-Site
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(crossSiteBrowserRequest(req({ "sec-fetch-site": "cross-site" }, method))).toBe(false);
  });
});

describe("a cross-site post", () => {
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

  it("is refused before the route runs: no new identity, nothing counted", async () => {
    const res = await vote(req({ "sec-fetch-site": "cross-site", origin: "https://evil.example", "x-forwarded-for": "203.0.113.7" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cross_site_refused");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await t.db.query(`select 1 from rate_hits`)).rows).toHaveLength(0);
    // The same post from the show's own page goes through (to the made-up character's 404) and mints as before.
    const own = await vote(req({ "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.7" }));
    expect(own.status).toBe(404);
    expect(own.headers.get("set-cookie")).toMatch(/bz_(sess|uid)=/);
  });

  it("is refused by a route that reads words for crisis resources before a word is read", async () => {
    let read = 0;
    let ran = 0;
    const route = crisisAware(
      "date_note",
      () => {
        read++;
        return [];
      },
      handle(async () => {
        ran++;
        return json({ ok: true });
      }),
    );
    const res = await route(req({ "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect([read, ran]).toEqual([0, 0]);
    expect((await route(req({ "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect([read, ran]).toEqual([1, 1]);
  });

  it("can't tick the age gate for a visitor", async () => {
    const form = () => {
      const f = new FormData();
      f.set("from", "/characters");
      return f;
    };
    const elsewhere = await postAge(new Request(`${BASE_URL}/api/age`, { method: "POST", headers: { "sec-fetch-site": "cross-site" }, body: form() }));
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.headers.get("set-cookie")).toBeNull();
    const own = await postAge(new Request(`${BASE_URL}/api/age`, { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: form() }));
    expect(own.status).toBe(303);
    expect(own.headers.get("location")).toBe("/characters");
    expect(own.headers.get("set-cookie")).toMatch(/bz_adult=1/);
  });
});
