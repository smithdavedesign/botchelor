// The admin analytics page's data (lib/agent-analytics.ts): every MCP call logged, each connection classified.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminAnalytics } from "@/app/api/admin/analytics/route";
import { agentAnalytics, isOurs, pruneMcpCalls, pruneMcpSessions, WRITE_TOOLS } from "@/lib/agent-analytics";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { BASE_URL, startTestDb, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = (method: string, params: Record<string, unknown>, ctx: McpContext) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
async function connect(name: string, userAgent = `${name}/1.0`): Promise<McpContext> {
  const ctx: McpContext = { userAgent };
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name } }, ctx);
  return { sessionId: ctx.issuedSessionId, userAgent };
}
const tool = (name: string, args: Record<string, unknown>, ctx: McpContext) => rpc("tools/call", { name, arguments: args }, ctx);

describe("agent analytics", () => {
  it("logs every call (never its arguments) and sorts connections into crawlers, explorers and players", async () => {
    const crawler = await connect("glama", "node");
    await rpc("tools/list", {}, crawler);
    const explorer = await connect("curious-bot");
    await rpc("tools/list", {}, explorer);
    await tool("list_cast", {}, explorer);
    await tool("get_episode", { episode_id: "nope" }, explorer); // fails
    const player = await connect("real-agent");
    await tool("create_character", validCharacter({ name: "Odile Ferrant" }), player);
    const ours = await connect("live-board-check", "botchelor-live-check/1.0 (Claude)");
    await tool("my_status", {}, ours);

    const logged = (await t.db.query<Any>(`select method, tool, ok from mcp_calls order by id`)).rows;
    expect(logged.filter((r: Any) => r.method === "initialize")).toHaveLength(4);
    expect(logged.find((r: Any) => r.tool === "get_episode")).toMatchObject({ ok: false });
    expect(JSON.stringify(await t.db.query(`select * from mcp_calls`))).not.toContain("Odile"); // arguments aren't kept

    const a = await agentAnalytics(t.db, 7);
    expect(a.totals).toMatchObject({ connections: 3, crawlers: 1, explorers: 1, players: 1, ours: 1 });
    expect(a.funnel).toMatchObject({ connected: 3, listed_tools: 3, called_a_tool: 2, made_a_character: 1, went_on_a_date: 0, sent_feedback: 0 });
    expect(a.clients.find((c) => c.client === "real-agent")).toMatchObject({ player: 1, characters: 1 });
    expect(a.tools.map((x) => x.tool)).toEqual(expect.arrayContaining(["list_cast", "get_episode", "create_character"]));
    expect(a.tools.map((x) => x.tool)).not.toContain("my_status"); // ours stays out
    expect(a.tools.find((x) => x.tool === "get_episode")).toMatchObject({ errors: 1 });
    expect(a.recent[0].kind).not.toBe("crawler"); // the interesting ones first
  });

  it("knows our own checks and the write tools", () => {
    expect(isOurs("botchelor-e2e-live", null)).toBe(true);
    expect(isOurs("anything", "botchelor-live-check/1.0 (Claude)")).toBe(true);
    expect(isOurs("glama", "node")).toBe(false);
    expect(WRITE_TOOLS.has("create_character")).toBe(true);
    expect(WRITE_TOOLS.has("list_cast")).toBe(false);
  });

  it("is owner-only, offers up to a year, and calls older than 13 months are pruned", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", ["an", "pass"].join("-"));
    expect((await adminAnalytics(new Request(`${BASE_URL}/api/admin/analytics`))).status).toBe(403);
    const ok = await adminAnalytics(new Request(`${BASE_URL}/api/admin/analytics?days=30`, { headers: { "x-frontier-key": "an-pass" } }));
    expect((await ok.json()).window_days).toBe(30);
    const year = await adminAnalytics(new Request(`${BASE_URL}/api/admin/analytics?days=9999`, { headers: { "x-frontier-key": "an-pass" } }));
    expect((await year.json()).window_days).toBe(365);
    await t.db.query(
      `insert into mcp_calls (method, ok, created_at) values ('tools/list', true, now() - interval '500 days'), ('tools/list', true, now() - interval '200 days'), ('tools/list', true, now())`,
    );
    await pruneMcpCalls(t.db);
    // The 500-day-old call goes; the 200-day-old one stays for the year view.
    expect((await t.db.query<Any>(`select count(*)::int as n from mcp_calls`)).rows[0].n).toBe(2);
  });

  it("sessions go with the calls, but an agent that did something keeps its latest, so it's still known for an agent", async () => {
    const session = (id: string, agent: string, calls: number, daysAgo: number) =>
      t.db.query(
        `insert into mcp_sessions (id, agent_id, client_name, calls, created_at, last_seen)
         values ($1, $2, 'glama', $3, now() - make_interval(days => $4), now() - make_interval(days => $4))`,
        [id, agent, calls, daysAgo],
      );
    // A directory's probe a year and more ago (no tool called, nothing owned), and one last week.
    await session("probe-old", "agent-probe-old", 0, 500);
    await session("probe-new", "agent-probe-new", 0, 7);
    // An agent that played long ago: its older session goes, its latest stays however old.
    await session("player-1", "agent-player", 4, 520);
    await session("player-2", "agent-player", 2, 450);
    // An agent that never called a tool but owns a character (made on the site and claimed): its latest stays too.
    await session("owner-1", "agent-owner", 0, 480);
    await t.db.query(
      `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ('owned-1', 'agent-owner', 'Sam', 30, 'Me.', '[]'::jsonb, 'x', 'y')`,
    );
    // Within the calls' 400 days, nothing goes, whatever it did.
    await session("recent-1", "agent-recent", 0, 300);
    await session("recent-2", "agent-recent", 0, 200);
    await pruneMcpSessions(t.db);
    const left = (await t.db.query<{ id: string }>(`select id from mcp_sessions order by id`)).rows.map((r) => r.id);
    expect(left).toEqual(["owner-1", "player-2", "probe-new", "recent-1", "recent-2"]);
  });
});
