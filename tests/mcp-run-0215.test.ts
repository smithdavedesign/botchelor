import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleCharacter, type Character } from "@/lib/character";
import { simulateConversation, type Turn } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type DateInput, type SideSetup } from "@/lib/engine";
import { PROFILE_PROMPTS } from "@/lib/extras";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CORE_TOOL_ORDER, episodeSummary, handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { argShape, BOOKING_RULE, costLabel, fullInstructions, isoCursor, spentNote } from "@/lib/mcp/dispatcher";
import { PARTNER_STYLE_MEANS } from "@/lib/mcp/schemas";
import { notify } from "@/lib/notifications";
import { placeProposal, planPlace } from "@/lib/places";
import { agreedPlan } from "@/lib/plans";
import { lineIssues, selfAddress, transcriptQuality } from "@/lib/quality";
import { CONVERSATION_TURNS } from "@/lib/rules";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { pickVenue } from "@/lib/venues";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// MCP 2.7.0, from the 2026-10-22-0215 run (three uninstructed visitors: 8.5, 8 and 8 overall; MCP 8.5, 8.5 and 8). Run
// folder: ~/.botchelor-loop/runs/2026-10-22-0215. #641 a wait never books, #642 profiles and errors that teach the shape,
// exclusivity said where it bites (and a closed character dated on a two-agent date), #643 the second date's place, #645 a
// line in the wrong mouth, #644 leave_nudge says it saved, #619's comment on cursors, house_bot on every card, and the rest.
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
  setSwipeGateForTests(false);
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(client = "botchelor-run-0215-test"): Promise<McpContext & { init: Any }> {
  const ctx: McpContext = {};
  const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx)).result;
  return { sessionId: ctx.issuedSessionId, init };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string, extra: Record<string, unknown> = {}, client?: string) {
  const ctx = await connect(client);
  // decide, as these were written for (2.12.0 made open the default).
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true, partner_style: "decide", ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string };
}
/** Two agents' characters that liked each other (matched, no answers yet). */
async function matched(a = "Thaddeus Quill", b = "Marguerite Plum") {
  const A = await agentWith(a);
  const B = await agentWith(b);
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  return { A, B };
}
/** …and both said yes to a date. */
async function agreed(a?: string, b?: string) {
  const { A, B } = await matched(a, b);
  await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
  await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
  return { A, B };
}
/** A date with one of the house cast on the show's model, written inline (the test harness). */
async function houseDate(ctx: McpContext, characterId: string, ending: "second_date" | "friends" | "disaster" = "friends", partner = HOUSE_CHARACTERS[0].id) {
  scriptOutcome({ ending });
  scriptedModel([episodeJson(), episodeJson()]);
  const r = await call("go_on_date", { character_id: characterId, partner_id: partner }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent;
}
const freeLeft = async (ctx: McpContext): Promise<number> => (await call("my_status", {}, ctx)).structuredContent.dates_left.free_left;
const line = (i: number) => ({ dialogue: `Line ${i}: tell me something true about the sea, and something false.`, action: "", emotion: "warm", interest_signal: 0.6 });
const timed = async <T,>(p: Promise<T>): Promise<[T, number]> => {
  const t0 = Date.now();
  const out = await p;
  return [out, Date.now() - t0];
};
/** A time written by hand, as an agent's own clock would: whole seconds, in a +02:00 offset. */
const byHand = (at: Date) => `${new Date(at.getTime() + 2 * 3600_000).toISOString().slice(0, 19)}+02:00`;
/** The tools whose call spends a date (go_on_date, plan_second_date) or a shared daily date (the own-date take-overs). */
const SPENDING = new Set(["go_on_date", "plan_second_date", "autoplay_own_date", "hand_over_own_date"]);

it("is MCP 2.7.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.7.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("#641: a wait never books, and a spending call is suggested as a preview", () => {
  it("plan_second_date with wait_seconds waits for the airing, then previews: nothing booked or spent, and the booking call comes in its next_calls", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "second_date");
    const free = await freeLeft(A.ctx);
    // It airs in about two seconds (the prediction window runs from the booking).
    await t.db.query(`update episodes set created_at = now() - interval '10 minutes' + interval '2 seconds' where id = $1`, [booked.episode.id]);
    const episodes = await t.count("episodes");
    const r = await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 10 }, A.ctx);
    expect(r.isError).toBeUndefined();
    const s = r.structuredContent;
    expect(s).toMatchObject({ preview: true, booked: false, returned_because: "new", waited_for: "the first date to air", second_date: { can_plan: true } });
    expect(s.wait_note).toBe(`A wait never books: this is the preview. ${BOOKING_RULE} plan_second_date with episode_id (no preview) books it; wait_seconds with confirm: true waits, then books.`);
    expect(s.cost).toMatchObject({ spent: "nothing", would_spend: expect.stringMatching(/^1 free weekly date and 1 of the agents' shared daily dates/) });
    expect(s.next_calls[0]).toEqual({ tool: "plan_second_date", args: { episode_id: booked.episode.id }, why: expect.stringMatching(/^Books it: spends 1 free weekly date/) });
    // 2.9.0: the first date aired during this wait, which is when its exclusive_soon goes out now: it leads this reply, with
    // its call (it used to go out when the date was written, before it aired).
    expect(s.heads_up).toContainEqual(expect.objectContaining({ kind: "exclusive_soon", character_id: A.id }));
    expect(s.next_calls.slice(1)).toEqual([expect.objectContaining({ tool: "update_character", args: { character_id: A.id, partner_style: "open" } })]);
    expect(await t.count("episodes")).toBe(episodes);
    expect(await freeLeft(A.ctx)).toBe(free);

    // The call it hands back books it, and says plainly what it spent and what's left.
    scriptedModel([episodeJson()]);
    const b = (await call(s.next_calls[0].tool, s.next_calls[0].args, A.ctx)).structuredContent;
    expect(b).toMatchObject({ second_date_of: booked.episode.id });
    expect(b.spent_note).toMatch(new RegExp(`^Booked: used 1 free date, ${4 - free} of your 3 this week; ${free - 1} left, and 1 of the \\d+ show-model dates all agents share today \\(\\d+ left\\)\\.$`));
    const keys = Object.keys(b);
    expect(keys.indexOf("spent_note")).toBe(keys.indexOf("episode") + 1);
    expect(await freeLeft(A.ctx)).toBe(free - 1);
  });

  it("wait_seconds with confirm: true waits for the airing, then books (the one-call convenience); preview: true always wins", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "second_date");
    await t.db.query(`update episodes set created_at = now() - interval '10 minutes' + interval '2 seconds' where id = $1`, [booked.episode.id]);
    const episodes = await t.count("episodes");
    scriptedModel([episodeJson()]);
    const s = (await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 10, confirm: true }, A.ctx)).structuredContent;
    expect(s).toMatchObject({ second_date_of: booked.episode.id, returned_because: "new", waited_for: "the first date to air" });
    expect(s.spent_note).toMatch(/^Booked: used 1 free date, 2 of your 3 this week; 1 left/);
    expect(await t.count("episodes")).toBe(episodes + 1);
    // preview: true wins over confirm: nothing more is booked.
    const both = (await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1, confirm: true, preview: true }, A.ctx)).structuredContent;
    expect(both).toMatchObject({ preview: true, booked: false, second_date: { can_plan: false, reason: "planned" } });
    expect(await t.count("episodes")).toBe(episodes + 1);
  });

  it("the schema and the words say which calls book: confirm is optional, and plan_second_date's description, the quickstart and the guide say it", async () => {
    expect(BOOKING_RULE).toBe("go_on_date and plan_second_date book on the call unless preview: true; a wait never books unless confirm: true.");
    const tool = MCP_TOOLS.find((x) => x.name === "plan_second_date")!;
    const schema = tool.inputSchema as Any;
    expect(schema.properties.confirm).toMatchObject({ type: "boolean", default: false, description: expect.stringMatching(/a wait alone only previews/) });
    expect(schema.properties.wait_seconds.description).toMatch(/then preview/);
    expect(schema.required ?? []).not.toContain("confirm");
    expect(tool.description).toContain(BOOKING_RULE.replace(/\.$/, ""));
    expect(tool.description).not.toMatch(/It happens where they planned it in their texts/);
    const { init } = await connect();
    expect(init.instructions).toContain(`Booking: ${BOOKING_RULE}`);
    expect(fullInstructions()).toContain(BOOKING_RULE);
  });

  it("no next_calls entry for a spending tool lacks preview: true, except the booking call a preview hands back", async () => {
    const A = await agentWith("Ada Lumen");
    const replies: Any[] = [];
    replies.push(await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, open_to_dates: true, extras: PROFILE }), A.ctx));
    replies.push(await call("my_status", {}, A.ctx));
    replies.push(await call("swipe", { character_id: A.id, target_id: HOUSE_CHARACTERS[1].id, like: true }, A.ctx));
    const booked = await houseDate(A.ctx, A.id, "second_date");
    replies.push({ structuredContent: booked });
    replies.push(await call("plan_second_date", { episode_id: booked.episode.id }, A.ctx));
    replies.push(await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1 }, A.ctx));
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [booked.episode.id]);
    replies.push(await call("get_episode", { episode_id: booked.episode.id }, A.ctx));
    replies.push(await call("my_status", {}, A.ctx));
    const preview = await call("plan_second_date", { episode_id: booked.episode.id, preview: true }, A.ctx);
    replies.push(preview);
    // Two agents agree a date: the last yes, and my_status, suggest booking it.
    const { A: X, B: Y } = await matched();
    await call("answer_match", { character_id: X.id, with: Y.id, yes: true }, X.ctx);
    replies.push(await call("answer_match", { character_id: Y.id, with: X.id, yes: true }, Y.ctx));
    const status = await call("my_status", {}, Y.ctx);
    replies.push(status);
    let checked = 0;
    for (const r of replies) {
      const sc = r.structuredContent ?? {};
      for (const c of (sc.next_calls ?? []) as Any[]) {
        expect(CORE_TOOL_ORDER as readonly string[]).toContain(c.tool);
        if (!SPENDING.has(c.tool)) continue;
        checked++;
        // A spending call is suggested as a preview; only a preview's own reply hands back the call that books (or another wait).
        if (c.args.preview !== true) expect({ tool: c.tool, args: c.args, inPreviewReply: sc.preview === true }).toEqual({ tool: c.tool, args: c.args, inPreviewReply: true });
      }
    }
    expect(checked).toBeGreaterThanOrEqual(7);
    expect(preview.structuredContent.next_calls).toEqual([{ tool: "plan_second_date", args: { episode_id: booked.episode.id }, why: expect.stringMatching(/^Books it/) }]);
    // The words say it too: the date-agreed item's call and the second-date hint.
    expect(status.structuredContent.dates_to_book_note).toMatch(/preview: true first shows the cost/);
    for (const item of (status.structuredContent.new_since ?? []) as Any[]) if (item.call?.startsWith("go_on_date")) expect(item.call).toMatch(/preview: true/);
    const later = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(later.second_date_ready.note).toMatch(/plan_second_date \(episode_id, preview: true\) says whether it can be booked and the cost; without preview it books/);
  });

  it("a proposal: my_status suggests answer_match with preview: true; the preview says what a yes books and costs and hands over both answers; the yes books and says what it spent", async () => {
    const A = await agentWith("Hesper Oyelaran");
    const B = await agentWith("Ottoline Brack");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx)).isError).toBeUndefined();
    await call("set_open_to_dates", { character_id: B.id, open: false }, B.ctx);
    const proposed = (await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    expect(proposed.status).toBe("proposed");
    const status = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(status.invites[0].call).toBe(`answer_match (character_id: "${B.id}", with: "${A.id}", preview: true) shows what a yes would book and cost; then yes: true (books it) or false`);
    expect(status.next_calls).toContainEqual({ tool: "answer_match", args: { character_id: B.id, with: A.id, preview: true }, why: expect.stringMatching(/preview: true shows what a yes would book and cost/) });
    const episodes = await t.count("episodes");
    // preview needs no yes.
    const p = await call("answer_match", { character_id: B.id, with: A.id, preview: true }, B.ctx);
    expect(p.isError).toBeUndefined();
    expect(p.structuredContent).toMatchObject({ preview: true, answered: false, answers: "a date their creator proposed", proposal: { status: "pending" } });
    expect(p.structuredContent.yes_would).toMatch(/^book the date \(the show's model plays both sides\): 1 free weekly date/);
    expect(p.structuredContent.cost).toMatchObject({ spent: "nothing", would_spend: expect.stringMatching(/^yes: 1 free weekly date/) });
    expect(p.structuredContent.next_calls).toEqual([
      { tool: "answer_match", args: { character_id: B.id, with: A.id, yes: true }, why: expect.stringMatching(/^Yes: books it, spending 1 free weekly date/) },
      { tool: "answer_match", args: { character_id: B.id, with: A.id, yes: false }, why: "No: final, and free." },
    ]);
    expect(await t.count("episodes")).toBe(episodes);
    scriptedModel([episodeJson()]);
    const yes = (await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx)).structuredContent;
    expect(yes.accepted_proposal).toBe(true);
    expect(yes.spent_note).toMatch(/^Booked: used 1 free date, 1 of your 3 this week; 2 left, and 1 of the \d+ show-model dates all agents share today/);
    // On a plain match, a preview says answering is free.
    const { A: X, B: Y } = await matched("Pell Ortega", "Wren Pike");
    const plain = (await call("answer_match", { character_id: X.id, with: Y.id, preview: true }, X.ctx)).structuredContent;
    expect(plain).toMatchObject({ preview: true, answered: false, answers: "a match", cost: { would_spend: "nothing: answering a match is free" } });
    expect((await t.db.query<Any>(`select yes_lo, yes_hi from matches where (character_lo = $1 and character_hi = $2) or (character_lo = $2 and character_hi = $1)`, [X.id, Y.id])).rows[0]).toEqual({ yes_lo: null, yes_hi: null });
  });

  it("every booking says what it spent and what's left; the cost label in _meta is short", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "friends");
    expect(booked.spent_note).toMatch(/^Booked: used 1 free date, 1 of your 3 this week; 2 left, and 1 of the \d+ show-model dates all agents share today \(\d+ left\)\.$/);
    // #726: after the third free date it says 3 of 3 used and 0 left, not "used 1 of your 3 … 0 left".
    expect(spentNote({ yours: "1 free weekly date", left: { free_dates_this_week: 0 } })).toBe("Booked: used 1 free date, 3 of your 3 this week; 0 left.");
    expect(spentNote({ yours: "1 token", agents_shared_daily: "counted one", left: { free_dates_this_week: 0, tokens: 4, agents_shared_daily: 9, agents_shared_daily_cap: 12 } })).toBe(
      "Booked: used 1 token (no free dates were left this week); 4 tokens left, and 1 of the 12 show-model dates all agents share today (9 left).",
    );
    expect(spentNote({ yours: "this week's free second date", agents_shared_daily: "counted one", left: { free_dates_this_week: 2, agents_shared_daily: 3, agents_shared_daily_cap: 12 } })).toMatch(
      /^Booked: used this week's free second date \(your free dates are untouched: 2 left\), and 1 of the 12/,
    );
    expect(costLabel("go_on_date")).toBe("1 date + 1 shared daily date");
    expect(costLabel("browse_episodes")).toBe("free");
    const go = MCP_TOOLS.find((x) => x.name === "go_on_date")!;
    expect((go._meta as Any)["botchelor/cost"]).toBe("1 date + 1 shared daily date");
    expect(go.description).toMatch(/^Costs one date/);
  });
});

describe("#642: the first-time path and errors teach the shape", () => {
  it("create_character says a dating profile is needed to swipe, lists the prompt ids and gives an example that works; with extras it's ready", async () => {
    const ctx = await connect();
    const bare = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, open_to_dates: true }), ctx)).structuredContent;
    expect(bare.dating_profile).toMatchObject({
      complete: false,
      needs: ["2 more answered profile prompts (extras.prompts)", "2 more interests (extras.hobbies)"],
      prompt_ids: PROFILE_PROMPTS.map((p) => p.id),
      why: expect.stringMatching(/^Swiping, and showing in others' decks, needs a dating profile/),
      shape: expect.stringMatching(/^extras\.prompts is a list of \{id, answer\}/),
      note: expect.stringMatching(/create_character takes extras too/),
    });
    const finish = bare.next_calls.find((c: Any) => c.tool === "update_character" && c.args.extras);
    expect(finish.args).toEqual({ character_id: bare.character.id, extras: bare.dating_profile.example.extras });
    expect(bare.next_calls.some((c: Any) => c.tool === "swipe_deck")).toBe(false);
    // The example's shape is one the server takes, words of its own in place of the <…>.
    const own = { prompts: finish.args.extras.prompts.map((p: Any, i: number) => ({ id: p.id, answer: ["Fog over the harbour at six.", "Tide tables, and why they lie."][i] })), hobbies: ["Sea swimming", "Crosswords"] };
    const upd = (await call("update_character", { character_id: bare.character.id, extras: own }, ctx)).structuredContent;
    expect(upd.dating_profile).toMatchObject({ complete: true });
    const ready = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, open_to_dates: true, extras: PROFILE }), ctx)).structuredContent;
    expect(ready.dating_profile).toMatchObject({ complete: true });
    expect(ready.next_calls.some((c: Any) => c.tool === "swipe_deck")).toBe(true);
    // check_only says it before anything is saved.
    const check = (await call("create_character", { ...validCharacter({ name: "Cy Marr" }), check_only: true }, ctx)).structuredContent;
    expect(check.dating_profile).toMatchObject({ complete: false });
    // The description says it, with an example, and that create_character takes extras; the schema lists the ids.
    const tool = MCP_TOOLS.find((x) => x.name === "create_character")!;
    expect(tool.description).toMatch(/To swipe, and to show in others' decks \(open_to_dates: true\), it needs a dating profile, which this takes too: two extras\.prompts as \{id, answer\}/);
    expect(tool.description).toContain('e.g. extras: {"prompts": [{"id": "geek_out", "answer": "…"}, {"id": "simple_pleasures", "answer": "…"}], "hobbies": ["…", "…"]}');
    expect((tool.inputSchema as Any).properties.extras.description).toContain(PROFILE_PROMPTS.map((p) => p.id).join(", "));
    // The quickstart, in one line.
    const { init } = await connect();
    expect(init.instructions).toMatch(/^Swiping: A dating profile, needed to swipe and to be in others' decks: extras\.prompts \(2 answered, as \[\{id, answer\}\], ids listed in create_character's extras\) and 2 extras\.hobbies; create_character takes them/m);
  });

  it("swipe_deck and swipe refuse an unfinished profile with the shape, the ids and the call", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const r = await call("swipe_deck", { character_id: id }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: Finish Ada's dating profile to swipe: 2 more answered profile prompts \(extras\.prompts\), 2 more interests \(extras\.hobbies\)\. Set them with update_character \(character_id, extras\): extras\.prompts is a list of \{id, answer\}/);
    expect(r.content[0].text).toContain('"id":"geek_out"');
    expect(r.structuredContent.prompt_ids).toEqual(PROFILE_PROMPTS.map((p) => p.id));
    expect(r.structuredContent.next_calls[0]).toMatchObject({ tool: "update_character", args: { character_id: id, extras: { prompts: expect.any(Array), hobbies: expect.any(Array) } } });
    const s = await call("swipe", { character_id: id, target_id: HOUSE_CHARACTERS[0].id, like: true }, ctx);
    expect(s.isError).toBe(true);
    expect(s.content[0].text).toMatch(/Set them with update_character \(character_id, extras\)/);
  });

  it("a missing boolean or enum says its type and an example; a wrong type is refused, never guessed", async () => {
    const { A, B } = await matched();
    // 2.10.0 (#662): answer reads as yes now (tests/mcp-run-0800.test.ts); a call without either still names it, typed.
    const r = await call("answer_match", { character_id: A.id, with: B.id }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('Error: "yes" is required: true or false (e.g. "yes": true). (answer_match takes: character_id, with, yes, preview, agent_id.)');
    expect(r.structuredContent).toMatchObject({ code: "missing_argument", field: "yes" });
    const p = await call("predict_arc", { character_id: A.id, with: B.id }, A.ctx);
    expect(p.content[0].text).toMatch(/^Error: "pick" is required: one of yes, no \(e\.g\. "pick": "yes"\)\. \(predict_arc takes: /);
    // yes: "yes" used to be read as a no, and a no is final. A word it can't read is refused, and nothing is answered (2.10.0:
    // "yes" and "no" themselves read as true and false: tests/mcp-run-0800.test.ts).
    const wrong = await call("answer_match", { character_id: A.id, with: B.id, yes: "maybe" }, A.ctx);
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0].text).toMatch(/^Error: Not valid — yes: true or false, not "maybe" \(e\.g\. "yes": true\)\. Nothing was done\. \(answer_match takes: /);
    expect(wrong.structuredContent).toMatchObject({ code: "invalid_argument", field: "yes" });
    expect((await t.db.query<Any>(`select yes_lo, yes_hi from matches`)).rows[0]).toEqual({ yes_lo: null, yes_hi: null });
    // "true" as text is read as true, and says so.
    const text = (await call("answer_match", { character_id: A.id, with: B.id, yes: "true" }, A.ctx)).structuredContent;
    expect(text.status).toBe("waiting_on_them");
    expect(text.read_arguments_as).toContain('yes: "true" → true');
    // An enum given another type names its values.
    const e = await call("predict_arc", { character_id: A.id, with: B.id, pick: true }, A.ctx);
    expect(e.content[0].text).toMatch(/^Error: Not valid — pick: one of yes, no, not true \(e\.g\. "pick": "yes"\)\. Nothing was done\./);
    // A word a tool reads on purpose still works (a swipe's "right", a vote's up: true).
    expect(argShape({ type: "boolean" })).toEqual({ type: "true or false", example: true });
    expect(argShape({ type: "integer", minimum: 1, maximum: 5 })).toEqual({ type: "a number from 1 to 5", example: 1 });
    expect(argShape({ type: "string", enum: ["a", "b"] })).toEqual({ type: "one of a, b", example: "a" });
    expect(argShape({ type: "string" })).toBeNull();
  });

  it("a profile in the wrong shape is refused with the shape and an example", async () => {
    const ctx = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const r = await call("update_character", { character_id: id, extras: { prompts: [{ q: "win_me_over", a: "Bring a thermos." }] } }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/extras\.prompts/);
    expect(r.content[0].text).toMatch(/\(extras\.prompts is a list of \{id, answer\} \(answers up to 160 characters; id one of win_me_over, .*\); extras\.hobbies is a list of short strings, e\.g\. \{"prompts":\[\{"id":"geek_out"/);
  });
});

describe("exclusivity said where it bites, and a closed character can't be dated on a two-agent date", () => {
  it("create_character names partner_style and offers update_character with partner_style open in next_calls; open says the couple stage still moves", async () => {
    const ctx = await connect();
    // 2.12.0: left out it's open (no call offered: see below), so decide is chosen here.
    const s = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, partner_style: "decide" }), ctx)).structuredContent;
    expect(s.partner_style).toBe("decide");
    expect(s.next_calls).toContainEqual({
      tool: "update_character",
      args: { character_id: s.character.id, partner_style: "open" },
      why: expect.stringMatching(/partner_style "open" keeps it open to other dates even in a Dating couple \(more than one partner: it stays open to other dates, and its couples still move up a stage \(Sparks, Dating\)/),
    });
    const open = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, partner_style: "open" }), ctx)).structuredContent;
    expect(open.next_calls.some((c: Any) => c.args.partner_style === "open")).toBe(false);
    const byDefault = (await call("create_character", validCharacter({ name: "Cy Moss", keep_name: true }), ctx)).structuredContent;
    expect(byDefault.partner_style).toBe("open");
    expect(byDefault.next_calls.some((c: Any) => c.args.partner_style === "open")).toBe(false);
    expect(open.partner_style_note).toContain(PARTNER_STYLE_MEANS.open);
    expect(PARTNER_STYLE_MEANS.open).toMatch(/Its couples still move up a stage \(Sparks, Dating\) as their dates go: open only means it never closes to other dates/);
    // compact: false (2.13.0, #751): this connection already had the open note word for word, from create_character.
    const upd = (await call("update_character", { character_id: s.character.id, partner_style: "open", compact: false }, ctx)).structuredContent;
    expect(upd).toMatchObject({ partner_style: "open" });
    expect(upd.partner_style_note).toMatch(/still move up a stage/);
  });

  it("exclusive_soon names partner_style and puts the call that keeps it open in next_calls, in my_status and in the reply a notice leads", async () => {
    const A = await agentWith("Ada Lumen");
    const count = async () => (await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = $1 and kind = 'exclusive_soon'`, [A.agentId])).rows[0].n;
    // 2.9.0 (the 2026-10-22-0610 run): the date that makes them Sparks is written in this call (inline here), but its warning
    // waits for the date to air (2.7.0 sent it now, ahead of the airing).
    const booked = await houseDate(A.ctx, A.id, "second_date");
    expect((booked.heads_up ?? []).some((h: Any) => h.kind === "exclusive_soon")).toBe(false);
    expect(await count()).toBe(0);
    expect((await call("my_status", {}, A.ctx)).structuredContent.exclusive_soon).toBeUndefined();
    // It airs (its window closed) on the next call anyone makes: the warning leads that call's reply, once.
    await t.db.query(`update episodes set created_at = now() - interval '11 minutes' where creator_id = $1`, [A.agentId]);
    const aired = (await call("my_dates", {}, A.ctx)).structuredContent;
    const notice = aired.heads_up.find((h: Any) => h.kind === "exclusive_soon");
    expect(notice).toMatchObject({ character_id: A.id, stay_open: { tool: "update_character", arguments: { character_id: A.id, partner_style: "open" } } });
    expect(notice.stay_open_note).toBe('partner_style "open": more than one partner: it stays open to other dates, and its couples still move up a stage (Sparks, Dating) as their dates go.');
    expect(aired.next_calls).toContainEqual(expect.objectContaining({ tool: "update_character", args: { character_id: A.id, partner_style: "open" } }));
    // Shown once as a notice; my_status says the state while it lasts, with the same call.
    const status = (await call("my_status", {}, A.ctx)).structuredContent;
    const soon = status.heads_up.find((h: Any) => h.kind === "exclusive_soon");
    expect(soon).toMatchObject({ character_id: A.id, partner_style: "decide", stay_open: { tool: "update_character", arguments: { character_id: A.id, partner_style: "open" } } });
    expect(soon.what).toMatch(/\(partner_style decide, and it would settle on one\)\. partner_style "open" keeps Ada open \(more than one partner: it stays open to other dates, and its couples still move up a stage/);
    expect(status.next_calls).toContainEqual({ tool: "update_character", args: { character_id: A.id, partner_style: "open" }, why: expect.stringMatching(/^Ada is one date from going exclusive: partner_style "open" keeps it open/) });
    expect(await count()).toBe(1);
  });

  it("a character whose couple just became a Dating couple settles before a two-agent date, as go_on_date does: closed, the refusal says why, both ways", async () => {
    const A = await agentWith("Hesper Oyelaran");
    const B = await agentWith("Ottoline Brack");
    const C = await agentWith("Brannoch Veil");
    // Hesper wants one partner when she settles (guarded, not open), and is left to decide.
    await call("update_character", { character_id: A.id, temperament: { warmth: 0.6, openness: 0.2, guardedness: 0.8, humor: 0.5 } }, A.ctx);
    // Two dates with Ottoline that end in second dates make them a Dating couple (every date counts, aired or not).
    for (let i = 0; i < 2; i++) {
      scriptOutcome({ ending: "second_date" });
      scriptedModel([episodeJson()]);
      const r = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
      expect(r.isError).toBeUndefined();
    }
    expect((await t.db.query<Any>(`select stage from relationships where $1 in (character_a, character_b) and $2 in (character_a, character_b)`, [A.id, B.id])).rows[0].stage).toBe("dating");
    // Nothing aired, so nothing settled her yet: the hole the run hit (her agent started a date with Brannoch).
    expect((await t.db.query<Any>(`select partner_style, partner_style_decided, open_to_dates from characters where id = $1`, [A.id])).rows[0]).toEqual({ partner_style: "decide", partner_style_decided: null, open_to_dates: true });
    // Brannoch's agent asks Hesper (a preview runs the same checks): she settles on one partner first, and it's refused.
    const theirs = await call("start_own_date", { character_id: C.id, partner_id: A.id, preview: true }, C.ctx);
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0].text).toBe(
      'Error: Hesper is with Ottoline Brack and wants one partner (a Dating couple), so they\'re closed to other dates. Only their owner can reopen them (update_character with partner_style: "open" and open_to_dates: true). A two-agent date keeps the one-partner rule, as go_on_date does.',
    );
    expect((await t.db.query<Any>(`select partner_style_decided, open_to_dates from characters where id = $1`, [A.id])).rows[0]).toEqual({ partner_style_decided: "one", open_to_dates: false });
    // Hesper's own agent asks Brannoch: refused too, with how to date Ottoline or reopen her.
    const mine = await call("start_own_date", { character_id: A.id, partner_id: C.id }, A.ctx);
    expect(mine.isError).toBe(true);
    expect(mine.content[0].text).toBe(
      'Error: Hesper is with Ottoline Brack and wants one partner (a Dating couple), so they\'re closed to other dates. Date Ottoline, or set them to more than one partner on their card (agents: update_character with partner_style: "open" and open_to_dates: true). A two-agent date keeps the one-partner rule, as go_on_date does.',
    );
    expect(await t.count("episodes", "performed_by = 'agent'")).toBe(0);
    // Her partner is still hers to date: the rule only closes her to others. (Behind the swipe gate, as on the live show: a
    // couple that has dated needs no open_to_dates, and settling the couple closed Ottoline too.)
    setSwipeGateForTests(true);
    scriptOutcome({ ending: "friends" });
    const withPartner = await call("start_own_date", { character_id: A.id, partner_id: B.id, preview: true }, A.ctx);
    expect(withPartner.isError ? withPartner.content[0].text : "ok").toBe("ok");
  });
});

describe("#643: the second date's place", () => {
  it("places people make things in are places: the foundry, the caves; a plan to go there is agreed, and a morning-after plan points there too", () => {
    expect(placeProposal("Come to the foundry on Saturday? I'll pour you a bell.", "Hesper Oyelaran", "Ottoline Brack")).toEqual({ place: "elsewhere@the foundry", strong: true });
    expect(placeProposal("I'd love to show you the caves.", "Brannoch Veil", "Hesper Oyelaran")).toEqual({ place: "elsewhere@the caves", strong: true });
    const plan = agreedPlan([{ who: "lo", text: "Come see the foundry on Saturday?" }, { who: "hi", text: "Yes! The foundry it is." }], { lo: "Hesper Oyelaran", hi: "Ottoline Brack" });
    expect(plan?.place).toBe("elsewhere@the foundry");
    expect(planPlace([{ text: "Saturday at the foundry? I'll show you a pour.", from: "Hesper Oyelaran", to: "Ottoline Brack" }])).toBe("elsewhere@the foundry");
    // A venue the library has still wins, as it did; one of their homes is a home.
    expect(planPlace([{ text: "Coffee before the foundry?", from: "Hesper Oyelaran", to: "Ottoline Brack" }])).toBe("corner_cafe");
    expect(planPlace([{ text: "Back to mine next time.", from: "Hesper Oyelaran", to: "Ottoline Brack" }])).toBe("home@Hesper's place");
    expect(planPlace([{ text: "Same time next week?", from: "Hesper Oyelaran", to: "Ottoline Brack" }])).toBeNull();
  });

  it("a second date goes where the two agreed by text: a place without a set plays on a stand-in set with its name, the request is logged, and the reply says so", async () => {
    const A = await agentWith("Hesper Oyelaran");
    const B = await agentWith("Ottoline Brack");
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const first = (await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [first.episode.id]);
    await call("send_text", { character_id: A.id, to: B.id, text: "Come to the foundry on Saturday? I'll pour you a bell." }, A.ctx);
    await call("send_text", { character_id: B.id, to: A.id, text: "Yes! The foundry it is." }, B.ctx);
    scriptedModel([episodeJson()]);
    const r = await call("plan_second_date", { episode_id: first.episode.id }, A.ctx);
    expect(r.isError).toBeUndefined();
    const s = r.structuredContent;
    expect(s.venue).toEqual({ id: "elsewhere@the foundry", name: "The foundry", placeholder: true });
    expect(s.where_note).toBe(
      "They agreed on the foundry in their texts (“Come to the foundry on Saturday? I'll pour you a bell.” / “Yes! The foundry it is.”): there's no set for it yet, so it plays on a stand-in set named the foundry, and the request for a real one is logged.",
    );
    expect(s.note).toBe("Both wanted another date, so this is their second date.");
    expect((await t.db.query<Any>(`select setup->>'venue' as venue from episodes where id = $1`, [s.episode.id])).rows[0].venue).toBe("elsewhere@the foundry");
    // Written (inline here), its place is asked for as a new set.
    expect((await t.db.query<Any>(`select count(*)::int as n from scene_requests where normalized = 'foundry'`)).rows[0].n).toBe(1);
  });

  it("with no place agreed, the reply says the show dealt one, instead of claiming they planned it", async () => {
    const A = await agentWith("Hesper Oyelaran");
    const B = await agentWith("Ottoline Brack");
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const first = (await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [first.episode.id]);
    scriptedModel([episodeJson()]);
    const s = (await call("plan_second_date", { episode_id: first.episode.id }, A.ctx)).structuredContent;
    expect(s.where_note).toMatch(/^No place was agreed in their texts \(that takes one of them naming a place and the other saying yes\), so the show dealt .+\.$/);
    expect(s.venue.placeholder).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/where they planned it in their texts/);
  });
});

describe("#645: each line in the right mouth", () => {
  it("selfAddress flags a line that calls its own speaker by name, and nothing else", () => {
    expect(selfAddress("The wattage is forty, Ottoline…", "Ottoline Brack", "Nell Abiodun")).toBe(", Ottoline");
    expect(selfAddress("The wattage is forty, Ottoline…", "Nell Abiodun", "Ottoline Brack")).toBeNull();
    expect(selfAddress("Ottoline, listen: the lamp is forty watts.", "Ottoline Brack", "Nell Abiodun")).toBe("Ottoline,");
    // A first line may introduce itself; a name in a sentence isn't a vocative; two characters can share a first name.
    expect(selfAddress("Ottoline, lighthouse keeper. Pleased to meet you.", "Ottoline Brack", "Nell Abiodun", { firstLine: true })).toBeNull();
    expect(selfAddress("I'm Ottoline, by the way.", "Ottoline Brack", "Nell Abiodun")).toBeNull();
    expect(selfAddress("Ottoline's lamp is forty watts.", "Ottoline Brack", "Nell Abiodun")).toBeNull();
    expect(selfAddress("You too, Caspian.", "Caspian Wren", "Caspian Ruel")).toBeNull();
  });

  // The dates critic's fixtures (tests/dates-redesign.test.ts).
  const sheet = (name: string) => ({ name, age: 30, bio: `A cartographer who maps ${name.toLowerCase()}.`, traits: ["curious", "warm", "dry"], want: "a map reader", dealbreaker: "liars", house: false });
  const side = (name: string): SideSetup => ({ sheet: sheet(name), signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_funny", note: null, gameBudget: 25 });
  const INPUT: DateInput = { a: side("Mira"), b: side("Rafe") };
  const CHARS: [Character, Character] = [
    assembleCharacter({ id: "a", sheet: INPUT.a.sheet, soul: null, memory: null }),
    assembleCharacter({ id: "b", sheet: INPUT.b.sheet, soul: null, memory: null }),
  ];
  const turn = (s: "a" | "b", dialogue: string): Turn => ({ side: s, act: 0, dialogue, action: "", emotion: "warm", interest: 0.5 });

  it("lineIssues and transcriptQuality count it; the show's critic sends the line back once, with a note, and keeps the rewrite", async () => {
    expect(lineIssues([], turn("a", "The wattage is forty, Mira…"), CHARS).self_address).toBe(", Mira");
    expect(lineIssues([], turn("b", "The wattage is forty, Mira…"), CHARS).self_address).toBeNull();
    expect(transcriptQuality([turn("a", "Hello."), turn("b", "Hi."), turn("a", "Busy night?"), turn("b", "Rafe, sit down, please.")], CHARS).self_addresses).toBe(1);
    const turnJson = (dialogue: string) => JSON.stringify({ dialogue, action: "", emotion: "warm", interest_signal: 0.5 });
    const queue = [turnJson("The wattage is forty, Mira…"), turnJson("The lamp burns at forty watts, Rafe — want to see?"), ...Array.from({ length: CONVERSATION_TURNS - 1 }, (_, i) => turnJson(`Line ${i} — on with it.`))];
    const prompts: Any[][] = [];
    const model = {
      async complete(messages: Any[]) {
        prompts.push(messages);
        const next = queue.shift();
        if (!next) throw new Error("out");
        return next;
      },
    };
    const outcome = fixedEngine({ ending: "friends" }).decide(INPUT, 1);
    const transcript = await simulateConversation(model, INPUT, outcome, CHARS, "a_hard_question", pickVenue(1));
    expect(transcript[0]).toMatchObject({ side: "a", dialogue: "The lamp burns at forty watts, Rafe — want to see?" });
    expect(prompts[1].at(-1).content).toMatch(/^Revise that line: you called yourself by name \(", Mira"\): you are Mira, talking to Rafe — write Mira's own line, and use Rafe's name if you mean them/);
    expect(transcript).toHaveLength(CONVERSATION_TURNS);
  });

  it("get_episode's summary names each line's speaker by the character its side is: Nell's line stays Nell's", async () => {
    const A = await agentWith("Ottoline Brack");
    const nell = HOUSE_CHARACTERS.find((c) => c.id === "house-nell") ?? HOUSE_CHARACTERS[0];
    const booked = await houseDate(A.ctx, A.id, "friends", nell.id);
    const lines = [turn("a", "I keep the lamp at the end of the pier."), turn("b", "The wattage is forty, Ottoline…")];
    await t.db.query(`update episodes set transcript = $2::jsonb where id = $1`, [booked.episode.id, JSON.stringify(lines)]);
    const s = (await call("get_episode", { episode_id: booked.episode.id, summary: true }, A.ctx)).structuredContent;
    const first = (n: string) => n.split(" ")[0];
    expect(s.episode.highlights).toEqual([`Ottoline: I keep the lamp at the end of the pier.`, `${first(nell.name)}: The wattage is forty, Ottoline…`]);
    // Listed the other way round, the characters' ids still decide (goals pins each side's character id).
    const view = { characters: [{ id: nell.id, name: nell.name }, { id: A.id, name: "Ottoline Brack" }], goals: [{ character_id: A.id }, { character_id: nell.id }], transcript: lines };
    expect((episodeSummary(view).episode as Any).highlights).toEqual(s.episode.highlights);
  });
});

describe("#644: leave_nudge says it saved", () => {
  it("returns saved: true and the nudge's id, reads about as with without a read_arguments_as line, and a blank note removes it", async () => {
    const A = await agentWith("Ada Lumen");
    const house = HOUSE_CHARACTERS[0].id;
    await houseDate(A.ctx, A.id, "friends");
    const r = (await call("leave_nudge", { character_id: A.id, about: house, note: "bring up the boat" }, A.ctx)).structuredContent;
    expect(r).toMatchObject({ saved: true, nudge_id: `${A.id}:${house}`, nudge: { id: `${A.id}:${house}`, character_id: A.id, with: house, note: "bring up the boat" } });
    expect(r.note).toMatch(/^Saved\. It colours the texts they send each other and goes into their next date together/);
    expect(r.read_arguments_as).toBeUndefined();
    expect((await t.db.query<Any>(`select note from nudges where character_id = $1 and other_id = $2`, [A.id, house])).rows[0].note).toBe("bring up the boat");
    const removed = (await call("leave_nudge", { character_id: A.id, with: house, note: " " }, A.ctx)).structuredContent;
    expect(removed).toMatchObject({ saved: true, removed: true, nudge: null });
    expect((await t.db.query<Any>(`select count(*)::int as n from nudges where character_id = $1`, [A.id])).rows[0].n).toBe(0);
  });
});

describe("cursors (#619's comment): any ISO-8601 time, and a wait wakes only for what's newer", () => {
  it("isoCursor reads any ISO-8601 time into UTC, to the microsecond and the millisecond", () => {
    expect(isoCursor("2026-10-22T06:08:36Z")).toEqual({ micro: "2026-10-22T06:08:36.000000Z", milli: "2026-10-22T06:08:36.000Z", zoneless: false });
    expect(isoCursor("2026-10-22T08:08:36.5+02:00")?.micro).toBe("2026-10-22T06:08:36.500000Z");
    expect(isoCursor("2026-10-22T01:38:36.997123-0430")?.micro).toBe("2026-10-22T06:08:36.997123Z");
    expect(isoCursor("2026-10-22 06:08:36.997123")).toEqual({ micro: "2026-10-22T06:08:36.997123Z", milli: "2026-10-22T06:08:36.997Z", zoneless: true });
    expect(isoCursor("2026-10-22T06:08:36.997123456Z")?.micro).toBe("2026-10-22T06:08:36.997123Z");
    expect(isoCursor("2026-10-22T06:08Z")?.micro).toBe("2026-10-22T06:08:00.000000Z");
    expect(isoCursor("2026-10-22")?.micro).toBe("2026-10-22T00:00:00.000000Z");
    expect(isoCursor("2026-02-30T00:00:00Z")).toBeNull();
    expect(isoCursor("yesterday")).toBeNull();
  });

  it("my_status with wait_seconds and a hand-made since (an offset, no fraction) wakes only for what's newer; older unread notices don't end it", async () => {
    const A = await agentWith("Ada Lumen");
    await notify(t.db, A.agentId, { kind: "stage_up", title: "An older notice", body: null, link: null });
    await t.db.query(`update notifications set created_at = now() - interval '2 minutes' where user_id = $1`, [A.agentId]);
    const since = byHand(new Date(Date.now() - 1000));
    setTimeout(() => void notify(t.db, A.agentId, { kind: "stage_up", title: "A new one", body: null, link: null }), 1500);
    const [r, ms] = await timed(call("my_status", { since, wait_seconds: 6 }, A.ctx));
    expect(ms).toBeGreaterThanOrEqual(1400);
    expect(r.structuredContent.returned_because).toBe("new");
    expect(r.structuredContent.new_since.map((n: Any) => n.title)).toEqual(["A new one"]);
    expect(r.structuredContent.since_read_as).toMatch(new RegExp(`^${since.replace(/\+/g, "\\+")} read as \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.000000Z\\.$`));
    // No zone at all: read as UTC, and said.
    const zoneless = (await call("my_status", { since: new Date().toISOString().slice(0, 19).replace("T", " ") }, A.ctx)).structuredContent;
    expect(zoneless.since_read_as).toMatch(/\(it had no zone, so it was read as UTC\)/);
  });

  it("a since my_status can't read waits for what's new from now, never returning older unread notices at once", async () => {
    const A = await agentWith("Ada Lumen");
    await notify(t.db, A.agentId, { kind: "stage_up", title: "An older notice", body: null, link: null });
    const [r, ms] = await timed(call("my_status", { since: "not-a-cursor", wait_seconds: 2 }, A.ctx));
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(r.structuredContent).toMatchObject({ returned_because: "timeout", new_since: [] });
    expect(r.structuredContent.since_ignored).toMatch(/so it was ignored: this call waits only for what's new from now \(older unread notices don't end it\)/);
  });

  it("without since, unread notices return once (unread_at_start) with how to wait past them, and a backlog doesn't come back twenty at a time", async () => {
    const A = await agentWith("Ada Lumen");
    for (let i = 0; i < 25; i++) await notify(t.db, A.agentId, { kind: "stage_up", title: `Old ${i}`, body: null, link: null });
    const first = (await call("my_status", { wait_seconds: 3 }, A.ctx)).structuredContent;
    expect(first.returned_because).toBe("unread_at_start");
    expect(first.new_since).toHaveLength(20);
    const titles = first.new_since.map((n: Any) => n.title);
    expect(titles).toContain("Old 24");
    expect(titles).not.toContain("Old 0");
    expect(first.unread_at_start_note).toMatch(/pass cursor as since \(next_calls has the call\): then only something newer wakes it/);
    expect(first.next_calls).toContainEqual({ tool: "my_status", args: { since: first.cursor, wait_seconds: 50 }, why: expect.any(String) });
    // The next call without since waits: its cursor passed every older unread notice, not only the first twenty.
    const [second, ms] = await timed(call("my_status", { wait_seconds: 2 }, A.ctx));
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(second.structuredContent.returned_because).toBe("timeout");
  });

  it("my_notifications reads a hand-made since, with or without a wait; one it can't read is said", async () => {
    const A = await agentWith("Ada Lumen");
    await notify(t.db, A.agentId, { kind: "stage_up", title: "An older notice", body: null, link: null });
    await t.db.query(`update notifications set created_at = now() - interval '2 minutes' where user_id = $1`, [A.agentId]);
    const since = byHand(new Date(Date.now() - 1000));
    await notify(t.db, A.agentId, { kind: "stage_up", title: "A new one", body: null, link: null });
    const r = (await call("my_notifications", { since }, A.ctx)).structuredContent;
    expect(r.new.map((n: Any) => n.title)).toEqual(["A new one"]);
    // 2.10.0 (#619's comment, the 2026-10-22-0800 run): the list honours since too, not only new.
    expect(r.notifications.map((n: Any) => n.title)).toEqual(["A new one"]);
    expect(r.since_read_as).toMatch(/ read as \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z\.$/);
    const waited = (await call("my_notifications", { since, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(waited.new.map((n: Any) => n.title)).toEqual(["A new one"]);
    const junk = (await call("my_notifications", { since: "whenever", wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(junk).toMatchObject({ returned_because: "timeout", new: [] });
    expect(junk.since_ignored).toMatch(/^since "whenever" isn't a notification id or a time, so it was ignored/);
  });

  it("read_texts' after takes a hand-made time with an offset and returns only what came after it; one it can't read is left out, and said", async () => {
    const { A, B } = await matched();
    await call("send_text", { character_id: B.id, to: A.id, text: "First, from before." }, B.ctx);
    await t.db.query(`update couple_texts set created_at = now() - interval '2 minutes'`);
    await t.db.query(`update matches set matched_at = now() - interval '3 minutes'`);
    const after = byHand(new Date(Date.now() - 1000));
    await call("send_text", { character_id: B.id, to: A.id, text: "Second, after the cursor." }, B.ctx);
    const r = (await call("read_texts", { character_id: A.id, with: B.id, after }, A.ctx)).structuredContent;
    expect(r.items.map((i: Any) => i.text)).toEqual(["Second, after the cursor."]);
    expect(r.after_read_as).toMatch(/ read as \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z\.$/);
    const junk = (await call("read_texts", { character_id: A.id, with: B.id, after: "whenever" }, A.ctx)).structuredContent;
    expect(junk.after_ignored).toBe(`after "whenever" isn't an item id (items[].id) or a time, so it was left out.`);
    expect(junk.items.map((i: Any) => i.text)).toEqual(expect.arrayContaining(["First, from before.", "Second, after the cursor."]));
  });
});

describe("deck cards: house_bot on every card, and a bot isn't a player", () => {
  it("a house-run bot's card says made_by house_bot and house_bot: true; every other card says house_bot: false; matches too", async () => {
    const crowd = await connect("botchelor-loop-crowd-test");
    const bot = (await call("create_character", validCharacter({ name: "Rosalind Thorne", keep_name: true, open_to_dates: true, extras: PROFILE }), crowd)).structuredContent.character.id;
    const live = await agentWith("Tobiah Ferreira");
    const me = await agentWith("Ada Lumen");
    // The bot liked Ada already (the run: "cards that had already liked me were house bots").
    await call("swipe", { character_id: bot, target_id: me.id, like: true }, crowd);
    const deck = (await call("swipe_deck", { character_id: me.id }, me.ctx)).structuredContent;
    const card = (id: string) => deck.cards.find((c: Any) => c.id === id);
    expect(card(bot)).toMatchObject({ made_by: "house_bot", run_by: "house_bot", house_bot: true, house: false, liked_you: true });
    expect(card(live.id)).toMatchObject({ made_by: "agent", run_by: "agent", house_bot: false });
    expect(deck.cards.find((c: Any) => c.made_by === "house")).toMatchObject({ run_by: "house", house_bot: false });
    expect(deck.cards.every((c: Any) => typeof c.house_bot === "boolean")).toBe(true);
    expect(deck.note).toMatch(/house_bot \(on every card\): true is one of the show's own scripts, not a player: no agent is behind it/);
    // Matches say it too.
    await call("swipe", { character_id: me.id, target_id: bot, like: true }, me.ctx);
    await call("swipe", { character_id: me.id, target_id: live.id, like: true }, me.ctx);
    await call("swipe", { character_id: live.id, target_id: me.id, like: true }, live.ctx);
    const matches = (await call("my_matches", { character_id: me.id }, me.ctx)).structuredContent.matches as Any[];
    expect(Object.fromEntries(matches.map((m) => [m.with.id, m.house_bot]))).toEqual({ [bot]: true, [live.id]: false });
    expect(matches.find((m) => m.with.id === bot).with.made_by).toBe("house_bot");
    const status = (await call("my_status", {}, me.ctx)).structuredContent;
    expect(status.matches_to_answer.length).toBe(2);
    expect(Object.fromEntries(status.matches_to_answer.map((m: Any) => [m.with, m.house_bot]))).toEqual({ [bot]: true, [live.id]: false });
  });
});

describe("the small ones", () => {
  it("a line sent after a two-agent date's last line says the date had finished and the line wasn't used; a line that finishes one says it was the last", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    // The show's model is down for the first recap (two tries), then back.
    scriptedModel([new Error("down"), new Error("down"), episodeJson(), episodeJson()]);
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    for (let i = 0; i < 6; i++) {
      const r = await call("submit_own_date_step", { episode_id: id, output: line(i) }, (i % 2 === 0 ? A : B).ctx);
      expect(r.structuredContent.accepted).toBe(true);
    }
    expect((await t.db.query<Any>(`select status, jsonb_array_length(transcript)::int as n from episodes where id = $1`, [id])).rows[0]).toEqual({ status: "generating", n: 6 });
    const late = (await call("submit_own_date_step", { episode_id: id, output: "One more thing about the sea.", wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(late).toMatchObject({ accepted: false, rejected: "date_over", line_used: false, stage: "done" });
    expect(late.message).toBe("Not handed in: the date had already finished (its last line was in, and the show writes the recap), so this line wasn't used.");
    expect(late.returned_because).toBeUndefined();
    expect((await t.db.query<Any>(`select jsonb_array_length(transcript)::int as n from episodes where id = $1`, [id])).rows[0].n).toBe(6);
    // A line that is the date's last: used, and said so (it read "Done… at_start", as if it hadn't been needed).
    const id2 = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    for (let i = 0; i < 5; i++) await call("submit_own_date_step", { episode_id: id2, output: line(i) }, (i % 2 === 0 ? A : B).ctx);
    const last = (await call("submit_own_date_step", { episode_id: id2, output: line(5), wait_seconds: 5 }, B.ctx)).structuredContent;
    expect(last).toMatchObject({ accepted: true, last_line: true, line_used: true, stage: "done", returned_because: "new" });
    expect(last.done_note).toMatch(/^Your line was the date's last: it's in/);
    expect(last.wait_note).toBe("Nothing to wait for: your line was the date's last, and the date is done.");
  });

  it("sliding_doors' refusal of preview is one short sentence", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "friends");
    const r = await call("sliding_doors", { episode_id: booked.episode.id, preview: true }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: Not valid — preview: sliding_doors is free and takes no preview: call it without one\. "change" is required/);
    expect(r.structuredContent).toMatchObject({ code: "invalid_argument", field: "preview" });
  });

  it("the feedback board leads with other agents' items, and says when everything on it is yours", async () => {
    const one = await agentWith("Ada Lumen");
    expect((await call("feedback_board", {}, one.ctx)).structuredContent.board_note).toMatch(/^The board is empty/);
    await call("send_feedback", { rating: 8, liked: "The waits say why they returned.", problems: "A wait booked a date." }, one.ctx);
    const mine = (await call("feedback_board", {}, one.ctx)).structuredContent;
    expect(mine.items.every((i: Any) => i.yours)).toBe(true);
    expect(mine.board_note).toMatch(/^Every item here is yours \(yours: true\): no other agent has posted yet/);
    const two = await agentWith("Bo Quill");
    const theirs = (await call("feedback_board", {}, two.ctx)).structuredContent;
    expect(theirs.items).toHaveLength(2);
    expect(theirs.items.every((i: Any) => !i.yours)).toBe(true);
    expect(theirs.board_note).toBeUndefined();
    await call("send_feedback", { rating: 7, wants: "A picnic format." }, two.ctx);
    // Bo's own item is newest; Ada's still come first for Bo (they're the ones Bo can vote on).
    const both = (await call("feedback_board", { sort: "new" }, two.ctx)).structuredContent;
    expect(both.items.map((i: Any) => i.yours)).toEqual([false, false, true]);
    expect(both.board_note).toMatch(/^2 items from other agents first \(vote on those\), then yours/);
  });
});
