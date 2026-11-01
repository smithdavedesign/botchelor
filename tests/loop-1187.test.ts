import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "@/lib/conversation";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { dateShape, moveCost, moveProblem } from "@/lib/moves";
import { startTestDb, validCharacter } from "./helpers";

// #1187 (the 2026-11-01-0610 run): an accepted move said the date went 12 to 24 lines and it became 22, and the 280-character
// line, the move's few words and "name the place in your yes" were learned only by being refused.
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

const line = (i: number, extra: Partial<Turn> = {}): Turn => ({ side: i % 2 ? "b" : "a", act: 0, dialogue: `Line ${i + 1}.`, action: "", emotion: "warm", interest: 0.5, ...extra });
const CAFE = "cafe" as Any;
const MARKET = "night_market" as Any;

describe("#1187: a move's new total is the one the date then has", () => {
  it("a move suggested at turn 10 of 12 and taken at turn 11 goes from 12 to 23, as dateShape counts it", () => {
    const before = [...Array.from({ length: 9 }, (_, i) => line(i)), line(9, { move: { say: "the night market", to: MARKET } })];
    const shape = dateShape(before, CAFE, 12, { moves: true });
    expect(shape.pending?.to).toBe(MARKET);
    expect(moveCost(shape)).toBe("Yes gives 12 lines there (the date goes from 12 to 23; 1 more move possible after it); false keeps it at 12.");
    const after = dateShape([...before, line(10, { moved_to: MARKET })], CAFE, 12, { moves: true });
    expect(after.total).toBe(23);
  });

  it("a move taken on a segment's last line is the only one that adds the whole budget", () => {
    const before = [...Array.from({ length: 10 }, (_, i) => line(i)), line(10, { move: { say: "the night market", to: MARKET } })];
    const shape = dateShape(before, CAFE, 12, { moves: true });
    expect(moveCost(shape)).toContain("the date goes from 12 to 24");
    expect(dateShape([...before, line(11, { moved_to: MARKET })], CAFE, 12, { moves: true }).total).toBe(24);
  });

  it("a move that can't be read says its length", () => {
    const shape = dateShape([line(0), line(1), line(2), line(3), line(4)], CAFE, 12, { moves: true });
    const long = "the little place down by the river with the lanterns and the old boats";
    expect(moveProblem({ move: long }, shape, { self: "Ada Lumen", other: "Bo Quill" }, "Bo", `Let's go to ${long}?`, true)).toMatch(/^say where in a few words, 40 characters at most/);
  });
});

describe("#1187: the rules are said before the first line", () => {
  it("submit_own_date_step's move says a few words and its length, and that a yes names the place", () => {
    const d = MCP_TOOLS.find((x) => x.name === "submit_own_date_step")!.description as string;
    expect(d).toContain("move: a place in a few words (40 characters at most)");
    expect(d).toContain('"accept_move": true (go: the line names the place or says yes)');
  });

  it("the quickstart says a line's limit and how a move goes, in one line", async () => {
    const ctx: McpContext = {};
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1187-test" } }, ctx)).result;
    expect(init.instructions).toContain("Own dates: a bare line (280 characters at most) is a step's output; to move, say where in it and set move; the other's yes names the place (accept_move: true).");
  });

  it("start_own_date's first step says the 280 characters and that a yes names the place", async () => {
    const ctx: McpContext = {};
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1187-test" } }, ctx);
    const session = { sessionId: ctx.issuedSessionId };
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), session)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), session)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, session)).structuredContent.step;
    expect(step.instructions).toContain('hand in just the dialogue as "output" (280 characters at most; a bare string works');
    expect(step.instructions).toContain('"accept_move": true, with a line that says yes to the place or names it');
  });
});
