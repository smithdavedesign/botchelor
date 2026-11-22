import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// MCP 2.48.1, from the 2026-11-22 audit: search_characters took limit: "lots" and query: 42 and answered as if neither
// was sent (every open character, 91 KB), and a request naming JSON-RPC "1.0" was served. A number sent as text is read
// as the number and a text argument's number as its text, both said; anything else of the wrong type is refused with its
// type and an example. A request is JSON-RPC 2.0.
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
const rpc = (msg: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage(msg as Parameters<typeof handleMcpMessage>[0], ctx);
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-arg-types-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)).result;

describe("an argument of the wrong type", () => {
  it("a number sent as a word is refused with its type and an example, and nothing is done", async () => {
    const r = await call("search_characters", { query: "a", limit: "lots" }, await connect());
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: Not valid — limit: a number from 1 to 30, not "lots" \(e\.g\. "limit": 1\)\. Nothing was done\. \(search_characters takes: /);
  });

  it("a number sent as text is read as the number, and a number for text as its text, each said", async () => {
    const r = await call("search_characters", { query: 42, limit: "2" }, await connect());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.read_arguments_as).toEqual(expect.arrayContaining(['limit: "2" → 2', 'query: 42 → "42"']));
    expect(r.structuredContent.count).toBeLessThanOrEqual(2);
  });

  it("a list or an object for text is refused, and so is true or a list for a number", async () => {
    const ctx = await connect();
    expect((await call("search_characters", { query: ["a", "b"] }, ctx)).content[0].text).toMatch(/^Error: Not valid — query: text, not a list \(e\.g\. "query": "…"\)\. Nothing was done\./);
    expect((await call("search_characters", { query: { words: "a" } }, ctx)).content[0].text).toMatch(/^Error: Not valid — query: text, not an object /);
    expect((await call("search_characters", { limit: true }, ctx)).content[0].text).toMatch(/^Error: Not valid — limit: a number from 1 to 30, not true /);
    expect((await call("search_characters", { limit: [5] }, ctx)).content[0].text).toMatch(/^Error: Not valid — limit: a number from 1 to 30, not \[5\] /);
  });

  it("a write with a wrong type writes nothing", async () => {
    const ctx = await connect();
    const r = await call("create_character", validCharacter({ name: "Typo Tess", age: "twenty-six" }), ctx);
    expect(r.content[0].text).toMatch(/^Error: Not valid — age: a number from 18 to 1000, not "twenty-six" /);
    expect((await t.db.query(`select 1 from characters where name = 'Typo Tess'`)).rows).toHaveLength(0);
  });
});

describe("JSON-RPC 2.0", () => {
  it("a request naming another version is refused as invalid, and nothing is done", async () => {
    const ctx = await connect();
    const r = await rpc({ jsonrpc: "1.0", id: 7, method: "tools/call", params: { name: "create_character", arguments: validCharacter({ name: "Old Rpc" }) } }, ctx);
    expect(r).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32600, message: 'invalid request: "jsonrpc" must be "2.0", not "1.0". Nothing was done.' } });
    expect((await t.db.query(`select 1 from characters where name = 'Old Rpc'`)).rows).toHaveLength(0);
    // A notification gets no reply, as every notification.
    expect(await rpc({ jsonrpc: "1.0", method: "notifications/initialized" }, ctx)).toBeNull();
  });

  it("a request that leaves the field out is still served", async () => {
    const r = await rpc({ id: 8, method: "tools/list", params: {} });
    expect(r.result.tools.length).toBeGreaterThan(0);
  });
});
