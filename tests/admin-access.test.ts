// Admin access (2026-11-22 audit): a signed-in admin account passes every admin API with no second password, the
// browser keeps no admin key, and guessing the key that scripts send is limited per address (lib/admin-key.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as agentsGet } from "@/app/api/admin/agents/route";
import { POST as bookDate } from "@/app/api/admin/book-date/route";
import { GET as feedbackGet, PATCH as feedbackPatch } from "@/app/api/admin/feedback/route";
import { POST as frontierPost } from "@/app/api/admin/frontier/route";
import { POST as homeClip } from "@/app/api/admin/home-clip/route";
import { GET as relationshipsGet } from "@/app/api/admin/relationships/route";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { adminAuthorized } from "@/lib/admin-auth";
import { ADMIN_KEY_FAILURES_ALLOWED, ADMIN_KEY_LOCKOUT_MS, adminKeyAllowed, forgetAdminKeyFailuresForTests } from "@/lib/admin-key";
import { frontierAuthorized } from "@/lib/model";
import { BASE_URL, HOUSE_PARTNER_ID, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

const PW = ["admin", "key", "for", "tests"].join("-");
const ENV = { FRONTIER_PASSWORD: PW };

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetAdminKeyFailuresForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A request from `ip` as the platform's edge names it (lib/limits.ts clientIp), with the key and cookie given. */
const from = (ip: string | null, { key, cookie, path = "/api/admin/agents" }: { key?: string; cookie?: string; path?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, {
    headers: { ...(ip ? { "do-connecting-ip": ip } : {}), ...(key ? { "x-frontier-key": key } : {}), ...(cookie ? { cookie } : {}) },
  });

async function adminCookie(): Promise<string> {
  const id = crypto.randomUUID();
  await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return signedInCookie(id);
}

describe("guessing the admin key (lib/admin-key.ts)", () => {
  it("refuses every key from an address, the right one too, after 10 wrong ones, for 15 minutes", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED - 1; i++) expect(adminKeyAllowed(from("203.0.113.7"), false, now + i)).toBe(false);
    // Nine wrong: the right key still works, and clears the count.
    expect(adminKeyAllowed(from("203.0.113.7"), true, now + 20)).toBe(true);
    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED - 1; i++) expect(adminKeyAllowed(from("203.0.113.7"), false, now + 30 + i)).toBe(false);
    expect(adminKeyAllowed(from("203.0.113.7"), true, now + 50)).toBe(true);

    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED; i++) adminKeyAllowed(from("203.0.113.7"), false, now + 100 + i);
    expect(adminKeyAllowed(from("203.0.113.7"), true, now + 200)).toBe(false);
    expect(adminKeyAllowed(from("203.0.113.7"), true, now + 100 + ADMIN_KEY_LOCKOUT_MS - 1000)).toBe(false);
    // Another address is its own count.
    expect(adminKeyAllowed(from("198.51.100.4"), true, now + 300)).toBe(true);
    // Fifteen minutes on, the right key works again.
    expect(adminKeyAllowed(from("203.0.113.7"), true, now + 200 + ADMIN_KEY_LOCKOUT_MS)).toBe(true);
  });

  it("forgets wrong keys older than 15 minutes", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED - 1; i++) adminKeyAllowed(from("203.0.113.7"), false, now);
    adminKeyAllowed(from("203.0.113.7"), false, now + 16 * 60_000);
    expect(adminKeyAllowed(from("203.0.113.7"), true, now + 16 * 60_000 + 1)).toBe(true);
  });

  it("counts an IPv6 /64 as one address, and one request once however often it's checked", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED; i++) adminKeyAllowed(from(`2001:db8:1:2::${(i + 1).toString(16)}`), false, now + i);
    expect(adminKeyAllowed(from("2001:db8:1:2::ffff"), true, now + 100)).toBe(false);
    expect(adminKeyAllowed(from("2001:db8:1:3::1"), true, now + 100)).toBe(true);

    const once = from("192.0.2.9");
    for (let i = 0; i < 3 * ADMIN_KEY_FAILURES_ALLOWED; i++) adminKeyAllowed(once, false, now);
    expect(adminKeyAllowed(from("192.0.2.9"), true, now + 1)).toBe(true);
  });

  it("doesn't count a request with no address (the server's own calls)", () => {
    for (let i = 0; i < 3 * ADMIN_KEY_FAILURES_ALLOWED; i++) expect(frontierAuthorized(from(null, { key: "wrong" }), ENV)).toBe(false);
    expect(frontierAuthorized(from(null, { key: PW }), ENV)).toBe(true);
  });

  it("is what frontierAuthorized checks, so a locked-out address loses the key everywhere, the MCP's admin tools too", async () => {
    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED; i++) expect(frontierAuthorized(from("203.0.113.7", { key: `wrong-${i}` }), ENV)).toBe(false);
    expect(frontierAuthorized(from("203.0.113.7", { key: PW }), ENV)).toBe(false);
    expect((await agentsGet(from("203.0.113.7", { key: PW }))).status).toBe(403);
    expect(frontierAuthorized(from("198.51.100.4", { key: PW }), ENV)).toBe(true);
    expect((await agentsGet(from("198.51.100.4", { key: PW }))).status).toBe(200);

    // The MCP endpoint hands its admin tools only a key that passes here.
    const list = async (ip: string) => {
      const res = await mcpPost(
        new Request(`${BASE_URL}/api/mcp?tools=all`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "do-connecting-ip": ip, "x-frontier-key": PW },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        }),
      );
      return ((await res.json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.map((x) => x.name) ?? [];
    };
    const open = await list("198.51.100.4");
    const locked = await list("203.0.113.7");
    expect(open.length).toBeGreaterThan(locked.length);
    expect(locked.every((name) => open.includes(name))).toBe(true);
  });

  it("never refuses a signed-in admin account: it doesn't read the key", async () => {
    const cookie = await adminCookie();
    for (let i = 0; i < ADMIN_KEY_FAILURES_ALLOWED; i++) frontierAuthorized(from("203.0.113.7", { key: `wrong-${i}` }), ENV);
    expect(frontierAuthorized(from("203.0.113.7", { key: PW }), ENV)).toBe(false);
    expect(await adminAuthorized(from("203.0.113.7", { cookie }))).toBe(true);
    // Even with a wrong key beside it.
    expect(await adminAuthorized(from("203.0.113.7", { cookie, key: "wrong" }))).toBe(true);
  });
});

describe("a signed-in admin account passes the admin APIs that used to take only the key", () => {
  it("agents, relationships and the agents' feedback answer it, and refuse a signed-in account that isn't an admin", async () => {
    const cookie = await adminCookie();
    const someone = signedInCookie(crypto.randomUUID());
    for (const [handler, path] of [
      [agentsGet, "/api/admin/agents"],
      [relationshipsGet, "/api/admin/relationships"],
      [feedbackGet, "/api/admin/feedback"],
    ] as const) {
      expect((await handler(from("203.0.113.7", { cookie, path }))).status, path).toBe(200);
      expect((await handler(from("203.0.113.7", { cookie: someone, path }))).status, path).toBe(403);
      expect((await handler(from("203.0.113.7", { path }))).status, path).toBe(403);
    }
    const patch = (c: string) =>
      feedbackPatch(
        new Request(`${BASE_URL}/api/admin/feedback`, {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: c },
          body: JSON.stringify({ id: crypto.randomUUID(), hidden: true }),
        }),
      );
    expect((await patch(cookie)).status).not.toBe(403);
    expect((await patch(someone)).status).toBe(403);
  });

  it("booking a test date and the home clip get past the check (and stop at their own)", async () => {
    const cookie = await adminCookie();
    const booked = await bookDate(
      new Request(`${BASE_URL}/api/admin/book-date`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ character_id: crypto.randomUUID(), partner_id: HOUSE_PARTNER_ID }),
      }),
    );
    expect(booked.status).not.toBe(403);
    vi.stubEnv("HOME_HERO_CLIP", "1");
    const form = new FormData();
    form.set("episode", crypto.randomUUID());
    const clip = await homeClip(new Request(`${BASE_URL}/api/admin/home-clip`, { method: "POST", headers: { cookie }, body: form }));
    expect(clip.status).not.toBe(403);
    expect((await homeClip(new Request(`${BASE_URL}/api/admin/home-clip`, { method: "POST", body: new FormData() }))).status).toBe(403);
  });

  it("a frontier run still takes the key, from an admin account too: it spends on the paid model", async () => {
    const cookie = await adminCookie();
    const run = await frontierPost(
      new Request(`${BASE_URL}/api/admin/frontier`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: "A", b: "B" }) }),
    );
    expect(run.status).toBe(403);
  });
});
