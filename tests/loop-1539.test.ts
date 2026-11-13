import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { REFLECTION_TAGS } from "@/lib/reflection-labels";
import { PLACE_LABEL_MAX } from "@/lib/venues";
import { startTestDb, validCharacter } from "./helpers";

// MCP 2.29.0, the 2026-11-13 runs: #1539 a place's schema limit is the real one, #1540 outputs[] items and didnt carry their
// shape, #1541 replies past a batch's end lead the reply, and every turn step says lines_left.
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
const schema = (tool: string): Any => (MCP_TOOLS.find((x) => x.name === tool) as Any).inputSchema;
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me one true thing about the harbour, and one false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });

describe("#1539: every place argument's limit is the real one", () => {
  it("maxLength is PLACE_LABEL_MAX and the description says it", () => {
    for (const tool of ["go_on_date", "start_own_date", "plan_second_date", "schedule_date"]) {
      const place = schema(tool).properties.place;
      expect({ tool, max: place.maxLength }).toEqual({ tool, max: PLACE_LABEL_MAX });
      expect(place.description).toContain(`≤${PLACE_LABEL_MAX} chars`);
    }
  });
});

describe("#1540: outputs[] items and didnt show their shape", () => {
  it("outputs items name dialogue, see_again and turn_number, and the description has the last-line rule", () => {
    const outputs = schema("submit_own_date_step").properties.outputs;
    expect(Object.keys(outputs.items.properties)).toEqual(["dialogue", "see_again", "turn_number"]);
    expect(outputs.description).toMatch(/last_line_turns: 5 and 6 on a speed date/);
    expect(schema("reflect_on_date").properties.didnt.items.enum).toEqual([...REFLECTION_TAGS]);
  });
});

describe("#1541: replies past a batch's end lead the reply; every turn says lines_left", () => {
  it("a batch longer than the date warns first, names the dropped items and their see_again", async () => {
    const ctx0: McpContext = {};
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1539-test" } }, ctx0);
    const ctx = { sessionId: ctx0.issuedSessionId };
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character_id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character_id;
    const s = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    expect(s.lines_left).toBe(6);
    const two = (await call("submit_own_date_step", { episode_id: s.episode_id, outputs: [line(1), line(2)] }, ctx)).structuredContent;
    expect(two.lines_left).toBe(4);
    const r = (await call("submit_own_date_step", { episode_id: s.episode_id, outputs: [line(3), line(4), line(5, { see_again: true }), line(6, { see_again: true }), line(7), line(8, { see_again: true })] }, ctx)).structuredContent;
    expect(Object.keys(r)[0]).toBe("warning");
    expect(r.warning).toMatch(/^outputs items 5 to 6 weren't used: the date's lines ran out first \(4 of 6 went in\)\. The see_again on item 6 was dropped with its line/);
    expect(r.unused_outputs).toEqual([{ item: 5, see_again: false }, { item: 6, see_again: true }]);
    expect(MCP_SERVER_INFO.version).toBe("2.29.0");
  });
});
