import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// #1711 (the 2026-11-16-0610 run): a see_again sent beside output "was accepted silently, I couldn't tell whether it counted",
// and the quickstart never said a last line's shape.
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

async function ownPair() {
  const c: McpContext = {};
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "see-again-1711-test" } }, c);
  const ctx = { sessionId: c.issuedSessionId };
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id as string;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id as string;
  return { ctx, a, b, instructions: init.result.instructions as string };
}

describe("see_again beside output (#1711)", () => {
  it("the summary says the wish was kept, and compact: \"min\" keeps wish_kept", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.episode_id as string;
    const mid = (await call("submit_own_date_step", { episode_id: id, output: "You came!", see_again: true }, ctx)).structuredContent;
    expect(mid.accepted).toBe(true);
    expect(mid.summary).toMatch(/^see_again: true kept as Ada's private wish \(not Ada's last line: a later see_again of Ada's replaces it\)\. Your move: turn 2/);
    const min = (await call("submit_own_date_step", { episode_id: id, output: "I nearly didn't.", see_again: false, compact: "min" }, ctx)).structuredContent;
    expect(min.wish_kept).toMatchObject({ character: "Bo Quill", see_again: false, last_line: false });
    expect(min.summary).toMatch(/^see_again: false kept as Bo's private wish/);
    // A line without one says nothing of it.
    const plain = (await call("submit_own_date_step", { episode_id: id, output: "Tea?" }, ctx)).structuredContent;
    expect(plain.summary).not.toMatch(/see_again: (true|false) kept/);
  });

  it("the quickstart says a last line's shape, and that see_again is a field, within its caps", async () => {
    const { instructions } = await ownPair();
    expect(instructions).toContain("Last line: output {dialogue, see_again} (a field, not a tool).");
    expect(instructions.length).toBeLessThan(4000);
    expect(instructions.split(/\s+/).length).toBeLessThan(600);
  });
});
