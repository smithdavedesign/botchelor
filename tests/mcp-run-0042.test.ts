import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_CALLS, exampleCallsText } from "@/lib/agents";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CORE_MCP_TOOLS, CORE_TOOL_ORDER, handleMcpMessage, MCP_RESOURCES, MCP_SERVER_INFO, MCP_TOOLS, START_HERE, TOOL_COSTS, type McpContext } from "@/lib/mcp";
import { costTable, FULL_INSTRUCTIONS_URI, fullInstructions, HEADS_UP_RULE, SINCE_FORMAT } from "@/lib/mcp/dispatcher";
import { listNotifications } from "@/lib/notifications";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.6.0, from the 2026-10-22-0042 run (three uninstructed visitors: 8, 7.5 and 8 overall; MCP 8, 8.5 and 8.5). Run
// folder: ~/.botchelor-loop/runs/2026-10-22-0042. #633 a quickstart (the long text is a resource), #630 and the wait
// audit, #632 own-date transcripts, #631 my_characters' settings, and what else the three reports tripped on.
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
async function connect(client = "botchelor-run-0042-test"): Promise<McpContext & { init: Any }> {
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
/** Two agents' characters that matched and both said yes to a date. */
async function agreed(a = "Thaddeus Quill", b = "Marguerite Plum") {
  const A = await agentWith(a);
  const B = await agentWith(b);
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
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
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me something true about the sea, and something false.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });
/** Tool names a piece of prose names. */
const named = (text: string) => MCP_TOOLS.map((x) => x.name).filter((n) => new RegExp(`(^|[^a-z_])${n}([^a-z_]|$)`).test(text));

it("is MCP 2.6.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.6.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("#633: initialize carries a quickstart; the full text is the botchelor://instructions resource", () => {
  it("the quickstart is short: under 30 lines and 4,000 characters, naming only core tools", async () => {
    const { init } = await connect();
    const text: string = init.instructions;
    expect(text.split("\n").length).toBeLessThanOrEqual(30);
    expect(text.length).toBeLessThan(4000);
    expect(text.split(/\s+/).length).toBeLessThan(600);
    // What it is, the three calls to start, identity, costs, waiting, and where the rest is.
    expect(text).toMatch(/blind-date show for fictional adult characters/);
    expect(text).toMatch(/1 my_status[\s\S]*2 create_character \(attest: true\)[\s\S]*3 go_on_date with one of the house cast/);
    expect(text).toMatch(/Identity is anonymous\. Send back the mcp-session-id header/);
    expect(text).toMatch(/pass agent_id .* on every call/);
    expect(text).toMatch(/^Costs: .*free\. go_on_date and plan_second_date use one of your 3 free dates a week/m);
    expect(text).toMatch(/since \(the cursor its last reply returned, e\.g\. 2026-10-22T06:08:36\.997123Z\)/);
    expect(text).toContain(`resources/read with uri ${FULL_INSTRUCTIONS_URI}`);
    expect(text).toMatch(/Other agents may be inventing the same character right now/);
    expect(named(text).filter((n) => !(CORE_TOOL_ORDER as readonly string[]).includes(n))).toEqual([]);
    expect(init._meta["botchelor/full_instructions"]).toBe("botchelor://instructions");
  });

  it("the resource is listed, reads back, and is the old long text whole: the start, the steps, the cost table, how it works and the example calls", async () => {
    const listed = (await rpc("resources/list", {})).result.resources;
    expect(listed.map((r: Any) => r.uri)).toContain(FULL_INSTRUCTIONS_URI);
    expect(MCP_RESOURCES.find((r) => r.uri === FULL_INSTRUCTIONS_URI)).toMatchObject({ name: "instructions", mimeType: "text/plain" });
    const read = (await rpc("resources/read", { uri: FULL_INSTRUCTIONS_URI })).result.contents[0];
    expect(read).toMatchObject({ uri: FULL_INSTRUCTIONS_URI, mimeType: "text/plain" });
    const guide: string = read.text;
    expect(guide).toBe(fullInstructions());
    expect(guide.split("\n\n")[0].split("\n")).toEqual(START_HERE());
    for (const row of costTable()) expect(guide).toContain(row);
    for (const part of [SINCE_FORMAT, HEADS_UP_RULE, exampleCallsText(), "QUICKSTART.", "HOW IT WORKS.", "EXAMPLE CALLS", "0 Been here before?", "8 link_account"]) expect(guide).toContain(part);
    // Plus what's new: transcripts, a bare line, waits, next_calls, mine, context, the archetype note.
    for (const part of ["transcript: [{who, said}]", "handing in just the dialogue", "- Waits: every wait_seconds", "- next_calls:", "mine: include, only or exclude", "context:", "invent the same character"]) expect(guide).toContain(part);
    expect(guide.length).toBeGreaterThan((await connect()).init.instructions.length * 4);
    expect(named(guide).filter((n) => !(CORE_TOOL_ORDER as readonly string[]).includes(n))).toEqual([]);
  });
});

describe("#630 and the wait audit: every wait blocks until something new or the cap, and says why it returned", () => {
  it("plan_second_date with wait_seconds on a date airing past the wait waits it out, then says when it airs and what to do", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "second_date");
    // 2.7.0 (#641): a wait never books, so a wait that runs out answers as a preview: not aired, when it airs, the next wait.
    const t0 = Date.now();
    const r = await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1 }, A.ctx);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ preview: true, booked: false, returned_because: "timeout", wait_cap_seconds: 50, second_date: { can_plan: false, reason: "not_aired", airs: "scheduled" } });
    expect(Date.parse(r.structuredContent.second_date.airs_at)).toBeGreaterThan(Date.now());
    expect(r.structuredContent.wait_note).toMatch(/^A wait never books/);
    expect(r.structuredContent.next_calls).toEqual([{ tool: "plan_second_date", args: { episode_id: booked.episode.id, wait_seconds: 50, preview: true }, why: expect.any(String) }]);
    // With confirm: true it would have booked, so running out is the not_aired refusal, with the wait's report.
    const confirmed = await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1, confirm: true }, A.ctx);
    expect(confirmed.isError).toBe(true);
    expect(confirmed.content[0].text).toMatch(/hasn't yet, so nothing was booked or spent\. It airs on its own at \S+, in about \d+ seconds: call plan_second_date with wait_seconds: 50 once it's within 50 seconds of airing \(from \S+\), which waits for it, then previews \(confirm: true books\)/);
    expect(confirmed.content[0].text).toMatch(/This call waited 1 second; one call waits at most 50/);
    expect(confirmed.structuredContent).toMatchObject({ code: "not_aired", returned_because: "timeout", wait_cap_seconds: 50, airs: "scheduled" });
    expect(confirmed.structuredContent.wait_note).toMatch(/^It airs on its own at /);
    expect(confirmed.structuredContent.seconds_left).toBeGreaterThan(60);
    expect(Date.parse(confirmed.structuredContent.airs_at)).toBeGreaterThan(Date.now());
    expect(confirmed.structuredContent.next_calls).toEqual([{ tool: "plan_second_date", args: { episode_id: booked.episode.id, wait_seconds: 50, preview: true }, why: expect.any(String) }]);
    // Without a wait, the same note, and no wait report.
    const now = (await call("plan_second_date", { episode_id: booked.episode.id }, A.ctx)).structuredContent;
    expect(now.returned_because).toBeUndefined();
    expect(now.wait_note).toMatch(/It airs on its own at/);
  });

  it("plan_second_date waits for an airing inside the wait, then books the second date and says why it returned", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "second_date");
    // It airs in about two seconds (the prediction window runs from the booking).
    await t.db.query(`update episodes set created_at = now() - interval '10 minutes' + interval '2 seconds' where id = $1`, [booked.episode.id]);
    scriptedModel([episodeJson()]);
    // 2.7.0 (#641): booking after the wait takes confirm: true (a wait alone previews: tests/mcp-run-0215.test.ts).
    const r = await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 10, confirm: true }, A.ctx);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ second_date_of: booked.episode.id, returned_because: "new", waited_for: "the first date to air" });
    expect(r.structuredContent.waited_seconds).toBeLessThan(9);
    expect(r.structuredContent.next_calls[0]).toMatchObject({ tool: "get_episode", args: { episode_id: r.structuredContent.episode.id } });
  });

  it("submit_own_date_step with wait_seconds and nothing to wait for says so; read_texts without with waits across threads", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step.episode_id;
    const s = (await call("submit_own_date_step", { episode_id: id, output: "Hello there.", wait_seconds: 5 }, ctx)).structuredContent;
    expect(s).toMatchObject({ accepted: true, returned_because: "at_start", wait_note: "Nothing to wait for: the next step is yours." });

    const A = await agentWith("Hal Brooks");
    const B = await agentWith("Vi Lark");
    const C = await agentWith("Cy Marr");
    for (const X of [B, C]) {
      await call("swipe", { character_id: A.id, target_id: X.id, like: true }, A.ctx);
      await call("swipe", { character_id: X.id, target_id: A.id, like: true }, X.ctx);
    }
    setTimeout(() => void call("send_text", { character_id: C.id, to: A.id, text: "Do you trust a map with no compass rose?" }, C.ctx), 400);
    const w = (await call("read_texts", { character_id: A.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(w.returned_because).toBe("new");
    expect(w.new_texts).toEqual([expect.objectContaining({ character_id: A.id, with: C.id, text: "Do you trust a map with no compass rose?" })]);
    expect(w.threads.length).toBe(2);
    // An unread text already there comes straight back.
    const again = (await call("read_texts", { character_id: A.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(again.returned_because).toBe("at_start");
  });

  it("the waits' docs show since with an example", () => {
    const status = MCP_TOOLS.find((x) => x.name === "my_status")!.inputSchema as Any;
    expect(status.properties.since.description).toMatch(/e\.g\. 2026-10-22T06:08:36\.997123Z/);
    expect(status.properties.wait_seconds.description).toMatch(/after since/);
  });
});

describe("#632: own dates carry the conversation so far, and a bare line works", () => {
  it("get_own_date_step and submit_own_date_step return transcript [{who, said}], both sides, before the step", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    // The first step says plainly that a bare line works and messages is optional.
    expect(started.write_it_yourself).toMatch(/A bare line works: hand in just the dialogue as output/);
    expect(started.write_it_yourself).toMatch(/messages is optional/);
    expect(started.step.instructions).toMatch(/Quickest: write Ada Lumen's line yourself and hand in just the dialogue as "output"/);
    expect(started.transcript).toEqual([]);
    const id = started.step.episode_id;
    const one = (await call("submit_own_date_step", { episode_id: id, output: "You never asked about the wind." }, ctx)).structuredContent;
    expect(one.transcript).toEqual([{ who: "Ada Lumen", said: "You never asked about the wind." }]);
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, ctx);
    const read = (await call("get_own_date_step", { episode_id: id }, ctx)).structuredContent;
    expect(read.transcript).toEqual([
      { who: "Ada Lumen", said: "You never asked about the wind." },
      { who: "Bo Quill", said: line(1).dialogue },
    ]);
    const keys = Object.keys(read);
    expect(keys.indexOf("transcript")).toBeLessThan(keys.indexOf("step"));
    expect(read.next_calls).toEqual([{ tool: "submit_own_date_step", args: { episode_id: id, output: "<Ada Lumen's line>" }, why: expect.stringMatching(/turn 3 of/) }]);
  });

  it("on a two-agent date both agents read both sides' lines", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, output: "Do you always arrive early?" }, A.ctx);
    const theirs = (await call("get_own_date_step", { episode_id: id }, B.ctx)).structuredContent;
    expect(theirs.transcript).toEqual([{ who: "Thaddeus Quill", said: "Do you always arrive early?" }]);
    expect(theirs.next_calls[0]).toMatchObject({ tool: "submit_own_date_step", args: { episode_id: id, wait_seconds: 50 } });
  });

  it("a batch says which turns it filled, keeps of as the date's length, and a turn_number that doesn't match is refused (a retry can't land twice)", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    const step = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent.step;
    const batch = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [{ ...line(0), turn_number: 1 }, { ...line(1), turn_number: 2 }, line(2)] }, ctx)).structuredContent;
    expect(batch).toMatchObject({ accepted: true, accepted_count: 3, outputs_sent: 3, turn_number: 4, of: step.of });
    expect(batch.filled).toEqual([{ turn_number: 1, who: "Ada Lumen" }, { turn_number: 2, who: "Bo Quill" }, { turn_number: 3, who: "Ada Lumen" }]);
    expect(batch.batch_note).toBe(`outputs filled turns 1 to 3 (Ada, Bo, Ada). Next: turn 4 of ${step.of}, Bo Quill speaks.`);
    expect(batch.transcript).toHaveLength(3);
    // The same batch again (a retried call): refused at its first reply, nothing handed in twice.
    const retried = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [{ ...line(0), turn_number: 1 }, { ...line(1), turn_number: 2 }] }, ctx)).structuredContent;
    expect(retried).toMatchObject({ accepted: false, ok: false, rejected: "wrong_turn", accepted_count: 0 });
    expect(retried.message).toMatch(/says turn_number 1, but the date is at turn 4 of \d+ \(Bo Quill speaks\)\. Those turns are already in: was this batch handed in before/);
    expect((await call("get_own_date_step", { episode_id: step.episode_id }, ctx)).structuredContent.transcript).toHaveLength(3);
    // One reply pinned to the wrong turn: the same.
    const single = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { ...line(9), turn_number: 3 } }, ctx)).structuredContent;
    expect(single).toMatchObject({ accepted: false, rejected: "wrong_turn" });
    expect((await call("submit_own_date_step", { episode_id: step.episode_id, output: { ...line(3), turn_number: 4 } }, ctx)).structuredContent).toMatchObject({ accepted: true, turn_number: 5 });
  });
});

describe("#631: my_characters returns every setting update_character takes", () => {
  it("partner_style, talk, open_audience, this_week, dealbreaker, temperament and the soul, as saved", async () => {
    const A = await agentWith("Ada Lumen", { partner_style: "open", open_audience: "agents", soul: { values: "Keeps her word, even to a vending machine." } });
    const first = (await call("my_characters", {}, A.ctx)).structuredContent;
    expect(first.characters[0]).toMatchObject({
      id: A.id,
      partner_style: "open",
      open_audience: "agents",
      talk: "standard",
      visibility: "public",
      dealbreaker: validCharacter().dealbreaker,
      this_week_by: "the show",
      temperament: null,
      soul: { values: "Keeps her word, even to a vending machine." },
    });
    expect(first.characters[0].this_week).toEqual(expect.any(String));
    expect(first.settings_note).toMatch(/every field update_character changes/);
    await call("update_character", { character_id: A.id, partner_style: "one", talk: "longer", this_week: "Just adopted a very old cat", temperament: { warmth: 0.8, openness: 0.4, guardedness: 0.3, humor: 0.7 } }, A.ctx);
    const after = (await call("my_characters", {}, A.ctx)).structuredContent.characters[0];
    expect(after).toMatchObject({ partner_style: "one", talk: "longer", this_week: "Just adopted a very old cat", this_week_by: "you", temperament: { warmth: 0.8, openness: 0.4, guardedness: 0.3, humor: 0.7 } });
    expect(MCP_TOOLS.find((x) => x.name === "my_characters")!.description).toMatch(/partner_style/);
  });
});

describe("browse_episodes: never an aired date as open, and your own dates on request", () => {
  it("a date whose window has closed airs before the list is made, so it isn't offered; predict agrees", async () => {
    const host = await agentWith("Hal Brooks");
    const viewer = await agentWith("Vi Lark");
    const booked = await houseDate(host.ctx, host.id, "friends");
    const open = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent;
    expect(open.episodes.map((e: Any) => e.id)).toEqual([booked.episode.id]);
    expect(open.episodes[0].seconds_left).toBeGreaterThan(0);
    // Its window closes: the next list airs it and leaves it out.
    await t.db.query(`update episodes set created_at = now() - interval '11 minutes' where id = $1`, [booked.episode.id]);
    const later = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent;
    expect(later.episodes).toEqual([]);
    expect((await t.db.query<Any>(`select revealed_at is not null as aired from episodes where id = $1`, [booked.episode.id])).rows[0].aired).toBe(true);
    const all = (await call("browse_episodes", {}, viewer.ctx)).structuredContent;
    expect(all.open_for_predictions).toBe(0);
    expect(all.episodes[0]).toMatchObject({ id: booked.episode.id, ending: "friends" });
    expect(all.episodes[0].open_for_predictions).toBeUndefined();
  });

  it("mine: include, only or exclude; yours are marked and never predictable", async () => {
    const host = await agentWith("Hal Brooks");
    const other = await agentWith("Vi Lark");
    const mine = await houseDate(host.ctx, host.id, "friends", HOUSE_CHARACTERS[0].id);
    const theirs = await houseDate(other.ctx, other.id, "friends", HOUSE_CHARACTERS[1].id);
    const ids = (r: Any) => r.structuredContent.episodes.map((e: Any) => e.id).sort();
    expect(ids(await call("browse_episodes", { open: true }, host.ctx))).toEqual([theirs.episode.id]);
    const only = (await call("browse_episodes", { open: true, mine: "only" }, host.ctx)).structuredContent;
    expect(only.episodes).toEqual([expect.objectContaining({ id: mine.episode.id, yours: true, can_predict: false })]);
    expect(only.filter).toEqual({ mine: "only" });
    expect(ids(await call("browse_episodes", { open: true, mine: "include" }, host.ctx))).toEqual([mine.episode.id, theirs.episode.id].sort());
    const feed = (await call("browse_episodes", { mine: "exclude" }, host.ctx)).structuredContent;
    expect(feed.episodes.map((e: Any) => e.id)).toEqual([theirs.episode.id]);
    const withMine = (await call("browse_episodes", {}, host.ctx)).structuredContent;
    expect(withMine.episodes.find((e: Any) => e.id === mine.episode.id)).toMatchObject({ yours: true, open_for_predictions: false });
    expect(withMine.open_for_predictions).toBe(1);
  });
});

describe("predictions: something to go on, never the ending", () => {
  it("browse_episodes open and predict carry context (who, wants, the setting, which date, chemistry), and endings_lately", async () => {
    const host = await agentWith("Hal Brooks", { want: "Someone who reads the small print aloud" });
    const viewer = await agentWith("Vi Lark");
    const booked = await houseDate(host.ctx, host.id, "disaster");
    const open = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent;
    const context = open.episodes[0].context;
    expect(context).toMatchObject({
      a: { id: host.id, name: "Hal Brooks", wants: "Someone who reads the small print aloud", traits: expect.any(Array), aired_dates: 0, second_dates: 0 },
      b: { id: HOUSE_CHARACTERS[0].id, wants: expect.any(String) },
      where: expect.any(String),
      format: expect.any(String),
      date_number: 1,
    });
    expect(open.context_note).toMatch(/never the ending/);
    expect(open.endings_lately).toMatchObject({ second_date: expect.any(Number), friends: expect.any(Number), disaster: expect.any(Number), of: expect.any(Number) });
    // Nothing the engine decided, and no dealbreaker.
    const text = JSON.stringify(context);
    for (const key of ["ending", "box_score", "why", "drama_answer", "transcript", "scenes", "agendas", "dealbreaker"]) expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain("disaster");
    expect(text).not.toContain(validCharacter().dealbreaker);
    expect(text).not.toContain(HOUSE_CHARACTERS[0].dealbreaker);
    const picked = (await call("predict", { episode_id: booked.episode.id, pick: "friends" }, viewer.ctx)).structuredContent;
    expect(picked.context).toEqual(context);
    expect(JSON.stringify(picked.context)).not.toContain("disaster");
    expect(picked.next_calls[0]).toMatchObject({ tool: "browse_episodes", args: { open: true } });
  });

  it("a couple's earlier aired dates are in context; this date's ending isn't", async () => {
    const host = await agentWith("Hal Brooks");
    const viewer = await agentWith("Vi Lark");
    const first = await houseDate(host.ctx, host.id, "second_date");
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [first.episode.id]);
    const second = await houseDate(host.ctx, host.id, "disaster");
    void second;
    const open = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent;
    expect(open.episodes[0].context).toMatchObject({ before_together: ["second_date"], a: { aired_dates: 1, second_dates: 1 } });
    expect(JSON.stringify(open.episodes[0].context)).not.toContain("disaster");
  });
});

describe("two-agent dates never start unnoticed: heads_up first", () => {
  it("another agent's start leads the next reply and my_status, with the call to take the move; open dates and invitations come first", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    // B's next call, whatever it is.
    const next = (await call("my_dates", {}, B.ctx)).structuredContent;
    expect(Object.keys(next)[0]).toBe("heads_up");
    expect(next.heads_up[0]).toMatchObject({
      kind: "own_date_started",
      episode_id: id,
      character_id: B.id,
      started_by: "Thaddeus Quill's agent",
      your_move: false,
      take_your_move: { tool: "get_own_date_step", arguments: { episode_id: id, wait_seconds: 50 } },
      decline: { tool: "decline_own_date", arguments: { episode_id: id } },
    });
    expect(next.heads_up[0].what).toMatch(/^Thaddeus Quill's agent started a two-agent date with your Marguerite Plum \(free: you perform Marguerite, their agent performs Thaddeus/);
    expect(next.heads_up_note).toMatch(/a two-agent date another agent started/);
    // Shown once on other tools; my_status keeps it first while it's untouched.
    expect((await call("my_dates", {}, B.ctx)).structuredContent.heads_up).toBeUndefined();
    const status = (await call("my_status", {}, B.ctx)).structuredContent;
    const keys = Object.keys(status);
    expect(keys[0]).toBe("heads_up");
    expect(status.heads_up[0]).toMatchObject({ kind: "own_date_started", episode_id: id });
    expect(keys.indexOf("open_own_dates")).toBe(keys.indexOf("heads_up_note") + 1 + (keys.includes("invites") ? 2 : 0));
    expect(keys.indexOf("open_own_dates")).toBeLessThan(keys.indexOf("next"));
    // A plays the first line: it's B's move, and the clock is said.
    await call("submit_own_date_step", { episode_id: id, output: "Do you always arrive early?" }, A.ctx);
    const move = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(move.heads_up[0]).toMatchObject({ episode_id: id, your_move: true, show_takes_over_in_minutes: 3 });
    expect(move.heads_up[0].what).toMatch(/It's your move: quiet 3 minutes on it and the show's model takes over Marguerite's side/);
    expect(move.invites[0]).toMatchObject({ kind: "own_date", episode_id: id });
    expect(Object.keys(move).indexOf("invites")).toBeLessThan(Object.keys(move).indexOf("next"));
    expect(move.next_calls[0]).toEqual({ tool: "get_own_date_step", args: { episode_id: id, wait_seconds: 50 }, why: expect.stringMatching(/Your move on the date with Thaddeus Quill/) });
  });
});

describe("near-twins before saving: other agents' recent look-alikes, the idea they share, and jobs to pick", () => {
  const lighthouse = (name: string, extra: Record<string, unknown> = {}) =>
    validCharacter({
      name,
      age: 61,
      bio: "A retired lighthouse inspector who logs every passing ship in a weathered ledger and still checks the foghorn schedule at dawn.",
      traits: ["methodical", "wry", "sentimental"],
      want: "Someone who notices the small lights in the dark",
      extras: { ...PROFILE, occupation: "Retired lighthouse inspector" },
      open_to_dates: true,
      keep_name: true,
      ...extra,
    });

  it("check_only names other agents' look-alikes made in the last day, the idea several share, and jobs nobody recent has; nothing is saved", async () => {
    const one = await connect();
    const two = await connect();
    const hector = (await call("create_character", lighthouse("Hector Quill"), one)).structuredContent.character.id;
    const hollis = (await call("create_character", lighthouse("Hollis Marrow"), two)).structuredContent.character.id;
    const before = await t.count("characters");
    const me = await connect();
    const check = await call("create_character", { ...lighthouse("Ottoline Brack"), check_only: true }, me);
    expect(check.isError).toBeUndefined();
    const s = check.structuredContent;
    expect(await t.count("characters")).toBe(before);
    expect(Object.keys(s)[0]).toBe("warning");
    expect(s.warning).toMatch(/^Nothing is saved yet, and it reads a lot like /);
    expect(s.warning).toContain("Hector Quill");
    expect(s.warning).toContain("Hollis Marrow");
    expect(s.warning).toMatch(/2 other agents' characters made in the last 24 hours share "[^"]+" with it: agents on one model often invent the same character/);
    expect(s.warning).toMatch(/Pick a different job or hook before you create it\. Jobs nobody recent has: .+\./);
    expect(s.look_alikes.map((x: Any) => x.id).sort()).toEqual([hector, hollis].sort());
    expect(s.look_alikes[0]).toMatchObject({ run_by: "agent", agent_active: "active now", made_minutes_ago: expect.any(Number) });
    expect(s.shared_archetype).toMatchObject({ idea: expect.stringMatching(/lighthouse|inspector|foghorn|ledger/), characters: 2 });
    expect(s.try_instead.length).toBeGreaterThan(0);
    for (const job of s.try_instead) expect(job).not.toMatch(/lighthouse|inspector/);
    // The save says it again (and names any made since the check).
    const saved = (await call("create_character", lighthouse("Ottoline Brack"), me)).structuredContent;
    expect(saved.warning).toMatch(/^Saved, but it reads a lot like /);
    expect(saved.warning).toMatch(/Hector Quill \([^)]*made by another agent in the last few minutes\)/);
    expect(saved.shared_archetype.characters).toBe(2);
  });

  it("your own characters aren't other agents' look-alikes; a sheet nobody shares gets no warning", async () => {
    const me = await connect();
    await call("create_character", lighthouse("Hector Quill"), me);
    const check = (await call("create_character", { ...lighthouse("Hollis Marrow"), check_only: true }, me)).structuredContent;
    expect(check.look_alikes).toBeUndefined();
    const clean = (await call("create_character", { ...validCharacter({ name: "Pell Ortega", bio: "A competitive bonsai trimmer who narrates her own life in the third person." }), check_only: true }, me)).structuredContent;
    expect(clean.warning).toBeUndefined();
    expect(clean.look_alikes).toBeUndefined();
  });
});

describe("a dry run a tool doesn't take, and ids of the wrong kind, are said plainly", () => {
  it("preview on sliding_doors says it doesn't take preview, before the missing change; with change it runs and says so", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "friends");
    const r = await call("sliding_doors", { episode_id: booked.episode.id, preview: true }, A.ctx);
    expect(r.isError).toBe(true);
    // 2.7.0 (the 2026-10-22-0215 run: "rejected with a long explanation"): one short sentence, then what's missing.
    expect(r.content[0].text).toMatch(/^Error: Not valid — preview: sliding_doors is free and takes no preview: call it without one\. "change" is required: one of bolder, safer, bigger_budget, long_game/);
    expect(r.structuredContent).toMatchObject({ code: "invalid_argument", field: "preview" });
    const ran = (await call("sliding_doors", { episode_id: booked.episode.id, change: "bolder", check_only: true }, A.ctx)).structuredContent;
    expect(ran.sliding_doors).toBeDefined();
    expect(ran.warning).toMatch(/^Ignored: check_only: sliding_doors is free and takes no check_only, so it ran as asked/);
    // A read-only tool with only a dry run runs.
    expect((await call("browse_episodes", { preview: true }, A.ctx)).isError).toBeUndefined();
    // A tool that spends still refuses one (#490).
    expect((await call("swipe", { character_id: A.id, target_id: HOUSE_CHARACTERS[0].id, like: true, preview: true }, A.ctx)).content[0].text).toMatch(/swipe has no preview or dry run, so nothing was done or spent/);
  });

  it("an id error names the kind of id the argument takes and what the value given is", async () => {
    const A = await agentWith("Ada Lumen");
    const booked = await houseDate(A.ctx, A.id, "friends");
    const nope = await call("go_on_date", { character_id: "nope", partner_id: HOUSE_CHARACTERS[0].id, preview: true }, A.ctx);
    expect(nope.isError).toBe(true);
    expect(nope.content[0].text).toMatch(/character_id takes a character id \(a house character's like house-nell, anyone else's a 36-character id/);
    expect(nope.content[0].text).toMatch(/"nope" is not an id of anything on the show\./);
    expect(nope.structuredContent).toMatchObject({ expected: { character_id: "character id" }, got: { character_id: "not an id of anything on the show" } });
    // A character's id where a date's goes.
    const swapped = await call("get_episode", { episode_id: A.id }, A.ctx);
    expect(swapped.isError).toBe(true);
    expect(swapped.content[0].text).toContain(`episode_id takes an episode id (a date's 36-character id: my_dates lists yours, browse_episodes everyone's); "${A.id}" is a character id (Ada Lumen).`);
    // A date's id where a character's goes.
    const other = await call("get_character", { character_id: booked.episode.id }, A.ctx);
    expect(other.content[0].text).toContain(`"${booked.episode.id}" is an episode id (a date's).`);
    // Right kinds: the error says what's wrong on its own, no hint added.
    const fine = await call("go_on_date", { character_id: HOUSE_CHARACTERS[1].id, partner_id: HOUSE_CHARACTERS[0].id, preview: true }, A.ctx);
    expect(fine.content[0].text).not.toMatch(/takes a character id/);
  });
});

describe("search_characters lists every other creator's character that's open to dates, and says why one is missing", () => {
  it("open agent characters are found (past the 300 newest), yours and closed ones are named in left_out, private ones never", async () => {
    const one = await agentWith("Hector Quill", { bio: "A retired lighthouse inspector who logs every passing ship." });
    const two = await agentWith("Hollis Marrow", { bio: "Inspects lighthouses for a living, and logs the gulls." });
    const closed = await agentWith("Ines Varga", { bio: "A lighthouse cook who never leaves the rock.", open_to_dates: false });
    const hidden = await agentWith("Wren Pike", { bio: "A lighthouse painter nobody has met." });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [hidden.id]);
    // Three hundred and twenty newer open characters: the search still reaches the older matches.
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, open_to_dates, created_via, created_at)
       select 'filler-' || g, 'filler-owner', false, 'Filler ' || g, 30, 'A filler character with nothing to say', '["calm","dry","kind"]'::jsonb, 'x', 'y', true, 'mcp', now() + interval '1 minute'
         from generate_series(1, 320) g`,
    );
    const me = await agentWith("Ottoline Brack", { bio: "A retired lighthouse inspector with a ledger." });
    const found = (await call("search_characters", { query: "lighthouse", include_house: false }, me.ctx)).structuredContent;
    expect(found.characters.map((c: Any) => c.id).sort()).toEqual([one.id, two.id].sort());
    expect(found.left_out).toEqual(
      expect.arrayContaining([
        { id: me.id, name: "Ottoline Brack", why: expect.stringMatching(/^yours: a search never lists your own characters/) },
        { id: closed.id, name: "Ines Varga", why: expect.stringMatching(/^not open to dates right now/) },
      ]),
    );
    expect(JSON.stringify(found)).not.toContain(hidden.id);
    expect(found.search_note).toMatch(/Never your own .* or a private one/);
    // Closed ones come back with open_only: false; the private one still doesn't.
    const all = (await call("search_characters", { query: "lighthouse", include_house: false, open_only: false }, me.ctx)).structuredContent;
    expect(all.characters.map((c: Any) => c.id)).toContain(closed.id);
    expect(JSON.stringify(all)).not.toContain(hidden.id);
  });
});

describe("date_agreed says who liked first and who texted first", () => {
  it("not 'Started by': the like and the first text, each said as what it is", async () => {
    const A = await agentWith("Thaddeus Quill");
    const B = await agentWith("Marguerite Plum");
    await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    await call("send_text", { character_id: B.id, to: A.id, text: "I hear you collect maps of places that moved." }, B.ctx);
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const notice = (await listNotifications(t.db, A.agentId)).find((n) => n.kind === "date_agreed")!;
    expect(notice.body).toMatch(/^Thaddeus liked first; Marguerite texted first\. Book it with go_on_date/);
    expect(notice.body).not.toMatch(/Started by/);
    expect(notice.body!.length).toBeLessThanOrEqual(300);
  });
});

describe("schemas: required, examples, and the cost first", () => {
  it("the most-used tools carry an example call that has every required argument and only known ones", () => {
    for (const name of ["go_on_date", "get_episode", "swipe", "send_text", "submit_own_date_step"]) {
      const tool = CORE_MCP_TOOLS.find((x) => x.name === name)!;
      const schema = tool.inputSchema as Any;
      expect({ name, has: Array.isArray(schema.examples) }).toEqual({ name, has: true });
      const ex = schema.examples[0];
      expect(ex).toEqual(EXAMPLE_CALLS.find((c) => c.tool === name)!.args);
      for (const req of schema.required ?? []) expect({ name, req, there: req in ex }).toEqual({ name, req, there: true });
      for (const k of Object.keys(ex)) expect({ name, k, known: k in schema.properties }).toEqual({ name, k, known: true });
    }
  });

  it("every tool that needs an argument declares it required", () => {
    const req = (name: string) => ((MCP_TOOLS.find((x) => x.name === name)!.inputSchema as Any).required ?? []) as string[];
    expect(req("go_on_date")).toEqual(["character_id"]);
    expect(req("get_episode")).toEqual(["episode_id"]);
    expect(req("submit_own_date_step")).toEqual(["episode_id"]);
    expect(req("swipe")).toEqual(["character_id", "target_id", "like"]);
    expect(req("predict")).toEqual(["episode_id", "pick"]);
    expect(req("create_character")).toEqual(["name", "age", "bio", "traits", "want", "dealbreaker", "attest"]);
    // A tool with a required argument that's missing names it, and the schema agrees (#188).
    for (const tool of CORE_MCP_TOOLS) {
      const schema = tool.inputSchema as Any;
      for (const r of schema.required ?? []) expect({ tool: tool.name, r, inProps: r in schema.properties }).toEqual({ tool: tool.name, r, inProps: true });
    }
  });

  it("every description starts with its cost; the lean list carries it beside the tool's own first sentence", async () => {
    for (const x of MCP_TOOLS) expect({ tool: x.name, first: x.description.startsWith(TOOL_COSTS[x.name as keyof typeof TOOL_COSTS]) }).toEqual({ tool: x.name, first: true });
    const lean = (await rpc("tools/list", { lean: true })).result.tools as Any[];
    const browse = lean.find((x) => x.name === "browse_episodes");
    expect(browse.cost).toBe("Free.");
    expect(browse.description).toMatch(/^The public feed, newest first/);
    expect(lean.find((x) => x.name === "go_on_date").cost).toMatch(/^Costs one date/);
  });

  it("browse_episodes' mine is in the schema with its values", () => {
    const p = (MCP_TOOLS.find((x) => x.name === "browse_episodes")!.inputSchema as Any).properties.mine;
    expect(p.enum).toEqual(["include", "only", "exclude"]);
  });
});

describe("next_calls: the calls that fit next, ids filled in", () => {
  it("go_on_date, my_status and a swipe that matches give structured next steps", async () => {
    const A = await agentWith("Ada Lumen");
    const status = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(status.next_calls[0]).toMatchObject({ tool: expect.any(String), args: expect.any(Object), why: expect.any(String) });
    const booked = await houseDate(A.ctx, A.id, "friends");
    expect(booked.next_calls).toEqual([{ tool: "get_episode", args: { episode_id: booked.episode.id, wait_seconds: 50, summary: true }, why: expect.any(String) }]);
    const B = await agentWith("Bo Quill");
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    const matched = (await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx)).structuredContent;
    expect(matched.next_calls.map((c: Any) => c.tool)).toEqual(["answer_match", "send_text"]);
    expect(matched.next_calls[0].args).toEqual({ character_id: A.id, with: B.id, yes: true });
    // Every next_calls tool is in the core list.
    for (const c of [...status.next_calls, ...booked.next_calls, ...matched.next_calls]) expect(CORE_TOOL_ORDER as readonly string[]).toContain(c.tool);
  });

  it("a finished own date's step points at the episode, and at each reflection", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, outputs: [line(0), line(1), line(2), line(3), line(4), line(5)] }, ctx);
    const done = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.stage).toBe("done");
    expect(done.next_calls[0]).toEqual({ tool: "get_episode", args: { episode_id: id, summary: true }, why: expect.any(String) });
    expect(done.next_calls.slice(1).map((c: Any) => c.tool)).toEqual(["reflect_on_date", "reflect_on_date"]);
    expect(done.transcript).toBeUndefined();
  });
});
