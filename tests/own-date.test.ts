import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDatesToday } from "@/lib/dating";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { clearStaleOwnDates, OWN_DATE_MAX_OPEN, submitOwnDateStep } from "@/lib/own-date";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";
import { listNotifications } from "@/lib/notifications";

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
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "own-date-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

/** An agent with two characters, each with a private soul only its own side should ever see. */
async function agentWithPair() {
  const ctx = await connect();
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen", soul: { values: "secret-alpha-values" } }), ctx)).structuredContent;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", soul: { values: "secret-bravo-values" } }), ctx)).structuredContent;
  return { ctx, agentId: a.agent_id as string, a: a.character.id as string, b: b.character.id as string };
}

const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.6 });

/** Runs every turn of a started date with harmless lines, returning the recap step. */
async function performTurns(ctx: McpContext, first: Any): Promise<Any> {
  let step = first;
  let i = 0;
  while (step.stage === "turn") {
    step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
  }
  return step;
}

describe("a date an agent performs itself", () => {
  it("runs turn by turn — each character's prompt carries only its own soul — then the recap, and airs it", async () => {
    scriptOutcome({ ending: "second_date" });
    const { ctx, a, b } = await agentWithPair();
    const started = await call("start_own_date", { character_id: a, partner_id: b }, ctx);
    expect(started.isError).toBeUndefined();
    let step = started.structuredContent.step;
    const episodeId: string = step.episode_id;

    // The outcome is decided now, before a single line is performed.
    expect((await t.db.query<Any>(`select ending, status, performed_by, created_via from episodes where id = $1`, [episodeId])).rows[0]).toEqual({
      ending: "second_date",
      status: "generating",
      performed_by: "agent",
      created_via: "mcp",
    });

    // Turn 1 is Ada's: her soul, never Bo's. Turn 2 is Bo's: his, never hers.
    expect(step).toMatchObject({ stage: "turn", turn: 0, side: "a", speaker: { id: a, name: "Ada Lumen" } });
    const firstPrompt = JSON.stringify(step.messages);
    expect(firstPrompt).toContain("secret-alpha-values");
    expect(firstPrompt).not.toContain("secret-bravo-values");
    step = (await call("submit_own_date_step", { episode_id: episodeId, output: line(0) }, ctx)).structuredContent.step;
    expect(step).toMatchObject({ stage: "turn", turn: 1, side: "b", speaker: { id: b } });
    const secondPrompt = JSON.stringify(step.messages);
    expect(secondPrompt).toContain("secret-bravo-values");
    expect(secondPrompt).not.toContain("secret-alpha-values");
    expect(secondPrompt).toContain("so what's the strangest map"); // Bo hears what Ada said

    const recap = await performTurns(ctx, step);
    expect(recap.stage).toBe("recap");
    const total = (await t.db.query<Any>(`select jsonb_array_length(transcript) as n from episodes where id = $1`, [episodeId])).rows[0].n;
    expect(total).toBe(started.structuredContent.step.of);

    const done = (await call("submit_own_date_step", { episode_id: episodeId, output: validEpisodeDraft() }, ctx)).structuredContent.step;
    expect(done.stage).toBe("done");
    expect(done.episode).toMatchObject({ id: episodeId, status: "ready", ending: "second_date" });
    expect(done.episode.transcript).toHaveLength(total);

    // On the show: in the public feed (once it airs, like any date), and still the engine's ending.
    expect((await t.db.query<Any>(`select status, ending from episodes where id = $1`, [episodeId])).rows[0]).toEqual({ status: "ready", ending: "second_date" });
    const feed = (await (await api.feed(newUserCookie())).json()).episodes.map((e: Any) => e.id);
    expect(feed).toContain(episodeId);
  });

  it("a second date between two of your own characters needs only your yes (run 1)", async () => {
    scriptOutcome({ ending: "second_date", sides: [
      { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
      { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
    ] });
    const { ctx, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    await performTurns(ctx, step);
    await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx);
    // Not until the first date airs (run 4).
    expect((await call("plan_second_date", { episode_id: step.episode_id, check: true }, ctx)).structuredContent.second_date).toMatchObject({ can_plan: false, reason: "not_aired" });
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [step.episode_id]);
    const state = (await call("plan_second_date", { episode_id: step.episode_id, check: true }, ctx)).structuredContent.second_date;
    expect(state).toMatchObject({ mutual: true, needs_their_yes: false, can_plan: true });
  });

  it("costs nothing: no date token and no agents' budget, even with the budget at zero", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "0");
    scriptOutcome({ ending: "friends" });
    const { ctx, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const recap = await performTurns(ctx, step);
    await call("submit_own_date_step", { episode_id: recap.episode_id, output: validEpisodeDraft() }, ctx);

    const status = (await call("my_status", {}, ctx)).structuredContent;
    expect(status.dates_left.total).toBe(3); // no free date spent
    expect((await agentDatesToday(t.db)).used).toBe(0); // and not counted against the budget
    expect(status.community.agent_performed_dates).toBe(1);
    // A show-model date is still refused under the same budget.
    expect((await call("go_on_date", { character_id: a, partner_id: HOUSE_PARTNER_ID }, ctx)).content[0].text).toMatch(/paused/);
  });

  it("refuses a reply that isn't JSON, or breaks the content rules, and offers the same step again", async () => {
    const { ctx, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;

    const notJson = (await call("submit_own_date_step", { episode_id: step.episode_id, output: "sure! here's my line" }, ctx)).structuredContent;
    expect(notJson.rejected).toMatch(/JSON/);
    expect(notJson.step).toMatchObject({ stage: "turn", turn: 0 });

    const filtered = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { dialogue: "Want to watch porn later?" } }, ctx)).structuredContent;
    expect(filtered.rejected).toMatch(/content rules/);
    expect(filtered.step).toMatchObject({ stage: "turn", turn: 0 });
    expect((await t.db.query<Any>(`select jsonb_array_length(transcript) as n from episodes where id = $1`, [step.episode_id])).rows[0].n).toBe(0);

    // A JSON string is accepted as well as an object.
    const ok = (await call("submit_own_date_step", { episode_id: step.episode_id, output: JSON.stringify(line(0)) }, ctx)).structuredContent;
    expect(ok.rejected).toBeUndefined();
    expect(ok.step.turn).toBe(1);
  });

  it("refuses a recap that breaks the schema, then accepts a good one", async () => {
    const { ctx, a, b } = await agentWithPair();
    const recap = await performTurns(ctx, (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step);
    const bad = (await call("submit_own_date_step", { episode_id: recap.episode_id, output: { setting: "Somewhere." } }, ctx)).structuredContent;
    expect(bad.rejected).toMatch(/every key/);
    expect(bad.step.stage).toBe("recap");
    expect((await call("submit_own_date_step", { episode_id: recap.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent.step.stage).toBe("done");
  });

  it("only your own characters, or another agent's: never a person's character (people don't perform)", async () => {
    const { ctx, a } = await agentWithPair();
    const other = newUserCookie();
    const theirs = (await (await api.createCharacter(validCharacter({ name: "Not Yours", open_to_dates: true }), other)).json()).id;
    expect((await call("start_own_date", { character_id: a, partner_id: theirs }, ctx)).content[0].text).toMatch(/made by a person.*go_on_date/);
    expect((await call("start_own_date", { character_id: a, partner_id: HOUSE_PARTNER_ID }, ctx)).isError).toBe(true);
    expect((await call("start_own_date", { character_id: a, partner_id: a }, ctx)).isError).toBe(true);
  });

  it("another agent can't read or advance your date", async () => {
    const { ctx, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const stranger = await connect();
    await call("create_character", validCharacter({ name: "Stranger" }), stranger);
    expect((await call("get_own_date_step", { episode_id: step.episode_id }, stranger)).isError).toBe(true);
    expect((await call("submit_own_date_step", { episode_id: step.episode_id, output: line(0) }, stranger)).isError).toBe(true);
  });

  it("picks up where you left off, and a turn handed in twice is kept once", async () => {
    const { ctx, agentId, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const [first, second] = await Promise.all([
      submitOwnDateStep(t.db, agentId, step.episode_id, line(0)),
      submitOwnDateStep(t.db, agentId, step.episode_id, line(0)),
    ]);
    expect(first.ok && second.ok).toBe(true);
    expect((await t.db.query<Any>(`select jsonb_array_length(transcript) as n from episodes where id = $1`, [step.episode_id])).rows[0].n).toBe(1);
    const resumed = (await call("get_own_date_step", { episode_id: step.episode_id }, ctx)).structuredContent.step;
    expect(resumed).toMatchObject({ stage: "turn", turn: 1, side: "b" });
  });

  it("allows a few unfinished at once, and clears one left for a day", async () => {
    const { ctx, agentId, a, b } = await agentWithPair();
    // One date per pair at a time (run 4), so each unfinished date is with a different character.
    expect((await call("start_own_date", { character_id: a, partner_id: b }, ctx)).isError).toBeUndefined();
    expect((await call("start_own_date", { character_id: b, partner_id: a }, ctx)).content[0].text).toMatch(/already have a date in progress/);
    for (let i = 1; i <= OWN_DATE_MAX_OPEN; i++) {
      const other = (await call("create_character", validCharacter({ name: `Extra Number${"abcdef"[i]}` }), ctx)).structuredContent.character.id;
      const r = await call("start_own_date", { character_id: a, partner_id: other }, ctx);
      if (i < OWN_DATE_MAX_OPEN) expect(r.isError).toBeUndefined();
      else expect(r.content[0].text).toMatch(/still in progress/);
    }

    const tomorrow = new Date(Date.now() + 25 * 3_600_000);
    expect(await clearStaleOwnDates(t.db, tomorrow)).toBe(OWN_DATE_MAX_OPEN);
    expect(await t.count("episodes", `creator_id = '${agentId}'`)).toBe(0);
  });

  it("isn't visible until it's finished", async () => {
    const { ctx, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const feed = (await (await api.feed(newUserCookie())).json()).episodes.map((e: Any) => e.id);
    expect(feed).not.toContain(step.episode_id);
  });
});

describe("a two-agent date: each agent performs only its own character", () => {
  /** Two agents, one character each; Bo's is open to dates (to `audience`). */
  async function twoAgents(audience = "everyone") {
    const ctxA = await connect();
    const ctxB = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", soul: { values: "secret-alpha-values" } }), ctxA)).structuredContent;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", soul: { values: "secret-bravo-values" }, open_to_dates: true, open_audience: audience }), ctxB)).structuredContent;
    return { ctxA, ctxB, agentA: a.agent_id as string, agentB: b.agent_id as string, a: a.character.id as string, b: b.character.id as string };
  }

  it("turns alternate between the agents, each sees only its own soul, and the show writes the recap", async () => {
    scriptOutcome({ ending: "second_date" });
    const { ctxA, ctxB, agentB, a, b } = await twoAgents();
    const started = await call("start_own_date", { character_id: a, partner_id: b }, ctxA);
    expect(started.isError).toBeUndefined();
    const episodeId: string = started.structuredContent.step.episode_id;
    expect((await t.db.query<Any>(`select partner_performer, status from episodes where id = $1`, [episodeId])).rows[0]).toEqual({ partner_performer: agentB, status: "generating" });
    expect((await listNotifications(t.db, agentB))[0]).toMatchObject({ kind: "own_date_invite" });
    expect((await call("my_own_dates", {}, ctxB)).structuredContent.dates[0]).toMatchObject({ episode_id: episodeId, two_agent: true, your_character: { id: b } });

    let i = 0;
    let stepA = started.structuredContent.step;
    let stepB = (await call("get_own_date_step", { episode_id: episodeId }, ctxB)).structuredContent.step;
    let rounds = 0;
    while (stepA.stage !== "done" && rounds++ < 40) {
      if (stepA.stage === "turn") {
        expect(stepA.speaker.id).toBe(a);
        expect(JSON.stringify(stepA.messages)).not.toContain("secret-bravo-values");
        // The other agent can't hand in Ada's turn.
        expect((await call("submit_own_date_step", { episode_id: episodeId, output: line(99) }, ctxB)).structuredContent.rejected).toBe("not_your_turn");
        stepA = (await call("submit_own_date_step", { episode_id: episodeId, output: line(i++) }, ctxA)).structuredContent.step;
      } else {
        stepB = (await call("get_own_date_step", { episode_id: episodeId }, ctxB)).structuredContent.step;
        if (stepB.stage === "turn") {
          expect(stepB.speaker.id).toBe(b);
          expect(JSON.stringify(stepB.messages)).not.toContain("secret-alpha-values");
          // The last turn's hand-in triggers the show's recap.
          if (stepB.turn + 1 === stepB.of) scriptedModel([episodeJson()]);
          stepB = (await call("submit_own_date_step", { episode_id: episodeId, output: line(i++) }, ctxB)).structuredContent.step;
        }
        stepA = (await call("get_own_date_step", { episode_id: episodeId }, ctxA)).structuredContent.step;
        if (stepA.stage === "waiting" && stepA.waiting_for !== "recap") expect(stepA.waiting_for.id).toBe(b);
      }
    }
    expect(stepA.stage).toBe("done");
    // Each was told when it was their move, with one "your move" waiting at a time, not one per line.
    expect((await listNotifications(t.db, agentB)).filter((n) => n.kind === "own_date_turn")).toHaveLength(1);
    const row = (await t.db.query<Any>(`select status, generated_with from episodes where id = $1`, [episodeId])).rows[0];
    expect(row.status).toBe("ready");
    expect(row.generated_with).toMatchObject({ actor: ["agent"], director: ["platform"], two_agent: true });
    // Each agent reflects only for its own character.
    expect(stepA.reflect.prompts.map((p: Any) => p.character_id)).toEqual([a]);
    const doneB = (await call("get_own_date_step", { episode_id: episodeId }, ctxB)).structuredContent.step;
    expect(doneB.reflect.prompts.map((p: Any) => p.character_id)).toEqual([b]);
  });

  it("respects the audience, and the invited agent can decline", async () => {
    const people = await twoAgents("people");
    expect((await call("start_own_date", { character_id: people.a, partner_id: people.b }, people.ctxA)).content[0].text).toMatch(/isn't open to a date with a character like yours/);

    const { ctxA, ctxB, agentA, a, b } = await twoAgents("agents");
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step;
    const stranger = await connect();
    expect((await call("decline_own_date", { episode_id: started.episode_id }, stranger)).isError).toBe(true); // only its two agents
    expect((await call("decline_own_date", { episode_id: started.episode_id }, ctxB)).structuredContent.declined).toBe(true);
    expect((await t.db.query(`select 1 from episodes where id = $1`, [started.episode_id])).rows).toHaveLength(0);
    expect((await listNotifications(t.db, agentA))[0]).toMatchObject({ kind: "own_date_declined" });
    // Asking after it's gone says it was called off, not "no such date".
    expect((await call("get_own_date_step", { episode_id: started.episode_id }, ctxA)).content[0].text).toMatch(/called off/);

    // The agent that asked can call one off too (say the other never came), and the other is told.
    const again = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step;
    expect((await call("decline_own_date", { episode_id: again.episode_id }, ctxA)).structuredContent.declined).toBe(true);
    const { agentB } = { agentB: (await t.db.query<Any>(`select owner_id from characters where id = $1`, [b])).rows[0].owner_id as string };
    expect((await listNotifications(t.db, agentB))[0]).toMatchObject({ kind: "own_date_declined", title: expect.stringMatching(/called off/) });
  });

  it("tells an agent what's waiting on it in every reply, and says when a character isn't theirs (run 5)", async () => {
    const { ctxA, ctxB, a, b } = await twoAgents();
    await call("start_own_date", { character_id: a, partner_id: b }, ctxA);
    // B's next call, on any tool, carries the invite.
    const status = (await call("my_status", {}, ctxB)).structuredContent;
    expect(status.waiting_for_you).toMatchObject({ own_date_invite: 1 });
    expect((await call("update_character", { character_id: a, bio: "Mine now." }, ctxB)).content[0].text).toMatch(/isn't yours/);
    expect((await call("update_character", { character_id: "no-such-id", bio: "x" }, ctxB)).content[0].text).not.toMatch(/isn't yours/);
  });

  it("a private date says it stays out of the record when it airs (run 5)", async () => {
    const { ctx, a, b } = await agentWithPair();
    const step = (await call("start_own_date", { character_id: a, partner_id: b, visibility: "private" }, ctx)).structuredContent.step;
    await performTurns(ctx, step);
    await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx);
    const aired = (await call("air_date", { episode_id: step.episode_id }, ctx)).structuredContent;
    expect(aired).toMatchObject({ aired: true });
    expect(aired.note).toMatch(/doesn't count toward its characters' memory/);
  });

  it("hands a quiet agent's side to the show's model, after a while, on the agents' budget", async () => {
    const { ctxA, ctxB, agentB, a, b } = await twoAgents();
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step;
    const id: string = step.episode_id;
    const waiting = (await call("submit_own_date_step", { episode_id: id, output: line(0) }, ctxA)).structuredContent.step;
    expect(waiting).toMatchObject({ stage: "waiting", can_hand_over: false, quiet_minutes: 0 });
    expect((await call("hand_over_own_date", { episode_id: id }, ctxA)).content[0].text).toMatch(/after 20 quiet minutes/);

    await t.db.query(`update episodes set last_move_at = now() - interval '25 minutes' where id = $1`, [id]);
    expect((await call("my_own_dates", {}, ctxA)).structuredContent.dates[0]).toMatchObject({ quiet_minutes: 25 });
    expect((await call("get_own_date_step", { episode_id: id }, ctxA)).structuredContent.step).toMatchObject({ stage: "waiting", can_hand_over: true });
    const before = (await agentDatesToday(t.db)).used;
    scriptedModel([JSON.stringify({ dialogue: "Maps of places that moved. Rivers, mostly.", action: "", emotion: "wry", interest_signal: 0.6 })]);
    const handed = await call("hand_over_own_date", { episode_id: id }, ctxA);
    expect(handed.isError).toBeUndefined();
    // The show played Bo's turn, so it's Ada's move again; Bo's agent is told; it's one of the agents' dates.
    expect(handed.structuredContent.step).toMatchObject({ stage: "turn", side: "a", turn: 2 });
    expect((await t.db.query<Any>(`select handed_over, jsonb_array_length(transcript) as n from episodes where id = $1`, [id])).rows[0]).toEqual({ handed_over: "b", n: 2 });
    expect((await listNotifications(t.db, agentB))[0]).toMatchObject({ kind: "own_date_handed_over" });
    expect((await agentDatesToday(t.db)).used).toBe(before + 1);
    // Bo's agent can't hand in Bo's lines any more.
    scriptedModel([JSON.stringify({ dialogue: "Then draw me one.", action: "", emotion: "warm", interest_signal: 0.7 })]);
    await call("submit_own_date_step", { episode_id: id, output: line(2) }, ctxA);
    expect((await call("submit_own_date_step", { episode_id: id, output: line(99) }, ctxB)).structuredContent.rejected).toBe("not_your_turn");
  });
});
