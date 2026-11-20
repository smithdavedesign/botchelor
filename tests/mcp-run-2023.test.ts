import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { latelyFrom } from "@/lib/endings-lately";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { NO_IDENTITY_ERROR_NOTE } from "@/lib/mcp/dispatcher";
import { startTestDb } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// The 2026-11-19-2023 visitor run: #1865 (a header-less error read as a stray identity), #1866 (no base rate in the context).
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
const call = async (name: string, args: Any, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

describe("the 2026-11-19-2023 run", () => {
  it("an error on a call with no session and no agent_id says it ran as nobody (#1865)", async () => {
    const bare = await call("swipe", {});
    expect(bare.isError).toBe(true);
    expect(bare.structuredContent.identity_note).toBe(NO_IDENTITY_ERROR_NOTE);
    // With a session, no such note.
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "t" } } }, ctx);
    const withSession = await call("swipe", {}, { sessionId: ctx.issuedSessionId });
    expect(withSession.isError).toBe(true);
    expect(withSession.structuredContent.identity_note).toBeUndefined();
    // Nothing was recorded for a nobody call.
    const rows = (await t.db.query<{ n: number }>(`select count(*)::int as n from mcp_sessions where id like 'agent:%'`)).rows[0].n;
    expect(rows).toBe(0);
  });

  it("browse_episodes' context note carries the base rate (#1866)", async () => {
    const r = (await call("browse_episodes", { open: true })).structuredContent;
    // With nothing aired, the line says there's no mix yet; either way the base rate is said where the context is read.
    if (r.context_note) expect(r.context_note).toContain("Base rate, lately:");
    expect(latelyFrom({ second_date: 9, friends: 6, disaster: 5 }).says).toContain("45% second date");
  });
});
