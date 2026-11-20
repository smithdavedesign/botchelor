import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 2026-11-19-1952 run. #1860: a bare-string last line went in and closed the date with no see_again (three agents);
// #1526's wish_defaulted only said so after the fact. #1861: "my turns 1, 3, 5 of 6": the turn number counts both sides.
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
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result.structuredContent;

const LINES = ["You came!", "I nearly didn't.", "Tea or coffee?", "Tea, always.", "Good answer.", "I try.", "Shall we walk?", "Gladly.", "Rain again.", "I like rain.", "Me too.", "Bye then."];

async function ownDate() {
  const c: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1860-test" } }, c);
  const ctx = { sessionId: c.issuedSessionId };
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).character.id as string;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).character.id as string;
  scriptOutcome({ ending: "friends" });
  const start = await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx);
  return { ctx, id: start.episode_id as string, start };
}

/** Plays bare lines up to (not including) the turn `upTo`. */
async function playTo(ctx: McpContext, id: string, upTo: number) {
  let r: Any = null;
  for (let n = 1; n < upTo; n++) r = await call("submit_own_date_step", { episode_id: id, output: LINES[n - 1] }, ctx);
  return r;
}

describe("#1860: a bare last line is held, and asks for see_again", () => {
  it("refuses a bare string on a side's last line, hands the line back ready to resend, and takes the object form", async () => {
    const { ctx, id, start } = await ownDate();
    const of = start.of as number;
    const before = await playTo(ctx, id, of - 1);
    expect(before.turn_number).toBe(of - 1);
    expect(before.last_line).toBe(true);
    const held = await call("submit_own_date_step", { episode_id: id, output: "Same time next week?" }, ctx);
    expect(held.accepted).toBe(false);
    expect(held.see_again_needed).toBe(true);
    expect(held.turn_used).toBe(false);
    expect(held.turn_number).toBe(of - 1);
    expect(held.message).toMatch(/last line, and a bare string can't carry see_again/);
    expect(held.message).toContain('{"dialogue": "…", "see_again": true or false}');
    expect(held.summary).toMatch(/^Not accepted: .*still your move/);
    expect(held.next_calls[0].tool).toBe("submit_own_date_step");
    expect(held.next_calls[0].args.output.dialogue).toBe("Same time next week?");
    expect(held.next_calls[0].args.output).toHaveProperty("see_again");
    // check_only says the same before anything counts.
    const checked = await call("submit_own_date_step", { episode_id: id, output: "Same time next week?", check_only: true }, ctx);
    expect(checked.accepted).toBe(false);
    expect(checked.see_again_needed).toBe(true);
    const sent = await call("submit_own_date_step", { episode_id: id, output: { dialogue: "Same time next week?", see_again: true } }, ctx);
    expect(sent.accepted).toBe(true);
    expect(sent.wish_kept).toMatchObject({ see_again: true, last_line: true });
    // An object without see_again is the way to let interest_signal stand in: accepted, with #1526's note.
    const last = await call("submit_own_date_step", { episode_id: id, output: { dialogue: "We'll see." } }, ctx);
    expect(last.accepted).toBe(true);
    expect(last.wish_defaulted).toMatchObject({ stood_in: "interest_signal" });
  });

  it("takes a bare last line that carries see_again beside it, or after an earlier see_again of the side's", async () => {
    const { ctx, id, start } = await ownDate();
    const of = start.of as number;
    await call("submit_own_date_step", { episode_id: id, output: LINES[0] }, ctx);
    // Bo (turn 2) sends a see_again early: Bo's later bare last line isn't held.
    await call("submit_own_date_step", { episode_id: id, output: { dialogue: LINES[1], see_again: false } }, ctx);
    await playTo2(ctx, id, 3, of - 1);
    const beside = await call("submit_own_date_step", { episode_id: id, output: "Same time next week?", see_again: true }, ctx);
    expect(beside.accepted).toBe(true);
    const bo = await call("submit_own_date_step", { episode_id: id, output: "Maybe." }, ctx);
    expect(bo.accepted).toBe(true);
    expect(bo.wish_defaulted).toMatchObject({ stood_in: "earlier_see_again" });
  });

  it("a batch keeps today's behaviour: bare last lines go in, each said in wishes_kept", async () => {
    const { ctx, id, start } = await ownDate();
    const of = start.of as number;
    const r = await call("submit_own_date_step", { episode_id: id, outputs: LINES.slice(0, of) }, ctx);
    expect(r.accepted).toBe(true);
    expect(r.accepted_count).toBe(of);
    expect(r.wishes_kept.filter((w: Any) => w.see_again === null)).toHaveLength(2);
  });
});

async function playTo2(ctx: McpContext, id: string, from: number, upTo: number) {
  for (let n = from; n < upTo; n++) await call("submit_own_date_step", { episode_id: id, output: LINES[n - 1] }, ctx);
}

describe("#1861: the speaker's own line count beside turn_number", () => {
  it("says your_line (n of the side's lines, and its turns) and that turns alternate, from the first step", async () => {
    const { ctx, id, start } = await ownDate();
    const of = start.of as number;
    const half = Math.ceil(of / 2);
    expect(start.your_line).toEqual({ n: 1, of: half, turns: Array.from({ length: half }, (_, i) => 2 * i + 1) });
    expect(start.summary).toMatch(/turn 1 of \d+ \(Ada's line 1 of \d+: turns alternate between the two characters, Ada's are 1, 3/);
    const two = await call("submit_own_date_step", { episode_id: id, output: LINES[0] }, ctx);
    expect(two.your_line).toMatchObject({ n: 1, turns: expect.arrayContaining([2, 4]) });
    expect(two.summary).toMatch(/turn 2 of \d+ \(Bo's line 1 of/);
    const three = await call("submit_own_date_step", { episode_id: id, output: LINES[1] }, ctx);
    expect(three.your_line.n).toBe(2);
    expect(three.summary).toMatch(/Ada's line 2 of/);
  });
});
