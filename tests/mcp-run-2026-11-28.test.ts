import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airEpisode } from "@/lib/air";
import { nextDateNumber } from "@/lib/date-number";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { MIN_LINE_LETTERS, tooShortLine } from "@/lib/own-date";
import { movePlace } from "@/lib/places";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 2026-11-28 run (20 agents on the MCP server): a place named with a second-date yes was lost when the other side's
// yes booked it; a yes left waiting after the pair's next date was performed still read can_plan; an own date after a
// booked date 2 was a second "date 2"; initialize's live count read differently from swipe_deck's "active now"; the
// league left an agent out unsaid; and a line of "x" went in as a turn.
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
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function connect(client = "run-1128-test"): Promise<{ ctx: McpContext; init: Any }> {
  const c: McpContext = {};
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, c);
  return { ctx: { sessionId: c.issuedSessionId }, init };
}
async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const { ctx } = await connect();
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string, created: r.structuredContent };
}
async function airedFirstDate() {
  const A = await agentWith("Lysander Vexley");
  const B = await agentWith("Cornelius Quillby");
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson(), episodeJson()]);
  const booked = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
  if (booked.isError) throw new Error(booked.content[0].text);
  const first = booked.structuredContent.episode.id as string;
  await airEpisode(t.db, first, A.agentId);
  return { A, B, first };
}
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the sea, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6 });
async function match(A: { ctx: McpContext; id: string }, B: { ctx: McpContext; id: string }) {
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
  await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
}

describe("plan_second_date keeps the place named with a yes", () => {
  it("the other side's yes books it where the first one said, and says so", async () => {
    const { A, B, first } = await airedFirstDate();
    const yes = (await call("plan_second_date", { episode_id: first, confirm: true, place: "the night market" }, A.ctx)).structuredContent;
    expect(yes.second_date).toMatchObject({ status: "waiting", place: "the night market" });
    expect(yes.second_date.place_note).toMatch(/kept with your yes/);

    scriptedModel([episodeJson(), episodeJson()]);
    const booked = (await call("plan_second_date", { episode_id: first, confirm: true }, B.ctx)).structuredContent;
    expect(booked.booked).toBe(true);
    expect(booked.place_from_their_yes).toBe("the night market");
    const venue = (await t.db.query<{ venue: string }>(`select setup->>'venue' as venue from episodes where id = $1`, [booked.episode_id])).rows[0].venue;
    expect(venue).toBe(movePlace("the night market", "Cornelius Quillby", "Lysander Vexley"));
  });

  it("a place that can't host a date is refused with the yes, not lost later", async () => {
    const { A, first } = await airedFirstDate();
    const r = await call("plan_second_date", { episode_id: first, confirm: true, place: "https://example.com/somewhere" }, A.ctx);
    expect(r.isError).toBe(true);
    expect((await t.db.query(`select 1 from second_date_requests where episode_id = $1`, [first])).rows.length).toBe(0);
  });
});

describe("a second-date yes the pair's next date settled", () => {
  it("can_plan turns false with the date that followed, and confirm books nothing", async () => {
    const { A, B, first } = await airedFirstDate();
    expect((await call("plan_second_date", { episode_id: first, confirm: true }, A.ctx)).structuredContent.booked).toBeFalsy();

    // B's agent performs their next date themselves instead.
    await match(A, B);
    const own = await call("start_own_date", { character_id: B.id, partner_id: A.id, format: "speed_date" }, B.ctx);
    if (own.isError) throw new Error(own.content[0].text);
    const ownId = own.structuredContent.step.episode_id as string;

    const preview = (await call("plan_second_date", { episode_id: first, preview: true }, A.ctx)).structuredContent;
    expect(preview.second_date).toMatchObject({ can_plan: false, reason: "superseded", you_asked: true, superseded_by: { episode_id: ownId, own: true } });
    expect(preview.second_date.superseded_by.note).toMatch(/nothing left to book/);
    expect(preview.next_calls ?? []).toEqual([]);

    // Once that date is over, B's yes still books nothing.
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [ownId]);
    const before = (await t.db.query<{ n: number }>(`select count(*)::int as n from episodes`)).rows[0].n;
    const confirm = await call("plan_second_date", { episode_id: first, confirm: true }, B.ctx);
    expect(confirm.isError).toBe(true);
    expect(confirm.content[0].text).toMatch(/nothing left to book/);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from episodes`)).rows[0].n).toBe(before);
    // my_status no longer lists it as waiting.
    expect((await call("my_status", { include: ["all"] }, A.ctx)).structuredContent.second_date_yeses).toBeUndefined();
  });
});

describe("an own date after a booked date 2 is date 3", () => {
  it("counts the pair's booked public follow-up, as the show path does", async () => {
    const { A, B, first } = await airedFirstDate();
    await call("plan_second_date", { episode_id: first, confirm: true }, A.ctx);
    scriptedModel([episodeJson(), episodeJson()]);
    const booked = (await call("plan_second_date", { episode_id: first, confirm: true }, B.ctx)).structuredContent;
    expect(booked.booked).toBe(true);
    // Booked and public, not aired yet.
    await t.db.query(`update episodes set status = 'ready', visibility = 'public', revealed_at = null where id = $1`, [booked.episode_id]);
    const second = (await t.db.query<{ n: string }>(`select setup->>'date_number' as n from episodes where id = $1`, [booked.episode_id])).rows[0].n;
    expect(Number(second)).toBe(2);
    expect(await nextDateNumber(t.db, A.id, B.id)).toBe(3);
  });
});

describe("live_agents_now reads 'on now' the way swipe_deck does", () => {
  it("an agent whose newest call is on another of its sessions counts as on, and a house-run bot never does", async () => {
    const B = await agentWith("Perpetua Vandermolen");
    // B's own session went quiet half an hour ago, but B called a moment ago from another client.
    await t.db.query(`update mcp_sessions set last_seen = now() - interval '30 minutes' where agent_id = $1`, [B.agentId]);
    await t.db.query(`insert into mcp_sessions (id, agent_id, client_name, last_seen) values ($1, $2, 'botchelor-loop-side', now())`, [crypto.randomUUID(), B.agentId]);
    const { init } = await connect();
    expect(init.result._meta["botchelor/live_agents_now"]).toBe(1);

    // Only house-run sessions: a house-run bot, left out.
    await t.db.query(`update mcp_sessions set client_name = 'botchelor-loop-crowd' where agent_id = $1`, [B.agentId]);
    const { init: again } = await connect();
    expect(again.result._meta["botchelor/live_agents_now"]).toBe(0);
    expect(again.result._meta["botchelor/agents_on_now"]).toBe(0);
  });
});

describe("the model league says when it leaves an agent out", () => {
  it("an agent whose character reads as the show's test cast is told it isn't counted", async () => {
    const ours = await agentWith("Mira Quell", { model: "claude-opus-5-5" });
    expect(ours.created.model).toMatchObject({ counts_as: expect.any(String), counted_in_league: false });
    expect(ours.created.model.league_note).toMatch(/leaves this agent out/);
    const outside = await agentWith("Gwendolyn Ashcombe", { model: "claude-opus-5-5" });
    expect(outside.created.model.counted_in_league).toBeUndefined();
  });
});

describe("a near-empty line is refused", () => {
  it("tooShortLine: under two letters, so a short real answer still counts", () => {
    expect(MIN_LINE_LETTERS).toBe(2);
    for (const s of ["x", "…", "  a  ", "?!", "k."]) expect(tooShortLine(s)).toBe(true);
    for (const s of ["Hi.", "Yes.", "No!", "Hello.", "Oh, you.", "你好吗", "好"]) expect(tooShortLine(s)).toBe(false);
  });

  it("submit_own_date_step refuses 'x' as an error, writes nothing, and takes the next real line", async () => {
    const A = await agentWith("Odalys Oyelaran");
    const B = await agentWith("Thaddeus Quillfeather");
    await match(A, B);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const id: string = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    const refused = await call("submit_own_date_step", { episode_id: id, output: { dialogue: "x" } }, A.ctx);
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ accepted: false, ok: false, turn_used: false });
    expect(refused.structuredContent.message).toMatch(/too short/);
    expect((await t.db.query<{ n: number }>(`select jsonb_array_length(transcript)::int as n from episodes where id = $1`, [id])).rows[0].n).toBe(0);
    const ok = await call("submit_own_date_step", { episode_id: id, output: line(0) }, A.ctx);
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent.accepted).toBe(true);
  });
});
