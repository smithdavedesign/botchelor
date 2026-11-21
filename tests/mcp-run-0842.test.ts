// The 2026-11-21-0842 visitor run (#1969): "read_texts (no wait) hung past 120 seconds", and the server log had no line for
// it. The arena's airing of a date took 63 s on a loaded Mac (the same work takes under a second on a copy of its database),
// and the sweep every call makes before its tool runs (due dates air there) wasn't counted by the slow-call log (#1870).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, logSlowCall, SLOW_CALL_MS, type McpContext } from "@/lib/mcp/dispatcher";
import { startTestDb } from "./helpers";

// The sweep before every call: airing due dates. Here it "takes" two minutes (the clock jumps while it runs).
const clock = vi.hoisted(() => ({ offset: 0, sweepMs: 0 }));
vi.mock("@/lib/air", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/air")>();
  return { ...real, airDueDates: vi.fn(async () => { clock.offset += clock.sweepMs; return []; }) };
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clock.offset = 0;
  clock.sweepMs = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + clock.offset);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const rpc = (method: string, params: Record<string, unknown>, ctx: McpContext) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);

describe("the 2026-11-21-0842 run (#1969)", () => {
  it("a call held up before its tool runs is logged as slow, and says where the time went", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx: McpContext = { userAgent: "visitor/1.0" };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "visitor" } }, ctx);
    const session = { sessionId: ctx.issuedSessionId, userAgent: "visitor/1.0" };
    clock.sweepMs = 120_000;
    await rpc("tools/call", { name: "list_cast", arguments: {} }, session);
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[mcp] slow call: list_cast"));
    expect(line).toMatch(/took 12\d\.\d s \(120\.0 s of it before the tool ran: airing due dates/);
    // A quick sweep isn't logged.
    warn.mockClear();
    clock.sweepMs = 0;
    await rpc("tools/call", { name: "list_cast", arguments: {} }, session);
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith("[mcp] slow call"))).toBe(false);
  });

  it("logSlowCall names the sweep's share only when it's a second or more", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(logSlowCall("read_texts", SLOW_CALL_MS + 100, {}, 400)).toBe(true);
    expect(warn.mock.calls[0][0]).toBe(`[mcp] slow call: read_texts took ${((SLOW_CALL_MS + 100) / 1000).toFixed(1)} s`);
    expect(logSlowCall("my_status", 40_000, { wait_seconds: 30 }, 9_000)).toBe(true);
    expect(warn.mock.calls[1][0]).toBe("[mcp] slow call: my_status took 40.0 s (asked to wait up to 30 s; 9.0 s of it before the tool ran: airing due dates, quiet two-agent dates)");
  });
});
