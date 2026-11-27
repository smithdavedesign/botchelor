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
    // 2026-11-13 (MCP 2.28.0, the visitor runs' #1528/#1530/#1532/#1535): browse_episodes' status, create_character's compact
    // and the batch's see_again rule, after trimming browse_episodes, start_own_date and submit_own_date_step: ~170 bytes over,
    // so the cap moved to 68.8 KB.
    // 2026-11-13 (MCP 2.29.0, #1540): outputs[] items' shape and didnt's tags in the schema, after trimming start_own_date and
    // reflect_on_date (the core list stays under its 63 KB cap): the cap moved to 69.1 KB.
    // 2026-11-15 (MCP 2.31.0, the house tools): all four sit outside the core list, so the list's tools didn't grow; their
    // four names in more_tools.not_listed are 71 bytes, 30 over, so the cap moved to 69.2 KB.
    // 2026-11-16 (MCP 2.32.0, the free OC tools): the same again, four names outside the core list (5 bytes over): 69.3 KB.
    // 2026-11-16 (MCP 2.33.0, show ideas): three more names outside the core list, about 52 bytes: 69.4 KB.
    // 2026-11-17 (MCP 2.36.0, tags): search_characters filters by type and love life, the sheet takes tags and
    // get_character says it returns both, about 440 bytes inside the core list: 69.9 KB.
    // 2026-11-17 (MCP 2.37.0, art_style): create_character and update_character take how a character is drawn, about
    // 150 bytes inside the core list: 70.1 KB.
    // 2026-11-18 (MCP 2.38.0, more art styles, world and backstory): five more art_style values and two more extras,
    // about 115 bytes inside the core list: 70.3 KB.
    // 2026-11-20 (MCP 2.39.0, #1778): get_episode's transcript_only, about 90 bytes inside the core list: 70.4 KB.
    // 2026-11-20 (MCP 2.40.0, #1845): the core list's descriptions trimmed, its notes moved to every other list and the
    // cheatsheet (tests/mcp-core.test.ts): 54.4 KB, so the cap came down to 55.4 KB.
    // 2026-11-26 (MCP 2.52.0): heartbeat joined the core list (OpenClaw sees only listed tools): 55.6 KB, so 55.8 KB.
    // 2026-11-26 (MCP 2.56.0, character_life): one name outside the core list in more_tools.not_listed, 9 bytes over: 55.9 KB.
    // 2026-11-27 (MCP 2.62.0, Agent World): eight names outside the core list in more_tools.not_listed: 56.1 KB.
    expect(JSON.stringify(init).length + JSON.stringify(list).length).toBeLessThan(56_100);
  });
});
