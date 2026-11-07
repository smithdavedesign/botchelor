import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { startTestDb, validCharacter } from "./helpers";

// From the 2026-11-02-0704 run: a place that wasn't used as written says so (#1256), my_role says which number is which,
// and replies an agent can keep small (#1255).
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
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function agent(name: string, extra: Record<string, unknown> = {}) {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "issues-1256-test" } }, ctx);
  const c = { sessionId: ctx.issuedSessionId };
  const made = await call("create_character", validCharacter({ name, keep_name: true, ...extra }), c);
  if (made.isError) throw new Error(made.content[0].text);
  return { ctx: c, agentId: made.structuredContent.agent_id as string, id: made.structuredContent.character.id as string };
}

describe("#1256: a place passed says what became of it", () => {
  it("kept in its words, or matched to a venue the show has", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill", { open_to_dates: true });
    const kept = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date", place: "a tide-gauge hut at low water" }, A.ctx)).structuredContent;
    expect(kept).toMatchObject({ place_used: "kept", place_note: expect.stringMatching(/^Your place "a tide-gauge hut at low water" is kept/) });
    const C = await agent("Cy Marsh", { open_to_dates: true });
    const mapped = (await call("start_own_date", { character_id: A.id, partner_id: C.id, format: "speed_date", place: "a Roman aqueduct museum after closing" }, A.ctx)).structuredContent;
    expect(mapped).toMatchObject({ place_used: "mapped", place_note: expect.stringMatching(/is dealt as .+: the closest set the show has/) });
  });

  it("on a date the other agent started, the invited side's place is ignored, and the reply says so", async () => {
    const A = await agent("Ada Lumen", { open_to_dates: true });
    const B = await agent("Bo Quill", { open_to_dates: true });
    const started = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date", place: "a tide-gauge hut at low water" }, A.ctx)).structuredContent;
    expect(started.episode_id).toBeTruthy();
    // The invited side's start is refused (it's their date: get_own_date_step plays it), and says the place isn't used.
    const joined = (await call("start_own_date", { character_id: B.id, partner_id: A.id, format: "speed_date", place: "a typewriter repair shop" }, B.ctx)).structuredContent;
    expect(joined).toMatchObject({ code: "conflict", episode_id: started.episode_id, place_used: "ignored" });
    expect(joined.error).toMatch(/Your place "a typewriter repair shop" isn't used: Ada's agent started this date and set the place \(.*tide-gauge hut.*\)/i);
  });

  it("my_role says 0 is the first role", () => {
    const p = (MCP_TOOLS.find((x) => x.name === "start_own_date")!.inputSchema as Any).properties.my_role;
    expect(p.description).toMatch(/0 is the first role \(roles\[0\]\), 1 the second/);
  });
});

describe('#1255: compact: "min" keeps a turn reply small', () => {
  const line = { dialogue: "So what's the strangest map you've ever drawn, honestly?", action: "", emotion: "curious", interest_signal: 0.6 };
  const size = (x: unknown) => JSON.stringify(x).length;

  it("submit, get and wait each stay under 1.5 KB, with their line, whose move and the next call", async () => {
    const A = await agent("Ada Lumen", { open_to_dates: true });
    const B = await agent("Bo Quill", { open_to_dates: true });
    const ep: string = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.episode_id;

    const sent = (await call("submit_own_date_step", { episode_id: ep, output: line, compact: "min" }, A.ctx)).structuredContent;
    expect(sent).toMatchObject({ accepted: true, episode_id: ep, your_move: false, whose_move: "Bo Quill" });
    expect(sent.step).toBeUndefined();
    expect(sent.transcript).toBeUndefined();
    expect(size(sent)).toBeLessThan(1500);

    const mine = (await call("get_own_date_step", { episode_id: ep, compact: "min" }, B.ctx)).structuredContent;
    expect(mine).toMatchObject({ stage: "turn", your_move: true, whose_move: "Bo Quill", their_line: { who: "Ada Lumen", said: line.dialogue }, turn_number: expect.any(Number), of: expect.any(Number) });
    expect(mine.next_calls[0].tool).toBe("submit_own_date_step");
    expect(mine.step).toBeUndefined();
    expect(Object.keys(mine).filter((k) => k.endsWith("_note"))).toEqual([]);
    expect(size(mine)).toBeLessThan(1500);
    // The same call without it is several times the size.
    expect(size((await call("get_own_date_step", { episode_id: ep, compact: true }, B.ctx)).structuredContent)).toBeGreaterThan(3 * size(mine));

    await call("submit_own_date_step", { episode_id: ep, output: { ...line, dialogue: "A map of every bench that faces the sea." }, compact: "min" }, B.ctx);
    const waited = (await call("wait_for_my_turn", { episode_id: ep, compact: "min", wait_seconds: 0 }, A.ctx)).structuredContent;
    expect(waited).toMatchObject({ your_move: true, whose_move: "Ada Lumen", their_line: { who: "Bo Quill", said: "A map of every bench that faces the sea." } });
    expect(size(waited)).toBeLessThan(1500);
  });

  it('is listed among compact\'s values', () => {
    const p = (MCP_TOOLS.find((x) => x.name === "submit_own_date_step")!.inputSchema as Any).properties.compact;
    expect(p.enum).toContain("min");
    expect(p.description).toMatch(/"min"/);
  });
});
