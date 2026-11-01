import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { stageShown, stagesFor } from "@/lib/adult/stage-floor";
import { startTestDb, validCharacter } from "./helpers";

// From the loop20 prod run 2026-10-31-1744 (~/.botchelor-loop/runs/2026-10-31-1744): #1145 an innocent scene read as sex,
// #1146 a finished date with no transcript key, #1149 send_text between your own two said "wait for their agent".
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

describe("#1145: an acoustician's words aren't sex", () => {
  it("everyday senses of penetrate, climax and thrust show nothing; with a body in them they still do", () => {
    for (const line of [
      "The sound penetrates the whole nave, even the side chapels.",
      "That's the climax of the chord, the bit where it resolves.",
      "Feel the thrust of the organ when the bass pipes open?",
      "A squirt bottle for the reeds, that's my secret.",
    ])
      expect(stageShown(line)).toBeNull();
    expect(stageShown("He thrusts into her, slow.")).toBe(4);
    expect(stageShown("She climaxes with a gasp.")).toBe(4);
    expect(stageShown("He penetrates her, finally.")).toBe(4);
    expect(stageShown("I want to make love to you.")).toBe(4);
    // A batch of pitch talk leaves the stage where the claim put it.
    expect(stagesFor([{ text: "The climax of the chord." }, { text: "The sound penetrates the nave." }], 1, 1).stage).toBe(1);
  });
});

describe("#1146: a finished date with no lines says so", () => {
  it("get_episode has transcript: [] with transcript_missing and a note, never a missing key", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx);
    const agent = made.structuredContent.agent_id;
    const dewey = (await call("create_character", validCharacter({ name: "Dewey Lamarque", keep_name: true }), ctx)).structuredContent.character.id;
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility, sides)
       values ('ep-no-lines', $1, $2, $3, 'the pier', '{}'::jsonb, '["Act 1", "Act 2", "Act 3"]'::jsonb, '', '', 'friends', now(), '[]'::jsonb, 'ready', 'public', $4::jsonb)`,
      [agent, made.structuredContent.character.id, dewey, JSON.stringify([{ wants_another: false }, { wants_another: false }])],
    );
    const e = (await call("get_episode", { episode_id: "ep-no-lines" }, ctx)).structuredContent;
    const ep = e.episode ?? e;
    expect(ep.transcript).toEqual([]);
    expect(ep.transcript_missing).toBe(true);
    expect(ep.transcript_note).toMatch(/lines didn't come out .* the ending and the score stay as they are/);
  });
});

describe("#1149: texting between your own two waits on nobody", () => {
  it("send_text says both are yours, with no activity, read receipt or wait, and offers the reply from the other side", async () => {
    const ctx = await connect();
    const made = await call("create_character", validCharacter({ name: "Hettie Brack", keep_name: true }), ctx);
    const hettie = made.structuredContent.character.id;
    const dewey = (await call("create_character", validCharacter({ name: "Dewey Lamarque", keep_name: true }), ctx)).structuredContent.character.id;
    const [lo, hi] = [hettie, dewey].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, true, true)`, [lo, hi]);
    const r = await call("send_text", { character_id: hettie, to: dewey, text: "Same pier on Thursday? The tide's better." }, ctx);
    expect(r.isError, r.content?.[0]?.text).toBeFalsy();
    const d = r.structuredContent;
    expect(d.both_yours).toBe(true);
    expect(d.their_agent).toBeUndefined();
    expect(d.last_text_read).toBeUndefined();
    expect(d.reply_expected_within_seconds).toBeUndefined();
    expect(d.note).toMatch(/Both characters are yours/);
    expect(d.next_calls).toEqual([{ tool: "send_text", args: { character_id: dewey, to: hettie }, why: expect.any(String) }]);
  });
});
