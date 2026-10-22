import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { markResourceUpdated, resetSubscriptionsForTests, SUBSCRIBABLE } from "@/lib/mcp-subscriptions";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });
afterEach(() => resetSubscriptionsForTests());

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage(
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "subs-test" } } },
    ctx,
  );
  return { sessionId: ctx.issuedSessionId };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("resources/subscribe", () => {
  it("accepts a subscribable URI and returns an empty result with a push-availability note", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "resources/subscribe", params: { uri: SUBSCRIBABLE[0] } },
      ctx,
    ))!.result as Any;
    expect(res._meta["botchelor/pushed"]).toBe(true);
    expect(res._meta["botchelor/pushed_note"]).toMatch(/SSE stream/);
  });

  it("refuses an unknown URI with a list of what's subscribable", async () => {
    const ctx = await connect();
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "resources/subscribe", params: { uri: "botchelor://nothing-like-this" } },
      ctx,
    ))!;
    expect(res.error).toBeDefined();
    expect((res.error as Any).message).toMatch(/Subscribable:/);
  });

  it("refuses when there's no session", async () => {
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "resources/subscribe", params: { uri: SUBSCRIBABLE[0] } },
      {},
    ))!;
    expect(res.error).toBeDefined();
    expect((res.error as Any).message).toMatch(/initialized session/);
  });

  it("pending updates ride along on the next tool reply", async () => {
    const ctx = await connect();
    await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "resources/subscribe", params: { uri: SUBSCRIBABLE[0] } }, ctx);
    markResourceUpdated(SUBSCRIBABLE[0]);
    const call = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "my_status", arguments: {} } },
      ctx,
    ))!.result as Any;
    expect(call._meta["botchelor/pending_updates"]).toEqual([SUBSCRIBABLE[0]]);
    // Drained: next call has no pending.
    const call2 = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "my_status", arguments: {} } },
      ctx,
    ))!.result as Any;
    expect((call2._meta ?? {})["botchelor/pending_updates"]).toBeUndefined();
  });

  it("unsubscribe stops future pending-updates from riding along", async () => {
    const ctx = await connect();
    await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "resources/subscribe", params: { uri: SUBSCRIBABLE[0] } }, ctx);
    await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "resources/unsubscribe", params: { uri: SUBSCRIBABLE[0] } }, ctx);
    markResourceUpdated(SUBSCRIBABLE[0]);
    const call = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "my_status", arguments: {} } },
      ctx,
    ))!.result as Any;
    expect((call._meta ?? {})["botchelor/pending_updates"]).toBeUndefined();
  });
});

describe("client capabilities on initialize", () => {
  it("records what the client offered on ctx and echoes it in _meta", async () => {
    const ctx: McpContext = {};
    const res = (await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          clientInfo: { name: "caps-test" },
          capabilities: { sampling: {}, elicitation: {}, roots: { listChanged: true } },
        },
      },
      ctx,
    ))!.result as Any;
    expect(ctx.clientCapabilities).toMatchObject({ sampling: {}, elicitation: {}, roots: { listChanged: true } });
    expect(res._meta["botchelor/client_capabilities"]).toEqual({ sampling: true, elicitation: true, roots: true });
    expect(res._meta["botchelor/subscribable_resources"]).toEqual([...SUBSCRIBABLE]);
  });

  it("a client that offers nothing shows all false", async () => {
    const ctx: McpContext = {};
    const res = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "nocaps" } } },
      ctx,
    ))!.result as Any;
    expect(res._meta["botchelor/client_capabilities"]).toEqual({ sampling: false, elicitation: false, roots: false });
  });
});
