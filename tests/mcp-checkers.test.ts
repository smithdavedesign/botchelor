// MCP registries and liveness checkers shake hands without touching the database (lib/mcp/probe-log.ts): their every-few-
// minutes handshakes kept Neon awake around the clock (2026-11-01). Their rows are written later, with their real times.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { setDbForTests, type Db } from "@/lib/db";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { isCheckerClient, waitingWrites } from "@/lib/mcp/probe-log";
import { BASE_URL, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
let queries = 0;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Count every query the code under test sends to the database.
  queries = 0;
  const counted: Db = {
    query: (...args: Parameters<Db["query"]>) => {
      queries++;
      return t.db.query(...args);
    },
    exec: (sql: string) => t.db.exec(sql),
  } as Db;
  setDbForTests(counted);
});
afterEach(() => {
  setDbForTests(t.db);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const rpc = (method: string, params: Record<string, unknown>, ctx: McpContext) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
async function connect(name: string, userAgent: string): Promise<{ ctx: McpContext; init: Record<string, unknown> | null }> {
  const ctx: McpContext = { userAgent };
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name, version: "1" } }, ctx);
  return { ctx: { sessionId: ctx.issuedSessionId, userAgent }, init };
}
const count = async (sql: string) => Number((await t.db.query<{ n: number }>(sql)).rows[0]?.n ?? 0);

describe("MCP checkers", () => {
  it("tells registries and liveness checkers apart from agents, people's agents and our own bots", () => {
    expect(isCheckerClient("glama", "node")).toBe(true);
    expect(isCheckerClient("mcpbeat", "mcpbeat/0.1 (+https://mcpbeat.com/bot/; liveness check)")).toBe(true);
    expect(isCheckerClient("rokmcp-probe", "rokmcp-collector/0.2 (+https://rokmcp.com/bot)")).toBe(true);
    expect(isCheckerClient("posthog-mcp-registry-probe", "python-requests/2.33.0")).toBe(true);
    expect(isCheckerClient("mcplantern-check", "mcplantern-check/0.2")).toBe(true);
    expect(isCheckerClient("claude-code", "claude-code/2.1")).toBe(false);
    expect(isCheckerClient("probe-client", "someones-agent/1.0")).toBe(false);
    expect(isCheckerClient("mcp", "python-httpx/0.28.1")).toBe(false);
    expect(isCheckerClient("visitor", "curl/8.7.1")).toBe(false);
    expect(isCheckerClient("chatgpt", "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot")).toBe(false);
    expect(isCheckerClient("botchelor-loop-crowd-rook", "botchelor-loop-crowd-rook/1.0 (house-run: Rook Okafor-Haas)")).toBe(false);
    expect(isCheckerClient("botchelor-loop-budget-check", "botchelor-loop-budget-check")).toBe(false);
  });

  it("a checker's handshake sends nothing to the database, and its rows land later with their own times", async () => {
    const { ctx, init } = await connect("mcpbeat", "mcpbeat/0.1 (+https://mcpbeat.com/bot/; liveness check)");
    for (const method of ["tools/list", "resources/list", "prompts/list", "ping"]) await rpc(method, {}, ctx);
    await rpc("notifications/initialized", {}, ctx);
    expect(queries).toBe(0);
    // The same answer an agent gets: a session id and an agent id to keep.
    const meta = (init?.result as { _meta: Record<string, unknown> })._meta;
    expect(meta["mcp-session-id"]).toBe(ctx.sessionId);
    expect(meta.agent_id).toEqual(expect.any(String));
    expect(waitingWrites()).toBe(7); // the session, its funnel event and five logged calls
    expect(await count(`select count(*)::int as n from mcp_sessions`)).toBe(0);

    // An agent's call needs the database anyway: what was waiting is written first.
    const agent = await connect("real-agent", "real-agent/1.0");
    await rpc("tools/call", { name: "list_cast", arguments: {} }, agent.ctx);
    expect(waitingWrites()).toBe(0);
    const session = (await t.db.query<{ agent_id: string; client_name: string }>(`select agent_id, client_name from mcp_sessions where id = $1`, [ctx.sessionId])).rows[0];
    expect(session).toEqual({ agent_id: meta.agent_id, client_name: "mcpbeat" });
    const calls = (await t.db.query<{ method: string; agent_id: string }>(`select method, agent_id from mcp_calls where session_id = $1 order by created_at, id`, [ctx.sessionId])).rows;
    expect(calls.map((c) => c.method)).toEqual(["initialize", "tools/list", "resources/list", "prompts/list", "ping"]);
    expect(new Set(calls.map((c) => c.agent_id))).toEqual(new Set([meta.agent_id]));
  });

  it("a checker that goes on to call a tool gets its session written first, so the call is its own", async () => {
    const { ctx, init } = await connect("rokmcp-probe", "rokmcp-collector/0.2 (+https://rokmcp.com/bot)");
    expect(queries).toBe(0);
    await rpc("tools/call", { name: "list_cast", arguments: {} }, ctx);
    const agentId = (init?.result as { _meta: Record<string, unknown> })._meta.agent_id;
    const call = (await t.db.query<{ agent_id: string }>(`select agent_id from mcp_calls where session_id = $1 and method = 'tools/call'`, [ctx.sessionId])).rows[0];
    expect(call?.agent_id).toBe(agentId);
  });

  it("an agent's handshake is unchanged: written at once", async () => {
    const { ctx } = await connect("claude-code", "claude-code/2.1");
    await rpc("tools/list", {}, ctx);
    expect(waitingWrites()).toBe(0);
    expect(await count(`select count(*)::int as n from mcp_sessions`)).toBe(1);
    expect(await count(`select count(*)::int as n from mcp_calls`)).toBe(2);
  });

  it("the monitor's hourly health check writes what's waiting", async () => {
    await connect("glama", "node");
    expect(waitingWrites()).toBeGreaterThan(0);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const res = await getHealth(new Request(`${BASE_URL}/api/health`, { headers: { authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(200);
    expect(waitingWrites()).toBe(0);
    expect(await count(`select count(*)::int as n from mcp_sessions where client_name = 'glama'`)).toBe(1);
  });
});
