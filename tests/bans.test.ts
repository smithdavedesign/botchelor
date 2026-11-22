import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as liftRoute, GET as listRoute, POST as banRoute } from "@/app/api/admin/bans/route";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { POST as reportRoute } from "@/app/api/reports/route";
import { claimAdmin } from "@/lib/admins";
import { agentBan, banOn, banTarget, liftBan, liveBan, refreshBans, resetBansForTests, resolveTarget } from "@/lib/bans";
import { addressKey } from "@/lib/limits";
import { handleMcpMessage } from "@/lib/mcp";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// Bans and suspensions (lib/bans.ts, 2026-11-22): an admin stops an account, an agent or an address; every change it
// makes is refused, everything it reads stays open, and the admins' own tools never are.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetBansForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetBansForTests();
});

const HOUR = 60 * 60 * 1000;
const ban = (kind: "account" | "agent" | "address", target: string, until: Date | null = null) => banTarget(t.db, { kind, target, until, reason: "test", by: "admin-password" });
const fromAddress = (path: string, ip: string, init: { method?: string; cookie?: string; body?: unknown } = {}) =>
  new Request(`${BASE_URL}${path}`, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", "do-connecting-ip": ip, ...(init.cookie ? { cookie: init.cookie } : {}) },
    ...(init.method === "GET" ? {} : { body: JSON.stringify(init.body ?? {}) }),
  });

describe("an account ban", () => {
  it("refuses every change it makes, and nothing it reads; lifted, it plays again", async () => {
    const cookie = newUserCookie();
    await ban("account", userIdOf(cookie));
    const refused = await api.createCharacter(validCharacter(), cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "suspended", until: null, message: expect.stringContaining("can't be done from here") });
    expect((await api.feed(cookie)).status).toBe(200);
    // Someone else is untouched.
    expect((await api.createCharacter(validCharacter({ name: "Other Person" }), newUserCookie())).status).toBe(201);
    expect(await liftBan(t.db, "account", userIdOf(cookie))).toBe(true);
    expect((await api.createCharacter(validCharacter(), cookie)).status).toBe(201);
    expect(await liftBan(t.db, "account", userIdOf(cookie))).toBe(false);
  });

  it("a suspension says until when, and ends by itself", async () => {
    const cookie = newUserCookie();
    const now = Date.now();
    await ban("account", userIdOf(cookie), new Date(now + HOUR));
    const req = new Request(`${BASE_URL}/api/characters`, { method: "POST", headers: { cookie } });
    expect(banOn(req, now)).toMatchObject({ error: "suspended", until: new Date(now + HOUR).toISOString(), message: expect.stringContaining("until") });
    expect(banOn(req, now + 2 * HOUR)).toBeNull();
    expect(liveBan("account", userIdOf(cookie), now + 2 * HOUR)).toBeNull();
  });

  it("is loaded by every process from the table, ended ones left out", async () => {
    const live = randomUUID();
    const ended = randomUUID();
    await ban("account", live);
    await t.db.query(`insert into bans (kind, target, until, banned_by) values ('account', $1, now() - interval '1 hour', 'x')`, [ended]);
    resetBansForTests();
    expect(liveBan("account", live)).toBeNull();
    await refreshBans(t.db);
    expect(liveBan("account", live)).toEqual({ until: null });
    expect(liveBan("account", ended)).toBeNull();
  });
});

describe("an address ban", () => {
  it("refuses that address's changes whoever makes them, an IPv6 address's whole /64 with it", async () => {
    await ban("address", addressKey("203.0.113.9"));
    const res = await reportRoute(fromAddress("/api/reports", "203.0.113.9", { cookie: newUserCookie(), body: { episode_id: "nope" } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("suspended");
    expect((await reportRoute(fromAddress("/api/reports", "203.0.113.10", { cookie: newUserCookie(), body: { episode_id: "nope" } }))).status).toBe(404);
    await ban("address", addressKey("2001:db8:1:2::5"));
    expect(banOn(fromAddress("/api/reports", "2001:db8:1:2:ffff::1"))).not.toBeNull();
    expect(banOn(fromAddress("/api/reports", "2001:db8:1:3::1"))).toBeNull();
  });

  it("never stops the admins' tools, signing out, the webhooks, the jobs or the health check", async () => {
    await ban("address", addressKey("203.0.113.9"));
    for (const path of ["/api/admin/bans", "/api/auth/logout", "/api/webhooks/stripe", "/api/jobs/upkeep", "/api/health"]) {
      expect(banOn(fromAddress(path, "203.0.113.9")), path).toBeNull();
    }
    expect(banOn(fromAddress("/api/characters", "203.0.113.9"))).not.toBeNull();
  });

  it("refuses its MCP calls at the door", async () => {
    const init = (ip: string) =>
      mcpRoute(
        new Request(`${BASE_URL}/api/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "do-connecting-ip": ip, "user-agent": "botchelor-test/1.0" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "botchelor-test", version: "1" } } }),
        }),
      );
    await ban("address", addressKey("198.51.100.4"), new Date(Date.now() + HOUR));
    const refused = await init("198.51.100.4");
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatchObject({ code: -32000, message: expect.stringContaining("until") });
    expect((await init("198.51.100.5")).status).toBe(200);
  });
});

describe("an agent ban", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callTool = async (name: string, args: Record<string, unknown>): Promise<any> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any).result;

  it("refuses the agent's calls, and an account's ban covers the agents acting as it", async () => {
    const created = await callTool("create_character", validCharacter());
    const agentId: string = created.structuredContent.agent_id;
    expect((await callTool("my_status", { agent_id: agentId })).isError).toBeUndefined();
    await ban("agent", agentId);
    const refused = await callTool("my_status", { agent_id: agentId });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ code: "suspended" });
    await liftBan(t.db, "agent", agentId);
    expect((await callTool("my_status", { agent_id: agentId })).isError).toBeUndefined();
    await ban("account", agentId);
    expect(agentBan(agentId, null)).not.toBeNull();
    expect(agentBan(randomUUID(), null)).toBeNull();
  });
});

describe("the admins' bans (app/api/admin/bans)", () => {
  const as = (method: string, body?: unknown, key = "owner-pass") =>
    new Request(`${BASE_URL}/api/admin/bans`, { method, headers: { "content-type": "application/json", "x-frontier-key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it("bans an account by its handle, suspends an address for days, lists them and lifts one", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "owner-pass");
    const id = randomUUID();
    await t.db.query(`insert into accounts (user_id, handle, handle_display) values ($1, 'mallory', 'Mallory')`, [id]);
    const made = await banRoute(as("POST", { kind: "account", target: "@Mallory", reason: "spam rings" }));
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ kind: "account", target: id, label: "@Mallory", until: null });
    const suspended = await banRoute(as("POST", { kind: "address", target: "203.0.113.77", days: 7 }));
    expect(suspended.status).toBe(201);
    const key = (await suspended.json()).target as string;
    expect(key).toBe(addressKey("203.0.113.77"));
    const listed = (await (await listRoute(as("GET"))).json()).bans as { kind: string; target: string; label: string | null; live: boolean; until: string | null }[];
    expect(listed.map((b) => [b.kind, b.label, b.live])).toEqual(
      expect.arrayContaining([
        ["account", "@Mallory", true],
        ["address", null, true],
      ]),
    );
    // No address is kept: only its key.
    expect(JSON.stringify(listed)).not.toContain("203.0.113.77");
    expect((await liftRoute(as("DELETE", { kind: "address", target: key }))).status).toBe(200);
    expect((await liftRoute(as("DELETE", { kind: "address", target: key }))).status).toBe(404);
    expect(liveBan("address", key)).toBeNull();
  });

  it("never bans an admin's account, refuses what it can't find, and is the admins' only", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "owner-pass");
    const admin = randomUUID();
    await claimAdmin(t.db, admin);
    const res = await banRoute(as("POST", { kind: "account", target: admin }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("is_admin");
    expect((await banRoute(as("POST", { kind: "account", target: "@nobody-here" }))).status).toBe(422);
    expect((await banRoute(as("POST", { kind: "agent", target: "not-an-id" }))).status).toBe(422);
    expect((await banRoute(as("POST", { kind: "address", target: "not an address" }))).status).toBe(422);
    expect((await banRoute(as("POST", { kind: "account", target: randomUUID() }, "wrong"))).status).toBe(403);
    expect((await listRoute(as("GET", undefined, "wrong"))).status).toBe(403);
    expect(await resolveTarget(t.db, "address", "2001:db8::1")).toEqual({ target: addressKey("2001:db8::1"), label: null });
  });
});
