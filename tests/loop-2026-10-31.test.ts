import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { numbersHint } from "@/lib/heading";
import { secondDateState } from "@/lib/second-date";
import { startTestDb, validCharacter } from "./helpers";

// From the loop20 prod runs of 2026-10-31 (run folders ~/.botchelor-loop/runs/2026-10-31-1401): #1101 a content refusal
// names its field, #1102 expect_turn pins a line to its turn, #1104 plan_second_date answers as the character you name.
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
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the sea, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });

describe("#1101: a content refusal says where", () => {
  it("names the field the check tripped on, and for the age rule what counts, never the words", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent.character.id;
    const r = await call("update_character", { character_id: id, bio: "She taught herself to sail when she was 12 years old and never looked back." }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Characters must be adults.*\(In bio\.\) Any age under 18 there counts, even a pet's or a past one/);
    expect(r.content[0].text).not.toMatch(/12 years/);
  });
});

describe("#1102: expect_turn pins a line to its turn", () => {
  it("refuses a line written for another turn and writes nothing; the right one goes in", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Dewey Lamarque", keep_name: true }), ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    const id = step.episode_id;
    expect(step.turn_number).toBe(1);

    const late = (await call("submit_own_date_step", { episode_id: id, output: line(0), expect_turn: 2 }, ctx)).structuredContent;
    expect(late).toMatchObject({ accepted: false, rejected: "wrong_turn", turn_number: 1, speaker: step.speaker.name });
    expect(late.message).toMatch(/Nothing was written/);
    expect((await t.db.query(`select jsonb_array_length(coalesce(transcript, '[]'::jsonb))::int as n from episodes where id = $1`, [id])).rows[0].n).toBe(0);

    const ok = (await call("submit_own_date_step", { episode_id: id, output: line(0), expect_turn: 1 }, ctx)).structuredContent;
    expect(ok.accepted).not.toBe(false);
    expect(ok.turn_number).toBe(2);
  });
});

describe("#1104: plan_second_date as the character you name", () => {
  it("both characters yours: character_id picks the side; without it, side A as before", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx);
    const agent = made.structuredContent.agent_id;
    const hettie = made.structuredContent.character.id;
    const dewey = (await call("create_character", validCharacter({ name: "Dewey Lamarque", keep_name: true }), ctx)).structuredContent.character.id;
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility, sides)
       values ('ep-own-pair', $1, $2, $3, 'the pier', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'public', $4::jsonb)`,
      [agent, dewey, hettie, JSON.stringify([{ wants_another: true }, { wants_another: true }])],
    );
    expect(await secondDateState(t.db, "ep-own-pair", agent)).toMatchObject({ my_character_name: "Dewey Lamarque", partner_name: "Hettie Brack" });
    expect(await secondDateState(t.db, "ep-own-pair", agent, hettie)).toMatchObject({ my_character_name: "Hettie Brack", partner_name: "Dewey Lamarque" });
    const preview = (await call("plan_second_date", { episode_id: "ep-own-pair", character_id: hettie, preview: true }, ctx)).structuredContent;
    expect(JSON.stringify(preview)).toMatch(/"my_character_name":"Hettie Brack"/);
  });
});

describe("#1111: numbers_hint agrees with the box score", () => {
  const f = (n: number) => ({ final: n });
  it("a weak spot barely off an ordinary start is a small drag, named at its level; a big one still works against them", () => {
    const mild = numbersHint("friends", { chemistry: f(56), attraction: f(52), trust: f(50), awkwardness: f(41) }, "genuine_chemistry");
    expect(mild).toMatch(/This time it was awkwardness \(mild: [^)]*\), only a small drag on them/);
    expect(mild).not.toMatch(/working against them/);
    expect(mild).toMatch(/worked out for each date from its format and numbers, so the same two can head somewhere else another time/);
    const big = numbersHint("disaster", { chemistry: f(50), attraction: f(48), trust: f(45), awkwardness: f(66) }, "genuine_chemistry");
    expect(big).toMatch(/This time it was awkwardness \(high: [^)]*\), working against them/);
  });
});

describe("#1124: an empty filtered deck says why", () => {
  it("only: live_agents with none on now names the agents in the deck and what to do meanwhile", async () => {
    const ctx = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx)).structuredContent.character.id;
    const profile = {
      prompts: [
        { id: "geek_out", answer: "Tide tables, and why the moon gets the credit." },
        { id: "simple_pleasures", answer: "A dry sock after a wet pier." },
      ],
      hobbies: ["Sailing", "Knots"],
    };
    expect((await call("update_character", { character_id: mine, extras: profile }, ctx)).isError).toBeFalsy();
    const r = (await call("swipe_deck", { character_id: mine, only: "live_agents" }, ctx)).structuredContent;
    expect(r.cards).toEqual([]);
    expect(r.note).not.toMatch(/Nobody new in the deck/);
    expect(r.note).toMatch(/has its agent on right now/);
    expect(r.note).toMatch(/house cast is always on/);
  });
});
