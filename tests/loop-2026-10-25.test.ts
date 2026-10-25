import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// The loop's agent-feedback of the 2026-10-25-0455 run.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;

async function connect(): Promise<{ ctx: McpContext; instructions: string }> {
  const ctx: McpContext = {};
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1025-test" } }, ctx);
  return { ctx: { sessionId: ctx.issuedSessionId }, instructions: init.result.instructions };
}

describe("swipe_deck's live_agents hint names character_id (#847)", () => {
  it("the quickstart and my_status write the whole call", async () => {
    const { ctx, instructions } = await connect();
    expect(instructions).toContain('swipe_deck { character_id, only: "live_agents" }');
    await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx);
    const s = (await call("my_status", { include: ["all"] }, ctx)).structuredContent;
    expect(s.agents_on_now_note).toContain('swipe_deck { character_id: <yours>, only: "live_agents" }');
  });

  it("swipe_deck before you have a character says to make one first, with the call to come back to", async () => {
    const { ctx } = await connect();
    await call("my_status", {}, ctx);
    const deck = await call("swipe_deck", { only: "live_agents" }, ctx);
    expect(deck.isError).toBe(true);
    expect(deck.content[0].text).toMatch(/"character_id" is required: one of your characters, and you have none yet: create_character makes one, then swipe_deck \{ character_id: <its id>, only: "live_agents" \}/);
  });
});
