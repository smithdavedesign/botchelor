import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { AGENT_REUSE_MINUTES, handleMcpMessage, MCP_SERVER_INFO, stepTop, TOOL_COSTS, type McpContext } from "@/lib/mcp";
import { checkShowText } from "@/lib/safety";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// One PR for seven agent-feedback issues (David's calls, 2026-10-21): #563 booking notices, #474 innuendo on agents' own
// lines, #467 autoplay's cost said truthfully, #465 no double booking, #437 one agent_id per probing client, #559 flat
// own-date replies, #443 "Liked you" on deck cards.
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
  setEmailSenderForTests(null);
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (method: string, params: Record<string, unknown>, ctx: McpContext) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(client = "botchelor-batch-test", extra: McpContext = {}): Promise<McpContext & { agentId?: string }> {
  const ctx: McpContext = { ...extra };
  const r = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx)) as Any;
  return { sessionId: ctx.issuedSessionId, agentId: r.result._meta?.agent_id };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string };
}
const line = { dialogue: "So, what's the strangest map you've drawn?", action: "", emotion: "curious", interest_signal: 0.6 };
const turnJson = (i: number) => JSON.stringify({ dialogue: `Line ${i}: tell me something true about the sea, and something false.`, action: "", emotion: "warm", interest_signal: 0.6 });

describe("#563: an owner hears when someone else books a date with their character, private ones included", () => {
  function fakeEmail() {
    const sent: EmailMessage[] = [];
    vi.stubEnv("RESEND_API_KEY", "re_test_not_a_real_key");
    vi.stubEnv("SESSION_SECRET", ["batch", "test", "secret", "0123456789abcdef"].join("-"));
    setEmailSenderForTests(async (msg) => {
      sent.push(msg);
    });
    return sent;
  }

  it("a private go_on_date: an in-app notice (inbox and my_notifications) and an email to a verified address, never to the booker", async () => {
    const sent = fakeEmail();
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, 'bo-owner@example.test', 'on', now())`, [B.agentId]);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = await call("go_on_date", { character_id: A.id, partner_id: B.id, visibility: "private" }, A.ctx);
    expect(booked.isError).toBeUndefined();
    const episodeId: string = booked.structuredContent.episode.id;

    // (notifications isn't cleared between tests, so every query here is about this test's agents)
    const notices = (await t.db.query<Any>(`select user_id, kind, title, body, link from notifications where kind = 'date_booked_with_yours' and user_id = any($1)`, [[A.agentId, B.agentId]])).rows;
    expect(notices).toHaveLength(1);
    const n = notices[0];
    expect(n.user_id).toBe(B.agentId);
    expect(n.title).toMatch(/Ada booked a private date with Bo/);
    expect(n.body).toMatch(/Booked by Ada Lumen's creator \(an agent\), with your Bo Quill\./);
    expect(n.body).toMatch(/private: it never airs, and only its two owners can open it, you included/);
    expect(n.link).toBe(`/episodes/${episodeId}`);

    // Over MCP too, and the owner can open the private date it points at.
    const mine = (await call("my_notifications", {}, B.ctx)).structuredContent;
    expect(mine.notifications.find((x: Any) => x.kind === "date_booked_with_yours")).toMatchObject({ link: `/episodes/${episodeId}` });
    const opened = await call("get_episode", { episode_id: episodeId }, B.ctx);
    expect(opened.isError).toBeUndefined();

    // One email, to the owner's verified address, with the link and the one-click way out.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("bo-owner@example.test");
    expect(sent[0].text).toContain(`/episodes/${episodeId}`);
    expect(sent[0].headers["List-Unsubscribe"]).toMatch(/optout/);
    // The booker hears nothing of their own booking.
    expect((await t.db.query(`select 1 from notifications where user_id = $1 and kind = 'date_booked_with_yours'`, [A.agentId])).rows).toHaveLength(0);
  });

  it("no email without a verified address (pending) or after unsubscribing; the in-app notice still comes", async () => {
    const sent = fakeEmail();
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    const C = await agentWith("Cy Marr");
    await t.db.query(`insert into email_prefs (user_id, email, status) values ($1, 'bo@example.test', 'pending'), ($2, 'cy@example.test', 'off')`, [B.agentId, C.agentId]);
    for (const partner of [B.id, C.id]) {
      scriptOutcome({ ending: "friends" });
      scriptedModel([episodeJson()]);
      expect((await call("go_on_date", { character_id: A.id, partner_id: partner }, A.ctx)).isError).toBeUndefined();
    }
    expect(sent).toHaveLength(0);
    const kinds = (await t.db.query<Any>(`select user_id, title from notifications where kind = 'date_booked_with_yours' and user_id = any($1) order by created_at`, [[A.agentId, B.agentId, C.agentId]])).rows;
    expect(kinds.map((k: Any) => k.user_id)).toEqual([B.agentId, C.agentId]);
    expect(kinds[0].title).toMatch(/Ada booked a date with Bo/);
  });

  it("a house character has no owner to tell", async () => {
    fakeEmail();
    const A = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await call("go_on_date", { character_id: A.id, partner_id: HOUSE_PARTNER_ID }, A.ctx)).isError).toBeUndefined();
    const before = (await t.db.query<Any>(`select count(*)::int as n from notifications where kind = 'date_booked_with_yours'`)).rows[0].n;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await call("go_on_date", { character_id: A.id, partner_id: "house-juniper" }, A.ctx)).isError).toBeUndefined();
    expect((await t.db.query<Any>(`select count(*)::int as n from notifications where kind = 'date_booked_with_yours'`)).rows[0].n).toBe(before);
  });

  it("a two-agent private own date: the invite says it's private, links to the date and is emailed at once", async () => {
    const sent = fakeEmail();
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, 'bo-owner@example.test', 'on', now())`, [B.agentId]);
    const started = await call("start_own_date", { character_id: A.id, partner_id: B.id, visibility: "private" }, A.ctx);
    expect(started.isError).toBeUndefined();
    const invite = (await t.db.query<Any>(`select user_id, title, link from notifications where kind = 'own_date_invite' and user_id = $1`, [B.agentId])).rows[0];
    expect(invite.user_id).toBe(B.agentId);
    expect(invite.title).toMatch(/private: it never airs; you can still open it/);
    expect(invite.link).toBe(`/episodes/${started.structuredContent.episode_id}`);
    expect(sent.map((m) => m.to)).toEqual(["bo-owner@example.test"]);
  });
});

describe("#474: an agent's own lines pass the show's no-innuendo rule, deterministically", () => {
  it("the content check catches stock innuendo and lets ordinary lines through", () => {
    const barometer = "Is that the barometer in your pocket or are you just pleased to see the weather?";
    expect(checkShowText({ dialogue: barometer })).toEqual({ ok: false, reason: "innuendo", field: "dialogue" });
    expect(checkShowText({ dialogue: "Well, that's what she said." })).toMatchObject({ ok: false, reason: "innuendo" });
    expect(checkShowText({ dialogue: "Netflix and chill, then?" })).toMatchObject({ ok: false, reason: "innuendo" });
    for (const fine of ["I got lucky with the weather today.", "My place has a view of the harbour.", "Is that a map in your bag?", "She said that's what the tide does."]) {
      expect(checkShowText({ dialogue: fine })).toEqual({ ok: true });
    }
  });

  it("submit_own_date_step refuses it with the filtered refusal and says which rule (check_only too), and a clean line goes in", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    const episode_id = started.step.episode_id;
    const bad = { ...line, dialogue: "Is that the barometer in your pocket or are you just pleased to see the weather?" };
    const checked = (await call("submit_own_date_step", { episode_id, output: bad, check_only: true }, ctx)).structuredContent;
    expect(checked).toMatchObject({ accepted: false, ok: false });
    const refused = (await call("submit_own_date_step", { episode_id, output: bad }, ctx)).structuredContent;
    expect(refused).toMatchObject({ accepted: false, ok: false });
    expect(refused.rejected).toMatch(/^That line broke the show's content rules: it's innuendo/);
    expect(refused.message).toMatch(/innuendo/);
    expect(refused.step.turn_number).toBe(1); // the same step comes back
    const ok = (await call("submit_own_date_step", { episode_id, output: line }, ctx)).structuredContent;
    expect(ok.accepted).toBe(true);
  });
});

describe("#467: autoplay_own_date says up front, and in its cost, that it's one of today's show-model dates", () => {
  it("the cost line, the quickstart and start_own_date say so", async () => {
    // 2.13.0 (the 2026-10-23-2135 run): both say what the shared daily dates are, the same way.
    expect(TOOL_COSTS.autoplay_own_date).toMatch(/^Uses one of the agents' shared daily dates \(the show's model writes it; once a date\), never your weekly dates or tokens/);
    expect(TOOL_COSTS.start_own_date).toMatch(/^Free while you write the lines: no weekly date, token or shared daily date \(those count what the show's model writes, as autoplay_own_date does\)/);
    // 2.6.0 (#633): the long instructions are the botchelor://instructions resource; initialize carries a quickstart.
    const text: string = ((await rpc("resources/read", { uri: "botchelor://instructions" }, {})) as Any).result.contents[0].text;
    expect(text).toMatch(/your own lines are free and unlimited; autoplay_own_date isn't: it uses the show's model and counts as one of today's show-model dates/);
    expect(text).not.toMatch(/\(free and unlimited while you write the lines;/);
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    expect(started.how_long_tip).toMatch(/counts as one of today's show-model dates/);
    expect(started.cost).toMatchObject({ spent: "nothing", agents_shared_daily: "not counted" });
  });

  it("its result's cost reports the shared daily date it counted, and the show's model, truthfully", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    await call("submit_own_date_step", { episode_id: started.step.episode_id, output: line }, ctx);
    const preview = (await call("autoplay_own_date", { episode_id: started.step.episode_id, preview: true }, ctx)).structuredContent;
    expect(preview.cost).toMatchObject({ spent: "nothing", model: "the show's model", would_spend: expect.stringMatching(/shared daily dates/) });
    scriptedModel([...Array.from({ length: 5 }, (_, i) => turnJson(i)), episodeJson()]);
    const r = (await call("autoplay_own_date", { episode_id: started.step.episode_id }, ctx)).structuredContent;
    expect(r.cost).toMatchObject({ spent: "1 of the agents' shared daily dates", yours: "nothing", agents_shared_daily: "counted one", model: "the show's model", counts_as: "one of today's show-model dates" });
    expect(r.budget).toMatch(/^Counted now as one of today's show-model dates \(autoplay uses the show's model, not yours\): 1 of \d+ used today/);
  });
});

describe("#465: go_on_date won't book a pair twice", () => {
  it("refuses while a show-model date of theirs is still being written, even with again: true, naming it; its preview warns", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const first = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent;
    const episodeId: string = first.episode.id;
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [episodeId]); // still being written
    const again = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, again: true }, ctx);
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toContain(episodeId);
    expect(again.content[0].text).toMatch(/still writing.*get_episode/);
    expect(again.structuredContent).toMatchObject({ code: "already_booked", episode_id: episodeId });
    const preview = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(preview.can_book).toBe(false);
    expect(preview.problems.join(" ")).toContain(episodeId);
    expect(await t.count("episodes")).toBe(1);
  });

  it("refuses while a proposal you sent is unanswered, naming it and where the answer comes", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill", { open_to_dates: false });
    const proposalId = crypto.randomUUID();
    await t.db.query(`insert into date_proposals (id, from_user, from_character, to_character, to_user) values ($1, $2, $3, $4, $5)`, [proposalId, A.agentId, A.id, B.id, B.agentId]);
    const r = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(proposalId);
    expect(r.content[0].text).toMatch(/my_notifications tells you when they do/);
    expect(r.structuredContent).toMatchObject({ proposal_id: proposalId });
    expect(await t.count("episodes")).toBe(0);
  });

  it("refuses while a second date you said yes to waits on the other creator, pointing at plan_second_date", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const first = (await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    const episodeId: string = first.episode.id;
    await t.db.query(`insert into second_date_requests (episode_id, user_id) values ($1, $2)`, [episodeId, A.agentId]);
    const r = await call("go_on_date", { character_id: A.id, partner_id: B.id, again: true }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(episodeId);
    expect(r.content[0].text).toMatch(/plan_second_date/);
    expect(await t.count("episodes")).toBe(1);
  });
});

describe("#437: a probe initialize doesn't orphan an agent_id", () => {
  const probe = { userAgent: "someones-agent/1.0", visitor: "visitor-hash-1" };

  it("never for our own traffic: the loop's side-by-side visitors stay separate identities", async () => {
    const ours = { userAgent: "claude-cli/2.1 (Claude)", visitor: "visitor-hash-ours" };
    const first = await connect("claude-code", ours);
    const second = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } }, { ...ours })) as Any;
    expect(second.result._meta.agent_id).not.toBe(first.agentId);
    expect(second.result._meta.agent_id_reused).toBeUndefined();
  });

  it("the same client within the window gets the same agent_id back while it hasn't written anything", async () => {
    expect(AGENT_REUSE_MINUTES).toBe(10);
    const first = await connect("probe-client", probe);
    const second = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "probe-client" } }, { ...probe })) as Any;
    expect(second.result._meta.agent_id).toBe(first.agentId);
    expect(second.result._meta.agent_id_reused).toBe(true);
    // A read doesn't count as writing.
    await call("list_cast", {}, { sessionId: first.sessionId });
    expect((await connect("probe-client", probe)).agentId).toBe(first.agentId);
  });

  it("never hands out an identity that has written, nor across clients, addresses or the window", async () => {
    const first = await connect("probe-client", probe);
    const made = await call("create_character", validCharacter({ name: "Ada Lumen" }), { sessionId: first.sessionId });
    expect(made.isError).toBeUndefined();
    expect((await connect("probe-client", probe)).agentId).not.toBe(first.agentId);

    const lone = await connect("other-client", probe);
    expect((await connect("another-client", probe)).agentId).not.toBe(lone.agentId);
    expect((await connect("other-client", { ...probe, visitor: "visitor-hash-2" })).agentId).not.toBe(lone.agentId);
    expect((await connect("other-client", { userAgent: probe.userAgent })).agentId).not.toBe(lone.agentId); // no address: no reuse
    await t.db.query(`update mcp_sessions set created_at = now() - interval '11 minutes'`);
    expect((await connect("other-client", probe)).agentId).not.toBe(lone.agentId);
  });
});

describe("#559: the own-date tools answer flat, with step kept", () => {
  it("start, submit and get carry stage, episode_id, turn_number, of, your_move, whose_move and summary at the top level", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    expect(started).toMatchObject({ stage: "turn", episode_id: started.step.episode_id, turn_number: 1, of: started.step.of, your_move: true, whose_move: started.step.speaker.name });
    expect(started.summary).toMatch(/^Your move: turn 1 of \d+/);
    expect(started.step.stage).toBe("turn"); // still there, whole
    const next = (await call("submit_own_date_step", { episode_id: started.episode_id, output: line }, ctx)).structuredContent;
    expect(next).toMatchObject({ accepted: true, stage: "turn", turn_number: 2, episode_id: started.episode_id, your_move: true });
    const read = (await call("get_own_date_step", { episode_id: started.episode_id }, ctx)).structuredContent;
    expect(read).toMatchObject({ stage: "turn", turn_number: 2, of: started.of });
    expect(read.step.turn_number).toBe(2);
  });

  it("a waiting or finished step says whose move it is", () => {
    expect(stepTop({ stage: "waiting", episode_id: "e1", turn_number: 3, of: 12, waiting_for: { id: "c", name: "Bo Quill" }, instructions: "" })).toMatchObject({
      stage: "waiting",
      episode_id: "e1",
      turn_number: 3,
      of: 12,
      your_move: false,
      whose_move: "Bo Quill",
    });
    expect(stepTop({ stage: "done", episode_id: "e1", episode: null })).toMatchObject({ stage: "done", your_move: false, whose_move: null });
  });

  it("is in a patch release", () => {
    // 2.4.6 at the time; 2.5.0 (the 2026-10-21-2300 run) and later keep it.
    expect(MCP_SERVER_INFO.version.localeCompare("2.4.6", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
  });
});

describe("#443: deck cards say who already liked yours, as a flag only", () => {
  it("swipe_deck marks the card liked_you, and nothing lists the likers", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    await agentWith("Cy Marr");
    expect((await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx)).isError).toBeUndefined();
    const deck = (await call("swipe_deck", { character_id: A.id }, A.ctx)).structuredContent;
    const bo = deck.cards.find((c: Any) => c.id === B.id);
    expect(bo.liked_you).toBe(true);
    expect(deck.cards.filter((c: Any) => c.id !== B.id).every((c: Any) => c.liked_you === false)).toBe(true);
    expect(deck.note).toMatch(/liked_you: true means that character already liked yours/);
    // compact keeps the flag.
    const compact = (await call("swipe_deck", { character_id: A.id, compact: true }, A.ctx)).structuredContent;
    expect(compact.cards.find((c: Any) => c.id === B.id).liked_you).toBe(true);
    // my_status still counts them, never names them.
    const status = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(status.swipes.liked_you).toBe(1);
    expect(JSON.stringify(status.swipes)).not.toContain("Bo Quill");
  });
});
