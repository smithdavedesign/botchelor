import { afterEach, describe, expect, it } from "vitest";
import { GET as mcpGet } from "@/app/api/mcp/route";
import { BASE_URL } from "./helpers";
import { attachStream, queueFor, resetStreamsForTests, sseFrame } from "@/lib/mcp-stream";
import { markResourceUpdated, resetSubscriptionsForTests, subscribe } from "@/lib/mcp-subscriptions";

// Server-sent-events transport for the MCP server. One stream per session; server-initiated messages (resources
// updated, progress, sampling, elicitation) ride on it.

afterEach(() => {
  resetStreamsForTests();
  resetSubscriptionsForTests();
});

describe("SSE queue", () => {
  it("sseFrame formats a JSON-RPC notification as an event-stream event", () => {
    const frame = sseFrame({ jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "botchelor://feed/airing" } }, 3);
    expect(frame).toMatch(/^id: 3\ndata: /);
    expect(frame).toMatch(/\n\n$/);
    expect(frame).toContain('"method":"notifications/resources/updated"');
  });

  it("queues messages when no stream is open, then delivers them on attach", () => {
    const seen: string[] = [];
    queueFor("sid-1", { jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "a" } });
    queueFor("sid-1", { jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "b" } });
    const detach = attachStream("sid-1", (m) => seen.push(JSON.stringify(m.params)));
    expect(seen).toEqual([JSON.stringify({ uri: "a" }), JSON.stringify({ uri: "b" })]);
    detach();
  });

  it("markResourceUpdated pushes to the open stream for subscribed sessions", () => {
    subscribe("sid-2", "botchelor://feed/airing");
    const seen: unknown[] = [];
    const detach = attachStream("sid-2", (m) => seen.push(m));
    const hits = markResourceUpdated("botchelor://feed/airing");
    expect(hits).toBe(1);
    expect(seen).toHaveLength(1);
    expect((seen[0] as { params?: { uri?: string } }).params?.uri).toBe("botchelor://feed/airing");
    detach();
  });
});

describe("GET /api/mcp SSE", () => {
  it("without a session, returns 400 with a hint", async () => {
    const res = await mcpGet(new Request(`${BASE_URL}/api/mcp`, { headers: { accept: "text/event-stream" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("need_session");
  });

  it("with a session, returns an SSE response with the right headers", async () => {
    const res = await mcpGet(
      new Request(`${BASE_URL}/api/mcp`, { headers: { accept: "text/event-stream", "mcp-session-id": "sid-get" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    // Cancel the stream so vitest doesn't hang.
    await res.body?.cancel();
  });
});
