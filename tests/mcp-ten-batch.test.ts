import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, HOUSE_BOT_LABEL, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { agentDatesToday } from "@/lib/dating";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 10/10 batch (2026-10-21): what both simulated visitors listed for a 10 in the last two runs. Previews that don't
// run (#485, #490), cost on every spending tool (#485, #498), house-run bots labelled as such (#489, #486, #457), what
// get_episode returns (#481), and leaner own-date steps. Enums and costs: tests/mcp-schemas.test.ts; the tool list:
// tests/mcp-hints.test.ts.
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
async function connect(client = "ten-batch-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: client } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn, honestly?`, action: "", emotion: "curious", interest_signal: 0.6 });
const turnJson = (i: number) => JSON.stringify({ dialogue: `Show line ${i}: tell me something true about the sea, and something false.`, action: "", emotion: "warm", interest_signal: 0.6 });
const episodes = async () => (await t.db.query<{ n: number }>(`select count(*)::int as n from episodes`)).rows[0].n;

async function twoOfMine() {
  const ctx = await connect();
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
  return { ctx, a, b };
}
/** A visitor, a house-run bot (the loop's client name) and a live agent, each with a character open to dates. */
async function cast() {
  const bot = await connect("botchelor-loop-swipe-back");
  const ines = (await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, open_to_dates: true, extras: PROFILE }), bot)).structuredContent.character.id;
  const live = await connect("lanternfish");
  const tobiah = (await call("create_character", validCharacter({ name: "Tobiah Ferreira", keep_name: true, open_to_dates: true, extras: PROFILE }), live)).structuredContent.character.id;
  const me = await connect("visitor");
  const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), me)).structuredContent.character.id;
  return { bot, ines, live, tobiah, me, mine };
}

describe("previews that start and spend nothing (#490, #485)", () => {
  it("start_own_date with preview: true starts nothing, and says who plays the other side, the length, visibility and cost", async () => {
    const { ctx, a, b } = await twoOfMine();
    const p = await call("start_own_date", { character_id: a, partner_id: b, preview: true }, ctx);
    expect(p.isError).toBeUndefined();
    expect(p.structuredContent).toMatchObject({
      preview: true,
      started: false,
      kind: "your_own_two",
      visibility: "public",
      format: { id: "classic", lines: expect.any(Number) },
      cost: { spent: "nothing", agents_shared_daily: "not counted" },
    });
    expect(p.structuredContent.warning).toBeUndefined();
    expect(await episodes()).toBe(0);
    // The same checks a start makes: a house character is refused, and nothing is written.
    expect((await call("start_own_date", { character_id: a, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).content[0].text).toMatch(/house characters/);
    // And a real start says it cost nothing.
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    expect(started.cost).toMatchObject({ spent: "nothing", yours: "nothing" });
    expect(started.compact_note).toMatch(/short reminder/);
  });

  it("autoplay_own_date with preview: true plays nothing and counts nothing; the real one says what it spent", async () => {
    const { ctx, a, b } = await twoOfMine();
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    const p = (await call("autoplay_own_date", { episode_id: id, preview: true }, ctx)).structuredContent;
    expect(p).toMatchObject({ preview: true, played: false, side: "mine", show_plays: ["Ada Lumen", "Bo Quill"], lines_left: 6, recap: "the show writes it" });
    expect(p.would_cost).toMatch(/1 of the agents' shared daily dates/);
    expect(p.cost).toMatchObject({ spent: "nothing", would_spend: expect.stringMatching(/shared daily/) });
    expect((await t.db.query<Any>(`select handed_over_at, jsonb_array_length(transcript) as n from episodes where id = $1`, [id])).rows[0]).toEqual({ handed_over_at: null, n: 0 });
    expect((await agentDatesToday(t.db)).used).toBe(0);

    scriptedModel([...Array.from({ length: 6 }, (_, i) => turnJson(i)), episodeJson()]);
    const r = (await call("autoplay_own_date", { episode_id: id }, ctx)).structuredContent;
    expect(r.step.stage).toBe("done");
    expect(r.cost).toMatchObject({ spent: "1 of the agents' shared daily dates", yours: "nothing", agents_shared_daily: "counted one" });
  });

  it("a write tool without a dry run refuses one and does nothing; one with it under another name reads it as that", async () => {
    const { ctx, a } = await twoOfMine();
    const host = await connect();
    const hostChar = (await call("create_character", validCharacter({ name: "Cass Vega" }), host)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: hostChar, partner_id: HOUSE_PARTNER_ID }, host)).structuredContent.episode.id;
    const refused = await call("predict", { episode_id: ep, pick: "friends", dry_run: true }, ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/predict has no dry_run or dry run, so nothing was done or spent/);
    expect((await t.db.query(`select 1 from predictions`)).rows).toHaveLength(0);
    // create_character's dry run is check_only: preview is read as it, and nothing is saved.
    const checked = (await call("create_character", { ...validCharacter({ name: "Wren Kestrel" }), preview: true }, ctx)).structuredContent;
    expect(checked).toMatchObject({ saved: false, read_arguments_as: ["preview → check_only"] });
    // go_on_date's is preview: dry_run is read as it.
    const before = await episodes();
    expect((await call("go_on_date", { character_id: a, partner_id: HOUSE_PARTNER_ID, dry_run: true }, ctx)).structuredContent).toMatchObject({ preview: true, booked: false });
    expect(await episodes()).toBe(before);
  });

  it("plan_second_date takes preview as check; answer_date_proposal previews what accepting would cost", async () => {
    const host = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Cass Vega" }), host)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, host)).structuredContent.episode.id;
    const before = await episodes();
    expect((await call("plan_second_date", { episode_id: ep, preview: true }, host)).structuredContent.second_date).toMatchObject({ can_plan: false });
    expect(await episodes()).toBe(before);
    const p = (await call("answer_date_proposal", { character_id: mine, with: HOUSE_PARTNER_ID, accept: true, preview: true }, host)).structuredContent;
    expect(p).toMatchObject({ preview: true, answered: false, proposal_to_you: null, cost: { spent: "nothing", would_spend: expect.stringMatching(/no open proposal/) } });
  });
});

describe("a cost on every spending tool (#485, #498)", () => {
  it("go_on_date says it spent a free weekly date and a shared daily date, and what's left", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const r = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent;
    expect(r.cost).toMatchObject({
      spent: "1 free weekly date and 1 of the agents' shared daily dates",
      yours: "1 free weekly date",
      agents_shared_daily: "counted one",
      left: { free_dates_this_week: 2, tokens: 0, agents_shared_daily_cap: expect.any(Number) },
    });
    expect(r.cost.left.agents_shared_daily).toBe(r.cost.left.agents_shared_daily_cap - 1);
  });

  it("sliding_doors says it's free, in its description and its result", async () => {
    expect(MCP_TOOLS.find((x) => x.name === "sliding_doors")!.description).toMatch(/Free: no model call/);
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode.id;
    const used = (await agentDatesToday(t.db)).used;
    const r = (await call("sliding_doors", { episode_id: ep, change: "bolder" }, ctx)).structuredContent;
    expect(r.cost).toMatchObject({ spent: "nothing", agents_shared_daily: "not counted", left: { free_dates_this_week: 2 } });
    expect((await agentDatesToday(t.db)).used).toBe(used);
  });

  it("hand_over_own_date previews the hand-over and its cost without handing over", async () => {
    const ctxA = await connect();
    const ctxB = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctxA)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true }), ctxB)).structuredContent.character.id;
    const id = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, output: line(0) }, ctxA);
    await t.db.query(`update episodes set last_move_at = now() - interval '200 seconds' where id = $1`, [id]);
    const p = (await call("hand_over_own_date", { episode_id: id, preview: true }, ctxA)).structuredContent;
    expect(p).toMatchObject({ preview: true, handed_over: false, show_would_play: "Bo Quill", cost: { spent: "nothing", would_spend: expect.stringMatching(/shared daily/) } });
    expect((await t.db.query<Any>(`select handed_over, handed_over_at from episodes where id = $1`, [id])).rows[0]).toEqual({ handed_over: null, handed_over_at: null });
  });
});

describe("house-run bots are labelled as house-run everywhere (#489, #486, #457)", () => {
  it("made_by and run_by say house_bot on cards, search, profiles, the cast and matches; a real agent stays an agent", async () => {
    const { bot, ines, tobiah, me, mine } = await cast();
    const deck = (await call("swipe_deck", { character_id: mine }, me)).structuredContent.cards as Any[];
    const byId = (cards: Any[]) => Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId(deck)[ines]).toMatchObject({ made_by: "house_bot", run_by: "house_bot", house_bot: true });
    expect(byId(deck)[tobiah]).toMatchObject({ made_by: "agent", run_by: "agent", house_bot: false });
    expect(byId((await call("swipe_deck", { character_id: mine, compact: true }, me)).structuredContent.cards)[ines]).toMatchObject({ made_by: "house_bot", run_by: "house_bot" });
    expect((await call("swipe_deck", { character_id: mine, only: "agents" }, me)).structuredContent.cards.map((c: Any) => c.id)).toEqual([tobiah]);
    const found = byId((await call("search_characters", { open_only: false, limit: 30 }, me)).structuredContent.characters);
    expect(found[ines]).toMatchObject({ made_by: "house_bot", run_by: "house_bot" });
    expect(found[tobiah]).toMatchObject({ made_by: "agent", run_by: "agent" });
    expect((await call("get_character", { character_id: ines }, me)).structuredContent.character).toMatchObject({ made_by: "house_bot", run_by: "house_bot" });
    const listed = byId((await call("list_cast", { limit: 100 }, me)).structuredContent.cast);
    expect(listed[ines]).toMatchObject({ made_by: "house_bot", run_by: "house_bot" });
    expect(listed[tobiah]).toMatchObject({ made_by: "agent", run_by: "agent" });
    expect(listed[HOUSE_PARTNER_ID]).toMatchObject({ made_by: "house", run_by: "house" });

    await call("swipe", { character_id: mine, target_id: ines, like: true }, me);
    await call("swipe", { character_id: ines, target_id: mine, like: true }, bot);
    const match = (await call("my_matches", { character_id: mine }, me)).structuredContent.matches[0];
    expect(match).toMatchObject({ run_by: "house_bot", with: { id: ines, made_by: "house_bot" } });
    expect((await call("my_status", {}, me)).structuredContent.matches_to_answer).toEqual([expect.objectContaining({ with: ines, house_bot: true, run_by: "house_bot" })]);
    // Nothing a visitor reads calls it "agent-made" or another agent's.
    expect(JSON.stringify(match)).not.toMatch(/"made_by":"agent"/);
  });

  it("a like with no match yet says who's on the other end and what to expect (#486)", async () => {
    const { ines, tobiah, me, mine } = await cast();
    const toBot = (await call("swipe", { character_id: mine, target_id: ines, like: true }, me)).structuredContent;
    expect(toBot).toMatchObject({ matched: false, run_by: "house_bot", house_bot: true, next: expect.stringMatching(/house-run bot \(one of the show's own scripts\)/) });
    const toAgent = (await call("swipe", { character_id: mine, target_id: tobiah, like: true }, me)).structuredContent;
    expect(toAgent).toMatchObject({ matched: false, run_by: "agent", house_bot: false, agent_active: "active now", next: expect.stringMatching(/^No match yet\. Their agent was active now/) });
    // Likes stay secret: nothing says whether they liked yours.
    expect(JSON.stringify(toAgent)).not.toMatch(/liked you/);
  });

  it("the look-alike warning calls a house-run bot's character one, never 'made by another agent' (#489)", async () => {
    const sheet = {
      bio: "Runs the overnight lost-property desk at a ferry terminal and keeps a ledger of the strangest things people leave behind.",
      traits: ["wry", "patient", "secretly romantic"],
      want: "Someone who asks what the strangest lost thing was, and waits for the whole story",
      dealbreaker: "Anyone who calls lost things junk",
      voice: "Low, amused, unhurried. Answers a question with a better question.",
    };
    const bot = await connect("botchelor-loop-swipe-back");
    await call("create_character", validCharacter({ name: "Ines Varga-Holm", keep_name: true, ...sheet }), bot);
    const me = await connect("visitor");
    const made = (await call("create_character", validCharacter({ name: "Inez Varga", ...sheet }), me)).structuredContent;
    expect(made.warning).toMatch(/Ines Varga-Holm \([^)]*a house-run bot's character \(one of the show's own scripts, not another agent\)/);
    expect(made.warning).not.toMatch(/made by another agent/);
    // A real agent's twin, made minutes ago, still says so.
    const other = await connect("lanternfish");
    await call("create_character", validCharacter({ name: "Marta Hollis", ...sheet }), other);
    const again = (await call("create_character", validCharacter({ name: "Moira Hale", ...sheet }), me)).structuredContent;
    expect(again.warning).toMatch(/Marta Hollis \([^)]*made by another agent in the last few minutes\)/);
  });

  it("an own date with a house-run bot says the partner is a script, and autoplay plays both sides instead of refusing (#457)", async () => {
    const { bot, ines, me, mine } = await cast();
    await call("swipe", { character_id: mine, target_id: ines, like: true }, me);
    await call("swipe", { character_id: ines, target_id: mine, like: true }, bot);
    await call("answer_match", { character_id: mine, with: ines, yes: true }, me);
    await call("answer_match", { character_id: ines, with: mine, yes: true }, bot);
    const preview = (await call("start_own_date", { character_id: mine, partner_id: ines, preview: true, format: "speed_date" }, me)).structuredContent;
    expect(preview).toMatchObject({ kind: "house_bot", other_side: expect.stringMatching(/house-run bot's character \(one of the show's own scripts, not another agent\)/) });
    const started = (await call("start_own_date", { character_id: mine, partner_id: ines, format: "speed_date" }, me)).structuredContent;
    expect(started).toMatchObject({ house_bot: true, their_agent: HOUSE_BOT_LABEL });
    const id = started.step.episode_id;
    const waiting = (await call("submit_own_date_step", { episode_id: id, output: line(0) }, me)).structuredContent.step;
    expect(waiting).toMatchObject({ stage: "waiting", played_by: "house_bot" });
    expect(waiting.instructions).toMatch(/a house-run bot plays it automatically/);
    expect(waiting.instructions).not.toMatch(/agent performs/);
    const full = (await call("get_own_date_step", { episode_id: id, compact: false }, me)).structuredContent.step;
    expect(full.instructions).toMatch(/Ines Varga-Holm is a house-run bot's character \(one of the show's own scripts, not another agent\)/);

    const p = (await call("autoplay_own_date", { episode_id: id, preview: true }, me)).structuredContent;
    expect(p).toMatchObject({ house_bot: true, show_plays: ["Ada Lumen", "Ines Varga-Holm"] });
    scriptedModel([...Array.from({ length: 5 }, (_, i) => turnJson(i)), episodeJson()]);
    const r = await call("autoplay_own_date", { episode_id: id }, me);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.step.stage).toBe("done");
    expect(r.structuredContent.cost).toMatchObject({ spent: "1 of the agents' shared daily dates" });
  });

  it("a real two-agent date still keeps the other agent's side theirs", async () => {
    const { live, tobiah, me, mine } = await cast();
    void live;
    const id = (await call("start_own_date", { character_id: mine, partner_id: tobiah }, me)).structuredContent.step.episode_id;
    const both = await call("autoplay_own_date", { episode_id: id, side: "both" }, me);
    expect(both.content[0].text).toMatch(/the show can play only your side/);
    const p = (await call("autoplay_own_date", { episode_id: id, preview: true }, me)).structuredContent;
    expect(p).toMatchObject({ side: "mine", show_plays: ["Ada Lumen"] });
  });
});

describe("what comes back (#481)", () => {
  it("get_episode names the keys it returns and when the ending is there", () => {
    const d = MCP_TOOLS.find((x) => x.name === "get_episode")!.description;
    for (const key of ["ending", "why", "box_score", "transcript", "summary", "no wrapper", "generating"]) expect(d).toContain(key);
  });

  it("the main tools say what they return", () => {
    for (const name of ["my_status", "go_on_date", "get_episode", "start_own_date", "submit_own_date_step", "autoplay_own_date", "get_own_date_step", "swipe", "search_characters", "create_character", "my_dates", "browse_episodes", "predict", "plan_second_date", "sliding_doors", "my_matches", "get_character"]) {
      expect({ name, says: /Returns/.test(MCP_TOOLS.find((x) => x.name === name)!.description) }).toEqual({ name, says: true });
    }
  });

  it("the server is at 2.4.3", () => {
    expect(MCP_SERVER_INFO.version).toBe("2.4.3");
  });
});

describe("leaner own-date steps", () => {
  it("a wait is a short reminder by default; compact: false has the whole explanation", async () => {
    const ctxA = await connect();
    const ctxB = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctxA)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true }), ctxB)).structuredContent.character.id;
    const id = (await call("start_own_date", { character_id: a, partner_id: b }, ctxA)).structuredContent.step.episode_id;
    const short = (await call("submit_own_date_step", { episode_id: id, output: line(0) }, ctxA)).structuredContent.step;
    expect(short).toMatchObject({ stage: "waiting", played_by: "agent", quiet_minutes: 0 });
    expect(short.instructions).toMatch(/^Bo Quill's move \(their agent plays it, quiet 0 min\)\. get_own_date_step with wait_seconds waits for yours\./);
    const full = (await call("get_own_date_step", { episode_id: id, compact: false }, ctxA)).structuredContent.step;
    expect(full.instructions.length).toBeGreaterThan(short.instructions.length + 80);
  });

  it("a turn's reminder points at see_again instead of repeating it", async () => {
    const { ctx, a, b } = await twoOfMine();
    let step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    let i = 0;
    while (step.stage === "turn" && !step.see_again) step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i++) }, ctx)).structuredContent.step;
    expect(step.see_again).toMatch(/last line as planned/);
    expect(step.instructions).toMatch(/see_again says how to send a private wish/);
    expect(step.instructions).not.toContain(step.see_again);
  });
});
