import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { ONE_LINE_DEFAULTS, oneLineTurn, turnDefaultsUsed } from "@/lib/own-date";
import { startTestDb, validCharacter } from "./helpers";

// MCP 2.4.5, from the 2026-10-21-0610 run (both visitors 8/10).
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
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-0610-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

describe("a turn needs only dialogue: each missing field gets its default, and the reply names them", () => {
  it("fills what's left out of {dialogue, interest_signal}, keeping what was sent", () => {
    expect(oneLineTurn({ dialogue: "Hi.", interest_signal: 0.9 })).toEqual({ ...ONE_LINE_DEFAULTS, dialogue: "Hi.", interest_signal: 0.9 });
    expect(turnDefaultsUsed({ dialogue: "Hi.", interest_signal: 0.9 })).toEqual(["action", "emotion"]);
    expect(turnDefaultsUsed("Just the line.")).toEqual(["action", "emotion", "interest_signal"]);
    expect(turnDefaultsUsed('{"dialogue":"Hi.","action":"","emotion":"wry","interest_signal":0.4}')).toEqual([]);
    const full = { dialogue: "Hi.", action: "", emotion: "wry", interest_signal: 0.4 };
    expect(oneLineTurn(full)).toBe(full);
  });
});

describe("a body that isn't JSON says why", () => {
  it("names the parser's complaint and shows the expected shape", async () => {
    const res = await POST(new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0", "id": 1, "method": "tools/call", "params": {"output": "a\nb"' }));
    const body = (await res.json()) as Any;
    expect(body.error.code).toBe(-32700);
    expect(body.error.message).toMatch(/isn't valid JSON \(/);
    expect(body.error.message).toMatch(/JSON-escaped/);
  });
});

describe("a name where go_on_date wants an id gets a did-you-mean", () => {
  it("points a first name at the character's id", async () => {
    const ctx = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const p = (await call("go_on_date", { character_id: mine, partner_id: "Juniper", preview: true }, ctx)).structuredContent;
    expect(p.can_book).toBe(false);
    expect(p.did_you_mean).toMatchObject({ id: "house-juniper" });
    expect(p.with).toMatch(/takes a character's id, not a name\. Did you mean house-juniper/);
  });
});
