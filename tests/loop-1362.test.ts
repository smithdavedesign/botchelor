import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { pinnedSide } from "@/lib/own-date";
import { startTestDb, validCharacter } from "./helpers";

// #1362 (the 2026-11-08-0610 run: "I ran two submit_own_date_step calls in parallel by mistake. The second line was
// attributed to the wrong speaker without any warning"): on a date between an agent's own two characters, character_id pins
// a line to its speaker (another's turn: refused, nothing written), and every accepted line says whose it went in as.
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
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1362-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the harbour, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });
const said = async (id: string): Promise<number> =>
  (await t.db.query<{ n: number }>(`select jsonb_array_length(coalesce(transcript, '[]'::jsonb))::int as n from episodes where id = $1`, [id])).rows[0].n;

async function ownDate() {
  const ctx = await connect();
  const ines = (await call("create_character", validCharacter({ name: "Ines Varga", keep_name: true }), ctx)).structuredContent.character.id as string;
  const tomas = (await call("create_character", validCharacter({ name: "Tomas Reyes", keep_name: true }), ctx)).structuredContent.character.id as string;
  const step = (await call("start_own_date", { character_id: ines, partner_id: tomas, format: "speed_date" }, ctx)).structuredContent.step;
  expect(step).toMatchObject({ stage: "turn", turn_number: 1, speaker: { id: ines, name: "Ines Varga" } });
  return { ctx, ines, tomas, id: step.episode_id as string };
}

describe("#1362: a line pinned to its speaker", () => {
  it("pinnedSide reads an id or a full name, either case, and nothing else", () => {
    const ids = ["c-ines", "c-tomas"] as const;
    const names = ["Ines Varga", "Tomas Reyes"] as const;
    expect(pinnedSide("c-ines", ids, names)).toBe("a");
    expect(pinnedSide(" tomas reyes ", ids, names)).toBe("b");
    expect(pinnedSide("Ines", ids, names)).toBeNull();
    expect(pinnedSide("c-other", ids, names)).toBeNull();
  });

  it("every accepted line says whose it went in as, and the next call names the next speaker", async () => {
    const { ctx, ines, tomas, id } = await ownDate();
    const r = (await call("submit_own_date_step", { episode_id: id, output: line(1) }, ctx)).structuredContent;
    expect(r.accepted).toBe(true);
    expect(r.filled).toEqual([{ turn_number: 1, who: "Ines Varga" }]);
    expect(r.next_calls[0]).toMatchObject({ tool: "submit_own_date_step", args: { episode_id: id, character_id: tomas } });
    const r2 = (await call("submit_own_date_step", { episode_id: id, output: line(2), character_id: tomas }, ctx)).structuredContent;
    expect(r2.filled).toEqual([{ turn_number: 2, who: "Tomas Reyes" }]);
    expect(r2.next_calls[0].args.character_id).toBe(ines);
  });

  it("a second line meant for the same speaker is refused, not stored as the other character's", async () => {
    const { ctx, ines, id } = await ownDate();
    expect((await call("submit_own_date_step", { episode_id: id, output: line(1), character_id: ines }, ctx)).structuredContent.accepted).toBe(true);
    // The call sent alongside, landing after the first took Ines's turn: Tomas speaks now.
    const late = (await call("submit_own_date_step", { episode_id: id, output: line(2), speaker: "Ines Varga" }, ctx)).structuredContent;
    expect(late).toMatchObject({ accepted: false, ok: false, rejected: "wrong_speaker", line_used: false });
    expect(late.message).toMatch(/^Not handed in: this line is Ines Varga's \(character_id\), but turn 2 of \d+ is Tomas Reyes's\. Nothing was written\./);
    expect(late.message).toMatch(/Send Tomas Reyes's line for turn 2, then Ines Varga's\./);
    expect(late.turn_used).toBeUndefined();
    expect(await said(id)).toBe(1);
  });

  it("two pinned calls side by side: one goes in, the other is refused, and nothing lands on the wrong side", async () => {
    const { ctx, ines, id } = await ownDate();
    const both = await Promise.all([1, 2].map(async (i) => (await call("submit_own_date_step", { episode_id: id, output: line(i), character_id: ines }, ctx)).structuredContent));
    expect(both.filter((r) => r.accepted === true)).toHaveLength(1);
    const lost = both.find((r) => r.accepted !== true);
    expect(["wrong_speaker", "raced"]).toContain(lost.rejected);
    expect(lost.line_used).toBe(false);
    expect(await said(id)).toBe(1);
    const sides = (await t.db.query<{ transcript: Any[] }>(`select transcript from episodes where id = $1`, [id])).rows[0].transcript.map((x: Any) => x.side);
    expect(sides).toEqual(["a"]);
  });

  it("a character not on the date is refused by name; a pin with outputs is refused before anything goes in", async () => {
    const { ctx, id } = await ownDate();
    const stranger = (await call("submit_own_date_step", { episode_id: id, output: line(1), character_id: "Someone Else" }, ctx)).structuredContent;
    expect(stranger).toMatchObject({ accepted: false, rejected: "wrong_speaker" });
    expect(stranger.message).toMatch(/character_id "Someone Else" is neither character on this date/);
    const batch = await call("submit_own_date_step", { episode_id: id, outputs: [line(1), line(2)], character_id: "Ines Varga" }, ctx);
    expect(batch.isError).toBe(true);
    expect(batch.content[0].text).toMatch(/character_id pins one line/);
    expect(await said(id)).toBe(0);
  });

  it("the tool says one call at a time, and takes character_id", async () => {
    const tools = (await rpc("tools/list", { all: true })).result.tools as Any[];
    const tool = tools.find((x) => x.name === "submit_own_date_step");
    expect(tool.description).toMatch(/One call at a time/);
    expect(tool.inputSchema.properties.character_id).toBeTruthy();
  });
});
