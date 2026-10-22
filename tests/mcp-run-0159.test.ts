import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { argHints, handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { listNotifications, notify, unreadCount } from "@/lib/notifications";
import { settleCommitment } from "@/lib/partners";
import { HOUSE_PARTNER_ID, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.4.1, from the 2026-10-21-0159 simulated-agent run: my_status's wait is a real long-poll that says why it
// returned (#540, #515), "Your move" notices resolve when the date is over (#529), the one-partner rule is said up front
// and when it bites (#514), plan_second_date's preview has a cost (#536), and wrong argument names get a did-you-mean.
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
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(client = "run-0159-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: client } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
async function agent(name = "Ada Lumen", extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const made = (await call("create_character", validCharacter({ name, keep_name: true, ...extra }), ctx)).structuredContent;
  return { ctx, agentId: made.agent_id as string, id: made.character.id as string };
}
const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn, honestly?`, action: "", emotion: "curious", interest_signal: 0.6 });
const timed = async <T>(p: Promise<T>): Promise<[T, number]> => {
  const t0 = Date.now();
  const out = await p;
  return [out, Date.now() - t0];
};

describe("my_status with wait_seconds is a real long-poll (#540, #515)", () => {
  it("returns old unread notices once (unread_at_start), then waits for a new one instead of returning at once", async () => {
    const { ctx, agentId } = await agent();
    await notify(t.db, agentId, { kind: "texted", title: "Bo texted (old)", body: "hi", link: null });
    const first = (await call("my_status", { wait_seconds: 5 }, ctx)).structuredContent;
    expect(first.returned_because).toBe("unread_at_start");
    expect(first.new_since.map((n: Any) => n.title)).toEqual(["Bo texted (old)"]);
    expect(first.wait_cap_seconds).toBe(50);

    // Still unread, but already shown: it no longer ends the wait. Only the new one does.
    setTimeout(() => void notify(t.db, agentId, { kind: "matched", title: "A new match", body: null, link: null }), 1500);
    const [second, ms] = await timed(call("my_status", { wait_seconds: 6 }, ctx));
    expect(ms).toBeGreaterThanOrEqual(1400);
    expect(second.structuredContent.returned_because).toBe("new");
    expect(second.structuredContent.new_since.map((n: Any) => n.title)).toEqual(["A new match"]);
  });

  it("with since: the cursor it returned doesn't match its own notice again; it waits, and times out saying so", async () => {
    const { ctx, agentId } = await agent();
    const start = (await call("my_status", {}, ctx)).structuredContent.cursor;
    await notify(t.db, agentId, { kind: "texted", title: "Bo texted", body: "hi", link: null });
    const got = (await call("my_status", { since: start, wait_seconds: 3 }, ctx)).structuredContent;
    expect(got.returned_because).toBe("new");
    expect(got.new_since).toHaveLength(1);
    // The cursor is to the microsecond, from the database: passing it back waits (it used to return the same item at once).
    expect(got.cursor).toMatch(/\.\d{6}Z$/);
    const [again, ms] = await timed(call("my_status", { since: got.cursor, wait_seconds: 2 }, ctx));
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(again.structuredContent).toMatchObject({ returned_because: "timeout", new_since: [], cursor: got.cursor });
    expect(again.structuredContent.wait_capped_at).toBeUndefined();
  });

  it("a wait over the 50-second cap is capped and says so (#515)", async () => {
    const { ctx, agentId } = await agent();
    const start = (await call("my_status", {}, ctx)).structuredContent.cursor;
    setTimeout(() => void notify(t.db, agentId, { kind: "texted", title: "Bo texted", body: "hi", link: null }), 300);
    const got = (await call("my_status", { since: start, wait_seconds: 100 }, ctx)).structuredContent;
    expect(got).toMatchObject({ returned_because: "new", wait_cap_seconds: 50, wait_capped_at: 50, wait_note: expect.stringMatching(/wait_seconds 100 was capped at 50/) });
  });

  it("an agent's own already-read note isn't news", async () => {
    const { ctx, agentId } = await agent();
    const start = (await call("my_status", {}, ctx)).structuredContent.cursor;
    await t.db.query(`insert into notifications (id, user_id, kind, title, body, read_at) values (gen_random_uuid()::text, $1, 'own_date_declined', 'You called it off', 'x', now())`, [agentId]);
    const got = (await call("my_status", { since: start, wait_seconds: 1 }, ctx)).structuredContent;
    expect(got).toMatchObject({ returned_because: "timeout", new_since: [] });
  });

  it("the other waits share it: get_own_date_step says it was already your move, and the cap", async () => {
    const { ctx, id: a } = await agent("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const got = (await call("get_own_date_step", { episode_id: step.episode_id, wait_seconds: 90 }, ctx)).structuredContent;
    expect(got).toMatchObject({ returned_because: "at_start", already_your_move: true, wait_cap_seconds: 50, wait_capped_at: 50 });
  });

  it("the description says why it returns and the cap", () => {
    const tool = MCP_TOOLS.find((x) => x.name === "my_status")!;
    expect(tool.description).toMatch(/returned_because/);
    expect((tool.inputSchema as Any).properties.wait_seconds.maximum).toBe(50);
  });
});

describe("turn notices resolve when the date is over (#529)", () => {
  async function twoAgents() {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill", { open_to_dates: true });
    return { A, B };
  }
  const unreadTurnNotices = async (userId: string) =>
    (await t.db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and kind in ('own_date_turn', 'own_date_invite') and read_at is null`, [userId])).rows[0].n;

  it("called off: both agents' invite and 'your move' notices are marked read at once", async () => {
    const { A, B } = await twoAgents();
    const step = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step;
    await call("submit_own_date_step", { episode_id: step.episode_id, output: line(0) }, A.ctx);
    expect(await unreadTurnNotices(B.agentId)).toBeGreaterThan(0);
    expect((await call("decline_own_date", { episode_id: step.episode_id }, A.ctx)).structuredContent.declined).toBe(true);
    expect(await unreadTurnNotices(B.agentId)).toBe(0);
  });

  it("finished: a stale 'Your move… N of M lines in' is resolved when the date's recap is saved", async () => {
    const { ctx, agentId, id: a } = await agent("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    let step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const episodeId = step.episode_id;
    let i = 0;
    while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: episodeId, output: line(i++) }, ctx)).structuredContent.step;
    expect(step.stage).toBe("recap");
    // Both agents' notices go, not only the caller's (its own step call already clears its own): one for each.
    for (const who of [agentId, "the-other-agent"]) {
      await t.db.query(`insert into notifications (id, user_id, kind, title, body) values (gen_random_uuid()::text, $1, 'own_date_turn', 'Your move', $2)`, [
        who,
        `Two-agent date ${episodeId}, 10 of 12 lines in.`,
      ]);
    }
    expect(await unreadTurnNotices("the-other-agent")).toBe(1); // still mid-date
    await call("submit_own_date_step", { episode_id: episodeId, output: validEpisodeDraft() }, ctx);
    expect(await unreadTurnNotices(agentId)).toBe(0);
    expect(await unreadTurnNotices("the-other-agent")).toBe(0);
  });

  it("old ones fix themselves when read: resolved, read, and out of the unread count", async () => {
    const { ctx, agentId } = await agent();
    const gone = "00000000-0000-4000-8000-000000000000";
    await t.db.query(`insert into notifications (id, user_id, kind, title, body) values (gen_random_uuid()::text, $1, 'own_date_turn', 'Your move', $2)`, [
      agentId,
      `Two-agent date ${gone}, 10 of 12 lines in.`,
    ]);
    expect(await unreadCount(t.db, agentId)).toBe(0);
    const [n] = await listNotifications(t.db, agentId);
    expect(n).toMatchObject({ kind: "own_date_turn", read: true, resolved: { episode_id: gone, why: "gone" }, body: expect.stringMatching(/^Resolved/) });
    expect((await call("my_notifications", {}, ctx)).structuredContent.notifications[0]).toMatchObject({ resolved: { why: "gone" } });
  });

  it("a notice for a date still waiting on you stays", async () => {
    const { A, B } = await twoAgents();
    const step = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step;
    await call("submit_own_date_step", { episode_id: step.episode_id, output: line(0) }, A.ctx);
    const turn = (await listNotifications(t.db, B.agentId)).find((n) => n.kind === "own_date_turn");
    expect(turn).toMatchObject({ read: false });
    expect(turn?.resolved).toBeUndefined();
  });
});

describe("the one-partner rule is said up front and when it bites (#514)", () => {
  /** X (agent B's, one partner) matched with the visitor's character, then becomes a Dating couple with P. */
  async function setup() {
    const visitor = await agent("Ada Lumen", { open_to_dates: true });
    const B = await agent("Xan Morrow", { open_to_dates: true });
    await call("update_character", { character_id: B.id, partner_style: "one" }, B.ctx);
    const P = await agent("Pell Ortega", { open_to_dates: true });
    const [mlo, mhi] = [visitor.id, B.id].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, agreed_at) values ($1, $2, true, true, now())`, [mlo, mhi]);
    const [lo, hi] = [B.id, P.id].sort();
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, 'dating')`, [lo, hi]);
    await settleCommitment(t.db, lo, hi);
    return { visitor, B, P };
  }

  it("closing tells the match's owner, and my_status shows it closed instead of bookable", async () => {
    const { visitor, B } = await setup();
    const notes = await listNotifications(t.db, visitor.agentId);
    expect(notes.find((n) => n.kind === "match_taken")).toMatchObject({ title: "💍 Xan Morrow is now dating Pell Ortega and closed to other dates" });
    const s = (await call("my_status", {}, visitor.ctx)).structuredContent;
    expect(s.matches_closed).toEqual([expect.objectContaining({ with: B.id, note: expect.stringMatching(/now dating Pell Ortega and closed/) })]);
    expect(s.matches_closed_note).toMatch(/partner_style: "open" and open_to_dates: true/);
    expect((s.dates_to_book ?? []).map((d: Any) => d.with)).not.toContain(B.id);
  });

  it("the owner's own notice says what happened and how to reopen, and the refusals name the fields", async () => {
    const { B } = await setup();
    const own = (await listNotifications(t.db, B.agentId)).find((n) => n.kind === "partner_style");
    expect(own?.body).toMatch(/Dating couple.*go_on_date with anyone else is refused \(open_to_dates: false\).*update_character with partner_style: "open" and open_to_dates: true/);
    const refused = await call("go_on_date", { character_id: B.id, partner_id: HOUSE_PARTNER_ID }, B.ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/with Pell Ortega and wants one partner \(a Dating couple\).*Date Pell, or .*update_character with partner_style: "open" and open_to_dates: true/);
    // The fix works: more than one partner and open again, and it can book.
    expect((await call("update_character", { character_id: B.id, partner_style: "open", open_to_dates: true }, B.ctx)).isError).toBeUndefined();
  });

  it("the quickstart and go_on_date, swipe and answer_match say it", async () => {
    // 2.6.0 (#633): the long instructions are the botchelor://instructions resource; initialize carries a quickstart.
    const guide = ((await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "resources/read", params: { uri: "botchelor://instructions" } }, {}))!.result as Any).contents[0].text;
    expect(guide).toMatch(/One partner: a character that goes exclusive.*partner_style: "open" and open_to_dates: true/);
    for (const name of ["go_on_date", "swipe", "answer_match"]) {
      expect(MCP_TOOLS.find((x) => x.name === name)!.description).toMatch(/exclusive \(one partner[^)]*\) closes.*partner_style:? "open",? (and )?open_to_dates:? true/);
    }
  });
});

describe("plan_second_date's preview has a cost (#536)", () => {
  it("preview and check are the same dry run, with the cost object other previews return", async () => {
    scriptOutcome({
      ending: "second_date",
      sides: [
        { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
        { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
      ],
    });
    const { ctx, id: a } = await agent("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    let step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    let i = 0;
    while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
    await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [step.episode_id]);
    const before = (await t.db.query<{ n: number }>(`select count(*)::int as n from episodes`)).rows[0].n;
    const p = (await call("plan_second_date", { episode_id: step.episode_id, preview: true }, ctx)).structuredContent;
    const c = (await call("plan_second_date", { episode_id: step.episode_id, check: true }, ctx)).structuredContent;
    expect(p).toMatchObject({
      preview: true,
      booked: false,
      second_date: { can_plan: true },
      cost: { spent: "nothing", yours: "nothing", agents_shared_daily: "not counted", would_spend: expect.stringMatching(/shared daily dates/), left: expect.any(Object) },
    });
    expect(c).toEqual(p);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from episodes`)).rows[0].n).toBe(before);
  });
});

describe("wrong argument names get a did-you-mean", () => {
  it("guess → pick and about → with are read as the tool's own names", async () => {
    const { ctx, id } = await agent();
    const r = await call("leave_nudge", { character_id: id, about: HOUSE_PARTNER_ID, note: "bring up the boat" }, ctx);
    // Read as with: it gets as far as the real check (they haven't dated), not "with is required".
    expect(r.content[0].text).toMatch(/haven't been on a date together/);
    expect(r.content[0].text).not.toMatch(/"with" is required|Ignored/);
    const g = await call("guess_dealbreaker", { episode_id: "nope", guess: 2 }, ctx);
    expect(g.content[0].text).not.toMatch(/Ignored: guess/);
  });

  it("an unknown argument close to a real one names it", () => {
    expect(argHints("send_text", ["txt"])).toEqual(['"txt": did you mean "text"?']);
    expect(argHints("start_own_date", ["partner"])).toEqual(['"partner": did you mean "partner_id"?']);
    expect(argHints("send_text", ["zzzzzzzz"])).toEqual([]);
  });
});
