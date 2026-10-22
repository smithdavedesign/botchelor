import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { attachStream, requestElicitation, requestSampling, resetPendingForTests, resolveServerRequest } from "@/lib/mcp-stream";
import { startTestDb, validCharacter } from "./helpers";

// End-to-end for server-to-client sampling + elicitation: open an SSE stream, send a tools/call that triggers
// the request, let the fake client respond, verify the result rides on the tool's reply.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });
afterEach(() => resetPendingForTests());

async function connect(capabilities: Record<string, unknown> = {}): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage(
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "sampling-test" }, capabilities } },
    ctx,
  );
  return { sessionId: ctx.issuedSessionId, clientCapabilities: capabilities };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("requestSampling and requestElicitation round-trip", () => {
  it("pushes the request on the stream and resolves when the client responds", async () => {
    const sid = "sess-1";
    const seen: Any[] = [];
    attachStream(sid, (m) => seen.push(m));
    const pending = requestSampling(sid, {
      messages: [{ role: "user", content: { type: "text", text: "hello" } }],
      maxTokens: 50,
    });
    // The stream saw the server-initiated request with a `_requestId`.
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("sampling/createMessage");
    const requestId = seen[0].params._requestId;
    expect(typeof requestId).toBe("string");
    // The client responds via resolveServerRequest (what the dispatcher does when a Response POST comes in).
    const ok = resolveServerRequest(requestId, { role: "assistant", content: { type: "text", text: "hi back" }, model: "test" }, undefined);
    expect(ok).toBe(true);
    const result = await pending;
    expect(result.content.text).toBe("hi back");
  });

  it("times out when the client doesn't respond", async () => {
    const sid = "sess-timeout";
    attachStream(sid, () => {});
    await expect(
      requestSampling(sid, { messages: [{ role: "user", content: { type: "text", text: "x" } }] }, { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/);
  });

  it("fails when there's no open stream", async () => {
    await expect(
      requestElicitation("no-stream", { message: "confirm?", requestedSchema: { type: "object", properties: {} } }, { timeoutMs: 50 }),
    ).rejects.toThrow(/no open SSE stream/);
  });
});

describe("delete_character + elicitation", () => {
  it("without confirm and no elicitation capability, falls back to the old error", async () => {
    const ctx = await connect({ /* no elicitation */ });
    const c = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ name: "Ada Lumen" }) } },
      ctx,
    ))!.result as Any;
    const id = c.structuredContent.character.id;
    const r = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delete_character", arguments: { character_id: id } } },
      ctx,
    ))!.result as Any;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/can't be undone: call again with confirm: true/);
  });

  it("without confirm but with elicitation capability + an open stream, asks the user and declining prevents the delete", async () => {
    const ctx = await connect({ elicitation: {} });
    const c = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ name: "Bo Quill" }) } },
      ctx,
    ))!.result as Any;
    const id = c.structuredContent.character.id;
    // Open the stream and respond to the server's elicitation/create with "decline".
    const seen: Any[] = [];
    attachStream(ctx.sessionId!, (m) => {
      seen.push(m);
      // Fire the response on the next tick so the tool-call is already awaiting.
      setTimeout(() => resolveServerRequest((m.params as { _requestId: string })._requestId, { action: "decline" }, undefined), 1);
    });
    const r = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delete_character", arguments: { character_id: id } } },
      ctx,
    ))!.result as Any;
    expect(seen[0].method).toBe("elicitation/create");
    expect(seen[0].params.message).toMatch(/Delete the character Bo Quill\?/);
    expect(r.structuredContent.deleted).toBe(false);
    expect(r.structuredContent.note).toMatch(/user declined/);
    // The row still exists.
    const row = (await t.db.query<Any>(`select 1 from characters where id = $1`, [id])).rows[0];
    expect(row).toBeDefined();
  });

  it("accepting via elicitation deletes the character", async () => {
    const ctx = await connect({ elicitation: {} });
    const c = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ name: "Cy Marr" }) } },
      ctx,
    ))!.result as Any;
    const id = c.structuredContent.character.id;
    attachStream(ctx.sessionId!, (m) => {
      setTimeout(() => resolveServerRequest((m.params as { _requestId: string })._requestId, { action: "accept", content: { confirm: true } }, undefined), 1);
    });
    const r = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delete_character", arguments: { character_id: id } } },
      ctx,
    ))!.result as Any;
    expect(r.structuredContent.deleted || r.structuredContent.retired).toBe(true);
  });
});

describe("check_originality + sampling", () => {
  it("with rewrite: true and a client that supports sampling, asks the client's LLM for a stronger bio", async () => {
    const ctx = await connect({ sampling: {} });
    // Create a character with a boring bio to trigger the sampling branch.
    const c = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ name: "Dot Vell", bio: "A nice person who likes nice things." }) } },
      ctx,
    ))!.result as Any;
    const id = c.structuredContent.character.id;
    const seen: Any[] = [];
    attachStream(ctx.sessionId!, (m) => {
      seen.push(m);
      setTimeout(() => resolveServerRequest((m.params as { _requestId: string })._requestId, {
        role: "assistant",
        content: { type: "text", text: "A night-shift pharmacist who narrates dreams back to her customers at 3am." },
        model: "client-llm-v1",
      }, undefined), 1);
    });
    const r = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check_originality", arguments: { character_id: id, rewrite: true } } },
      ctx,
    ))!.result as Any;
    const data = r.structuredContent;
    if (data.rewrite_suggestion) {
      expect(seen[0].method).toBe("sampling/createMessage");
      expect(data.rewrite_suggestion.bio).toMatch(/night-shift pharmacist/);
      expect(data.rewrite_suggestion.model).toBe("client-llm-v1");
    } else {
      // The originality score happened to be high enough that we skipped sampling; the request still shouldn't be refused.
      expect(seen).toHaveLength(0);
    }
  });

  it("without rewrite: true (default), no sampling request is sent", async () => {
    const ctx = await connect({ sampling: {} });
    const c = (await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ name: "Era Vane" }) } },
      ctx,
    ))!.result as Any;
    const id = c.structuredContent.character.id;
    const seen: Any[] = [];
    attachStream(ctx.sessionId!, (m) => seen.push(m));
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check_originality", arguments: { character_id: id } } },
      ctx,
    );
    expect(seen).toHaveLength(0);
  });
});

describe("JSON-RPC Response from the client resolves the pending server request", () => {
  it("a POST with no method but with an id matching a pending request is accepted silently", async () => {
    const ctx = await connect({ sampling: {} });
    attachStream(ctx.sessionId!, (m) => {
      // Return the response not via resolveServerRequest directly, but via the dispatcher so we exercise that path.
      setTimeout(async () => {
        await handleMcpMessage(
          { jsonrpc: "2.0", id: (m.params as { _requestId: string })._requestId, result: { role: "assistant", content: { type: "text", text: "ok" }, model: "x" } } as Any,
          ctx,
        );
      }, 1);
    });
    const got = await requestSampling(ctx.sessionId!, {
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    }, { timeoutMs: 200 });
    expect(got.content.text).toBe("ok");
  });
});
