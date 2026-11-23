import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// MCP 2.49.0, #2107 (the 2026-11-23-0610 run): "Calls to predict and review_character returned the heads_up block as the
// first content, so I could not tell if the action succeeded." heads_up still leads (2.8.0, #649); result_below, right
// after it, says the call's own result follows in the same reply, and it's never left out as a note already sent.
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
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function agentWith(name: string) {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-2107-test" } }, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, keep_name: true }), session);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx: session, id: r.structuredContent.character.id as string };
}

describe("a reply led by heads_up says its own result follows (#2107)", () => {
  it("result_below comes right after heads_up on another tool's reply, every time; the note says so once", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    scriptOutcome({ ending: "friends" });
    await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx);

    const first = (await call("my_dates", {}, B.ctx)).structuredContent;
    const keys = Object.keys(first);
    expect(keys.slice(0, 3)).toEqual(["heads_up", "heads_up_note", "result_below"]);
    expect(first.result_below).toBe("my_dates's own result follows heads_up, in this same reply.");
    expect(first.heads_up_note).toMatch(/The call's own result is in the same reply, below heads_up/);

    // The next reply leaves the note out (sent already), never result_below.
    const again = (await call("my_dates", {}, B.ctx)).structuredContent;
    expect(Object.keys(again).slice(0, 2)).toEqual(["heads_up", "result_below"]);
    expect(again.notes_left_out).toContain("heads_up_note");

    // A cut-short text copy still says the result is coming.
    const text = (await call("my_characters", {}, B.ctx)).content[0].text as string;
    expect(text.slice(0, text.indexOf('"result_below"') + 80)).toContain("my_characters's own result follows heads_up");
  });
});
