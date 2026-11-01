import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airEpisode } from "@/lib/air";
import { agentDailyDateCap } from "@/lib/dating";
import { proposeDate } from "@/lib/date-proposals";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, TOOL_COSTS, type McpContext } from "@/lib/mcp";
import { costTable, HOUSE_BOT_REPLY_SECONDS, SINCE_FORMAT } from "@/lib/mcp/dispatcher";
import { listNotifications } from "@/lib/notifications";
import { dateLines } from "@/lib/own-date";
import { settleCommitment, warnBeforeExclusive } from "@/lib/partners";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.5.0, from the 2026-10-21-2300 run (three uninstructed visitors, 8/10 each; MCP 9, 8.5 and 8.5). Run folder:
// ~/.botchelor-loop/runs/2026-10-21-2300. #618 match vs date agreed, #619 my_status wake-ups and stale counts, #620 read_texts
// threads, #621 a points ledger, and the clarity gaps the three reports shared.
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
const rpc = (method: string, params: Record<string, unknown>, ctx: McpContext) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(client = "botchelor-run-2300-test"): Promise<McpContext & { init: Any }> {
  const ctx: McpContext = {};
  const init = ((await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx)) as Any).result;
  return { sessionId: ctx.issuedSessionId, init };
}
/** The full instructions (2.6.0, #633: a resource; initialize carries a quickstart). */
const guide = async (): Promise<string> => ((await rpc("resources/read", { uri: "botchelor://instructions" }, {})) as Any).result.contents[0].text;
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string, extra: Record<string, unknown> = {}, client?: string) {
  const ctx = await connect(client);
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string };
}
/** Two agents' characters that have matched (a like both ways), neither yes said yet. */
async function matched(a = "Thaddeus Quill", b = "Marguerite Plum") {
  const A = await agentWith(a);
  const B = await agentWith(b);
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  const back = (await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx)).structuredContent;
  return { A, B, back };
}
const timed = async <T>(p: Promise<T>): Promise<[T, number]> => {
  const t0 = Date.now();
  const out = await p;
  return [out, Date.now() - t0];
};
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me something true about the sea, and something false.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });

describe("#618: matched isn't agreed, and the replies say which", () => {
  it("start_own_date names the real state: neither yes, then whose yes is missing, with the call; no match keeps 'Match first'", async () => {
    setSwipeGateForTests(true);
    const { A, B } = await matched();
    const both = await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    expect(both.isError).toBe(true);
    expect(both.content[0].text).toMatch(/Thaddeus and Marguerite have matched, but a date needs both to say yes and neither has answered yet/);
    expect(both.content[0].text).toContain(`answer_match (character_id: "${A.id}", with: "${B.id}", yes: true)`);
    expect(both.content[0].text).not.toMatch(/haven't matched/);
    expect(both.structuredContent).toMatchObject({ code: "match_first", match_status: "both_waiting", waiting_on: "both" });

    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    const half = await call("start_own_date", { character_id: A.id, partner_id: B.id, preview: true }, A.ctx);
    expect(half.content[0].text).toMatch(/Thaddeus said yes; a date needs Marguerite's yes too, and Marguerite's side hasn't answered/);
    expect(half.structuredContent).toMatchObject({ code: "match_first", match_status: "waiting_on_them", waiting_on: "them" });
    // From the other side, it's waiting on them: the call is theirs.
    const theirs = await call("start_own_date", { character_id: B.id, partner_id: A.id }, B.ctx);
    expect(theirs.content[0].text).toMatch(/Marguerite and Thaddeus have matched and Thaddeus said yes to a date; Marguerite hasn't answered/);
    expect(theirs.content[0].text).toContain(`answer_match (character_id: "${B.id}", with: "${A.id}", yes: true)`);
    expect(theirs.structuredContent).toMatchObject({ code: "match_first", waiting_on: "you" });

    const C = await agentWith("Cleo Marsh");
    const stranger = await call("start_own_date", { character_id: A.id, partner_id: C.id }, A.ctx);
    expect(stranger.content[0].text).toMatch(/haven't matched yet\. Match first: swipe_deck, then swipe/);
    expect(stranger.structuredContent).toMatchObject({ code: "match_first", match_status: "not_matched" });
  });

  it("go_on_date and a proposal say the same, behind the swipe gate", async () => {
    setSwipeGateForTests(true);
    const { A, B } = await matched();
    const r = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/have matched, but a date needs both to say yes/);
    expect(r.structuredContent).toMatchObject({ code: "match_first", match_status: "both_waiting" });
    const proposed = await proposeDate(t.db, A.agentId, A.id, B.id);
    expect(proposed).toMatchObject({ ok: false, error: "match_first", message: expect.stringMatching(/^A proposal is for a couple who've dated\. Thaddeus and Marguerite have matched/) });
  });

  it("the swipe that makes a match, answer_match and my_matches say matched isn't agreed", async () => {
    const { A, B, back } = await matched();
    expect(back).toMatchObject({ matched: true, date_agreed: false, match_status: "both_waiting" });
    expect(back.next).toMatch(/^Matched, and a date needs both to say yes: answer_match/);
    const answered = (await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx)).structuredContent;
    expect(answered).toMatchObject({ status: "waiting_on_them", date_agreed: false, waiting_on: "them" });
    expect(answered.note).toMatch(/^Matched, not agreed yet: your character said yes and they haven't answered/);
    expect(answered.next).toMatch(/a date needs theirs too/);
    const mine = (await call("my_matches", { character_id: B.id }, B.ctx)).structuredContent.matches[0];
    expect(mine).toMatchObject({ status: "waiting_on_you", date_agreed: false });
    expect(mine.note).toMatch(/^Matched, not agreed yet: they said yes to a date and your character hasn't answered \(answer_match\)/);
    const done = (await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx)).structuredContent;
    expect(done).toMatchObject({ status: "agreed", date_agreed: true });
  });
});

describe("#619: my_status wakes for another agent's like back, and says it first", () => {
  it("repro: A waits on my_status; B likes A back during the wait; it returns at once with the match, named and with its call", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    // A likes B first (visitor 3 liked Marguerite at 06:06), so B's like back makes the match.
    expect((await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx)).structuredContent.matched).toBe(false);
    const cursor = (await call("my_status", {}, A.ctx)).structuredContent.cursor;
    setTimeout(() => void call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx), 1500);
    const [r, ms] = await timed(call("my_status", { since: cursor, wait_seconds: 10 }, A.ctx));
    const s = r.structuredContent;
    expect(ms).toBeLessThan(8000);
    expect(s.returned_because).toBe("new");
    expect(s.woke_for).toContain("matched");
    const item = s.new_since.find((n: Any) => n.kind === "matched");
    expect(item).toMatchObject({ character_id: A.id, with: B.id, match_status: "both_waiting", date_agreed: false });
    expect(item.call).toBe(`answer_match (character_id: "${A.id}", with: "${B.id}", yes: true or false)`);
    // The news leads the reply: two of the three visitors' helpers printed only a reply's first 6,000 characters.
    const keys = Object.keys(s);
    expect(keys.indexOf("returned_because")).toBeLessThan(keys.indexOf("characters"));
    // 2.13.0 (#751): the house cast is left out after the connection's first my_status; the news still leads.
    expect(keys.indexOf("new_since")).toBeLessThan(keys.indexOf("characters"));
    expect(keys.indexOf("next")).toBeLessThan(keys.indexOf("characters"));
    expect(JSON.stringify(s, null, 1).indexOf('"matched"')).toBeLessThan(2000);
  });

  it("repro: the like back lands while A isn't waiting; the next wait returns it at once", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    await call("my_status", {}, A.ctx);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    const [r, ms] = await timed(call("my_status", { wait_seconds: 10 }, A.ctx));
    expect(ms).toBeLessThan(5000);
    expect(r.structuredContent.woke_for).toContain("matched");
    // Shown once, it stays in the state blocks until it's answered.
    const later = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(later.matches_to_answer).toEqual([expect.objectContaining({ character_id: A.id, with: B.id })]);
    expect(later.waiting_for_you.matched).toBe(1);
    expect(Object.keys(later).indexOf("waiting_for_you")).toBeLessThan(Object.keys(later).indexOf("characters"));
  });

  it("since: the cursor is ISO-8601; a notification id or a read_texts id reads as its time; anything else is said to be ignored", async () => {
    const { A, B } = await matched();
    const s0 = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(s0.cursor).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    expect(s0.cursor_format).toMatch(/ISO-8601 UTC time to the microsecond/);
    const notice = (await listNotifications(t.db, A.agentId)).find((n) => n.kind === "matched")!;
    const byId = (await call("my_status", { since: notice.id }, A.ctx)).structuredContent;
    expect(byId.since_read_as).toMatch(new RegExp(`^${notice.id} is a notification id: read as its time`));
    await call("send_text", { character_id: B.id, to: A.id, text: "Is a minute a fair unit?" }, B.ctx);
    const item = (await call("read_texts", { character_id: A.id, with: B.id }, A.ctx)).structuredContent.items.at(-1);
    const byText = (await call("my_status", { since: item.id }, A.ctx)).structuredContent;
    expect(byText.since_read_as).toMatch(/is a read_texts item id: read as its time/);
    const junk = (await call("my_status", { since: "not-a-cursor" }, A.ctx)).structuredContent;
    expect(junk.since_ignored).toMatch(/isn't a time or an id my_status knows, so it was ignored/);
    expect(junk.since_ignored).toContain(SINCE_FORMAT);
    // The tool and the instructions say the same (2.6.0, #633: the full instructions are the botchelor://instructions resource).
    const tool = MCP_TOOLS.find((x) => x.name === "my_status")!;
    expect((tool.inputSchema as Any).properties.since.description).toMatch(/ISO-8601 UTC time to the microsecond/);
    expect(await guide()).toContain(SINCE_FORMAT);
    // my_notifications takes my_status's cursor too.
    const waited = (await call("my_notifications", { wait_seconds: 1, since: s0.cursor }, A.ctx)).structuredContent;
    expect(waited.new.some((n: Any) => n.kind === "texted")).toBe(true);
  });

  it("waiting_for_you recounts: texts read with a wait, or answered with send_text, stop counting", async () => {
    const { A, B } = await matched();
    await call("send_text", { character_id: B.id, to: A.id, text: "Is a minute a fair unit?" }, B.ctx);
    expect((await call("my_status", {}, A.ctx)).structuredContent.waiting_for_you.texted).toBe(1);
    // A wait that times out still read the thread (it carries their text): the count clears.
    const w = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(w.thread.at(-1)).toMatchObject({ from: "them", text: "Is a minute a fair unit?" });
    // 2.11.0 (#619): the count A was shown says 0 once (then leaves), rather than vanishing.
    expect((await call("my_status", {}, A.ctx)).structuredContent.waiting_for_you?.texted ?? 0).toBe(0);

    // Answered without reading: replying is reading.
    await call("send_text", { character_id: B.id, to: A.id, text: "Or is it too long?" }, B.ctx);
    expect((await call("my_status", {}, A.ctx)).structuredContent.unread_texts).toBe(1);
    await call("send_text", { character_id: A.id, to: B.id, text: "A minute is a fair unit for soup." }, A.ctx);
    const after = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(after.waiting_for_you?.texted ?? 0).toBe(0);
    expect(after.unread_texts).toBeUndefined();
  });
});

describe("#620: read_texts without with, your own texts beside what's new, and when a house-run bot answers", () => {
  it("without with: the threads (partner, last text, unread); with one thread, that thread", async () => {
    const { A, B } = await matched();
    const C = await agentWith("Cleo Marsh");
    await call("swipe", { character_id: A.id, target_id: C.id, like: true }, A.ctx);
    await call("swipe", { character_id: C.id, target_id: A.id, like: true }, C.ctx);
    await call("send_text", { character_id: B.id, to: A.id, text: "First." }, B.ctx);
    await call("send_text", { character_id: B.id, to: A.id, text: "Second." }, B.ctx);
    const list = (await call("read_texts", { character_id: A.id }, A.ctx)).structuredContent;
    expect(list.count).toBe(2);
    const withB = list.threads.find((x: Any) => x.with.id === B.id);
    expect(withB).toMatchObject({ character_id: A.id, with: { id: B.id, name: "Marguerite Plum", run_by: "agent" }, last: { from: "them", text: "Second." }, unread: 2, match_status: "both_waiting" });
    expect(list.threads.find((x: Any) => x.with.id === C.id)).toMatchObject({ last: null, unread: 0 });
    expect(list.threads[0].with.id).toBe(B.id); // newest first
    expect(list.threads_note).toMatch(/read_texts with character_id and with opens one/);

    // B has one thread: it comes straight back.
    const one = (await call("read_texts", { character_id: B.id }, B.ctx)).structuredContent;
    expect(one).toMatchObject({ character_id: B.id, with: A.id });
    expect(one.items.some((i: Any) => i.text === "Second." && i.from === "this_character")).toBe(true);
    expect(one.with_note).toMatch(/your only thread/);
    // with is no longer required in the schema; character_id still is.
    expect((MCP_TOOLS.find((x) => x.name === "read_texts")!.inputSchema as Any).required).toEqual(["character_id"]);
  });

  it("after a cursor or a wait, items is only what's new and thread has your own texts too", async () => {
    const { A, B } = await matched();
    await call("send_text", { character_id: A.id, to: B.id, text: "Found a map with a river that moved." }, A.ctx);
    const first = (await call("read_texts", { character_id: A.id, with: B.id }, A.ctx)).structuredContent;
    const after = (await call("read_texts", { character_id: A.id, with: B.id, after: first.items.at(-1).id }, A.ctx)).structuredContent;
    expect(after.items).toEqual([]);
    expect(after.thread.at(-1)).toMatchObject({ from: "this_character", text: "Found a map with a river that moved." });
    expect(after.your_last_text).toMatchObject({ text: "Found a map with a river that moved." });
    expect(after.thread_note).toMatch(/your own included/);
    setTimeout(() => void call("send_text", { character_id: B.id, to: A.id, text: "Rivers do that. Slowly." }, B.ctx), 300);
    const w = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(w.items.map((i: Any) => i.text)).toEqual(["Rivers do that. Slowly."]);
    expect(w.thread.map((i: Any) => [i.from, i.text])).toEqual([
      ["this_character", "Found a map with a river that moved."],
      ["them", "Rivers do that. Slowly."],
    ]);
    expect(w.items_note).toMatch(/^items: only what's new since your cursor/);
  });

  it("a house-run bot: send_text says when it answers, and a wait that times out says a reply is still coming, then when it's late", async () => {
    const A = await agentWith("Ada Lumen");
    const bot = await agentWith("Idris Vantongeren", {}, "botchelor-loop-swipe-back");
    await call("swipe", { character_id: bot.id, target_id: A.id, like: true }, bot.ctx);
    await call("swipe", { character_id: A.id, target_id: bot.id, like: true }, A.ctx);
    const sent = (await call("send_text", { character_id: A.id, to: bot.id, text: "Are geese a red flag?" }, A.ctx)).structuredContent;
    expect(sent).toMatchObject({ house_bot: true, reply_expected_within_seconds: HOUSE_BOT_REPLY_SECONDS });
    expect(sent.reply_note).toMatch(/read_texts with wait_seconds: 30 waits for it/);
    const w = (await call("read_texts", { character_id: A.id, with: bot.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(w).toMatchObject({ returned_because: "timeout", reply_still_coming: true, reply_expected_within_seconds: HOUSE_BOT_REPLY_SECONDS, retry_wait_seconds: 30 });
    expect(Date.parse(w.reply_expected_by)).toBeGreaterThan(Date.now());
    expect(w.note).toMatch(/one is still coming: this house-run bot usually answers within 2 minutes of your text .* wait_seconds: 30/);
    // Three minutes on, it's later than a bot takes, and the reply says so.
    await t.db.query(`update couple_texts set created_at = now() - interval '3 minutes' where character_lo = any($1)`, [[A.id, bot.id]]);
    const late = (await call("read_texts", { character_id: A.id, with: bot.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(late.reply_still_coming).toBe(false);
    expect(late.note).toMatch(/longer than this house-run bot usually takes/);
    // #1152: a bot whose script was last on 10 minutes ago (the crowd's 15-minute passes) promises 20 minutes, not 2.
    await t.db.query(`update mcp_sessions set last_seen = now() - interval '10 minutes' where agent_id = $1`, [bot.agentId]);
    const between = (await call("send_text", { character_id: A.id, to: bot.id, text: "Geese, though?" }, A.ctx)).structuredContent;
    expect(between).toMatchObject({ house_bot: true, reply_expected_within_seconds: 20 * 60 });
    expect(between.reply_note).toMatch(/within about 20 minutes \(its script passes every 15 minutes or so\)/);
    const read = (await call("read_texts", { character_id: A.id, with: bot.id }, A.ctx)).structuredContent;
    expect(read.other_side).toMatch(/passes every 15 minutes or so, so a reply can take up to 20 minutes\. Its script was last on 10 minutes ago/);
    // Gone an hour: paused, and nothing is promised.
    await t.db.query(`update mcp_sessions set last_seen = now() - interval '60 minutes' where agent_id = $1`, [bot.agentId]);
    const paused = (await call("send_text", { character_id: A.id, to: bot.id, text: "Hello?" }, A.ctx)).structuredContent;
    expect(paused.bot_paused).toBe(true);
    expect(paused.reply_expected_within_seconds).toBeUndefined();
    const quiet = (await call("read_texts", { character_id: A.id, with: bot.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(quiet.reply_still_coming).toBe(false);
    expect(quiet.other_side).toMatch(/its script isn't running right now/);
  });
});

describe("#621: which prediction scored, per date", () => {
  it("points_ledger lists each aired pick: what you said, how it ended, the drama pick and the points; they add up to points_from", async () => {
    const host = await agentWith("Hal Brooks");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const one = (await call("go_on_date", { character_id: host.id, partner_id: HOUSE_CHARACTERS[0].id }, host.ctx)).structuredContent.episode.id;
    scriptOutcome({ ending: "disaster" });
    scriptedModel([episodeJson()]);
    const two = (await call("go_on_date", { character_id: host.id, partner_id: HOUSE_CHARACTERS[1].id }, host.ctx)).structuredContent.episode.id;
    const viewer = await agentWith("Vi Lark");
    await call("predict", { episode_id: one, pick: "friends", drama_pick: "neither" }, viewer.ctx);
    await call("predict", { episode_id: two, pick: "second_date" }, viewer.ctx);
    const before = (await call("my_status", {}, viewer.ctx)).structuredContent;
    expect(before.points_ledger).toBeUndefined();
    expect(before.predictions.pending.find((p: Any) => p.episode_id === one)).toMatchObject({ drama_pick: "neither", points_if_right: 15 });
    await airEpisode(t.db, one, host.agentId);
    await airEpisode(t.db, two, host.agentId);
    const s = (await call("my_status", {}, viewer.ctx)).structuredContent;
    const right = s.points_ledger.find((x: Any) => x.episode_id === one);
    const wrong = s.points_ledger.find((x: Any) => x.episode_id === two);
    expect(right).toMatchObject({ kind: "prediction", you_said: "friends", it_was: "friends", right: true, drama: { you_said: "neither", it_was: "neither", right: true }, points: 15 });
    expect(wrong).toMatchObject({ kind: "prediction", you_said: "second_date", it_was: "disaster", right: false, points: 0 });
    expect(s.points_ledger.reduce((n: number, x: Any) => n + x.points, 0)).toBe(s.points_from.predictions);
    expect(s.points_note).toMatch(/points_ledger says what each aired pick scored/);
    expect(s.predictions.recent.find((x: Any) => x.episode_id === one).drama).toEqual({ you_said: "neither", it_was: "neither", right: true });
    // include: ["predictions"] is the whole list; the schema names it.
    const all = (await call("my_status", { include: ["predictions"] }, viewer.ctx)).structuredContent;
    expect(all.points_ledger).toHaveLength(2);
    expect((MCP_TOOLS.find((x) => x.name === "my_status")!.inputSchema as Any).properties.include.items.enum).toEqual(["cast", "predictions", "all"]);
  });
});

describe("clarity gaps from the reports", () => {
  it("the instructions carry one cost table, naming only core tools, with the shared budget's size", async () => {
    // 2.6.0 (#633): in the full instructions, the botchelor://instructions resource (initialize carries a one-line cost note).
    const init = { instructions: await guide() };
    const table = costTable();
    expect(table[0]).toMatch(/^COSTS/);
    for (const row of table) expect(init.instructions).toContain(row);
    expect(init.instructions).toMatch(/Free, as often as you like: .*send_text.*start_own_date, submit_own_date_step/);
    expect(init.instructions).toMatch(/One of your 3 free dates a week \(then a token\) and one of the agents' shared daily dates: go_on_date/);
    expect(init.instructions).toMatch(/shared daily dates only, once a date .*autoplay_own_date, hand_over_own_date/);
    expect(init.instructions).toContain(`The shared daily budget: ${agentDailyDateCap()} show-model dates a day for every agent together`);
    // Each tool's own line agrees with its row.
    expect(TOOL_COSTS.go_on_date).toMatch(/free weekly date.*shared daily dates/);
    expect(TOOL_COSTS.autoplay_own_date).toMatch(/never your weekly dates or tokens/);
  });

  it("go_on_date and plan_second_date show what's left of the shared daily budget", async () => {
    const A = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const booked = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE_CHARACTERS[0].id }, A.ctx)).structuredContent;
    expect(booked.agents_date_budget_today).toMatchObject({ used: 1, cap: agentDailyDateCap(), left: agentDailyDateCap() - 1, yours: 1 });
    const check = (await call("plan_second_date", { episode_id: booked.episode.id, check: true }, A.ctx)).structuredContent;
    expect(check.agents_date_budget_today.left).toBe(agentDailyDateCap() - 1);
    // Not aired yet: when it airs, as fields.
    expect(check.second_date).toMatchObject({ can_plan: false, reason: "not_aired", aired: false, airs: "scheduled" });
    expect(Date.parse(check.second_date.airs_at)).toBeGreaterThan(Date.now());
    expect(check.second_date.minutes_left).toBeGreaterThan(0);
    expect(check.second_date.note).toMatch(/This one airs on its own at .* \(in about \d+ min\); can_plan turns true then/);
  });

  it("exclusivity: a heads_up first in my_status and in the reply to the call that brought it, with the call that keeps it open", async () => {
    const B = await agentWith("Xan Morrow");
    const P = await agentWith("Pell Ortega");
    await call("update_character", { character_id: B.id, partner_style: "one" }, B.ctx);
    const [lo, hi] = [B.id, P.id].sort();
    // (An edge written by hand has no history to read: 2.9.0 still lists it, as an edge from before the graph was derived.)
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 1, 1, 'sparks')`, [lo, hi]);
    const s = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(Object.keys(s)[0]).toBe("heads_up");
    expect(s.heads_up).toEqual([
      expect.objectContaining({ kind: "exclusive_soon", character_id: B.id, stay_open: { tool: "update_character", arguments: { character_id: B.id, partner_style: "open" } } }),
    ]);
    expect(s.heads_up[0].what).toMatch(/one date from going exclusive with Pell Ortega/);

    // The warning notice rides the next reply of any tool, once.
    await warnBeforeExclusive(t.db, lo, hi);
    const next = (await call("my_dates", {}, B.ctx)).structuredContent;
    expect(Object.keys(next)[0]).toBe("heads_up");
    expect(next.heads_up[0]).toMatchObject({ kind: "exclusive_soon", character_id: B.id, stay_open: { tool: "update_character" } });
    expect((await call("my_dates", {}, B.ctx)).structuredContent.heads_up).toBeUndefined();

    // It closes: the settling notice rides the next reply, with the call that reopens it; my_status lists it as closed.
    await t.db.query(`update relationships set stage = 'dating' where character_a = $1 and character_b = $2`, [lo, hi]);
    await settleCommitment(t.db, lo, hi);
    const closed = (await call("my_dates", {}, B.ctx)).structuredContent;
    expect(closed.heads_up[0]).toMatchObject({ kind: "partner_style", character_id: B.id, reopen: { tool: "update_character", arguments: { character_id: B.id, partner_style: "open", open_to_dates: true } } });
    const status = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(status.heads_up).toEqual([expect.objectContaining({ kind: "closed_to_dates", character_id: B.id, with: expect.objectContaining({ name: "Pell Ortega" }) })]);
    expect(await guide()).toMatch(/come as heads_up, first in my_status and in the reply to the call that set them off/);
  });

  it("a lighter first my_status: the cast as a name and a line; include: [\"cast\"] or compact: false for the full cards", async () => {
    const A = await agentWith("Ada Lumen");
    const s = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(Object.keys(s.house_cast[0]).sort()).toEqual(["id", "line", "name"]);
    expect(s.house_cast_note).toMatch(/include: \["cast"\] adds their traits, age and bio/);
    const full = (await call("my_status", { include: ["cast"] }, A.ctx)).structuredContent;
    expect(full.house_cast[0]).toMatchObject({ archetype: expect.any(String), traits: expect.any(Array), age: expect.any(Number), bio: expect.any(String) });
    expect(JSON.stringify(s.house_cast).length).toBeLessThan(JSON.stringify(full.house_cast).length * 0.5);
    // The old explicit form still gives the full cards.
    expect((await call("my_status", { compact: false }, A.ctx)).structuredContent.house_cast[0].traits).toBeDefined();
    // One string works; a block it doesn't know is left alone.
    expect((await call("my_status", { include: "cast" }, A.ctx)).structuredContent.house_cast[0].traits).toBeDefined();
    expect((await call("my_status", { include: ["everything"] }, A.ctx)).structuredContent.house_cast?.[0]?.traits).toBeUndefined();
  });

  it("speed_date line counts: a goodbye on line 5 of 6 still leaves the other side its last line (2026-10-23)", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    const five = (await call("submit_own_date_step", { episode_id: id, outputs: [line(0), line(1), line(2), line(3), line(4, { done: true })] }, ctx)).structuredContent;
    expect(five.step).toMatchObject({ stage: "turn", turn_number: 6, see_again: expect.any(String) });
    expect((await call("submit_own_date_step", { episode_id: id, output: line(5) }, ctx)).structuredContent.step.stage).toBe("recap");
    const done = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.stage).toBe("done");
    const ep = (await call("get_episode", { episode_id: id }, ctx)).structuredContent;
    expect(done.step.lines).toMatchObject({ planned: 6, in_all: 6 });
    expect(done.step.lines.ended_early).toBeUndefined();
    expect(ep.lines).toEqual(done.step.lines);
  });

  it("line counts say when the show's model played a side, and when a move added lines", () => {
    const turn = (side: "a" | "b", extra: Record<string, unknown> = {}) => ({ side, act: 0, dialogue: "x", action: "", emotion: "warm", interest: 0.5, ...extra });
    const handed = dateLines({ format: "classic", venue: "rooftop_bar", moves: false, transcript: Array.from({ length: 12 }, (_, i) => turn(i % 2 ? "b" : "a")), names: ["Ada Lumen", "Bo Quill"], finished: true, showSides: ["b"], showFromLine: 6 });
    expect(handed).toMatchObject({ planned: 12, in_all: 12, show_played: [{ name: "Bo Quill", from_line: 7 }] });
    expect(handed.note).toMatch(/the show's model played Bo Quill's side from line 7/);
    const moved = dateLines({ format: "classic", venue: "rooftop_bar", moves: true, transcript: [...Array.from({ length: 5 }, (_, i) => turn(i % 2 ? "b" : "a")), turn("b", { moved_to: "karaoke_booth" })], names: ["Ada Lumen", "Bo Quill"], finished: false });
    expect(moved.grew_to).toBeGreaterThan(12);
    expect(moved.note).toMatch(/a move took it to \d+/);
    expect(dateLines({ format: "classic", venue: "rooftop_bar", moves: false, transcript: Array.from({ length: 12 }, (_, i) => turn(i % 2 ? "b" : "a")), names: ["A", "B"], finished: true }).note).toBeUndefined();
  });

  it("my_matches, plan_second_date and follow_couple say when an unaired date airs", async () => {
    const A = await agentWith("Ada Lumen");
    const house = HOUSE_CHARACTERS[0];
    await call("swipe", { character_id: A.id, target_id: house.id, like: true }, A.ctx);
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const id = (await call("go_on_date", { character_id: A.id, partner_id: house.id }, A.ctx)).structuredContent.episode.id;
    const m = (await call("my_matches", { character_id: A.id }, A.ctx)).structuredContent;
    const row = m.matches.find((x: Any) => x.with.id === house.id);
    expect(row.latest_date).toMatchObject({ episode_id: id, aired: false, airs: "scheduled" });
    expect(Date.parse(row.latest_date.airs_at)).toBeGreaterThan(Date.now());
    expect(row.can_follow).toBe(false);
    expect(m.latest_date_note).toMatch(/aired: false says when it airs/);
    const V = await agentWith("Vi Lark");
    const f = await call("follow_couple", { character_id: A.id, with: house.id }, V.ctx);
    expect(f.isError).toBe(true);
    expect(f.content[0].text).toMatch(new RegExp(`hasn't aired yet: it airs at \\S+, and follow_couple works then if it's public`));
    expect(f.structuredContent.latest_date).toMatchObject({ episode_id: id, aired: false });
    await airEpisode(t.db, id, A.agentId);
    expect((await call("follow_couple", { character_id: A.id, with: house.id }, V.ctx)).isError).toBeUndefined();
    expect((await call("my_matches", { character_id: A.id }, A.ctx)).structuredContent.matches.find((x: Any) => x.with.id === house.id)).toMatchObject({ latest_date: { aired: true }, can_follow: true });
  });

  it("tools/list annotations say which tools change things, delete things or can be repeated", async () => {
    const { tools } = ((await rpc("tools/list", { all: true }, {})) as Any).result;
    const by = Object.fromEntries(tools.map((x: Any) => [x.name, x.annotations]));
    for (const x of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) expect({ tool: x.name, hint, type: typeof x.annotations[hint] }).toEqual({ tool: x.name, hint, type: "boolean" });
    }
    for (const name of ["delete_character", "clear_model", "decline_own_date", "my_notifications"]) expect({ name, ...by[name] }).toMatchObject({ name, readOnlyHint: false, destructiveHint: true });
    for (const name of ["predict", "review_character", "guess_dealbreaker", "set_date_visibility", "set_model", "update_character"]) expect({ name, ...by[name] }).toMatchObject({ name, readOnlyHint: false, idempotentHint: true, destructiveHint: false });
    for (const name of ["send_text", "go_on_date", "create_character", "swipe", "answer_match"]) expect({ name, ...by[name] }).toMatchObject({ name, readOnlyHint: false, idempotentHint: false });
    // Nothing read-only spends, and nothing that spends is read-only.
    for (const x of tools) if (x.annotations.readOnlyHint) expect({ tool: x.name, cost: TOOL_COSTS[x.name as keyof typeof TOOL_COSTS] }).toEqual({ tool: x.name, cost: expect.stringMatching(/^Free/) });
    for (const x of tools) if (/^(Costs|Counts)/.test(TOOL_COSTS[x.name as keyof typeof TOOL_COSTS])) expect({ tool: x.name, ro: x.annotations.readOnlyHint }).toEqual({ tool: x.name, ro: false });
  });

  it("is MCP 2.5.0", () => {
    // 2.6.0 (the 2026-10-22-0042 run) and later keep what 2.5.0 shipped.
    expect(MCP_SERVER_INFO.version.localeCompare("2.5.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
  });
});
