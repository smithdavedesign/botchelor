import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { CORE_TOOL_ORDER, ENDING_RULE, PUBLIC_MCP_TOOLS, toolListSizes } from "@/lib/mcp/dispatcher";
import { CONVERSATION_TURNS } from "@/lib/rules";
import { startTestDb } from "./helpers";

// #1361 (the 2026-11-08-0610 run: "My first-ever call returned 69KB with tools/list"; "a one-screen what-is-this line in
// initialize", with the core vs all split said up front): the quickstart opens with what this is, how a date ends and what
// each tool list weighs (the lean one too), and the first contact (initialize + the default tools/list) has a byte budget.
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
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);

describe("#1361: the first call", () => {
  it("opens with what it is, how a date ends, and the tool lists with what each weighs", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1361-test" } })).result;
    const top = (init.instructions as string).split("\n\n")[0].split("\n");
    expect(top).toHaveLength(3);
    expect(top[0]).toMatch(new RegExp(`^BOTCHELOR QUICKSTART\\. A comedic blind-date show .*dates of about ${CONVERSATION_TURNS} lines .*predicts how they end\\.$`));
    expect(top[1]).toBe(`Endings: ${ENDING_RULE}.`);
    const { core, lean } = toolListSizes();
    expect(top[2]).toBe(
      `Tools: tools/list shows the ${CORE_TOOL_ORDER.length} core tools (/api/mcp?tools=core, ${core} KB), enough for the whole show; params { lean: true } lists them in ${lean} KB. All ${PUBLIC_MCP_TOOLS.length}: POST tools/list to /api/mcp?tools=all (or params { all: true }).`,
    );
    // The sizes are the lists' own.
    const list = (await rpc("tools/list", {})).result.tools;
    const leanList = (await rpc("tools/list", { lean: true })).result.tools;
    expect(core).toBe(Math.round(JSON.stringify(list).length / 1000));
    expect(lean).toBe(Math.round(JSON.stringify(leanList).length / 1000));
    expect(lean).toBeLessThan(core / 3);
    // Plain HTTP is said with the session header; the curl example is the full guide's.
    expect(init.instructions).toMatch(/plain HTTP: POST each JSON-RPC call to \S+\/api\/mcp with it; the full guide opens with a curl call/);
    expect(init.instructions.length).toBeLessThan(4000);
    expect(init.instructions.split(/\s+/).length).toBeLessThan(600);
  });

  it("initialize plus the default tools/list stays under its budget", async () => {
    const ctx: McpContext = {};
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1361-test" } }, ctx);
    const list = await rpc("tools/list", {}, { sessionId: ctx.issuedSessionId });
    // 2026-11-08: 70.4 KB before #1361 (5.7 KB initialize, 64.7 KB list); the trims here brought initialize down. The
    // list's own cap is tests/mcp-core.test.ts's. A first contact past this needs a cut, or the lean list said louder.
    expect(JSON.stringify(init).length).toBeLessThan(5_400);
    // 2026-11-08 (#1361 closed): shorter shared docs + no category in the default list's _meta: 68.4 KB, cap 68.6 KB.
    expect(JSON.stringify(init).length + JSON.stringify(list).length).toBeLessThan(68_600);
  });
});
