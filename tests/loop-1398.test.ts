import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { sideLines } from "@/lib/own-date";
import { startTestDb, validCharacter } from "./helpers";

// #1398 (the 2026-11-09-0610 run: "The turn counter jumps 1, 3, 5, 7 because it counts both sides"): turn_number counts
// every line of the date, so one side sees odd numbers only. Each turn step also says the line on the speaker's own count
// (your_line), and last_line_note names the speaker's own last line, the one that carries see_again.
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1398-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the harbour, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });

describe("#1398: each side's own line count", () => {
  it("sideLines splits a date's lines, a first", () => {
    expect([sideLines(12, "a"), sideLines(12, "b")]).toEqual([6, 6]);
    expect([sideLines(23, "a"), sideLines(23, "b")]).toEqual([12, 11]);
  });

  it("your_line counts the speaker's own lines while turn_number counts both, and the last-line note names the speaker's", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    let step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const of = step.of as number;
    const half = { a: sideLines(of, "a"), b: sideLines(of, "b") };
    const seen: Array<[number, string]> = [];
    let i = 0;
    while (step.stage === "turn" && i < 4) {
      seen.push([step.turn_number, step.your_line]);
      const mine = half[step.side as "a" | "b"];
      const lastTurn = step.side === (of % 2 ? "a" : "b") ? of : of - 1;
      // A note goes once per session, word for word (notes_left_out), so each side's shows on its first step.
      if (i < 2) expect(step.last_line_note).toContain(`${step.speaker.name}'s is turn ${lastTurn}, its line ${mine} of ${mine}.`);
      expect(step.instructions).toContain(`Turn ${i + 1} of ${of}: ${step.speaker.name} speaks (own line ${Math.floor(i / 2) + 1} of ${mine}).`);
      step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
    }
    expect(seen).toEqual([
      [1, `Ada Lumen's 1st of ${half.a} lines (Bo Quill has ${half.b}); turn_number counts both sides' lines.`],
      [2, `Bo Quill's 1st of ${half.b} lines (Ada Lumen has ${half.a}); turn_number counts both sides' lines.`],
      [3, `Ada Lumen's 2nd of ${half.a} lines (Bo Quill has ${half.b}); turn_number counts both sides' lines.`],
      [4, `Bo Quill's 2nd of ${half.b} lines (Ada Lumen has ${half.a}); turn_number counts both sides' lines.`],
    ]);
  });
});
