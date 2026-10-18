// The agent features from rounds 3–6 of the visitor test (docs/agent-visitor-test.md) that run end to end over MCP.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airDueDates } from "@/lib/air";
import { agentStats } from "@/lib/dating";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

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
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "rounds-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.6 });

/** A date on the show's model with a house character, ready. */
async function showDate(ctx: McpContext, name = "Juno Marlowe") {
  const mine = (await call("create_character", validCharacter({ name }), ctx)).structuredContent.character.id;
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
  return { mine, ep };
}

describe("wait_for_my_turn (run 4)", () => {
  it("returns at once when it's your move, and waits then gives up with still_waiting when it isn't", async () => {
    const ctxA = await connect();
    const ctxB = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctxA)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true, open_audience: "agents" }), ctxB)).structuredContent.character.id;
    // Agents' first dates need a match under the swipe gate; this checks the waiting, not the gate.
    vi.stubEnv("SWIPE_GATE", "0");
    const id = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step.episode_id;
    expect((await call("wait_for_my_turn", { episode_id: id, timeout_seconds: 1 }, ctxA)).structuredContent.step).toMatchObject({ stage: "turn", side: "a" });
    const started = Date.now();
    const waited = (await call("wait_for_my_turn", { episode_id: id, timeout_seconds: 1 }, ctxB)).structuredContent;
    expect(waited).toMatchObject({ still_waiting: true, step: { stage: "waiting" } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    await call("submit_own_date_step", { episode_id: id, output: line(0) }, ctxA);
    expect((await call("wait_for_my_turn", { episode_id: id, timeout_seconds: 1 }, ctxB)).structuredContent.step).toMatchObject({ stage: "turn", side: "b" });
  });
});

describe("an ending says why (round 3)", () => {
  it("get_episode carries the why line once the ending is shown, and sliding_doors says what changed and why", async () => {
    const ctx = await connect();
    const { ep } = await showDate(ctx);
    const got = (await call("get_episode", { episode_id: ep.id }, ctx)).structuredContent;
    expect(got.why).toMatch(/^Just friends: .* Endings read where the numbers finished/);
    const doors = (await call("sliding_doors", { episode_id: ep.id, change: "bolder" }, ctx)).structuredContent.sliding_doors;
    expect(doors.what_changed).toMatch(/Juno's side was made more unpredictable/);
    expect(doors.alternate.why).toMatch(/^(A second date|Just friends|A disaster): /);
  });
});

describe("my_status (round 3)", () => {
  it("breaks points down by source and counts every finished date beside the aired public ones", async () => {
    const ctx = await connect();
    const { mine } = await showDate(ctx);
    const s = (await call("my_status", {}, ctx)).structuredContent;
    expect(s.points_from).toEqual({ predictions: 0, dealbreaker_guesses: 0, matchmaking: 0, ratings_received: 0, arc_calls: 0 });
    expect(s.points_note).toMatch(/for calling a public date's ending/);
    expect(s.characters.find((c: Any) => c.id === mine)).toMatchObject({ dates: 0, all_dates: 1 });
    expect(s.dates_note).toMatch(/aired public dates/);
    expect((await agentStats(t.db)).agents_with_characters).toBe(1);
  });
});

describe("the prediction window airs dates on its own (round 2, run 3)", () => {
  it("an early air_date schedules it, get_episode says when, and the sweep airs it once the window closes", async () => {
    const ctx = await connect();
    const { ep } = await showDate(ctx);
    const early = (await call("air_date", { episode_id: ep.id }, ctx)).structuredContent;
    expect(early).toMatchObject({ scheduled: true });
    expect((await call("get_episode", { episode_id: ep.id }, ctx)).structuredContent.airs_at).toBe(early.airs_at);
    expect(await airDueDates(t.db)).toEqual([]); // not due yet
    await t.db.query(`update episodes set air_after = now() - interval '1 minute' where id = $1`, [ep.id]);
    const aired = await airDueDates(t.db);
    expect(aired.map((a) => a.id)).toEqual([ep.id]);
    expect((await t.db.query<Any>(`select revealed_at is not null as aired, air_after from episodes where id = $1`, [ep.id])).rows[0]).toEqual({ aired: true, air_after: null });
  });
});

describe("a first date's box score has no carry-over note (round 3)", () => {
  it("the note is for follow-ups only", async () => {
    const ctx = await connect();
    const { ep } = await showDate(ctx);
    expect((await call("get_episode", { episode_id: ep.id }, ctx)).structuredContent.box_score_note).toBeUndefined();
  });
});
