import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { visitorKey } from "@/lib/limits";
import { checkRateLimit, rateLimitInfo, resetRateLimitsForTests } from "@/lib/rate-limit";
import { BASE_URL, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// 2026-11-22 audit: every MCP initialize writes a session row, and nothing limited how many one address could open.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetRateLimitsForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});

const ADDRESS = { "do-connecting-ip": "203.0.113.20" };
const post = (body: unknown, headers: Record<string, string> = ADDRESS) =>
  mcpPost(new Request(`${BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "someones-agent/1.0", ...headers }, body: JSON.stringify(body) }));
const initialize = (id: number) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-limit-test" } } });

describe("new MCP sessions per address", () => {
  it("opens sessions until the address's hour is used up, then answers 429 with when to come back", async () => {
    expect(rateLimitInfo("mcp_initialize")).toEqual({ windowSeconds: 3600, max: 150 });
    expect((await post(initialize(1))).status).toBe(200);
    // The rest of this hour's allowance, spent as other initializes from the same address would.
    const key = visitorKey(new Headers(ADDRESS))!;
    for (let i = 1; i < rateLimitInfo("mcp_initialize").max; i++) checkRateLimit(key, "mcp_initialize");
    const res = await post(initialize(2));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as { id: unknown; error: { message: string; data: { code: string } } };
    expect(body.id).toBe(2);
    expect(body.error.data.code).toBe("rate_limited");
    expect(body.error.message).toMatch(/Too many new sessions from this address/);
    // A call on a session already open isn't a new session, and another address has its own allowance.
    expect((await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })).status).toBe(200);
    expect((await post(initialize(4), { "do-connecting-ip": "198.51.100.7" })).status).toBe(200);
  });

  it("holds a day's worth too", () => {
    expect(rateLimitInfo("mcp_initialize_day")).toEqual({ windowSeconds: 86_400, max: 1_500 });
  });
});
