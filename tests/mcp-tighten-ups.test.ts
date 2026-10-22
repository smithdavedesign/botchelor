import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MCP_TOOLS, handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { startTestDb } from "./helpers";

// MCP tighten-ups PR: _meta on tool defs, listChanged, logging/setLevel, progressToken, server _meta on initialize.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage(
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "tighten-ups-test" } } },
    ctx,
  );
  return { sessionId: ctx.issuedSessionId };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("tool _meta (non-breaking hints)", () => {
  it("every tool carries _meta with its cost, category, and (when free-path) rate_limit", () => {
    for (const t of MCP_TOOLS) {
      expect(t._meta).toBeDefined();
      const meta = t._meta as Record<string, unknown>;
      expect(meta["botchelor/cost"]).toBeTypeOf("string");
      expect(meta["botchelor/category"]).toBeTypeOf("string");
    }
    const create = MCP_TOOLS.find((x) => x.name === "create_character")!;
    const rl = (create._meta as Record<string, unknown>)["botchelor/rate_limit"] as { bucket: string; window_seconds: number; max: number };
    expect(rl).toEqual({ bucket: "create_character", window_seconds: 300, max: 10 });
    // A tool with no free-path bucket: no rate_limit meta.
    const myStatus = MCP_TOOLS.find((x) => x.name === "my_status")!;
    expect((myStatus._meta as Record<string, unknown>)["botchelor/rate_limit"]).toBeUndefined();
  });

  it("the core list carries _meta too (clients that read the short list still see hints)", () => {
    for (const t of CORE_MCP_TOOLS) expect(t._meta).toBeDefined();
  });
});

describe("initialize capabilities and _meta", () => {
  it("declares listChanged: true for tools and resources, and a logging capability", async () => {
    const ctx: McpContext = {};
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "cap-test" } } },
      ctx,
    ))!.result as Any;
    expect(res.capabilities.tools.listChanged).toBe(true);
    expect(res.capabilities.resources.listChanged).toBe(true);
    // subscribe: true now that resources/subscribe is implemented (lib/mcp-subscriptions.ts).
    expect(res.capabilities.resources.subscribe).toBe(true);
    expect(res.capabilities.logging).toEqual({});
    expect(res._meta["botchelor/transport"]).toBe("streamable-http-post");
    expect(res._meta["botchelor/notifications_pushed"]).toBe(false);
    expect(res._meta["botchelor/tools_core_count"]).toBeGreaterThan(0);
    expect(res._meta["botchelor/tools_total_count"]).toBeGreaterThanOrEqual(res._meta["botchelor/tools_core_count"]);
  });
});

describe("logging/setLevel", () => {
  it("accepts the request and records the level in the context", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "logging/setLevel", params: { level: "debug" } },
      ctx,
    ))!.result as Any;
    expect(res).toEqual({});
    expect(ctx.logLevel).toBe("debug");
  });

  it("defaults missing level to 'info'", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "logging/setLevel", params: {} },
      ctx,
    ))!.result as Any;
    expect(res).toEqual({});
    expect(ctx.logLevel).toBe("info");
  });
});

describe("progressToken echo", () => {
  it("echoes the client's progressToken on the result's _meta with a note that it isn't pushed", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "my_status", arguments: {}, _meta: { progressToken: "abc-123" } },
      },
      ctx,
    ))!.result as Any;
    expect(res._meta.progressToken).toBe("abc-123");
    expect(res._meta["botchelor/progress_pushed"]).toBe(false);
    expect(res._meta["botchelor/progress_note"]).toMatch(/one JSON response/);
  });

  it("a numeric progressToken is echoed verbatim", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "my_status", arguments: {}, _meta: { progressToken: 42 } },
      },
      ctx,
    ))!.result as Any;
    expect(res._meta.progressToken).toBe(42);
  });

  it("absent progressToken: no progress fields on the response", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "my_status", arguments: {} } },
      ctx,
    ))!.result as Any;
    const meta = (res._meta ?? {}) as Record<string, unknown>;
    expect(meta.progressToken).toBeUndefined();
    expect(meta["botchelor/progress_pushed"]).toBeUndefined();
  });
});
