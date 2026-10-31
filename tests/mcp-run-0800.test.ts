import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "@/lib/conversation";
import { airEpisode } from "@/lib/air";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, PUBLIC_MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { CHEATSHEET_URI, cheatSheet, ENDING_RULE, genericAliases, normaliseArgs, OWN_ENDING_NOTE } from "@/lib/mcp/dispatcher";
import { MCP_RESOURCES } from "@/lib/mcp/resources";
import { notify } from "@/lib/notifications";
import { LAST_LINE_EXAMPLE, lastLineLead, ONE_LINE_DEFAULTS, oneLineTurn, TURN_SHAPES, unwrapOutput } from "@/lib/own-date";
import { wishReport } from "@/lib/wishes";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.10.0, from the 2026-10-22-0800 run (three uninstructed visitors on 2.9.0: 9, 9 and 8 overall; MCP 9, 8.5 and 8.5).
// Run folder: ~/.botchelor-loop/runs/2026-10-22-0800. The see_again lever said where it matters, #661 the second-date race,
// #662 argument names (aliases, every missing argument in one error, the cheat sheet), #663 one turn shape, the waits in
// #619's comment, and house-bot own dates said up front.
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
const HOUSE = HOUSE_CHARACTERS[0];
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(client = "botchelor-run-0800-test"): Promise<McpContext & { init: Any }> {
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
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string, agentId: r.structuredContent.agent_id as string };
}
type Agent = Awaited<ReturnType<typeof agentWith>>;
/** Two agents' characters that matched and both said yes to a date. */
async function agreed(a = "Ottoline Prewitt", b = "Hestia Moonwhistle") {
  const A = await agentWith(a);
  const B = await agentWith(b);
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
  await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
  return { A, B };
}
/** One agent with two characters of its own. */
async function ownPair() {
  const ctx = await connect();
  const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id as string;
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id as string;
  return { ctx, a, b };
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me something true about the harbour, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });

it("is MCP 2.10.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.10.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("1. the see_again lever, where it matters", () => {
  it("the quickstart says it in one short line, and start_own_date's first reply leads with it, ahead of the step", async () => {
    const ctx = await connect();
    const endings = (ctx.init.instructions as string).split("\n").find((l) => l.startsWith("Endings: "));
    expect(endings).toBe(`Endings: ${ENDING_RULE}.`);
    // 2.11.0 (#656): and a date you write shows where it's heading from its first step.
    expect(ENDING_RULE).toMatch(/^set when a date is booked .*never by what the lines say; a date you write shows where it's heading from its first step \(heading\); your one lever is see_again \(private\) with your character's last line: both true and it can't end in a disaster, both false and it can't be a second date$/);
    // The 2.9.0 wording that hid the lever is gone everywhere an agent reads it first.
    expect(ctx.init.instructions).not.toMatch(/shape how it plays, not how it ends|your lines don't \(only/);
    const own = await ownPair();
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: own.a, partner_id: own.b }, own.ctx)).structuredContent;
    expect(started.ending_note.startsWith(OWN_ENDING_NOTE)).toBe(true);
    expect(OWN_ENDING_NOTE).toBe(
      "How it ends: set now, at booking (who it's with and the sheets), never by what the lines say. Your one lever: see_again: true or false (private) with your character's last line (its step says when). Both true and it can't end in a disaster (a close friends ending becomes a second date); both false and it can't be a second date; one each, the engine's ending stands.",
    );
    const keys = Object.keys(started);
    expect(keys.indexOf("ending_note")).toBeLessThan(keys.indexOf("step"));
    expect(started.ending_note).toMatch(/the finished date says how the wishes counted \(wishes\)/);
  });

  it("a side's last line leads with see_again: the summary, the step's instructions, its reply format and example, and the call that hands it in", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    let r = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    // No step before a side's last line carries it.
    for (let i = 0; !r.step.see_again; i++) {
      expect(r.summary).toMatch(/^Your move: turn/);
      expect(r.last_line).toBeUndefined();
      r = (await call("submit_own_date_step", { episode_id: r.episode_id, output: line(i) }, ctx)).structuredContent;
    }
    expect(r).toMatchObject({ stage: "turn", turn_number: 5, whose_move: "Ada Lumen", last_line: true });
    const lead = lastLineLead("Ada Lumen", "Bo Quill");
    expect(lead).toBe("This is Ada Lumen's last line: add see_again: true or false (private) to say whether Ada Lumen wants another date with Bo Quill; with theirs, it can tip the ending.");
    expect(r.summary.startsWith(lead)).toBe(true);
    expect(r.summary).toMatch(/hand submit_own_date_step \{"dialogue": "…", "see_again": true or false\} \(a bare string can't carry see_again\)\.$/);
    // The step (compact by default after the first): led by it, the format an object with see_again first, and the example.
    expect(r.step.instructions.startsWith(lead)).toBe(true);
    expect(r.step.see_again.startsWith(lead)).toBe(true);
    expect(r.step.see_again).toMatch(/Send it with the line, as \{"dialogue": "…", "see_again": true\} \(a bare string can't carry it\)\. Left out, Ada Lumen's interest_signal across the last act \(the average\) stands in: 0\.65 or more counts as yes, 0\.35 or less as no\.$/);
    expect(r.step.reply_format).toMatch(/^\{"dialogue": "the line", "see_again": true or false \(private: does Ada Lumen want another date\?\)/);
    expect(r.step.example_reply).toBe(LAST_LINE_EXAMPLE);
    expect(JSON.parse(LAST_LINE_EXAMPLE)).toMatchObject({ see_again: true });
    expect(r.next_calls[0]).toEqual({
      tool: "submit_own_date_step",
      args: { episode_id: r.episode_id, output: { dialogue: "<Ada Lumen's line>", see_again: "<true or false: does Ada Lumen want another date?>" } },
      why: expect.stringMatching(/its last line: see_again \(private\) says whether Ada Lumen wants another date, and with theirs it can tip the ending/),
    });
    // compact: true and compact: false lead with it too; the full step's reply_format carries the field.
    const c = (await call("get_own_date_step", { episode_id: r.episode_id, compact: true }, ctx)).structuredContent.step;
    expect(c.instructions.startsWith(lead)).toBe(true);
    const f = (await call("get_own_date_step", { episode_id: r.episode_id, compact: false }, ctx)).structuredContent.step;
    expect(f.instructions.startsWith(lead)).toBe(true);
    expect(f.reply_format).toMatch(/"see_again":"true or false, private: does this character want another date\? With theirs, it can tip the ending\."\}$/);
    expect(f.example_reply).toBe(LAST_LINE_EXAMPLE);
    // The last act's note names the lever first, not "your lines shape how it plays".
    // #728: under engine v4, what both see_agains would do to it, truthfully.
    expect(r.step.act_note).toMatch(/What can still move it is both sides' private see_again on their last lines, not what the lines say: /);
  });

  it("on a two-agent date the finished date says how the wishes counted: your own (sent, or the interest_signal that stood in, and how to steer), theirs private", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson(), episodeJson()]);
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    let last: Any = null;
    for (let i = 0; i < 6; i++) {
      const who = i % 2 === 0 ? A : B;
      // Each performer's last-line step leads with it; A sends no, B sends nothing.
      if (i >= 4) expect((await call("get_own_date_step", { episode_id: id }, who.ctx)).structuredContent.last_line).toBe(true);
      last = (await call("submit_own_date_step", { episode_id: id, output: i === 4 ? line(i, { see_again: false }) : line(i) }, who.ctx)).structuredContent;
    }
    // B's last line finished it: B's reply is the done step, with B's side.
    expect(last).toMatchObject({ stage: "done" });
    expect(last.summary).toMatch(/wishes: how the see_again wishes counted/);
    expect(last.wishes).toEqual({
      tipped: false,
      yours: [{ character: "Hestia Moonwhistle", see_again: null, from: "interest_signal", interest_signal: 0.6 }],
      theirs: "private",
      note:
        "No see_again on Hestia's last line, so its interest_signal across the last act (average 0.6) stood in: no wish either way (0.65 or more counts as yes, 0.35 or less as no). Next time, send see_again: true or false with that line: it's how you steer. " +
        "Ottoline's wish stays private (only an agreement that moves the ending is told). The wishes move an ending only when both agree (both yes: never a disaster; both no: never a second date): they didn't move this one, so second_date is the engine's own ending.",
    });
    // A's no stays A's: nothing in B's reply carries it.
    expect(JSON.stringify(last)).not.toMatch(/"see_again":false/);
    const forA = (await call("get_own_date_step", { episode_id: id }, A.ctx)).structuredContent;
    const keys = Object.keys(forA);
    expect(keys.indexOf("wishes")).toBe(keys.indexOf("result") + 1);
    expect(forA.wishes).toMatchObject({ tipped: false, yours: [{ character: "Ottoline Prewitt", see_again: false, from: "see_again" }], theirs: "private" });
    expect(forA.wishes.note).toMatch(/^Ottoline said no \(see_again: false\)\. second_date is already|^Ottoline said no \(see_again: false\)\. Hestia's wish stays private/);
    expect(forA.wishes.yours[0].interest_signal).toBeUndefined();
  });

  it("between your own two characters it says both: mixed, no tip", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    let step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    for (let i = 0; step.stage === "turn"; i++) {
      const wish = step.see_again ? { see_again: step.side === "a" } : {};
      step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(i, wish) }, ctx)).structuredContent.step;
    }
    const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.stage).toBe("done");
    expect(done.wishes).toEqual({
      tipped: false,
      yours: [
        { character: "Ada Lumen", see_again: true, from: "see_again" },
        { character: "Bo Quill", see_again: false, from: "see_again" },
      ],
      note: "Ada said yes (see_again: true). Bo said no (see_again: false). Ada said yes, Bo no: mixed, so no tip; friends is the engine's own ending.",
    });
  });

  it("wishReport: a tip says both (as why does), both yes at the best ending has nothing to tip, the show's line and an older date say what they can, and nothing before the wishes count", () => {
    const turn = (side: "a" | "b", interest: number): Turn => ({ side, act: 2, dialogue: "…", action: "", emotion: "warm", interest });
    const transcript = [turn("a", 0.9), turn("b", 0.1)];
    const names = ["Ada Lumen", "Bo Quill"] as const;
    const tipped = wishReport({ stored: { a: false, b: false, engine: "second_date", sent: { a: true, b: false } }, transcript, ending: "friends", names, mine: ["a"] });
    expect(tipped).toMatchObject({ tipped: true, engine_ending: "second_date", theirs: { character: "Bo Quill", see_again: false } });
    expect(tipped!.note).toBe("Ada said no (see_again: false). Both said no: it tipped toward a parting: friends, where the engine alone had second_date.");
    const better = wishReport({ stored: { a: true, b: true, engine: "friends", sent: { a: true, b: true } }, transcript, ending: "second_date", names, mine: ["a", "b"] });
    expect(better!.note).toMatch(/Both said yes: it tipped toward a better ending: second_date, where the engine alone had friends\.$/);
    const top = wishReport({ stored: { a: true, b: true, engine: "second_date", sent: { a: true, b: true } }, transcript, ending: "second_date", names, mine: ["a", "b"] });
    expect(top!.note).toMatch(/Both said yes, but second_date is already the best ending: nothing to tip\.$/);
    const kept = wishReport({ stored: { a: false, b: false, engine: "second_date", sent: { a: true, b: true } }, transcript, ending: "second_date", names, mine: ["a", "b"] });
    expect(kept!.note).toMatch(/Both said no, but the engine kept second_date this time \(a tip comes only some of the time\)\.$/);
    const show = wishReport({ stored: { a: true, b: false, engine: "friends", sent: { a: false, b: false } }, transcript, ending: "friends", names, mine: ["a"], showPlayed: ["a"] });
    expect(show!.yours).toEqual([{ character: "Ada Lumen", see_again: true, from: "the_show", interest_signal: 0.9 }]);
    expect(show!.note).toMatch(/^The show's model played Ada's last line, so its interest_signal \(0\.9\) stood in: a yes \(0\.65 or more counts as yes, 0\.35 or less as no\)\./);
    const old = wishReport({ stored: { a: true, b: null, engine: "friends" }, transcript, ending: "friends", names, mine: ["a"] });
    expect(old!.yours[0]).toMatchObject({ from: "unknown", see_again: true });
    expect(old!.note).toMatch(/^Ada's wish counted as yes\./);
    expect(wishReport({ stored: { a: true }, transcript, ending: "friends", names, mine: ["a"] })).toBeNull();
    expect(wishReport({ stored: { a: true, b: true, engine: "friends" }, transcript, ending: "friends", names, mine: [] })).toBeNull();
  });
});

describe("2. #661: both agents book the same second date", () => {
  /** A's date with B's character on the show's model, ended in a second date and aired. */
  async function airedFirstDate() {
    const A = await agentWith("Ottoline Brackwater");
    const B = await agentWith("Fennimore Gaskell");
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson(), episodeJson()]);
    const booked = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    if (booked.isError) throw new Error(booked.content[0].text);
    const first = booked.structuredContent.episode.id as string;
    await airEpisode(t.db, first, A.agentId);
    return { A, B, first };
  }
  const freeLeft = async (x: Agent) => (await call("my_status", {}, x.ctx)).structuredContent.dates_left.free_left as number;

  it("the second plan_second_date returns the booked date as a success: which, who booked it and when, and nothing charged (with or without confirm, and in a preview)", async () => {
    const { A, B, first } = await airedFirstDate();
    scriptedModel([episodeJson(), episodeJson()]);
    const booked = (await call("plan_second_date", { episode_id: first }, A.ctx)).structuredContent;
    expect(booked).toMatchObject({ second_date_of: first, mutual: true });
    const second = booked.episode.id as string;
    const before = await freeLeft(B);
    const episodes = await t.count("episodes");

    const raced = await call("plan_second_date", { episode_id: first }, B.ctx);
    expect(raced.isError).toBeUndefined();
    expect(raced.structuredContent).toMatchObject({
      already_booked: true,
      booked_by_this_call: false,
      episode_id: second,
      second_date_of: first,
      booked_by: "Ottoline's agent",
      booked_ago: expect.stringMatching(/^\d+ seconds?$/),
      cost: { spent: "nothing" },
      next_calls: [{ tool: "get_episode", args: { episode_id: second, wait_seconds: 30, summary: true }, why: expect.any(String) }],
    });
    expect(raced.structuredContent.note).toMatch(/^Already booked: Ottoline's agent booked this second date \d+ seconds? ago \(.+\), so this call booked nothing and nothing was charged to you\./);
    expect(raced.structuredContent.spent_note).toBe("Nothing was spent: Ottoline's agent booked it, and it was charged to them.");
    expect(raced.structuredContent.episode.id).toBe(second);
    // With wait_seconds and confirm: true (it aired, so nothing to wait for): the same.
    const confirmed = await call("plan_second_date", { episode_id: first, wait_seconds: 1, confirm: true }, B.ctx);
    expect(confirmed.structuredContent).toMatchObject({ already_booked: true, episode_id: second, booked_by: "Ottoline's agent" });
    // A preview says so too, and offers the read instead of a booking.
    const preview = (await call("plan_second_date", { episode_id: first, preview: true }, B.ctx)).structuredContent;
    expect(preview).toMatchObject({ preview: true, booked: false, already_booked: { episode_id: second, booked_by: "Ottoline's agent" }, second_date: { reason: "planned" } });
    expect(preview.already_booked.note).toMatch(/^Ottoline's agent booked this second date .* there's nothing left to book, and nothing was charged to you\.$/);
    expect(preview.next_calls).toEqual([{ tool: "get_episode", args: { episode_id: second, wait_seconds: 30, summary: true }, why: expect.any(String) }]);
    // Nothing was booked or spent by any of B's calls; A's own retry says it was A's.
    expect(await freeLeft(B)).toBe(before);
    expect(await t.count("episodes")).toBe(episodes);
    const retry = (await call("plan_second_date", { episode_id: first }, A.ctx)).structuredContent;
    expect(retry).toMatchObject({ already_booked: true, booked_by: "you", episode_id: second });
    expect(retry.note).toMatch(/^Already booked: you booked this second date/);
    expect((await t.db.query<Any>(`select count(*)::int as n from episodes where followup_of = $1`, [first])).rows[0].n).toBe(1);
    // Someone who owns neither character hears nothing about their dates: the route's own refusal, as before.
    const C = await agentWith("Marguerite Osei-Lund");
    const stranger = await call("plan_second_date", { episode_id: first }, C.ctx);
    expect(stranger.isError).toBe(true);
    expect(stranger.content[0].text).toMatch(/Only an owner of one of the two characters can plan their second date/);
    expect(JSON.stringify(stranger.structuredContent)).not.toContain(second);
  });

  it("mutual: true says who agreed and where each yes came from", async () => {
    const { A, B, first } = await airedFirstDate();
    const preview = (await call("plan_second_date", { episode_id: first, preview: true }, B.ctx)).structuredContent;
    expect(preview.second_date).toMatchObject({ mutual: true, can_plan: true });
    expect(preview.second_date.mutual_note).toBe(
      "Who agreed: both characters wanted another date when that date ended (the engine's call); Ottoline is open to dates, its creator's standing yes, so no separate yes was needed.",
    );
    // A closed character's creator says yes in person: the note says when.
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [B.id]);
    const waiting = (await call("plan_second_date", { episode_id: first }, A.ctx)).structuredContent;
    expect(waiting.mutual_note).toMatch(/Fennimore's creator hasn't said yes yet \(it's booked when they do\)\.$/);
    scriptedModel([episodeJson(), episodeJson()]);
    // compact: false (2.13.0, #751): B's preview already sent this mutual_note, word for word.
    const booked = (await call("plan_second_date", { episode_id: first, compact: false }, B.ctx)).structuredContent;
    expect(booked.mutual).toBe(true);
    expect(booked.mutual_note).toMatch(/^Who agreed: both characters wanted another date when that date ended \(the engine's call\); Ottoline is open to dates/);
    const forA = (await call("plan_second_date", { episode_id: first, preview: true }, A.ctx)).structuredContent;
    expect(forA.second_date.mutual_note).toMatch(/Fennimore's creator said yes to this second date \(\d{4}-\d\d-\d\dT[\d:.]+Z\)/);
  });

  it("a date of theirs that isn't this second date still refuses, saying who started it and that nothing was spent", async () => {
    const { A, B, first } = await airedFirstDate();
    scriptOutcome({ ending: "friends" });
    const own = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    const r = await call("plan_second_date", { episode_id: first }, B.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(new RegExp(`They already have a date in progress \\(${own}\\), started by Ottoline's agent \\d+ seconds? ago, so nothing was booked or spent\\.`));
    expect(r.structuredContent).toMatchObject({ code: "conflict", episode_id: own, started_by: "Ottoline's agent" });
  });
});

describe("3. #662: argument names", () => {
  it("reads the names the run guessed (swipe verdict, answer_match answer, browse_episodes open_for_predictions, a longer partner name), and says so", async () => {
    const A = await agentWith("Ottoline Brackwater");
    const B = await agentWith("Gwendolen Rusk");
    const s = (await call("swipe", { character_id: A.id, target_id: B.id, verdict: true }, A.ctx)).structuredContent;
    expect(s).toMatchObject({ liked: true });
    expect(s.read_arguments_as).toContain("verdict → like");
    await call("swipe", { character_id: B.id, target_id: A.id, decision: "right" }, B.ctx);
    const a = (await call("answer_match", { character_id: A.id, with: B.id, answer: "yes" }, A.ctx)).structuredContent;
    expect(a.status).toBe("waiting_on_them");
    expect(a.read_arguments_as).toEqual(expect.arrayContaining(["answer → yes", 'yes: "yes" → true']));
    const browse = (await call("browse_episodes", { open_for_predictions: true }, A.ctx)).structuredContent;
    expect(browse.read_arguments_as).toContain("open_for_predictions → open");
    expect(browse.warning).toBeUndefined();
    const g = (await call("go_on_date", { character_id: A.id, partner_character_id: HOUSE.id, preview: true }, A.ctx)).structuredContent;
    expect(g.with.id).toBe(HOUSE.id);
    expect(g.read_arguments_as).toContain("partner_character_id → partner_id");
    // send_text's to, guessed as with (2.9.0), still reads.
    expect((await call("send_text", { character_id: A.id, with: B.id, text: "The tide tables say Thursday is fine." }, A.ctx)).structuredContent.read_arguments_as).toContain("with → to");
    // my_status' cursor is its since; read_texts' since is its after.
    expect((await call("my_status", { cursor: new Date().toISOString() }, A.ctx)).structuredContent.read_arguments_as).toContain("cursor → since");
    expect((await call("read_texts", { character_id: A.id, with: B.id, since: new Date(Date.now() - 60_000).toISOString() }, A.ctx)).structuredContent.read_arguments_as).toContain("since → after");
  });

  it("the collision guard: never a name the tool takes, never onto one already given, never against the tool's own aliases, never two different guesses for one argument", () => {
    const swipe = new Set(["character_id", "target_id", "like", "agent_id"]);
    expect(genericAliases(swipe, { verdict: true }, {}, "like")).toEqual([{ from: "verdict", to: "like" }]);
    expect(genericAliases(swipe, { verdict: true, like: false }, {}, "like")).toEqual([]);
    expect(genericAliases(swipe, { verdict: true, decision: false }, {}, "like")).toEqual([]);
    expect(genericAliases(swipe, { verdict: true, decision: true }, {}, "like")).toEqual([{ from: "verdict", to: "like" }]);
    expect(genericAliases(swipe, { verdict: true }, { verdict: "something_else" }, "like")).toEqual([]);
    expect(genericAliases(new Set(["open", "verdict"]), { verdict: true }, {}, "open")).toEqual([]);
    // A tool without one yes-or-no doesn't read verdict at all (predict's pick is a word).
    expect(normaliseArgs("predict", { episode_id: "e", verdict: "friends" }).args).toMatchObject({ verdict: "friends" });
    // The tool's own aliases still win: guess_dealbreaker's answer is its pick, swipe's choice its like, send_text's from its sender.
    expect(normaliseArgs("guess_dealbreaker", { episode_id: "e", answer: "2" }).args).toMatchObject({ pick: "2" });
    expect(normaliseArgs("swipe", { character_id: "c", target_id: "t", choice: "left" }).args).toMatchObject({ like: "left" });
    expect(normaliseArgs("send_text", { from: "x", with: "y", text: "hi" }).args).toMatchObject({ character_id: "x", to: "y" });
    // A name the tool takes itself is never read as another (vote_feedback's vote, my_status' since).
    expect(normaliseArgs("vote_feedback", { item_id: "x", vote: "up" }).aliased).toEqual([]);
    expect(normaliseArgs("my_status", { since: "2026-10-22T06:08:36.997123Z" }).aliased).toEqual([]);
    // answer_date_proposal's one yes-or-no is accept.
    expect(normaliseArgs("answer_date_proposal", { character_id: "c", with: "w", decision: false }).args).toMatchObject({ accept: false });
  });

  it("every missing required argument comes in one error, on every tool (an agent with two characters is asked which, beside the rest)", async () => {
    const ctx = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx);
    await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx);
    for (const tool of PUBLIC_MCP_TOOLS) {
      const required = ((tool.inputSchema as { required?: string[] }).required ?? []).filter((k) => k !== "agent_id");
      if (!required.length) continue;
      const r = await call(tool.name, {}, ctx);
      const text: string = r.content[0].text;
      expect({ tool: tool.name, error: r.isError }).toEqual({ tool: tool.name, error: true });
      for (const k of required) expect({ tool: tool.name, arg: k, named: text.includes(`"${k}" is required`) }).toEqual({ tool: tool.name, arg: k, named: true });
      expect({ tool: tool.name, code: r.structuredContent.code }).toEqual({ tool: tool.name, code: "missing_argument" });
    }
    // The run's two: swipe and predict.
    const swipe = (await call("swipe", {}, ctx)).content[0].text;
    expect(swipe).toMatch(/^Error: "character_id" is required: which of your characters\? Ada Lumen \(.+\), Bo Quill \(.+\)\. "target_id" is required: .* "like" is required: true or false/);
    const predict = (await call("predict", {}, ctx)).content[0].text;
    expect(predict).toMatch(/^Error: "episode_id" is required\. "pick" is required: one of second_date, friends, disaster/);
  });

  it("whatever refusal leads, the missing ones come with it: a dry run the tool doesn't take, a short id, names it doesn't take", async () => {
    const ctx = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx);
    await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx);
    // 2.11.0 (#622): swipe takes preview now; leave_nudge is a write with no dry run.
    const dry = await call("leave_nudge", { preview: true }, ctx);
    expect(dry.content[0].text).toMatch(/^Error: Not valid — preview: leave_nudge has no preview or dry run, so nothing was done or spent\. Call it without preview to go ahead\. "character_id" is required: which of your characters\? .* "with" is required.* "note" is required/);
    expect(dry.structuredContent).toMatchObject({ code: "invalid_argument", field: "preview" });
    const short = await call("predict", { episode_id: "8c71e989" }, ctx);
    expect(short.content[0].text).toMatch(/^Error: episode_id is a date's full 36-character id \(got 8 characters, and no date starts with that\)\. my_dates and browse_episodes list full ids\. "pick" is required: one of second_date, friends, disaster/);
    expect(short.structuredContent.code).toBe("refused");
    const unknown = await call("predict", { prediction: "friends" }, ctx);
    expect(unknown.content[0].text).toMatch(/^Error: predict doesn't take "prediction"\.( .*)? "episode_id" is required\. "pick" is required: .* It takes: episode_id, pick, drama_pick, agent_id \(top-level, not nested\)\. Every tool's arguments: resources\/read with uri botchelor:\/\/cheatsheet\.$/);
    expect(unknown.structuredContent.code).toBe("invalid_argument");
  });

  it("botchelor://cheatsheet is listed, reads back, and matches the tool definitions: one line per tool, required, then optional, then an example", async () => {
    expect(MCP_RESOURCES.map((r) => r.uri)).toContain(CHEATSHEET_URI);
    expect((await rpc("resources/list", {})).result.resources.map((r: Any) => r.uri)).toContain(CHEATSHEET_URI);
    const read = (await rpc("resources/read", { uri: CHEATSHEET_URI })).result.contents[0];
    expect(read).toMatchObject({ uri: CHEATSHEET_URI, mimeType: "text/plain" });
    expect(read.text).toBe(cheatSheet());
    const lines = (read.text as string).split("\n");
    expect(lines.filter((l) => /^\w+: required /.test(l))).toHaveLength(PUBLIC_MCP_TOOLS.length);
    const names = (s: string) => (s === "none" ? [] : s.split(", ").map((x) => x.replace(/ \(.*\)$/, "")));
    for (const tool of PUBLIC_MCP_TOOLS) {
      const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      const props = Object.keys(schema.properties ?? {});
      const required = (schema.required ?? []).filter((k) => k !== "agent_id");
      const m = new RegExp(`^${tool.name}: required (.*?); optional (.*?)\\. e\\.g\\. ${tool.name} (\\{.*\\})$`).exec(lines.find((l) => l.startsWith(`${tool.name}: `)) ?? "");
      expect({ tool: tool.name, line: Boolean(m) }).toEqual({ tool: tool.name, line: true });
      expect({ tool: tool.name, required: names(m![1]) }).toEqual({ tool: tool.name, required });
      expect({ tool: tool.name, optional: names(m![2]) }).toEqual({ tool: tool.name, optional: props.filter((k) => !required.includes(k) && k !== "agent_id") });
      const example = JSON.parse(m![3]) as Record<string, unknown>;
      for (const k of required) expect({ tool: tool.name, has: k in example, k }).toEqual({ tool: tool.name, has: true, k });
      for (const k of Object.keys(example)) expect({ tool: tool.name, known: props.includes(k), k }).toEqual({ tool: tool.name, known: true, k });
    }
    // 2.11.0 (#622): swipe takes preview and undo.
    expect(lines.find((l) => l.startsWith("swipe: "))).toBe('swipe: required character_id, target_id, like (true|false); optional preview (true|false), undo (true|false). e.g. swipe {"character_id":"<yours>","target_id":"<from swipe_deck>","like":true}');
    expect(lines.find((l) => l.startsWith("answer_match: "))).toMatch(/^answer_match: required character_id, with, yes \(true\|false\); optional preview \(true\|false\)\./);
    expect(lines.find((l) => l.startsWith("predict: "))).toMatch(/^predict: required episode_id, pick \(second_date\|friends\|disaster\); optional drama_pick \(a\|b\|neither\)\./);
    // The quickstart's last line points to it, and the quickstart stays as short as it was.
    const { init } = await connect();
    expect((init.instructions as string).split("\n").at(-1)).toMatch(/Every tool's arguments \(required, then optional, and an example call\), one line each: resources\/read with uri botchelor:\/\/cheatsheet\.$/);
    expect(init.instructions.length).toBeLessThan(4000);
    expect(init.instructions.split(/\s+/).length).toBeLessThan(600);
    // tools/list's more_tools and the full guide say where it is too.
    expect((await rpc("tools/list", {})).result.more_tools.how).toContain(CHEATSHEET_URI);
    expect((await rpc("resources/read", { uri: "botchelor://instructions" })).result.contents[0].text).toContain(`every tool's arguments, one line each: resources/read with uri ${CHEATSHEET_URI}`);
  });
});

describe("4. #663: one turn shape for output and outputs", () => {
  it("outputs takes every shape output does: a bare string, {output}, {dialogue}, {line}, and a turn inside {output}; so does output", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    const r = (await call("submit_own_date_step", {
      episode_id: id,
      outputs: [
        "Line one, a bare string about the harbour lights.",
        { output: "Line two, wrapped as output, about the ferry." },
        { dialogue: "Line three, as dialogue, about the gulls." },
        { line: "Line four, as line, about the tide tables." },
        { output: { dialogue: "Line five, a turn object inside output.", interest_signal: 0.7 } },
      ],
    }, ctx)).structuredContent;
    expect(r).toMatchObject({ accepted: true, accepted_count: 5, outputs_sent: 5 });
    const transcript = (await t.db.query<Any>(`select transcript from episodes where id = $1`, [id])).rows[0].transcript as Turn[];
    expect(transcript.map((x) => x.dialogue)).toEqual([
      "Line one, a bare string about the harbour lights.",
      "Line two, wrapped as output, about the ferry.",
      "Line three, as dialogue, about the gulls.",
      "Line four, as line, about the tide tables.",
      "Line five, a turn object inside output.",
    ]);
    expect(transcript[4].interest).toBe(0.7);
    // A single output wrapped the same way, carrying the wrapper's see_again.
    const one = (await call("submit_own_date_step", { episode_id: id, output: { output: "Line six, wrapped, and the last of the night.", see_again: true } }, ctx)).structuredContent;
    expect(one.accepted).toBe(true);
    expect((await t.db.query<Any>(`select wishes from episodes where id = $1`, [id])).rows[0].wishes).toMatchObject({ b: true, sent: { a: false, b: true } });
  });

  it("a refused item says which item, and names the shapes a turn takes and the keys it came with", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    const r = (await call("submit_own_date_step", { episode_id: id, outputs: ["Line one, about the harbour lights.", { text: "Hello there, said wrong." }] }, ctx)).structuredContent;
    // #1118: the first line is in, and the reply says so before anything else.
    expect(r).toMatchObject({ accepted: true, ok: false, accepted_count: 1, refused_at: 2, outputs_sent: 2, shapes: TURN_SHAPES });
    expect(r.message).toMatch(/^1 of 2 went in first \(turn 1\): don't send those again\. Not handed in:/);
    expect(r.rejected).toContain(`A turn takes ${TURN_SHAPES}`);
    expect(r.rejected).toMatch(/This one came with "text"\.$/);
    expect(r.message).toMatch(/The 2nd item of outputs was refused \(each item takes what output does\); nothing was used up: this turn is still yours, so send a corrected one for this step\.$/);
    expect(TURN_SHAPES).toBe('a bare string (just the line), {"dialogue": "…"} (action, emotion, interest_signal and, on a last line, see_again optional), {"line": "…"} or {"output": …}');
    // A single output refused the same way names them too.
    const single = (await call("submit_own_date_step", { episode_id: id, output: { words: "Hello." } }, ctx)).structuredContent;
    expect(single).toMatchObject({ accepted: false, shapes: TURN_SHAPES });
    expect(single.rejected).toMatch(/This one came with "words"\.$/);
  });

  it("unwrapOutput and oneLineTurn read {output} as the turn inside it, keeping the wrapper's own fields", () => {
    expect(oneLineTurn({ output: "Hi there." })).toEqual({ dialogue: "Hi there.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn({ output: { dialogue: "Hi.", see_again: true } })).toEqual({ dialogue: "Hi.", see_again: true, ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn({ output: '{"dialogue":"Hi."}', see_again: false })).toEqual({ dialogue: "Hi.", see_again: false, ...ONE_LINE_DEFAULTS });
    expect(unwrapOutput({ output: "x", turn_number: 3 })).toEqual({ line: "x", turn_number: 3 });
    // A turn with its own dialogue (or line) is left as it is.
    expect(unwrapOutput({ dialogue: "x", output: "y" })).toEqual({ dialogue: "x", output: "y" });
    expect(unwrapOutput("just a line")).toBe("just a line");
  });
});

describe("5. waits that say why (#619's comment)", () => {
  it("plan_second_date with a wait shorter than the airing: says it didn't wait the whole time, why, and when to call again", async () => {
    const A = await agentWith("Ada Lumen");
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson(), episodeJson()]);
    const booked = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE.id }, A.ctx)).structuredContent;
    const r = (await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(Object.keys(r).slice(0, 2)).toEqual(["wait_note", "call_again_at"]);
    expect(r.wait_note).toMatch(/^This call waited 1 s, not the whole time: the first date airs in about \d+ min \(at (\S+)\), past this call's 1 s\. Call again from (\S+), when one 30-second wait covers it \(next_calls has the call\)\./);
    expect(Date.parse(r.call_again_at)).toBe(Date.parse(r.second_date.airs_at) - 30_000); // #1057: one 30-second wait (it was 50)
    expect(r.next_calls[0]).toMatchObject({ tool: "plan_second_date", args: { episode_id: booked.episode.id, wait_seconds: 30, preview: true } });
    expect(r.next_calls[0].why).toContain(r.call_again_at);
  });

  it("read_texts with a wait that times out: items is only what's new, and the thread sits right beside it", async () => {
    const { A, B } = await agreed();
    await call("send_text", { character_id: A.id, to: B.id, text: "The tide's out at six." }, A.ctx);
    await call("send_text", { character_id: B.id, to: A.id, text: "Then we walk the flats." }, B.ctx);
    await call("send_text", { character_id: A.id, to: B.id, text: "Bring the good torch." }, A.ctx);
    const r = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(r).toMatchObject({ returned_because: "timeout", items: [], still_waiting: true });
    expect(r.items_note).toMatch(/^Nothing new from them since your cursor \(after\), so items is empty: on a wait it holds only what's new\. thread, right below it, has the newest texts both ways, yours included/);
    const keys = Object.keys(r);
    expect(keys.indexOf("items_note")).toBeLessThan(keys.indexOf("items"));
    expect(keys.indexOf("thread")).toBe(keys.indexOf("texts") + 1);
    expect(r.thread.map((x: Any) => x.text)).toEqual(["The tide's out at six.", "Then we walk the flats.", "Bring the good torch."]);
  });

  it("my_notifications and my_status with since: the lists honour it, not only new", async () => {
    const A = await agentWith("Ada Lumen");
    await notify(t.db, A.agentId, { kind: "stage_up", title: "An older notice", body: null, link: null });
    await t.db.query(`update notifications set created_at = now() - interval '2 minutes' where user_id = $1`, [A.agentId]);
    const since = new Date(Date.now() - 1000).toISOString();
    await notify(t.db, A.agentId, { kind: "stage_up", title: "A new one", body: null, link: null });
    const n = (await call("my_notifications", { since }, A.ctx)).structuredContent;
    expect(n.notifications.map((x: Any) => x.title)).toEqual(["A new one"]);
    expect(n.new.map((x: Any) => x.title)).toEqual(["A new one"]);
    expect(n.since_note).toBe("since was set, so notifications (like new) lists only what came after it: 1 older left out. Leave since out for the latest page.");
    const waited = (await call("my_notifications", { since, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(waited.notifications.map((x: Any) => x.title)).toEqual(["A new one"]);
    // Without since: the latest page, as always.
    const all = (await call("my_notifications", {}, A.ctx)).structuredContent;
    expect(all.notifications.map((x: Any) => x.title)).toEqual(expect.arrayContaining(["A new one", "An older notice"]));
    expect(all.since_note).toBeUndefined();
    // my_status: what's newer than since, never the older unread notice.
    const s = (await call("my_status", { since }, A.ctx)).structuredContent;
    expect(s.new_since.map((x: Any) => x.title)).toEqual(["A new one"]);
    expect(s.returned_because).toBe("new");
  });
});

describe("6. house-bot own dates, said up front", () => {
  it("start_own_date with a house-run bot's character says first that the bot plays its side from the show's script and the show writes the recap", async () => {
    const bot = await agentWith("Rosalind Ashgrove", {}, "botchelor-loop-swipe-back");
    const me = await agentWith("Ottoline Brackwater");
    const preview = (await call("start_own_date", { character_id: me.id, partner_id: bot.id, preview: true }, me.ctx)).structuredContent;
    expect(preview).toMatchObject({ kind: "house_bot" });
    expect(preview.other_side).toMatch(/its replies come from the show's script, not another agent.*there's no recap step for you: the show writes the recap once the last line is in/);
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: me.id, partner_id: bot.id }, me.ctx)).structuredContent;
    expect(started.house_bot_date).toBe(
      "Rosalind is a house-run bot's character (one of the show's own scripts, not another agent): it plays its side on its own, so its replies come from the show's script, not another agent. " +
        "You write only Ottoline's lines, and there's no recap step for you: the show writes the recap once the last line is in. autoplay_own_date can have the show's model play both sides.",
    );
    const keys = Object.keys(started);
    expect(keys.indexOf("house_bot_date")).toBeLessThan(keys.indexOf("ending_note"));
    expect(keys.indexOf("house_bot_date")).toBeLessThan(keys.indexOf("step"));
    expect(started.other_side).toMatch(/its lines come from the show's script, not another agent/);
    // A date with another agent's character (not a bot) says nothing of the kind.
    const { A, B } = await agreed();
    const plain = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    expect(plain.house_bot_date).toBeUndefined();
  });
});
