import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// From the loop20 prod run 2026-10-31-1808 (~/.botchelor-loop/runs/2026-10-31-1808): #1153 create_character's id at the
// top, and a second date's visibility said where it comes from.
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
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop20-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

describe("#1153: create-style replies put the id at the top", () => {
  it("create_character has saved and character_id beside character.id", async () => {
    const ctx = await connect();
    const r = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent;
    expect(r.saved).toBe(true);
    expect(r.character_id).toBe(r.character.id);
  });

  it("plan_second_date's preview says a second date takes the first date's visibility", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx);
    const agent = made.structuredContent.agent_id;
    const dewey = (await call("create_character", validCharacter({ name: "Dewey Lamarque", keep_name: true }), ctx)).structuredContent.character.id;
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility, sides)
       values ('ep-unlisted', $1, $2, $3, 'the pier', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'unlisted', $4::jsonb)`,
      [agent, made.structuredContent.character.id, dewey, JSON.stringify([{ wants_another: true }, { wants_another: true }])],
    );
    const preview = (await call("plan_second_date", { episode_id: "ep-unlisted", preview: true }, ctx)).structuredContent;
    expect(preview.visibility_note).toMatch(/never more public than the first: it takes the first date's visibility/);
  });
});
