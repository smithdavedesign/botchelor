import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airTimings } from "@/lib/air";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, namesWhen, START_HERE, type McpContext } from "@/lib/mcp";
import { bookedBody, listNotifications, notify } from "@/lib/notifications";
import { clearStaleOwnDates } from "@/lib/own-date";
import { settleCommitment, warnBeforeExclusive } from "@/lib/partners";
import { createMatch } from "@/lib/swipes";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.4.2, from the 2026-10-21-0319 simulated-agent run (both visitors): turn notices resolve on a submit, a line sent
// to a finished date is refused (date_finished), browse_episodes says when a date really airs, points and the docs agree,
// notices say what happened, a heads-up before exclusivity, one combined wait, a five-line start, and the smaller items.
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
async function connect(client = "run-0319-test"): Promise<McpContext & { init: Any }> {
  const ctx: McpContext = {};
  const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx)).result;
  return { sessionId: ctx.issuedSessionId, init };
}
async function agent(name = "Ada Lumen", extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const made = await call("create_character", validCharacter({ name, keep_name: true, ...extra }), ctx);
  if (made.isError) throw new Error(made.content[0].text);
  return { ctx, agentId: made.structuredContent.agent_id as string, id: made.structuredContent.character.id as string };
}
const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn, honestly?`, action: "", emotion: "curious", interest_signal: 0.6 });
const showLine = (i: number) => JSON.stringify({ dialogue: `Show line ${i}: rivers move, you know. Slowly, then all at once.`, action: "", emotion: "wry", interest_signal: 0.5 });
const unreadTurns = async (userId: string) =>
  (await t.db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and kind = 'own_date_turn' and read_at is null`, [userId])).rows[0].n;

/** A two-agent speed date between Ada (agent A) and Bo (agent B), Ada's first line in: Bo's move. */
async function bosMove() {
  const A = await agent("Ada Lumen");
  const B = await agent("Bo Quill", { open_to_dates: true });
  const id: string = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
  await call("submit_own_date_step", { episode_id: id, output: line(0) }, A.ctx);
  return { A, B, id };
}

/** A date between one agent's own two characters, played to the end. */
async function finishedOwnDate() {
  const A = await agent("Ada Lumen");
  const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), A.ctx)).structuredContent.character.id;
  let step = (await call("start_own_date", { character_id: A.id, partner_id: b, format: "speed_date" }, A.ctx)).structuredContent.step;
  const id = step.episode_id;
  let i = 0;
  while (step.stage === "turn") step = (await call("submit_own_date_step", { episode_id: id, output: line(i++) }, A.ctx)).structuredContent.step;
  step = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, A.ctx)).structuredContent.step;
  expect(step.stage).toBe("done");
  return { A, id };
}

it("is MCP 2.4.x (2.4.2 at the time)", () => {
  // 2.5.0 (the 2026-10-21-2300 run) and later keep what 2.4.2 shipped.
  expect(MCP_SERVER_INFO.version.localeCompare("2.4.2", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("1. a 'your move' notice resolves as soon as its move is made", () => {
  it("submitting the turn marks the agent's own turn notice for that date read at once, mid-date", async () => {
    const { A, B, id } = await bosMove();
    expect(await unreadTurns(B.agentId)).toBe(1);
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, B.ctx);
    // Bo moved: Bo's notice is done while the date goes on; Ada now has hers.
    expect(await unreadTurns(B.agentId)).toBe(0);
    expect(await unreadTurns(A.agentId)).toBe(1);
    expect((await t.db.query(`select status from episodes where id = $1`, [id])).rows[0].status).toBe("generating");
  });

  it("an older notice whose move has been made since says so when read (resolved: moved), and leaves the unread count", async () => {
    const { B, id } = await bosMove();
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, B.ctx);
    // A "still your move" that raced the line in, dated before it.
    await t.db.query(
      `insert into notifications (id, user_id, kind, title, body, created_at) values (gen_random_uuid()::text, $1, 'own_date_turn', '⏰ Still your move', $2, now() - interval '1 minute')`,
      [B.agentId, `Two-agent date ${id}: the other agent is waiting.`],
    );
    const n = (await listNotifications(t.db, B.agentId)).find((x) => x.title.startsWith("⏰"));
    expect(n).toMatchObject({ read: true, resolved: { episode_id: id, why: "moved" }, body: expect.stringMatching(/you've made that move/) });
    expect((await call("my_status", {}, B.ctx)).structuredContent.unread_notifications).toBe(0);
  });
});

describe("2. a line sent to a date that's over is refused: date_finished, naming the state", () => {
  it("finished (done): an error, not accepted: true; check_only too", async () => {
    const { A, id } = await finishedOwnDate();
    for (const extra of [{}, { check_only: true }]) {
      const r = await call("submit_own_date_step", { episode_id: id, output: line(99), ...extra }, A.ctx);
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ code: "date_finished", state: "done", accepted: false });
      expect(r.content[0].text).toMatch(/already finished \(state: done\)\. Your line wasn't used/);
    }
    // A batch says it too.
    const batch = await call("submit_own_date_step", { episode_id: id, outputs: [line(1), line(2)] }, A.ctx);
    expect(batch.structuredContent).toMatchObject({ code: "date_finished", state: "done" });
    // Reading it still works.
    expect((await call("get_own_date_step", { episode_id: id }, A.ctx)).structuredContent.step.stage).toBe("done");
  });

  it("called off: state called_off", async () => {
    const { A, B, id } = await bosMove();
    await call("decline_own_date", { episode_id: id }, B.ctx);
    const r = await call("submit_own_date_step", { episode_id: id, output: line(2) }, A.ctx);
    expect(r.structuredContent).toMatchObject({ code: "date_finished", state: "called_off" });
    expect(r.content[0].text).toMatch(/called off/);
  });

  it("handed over: the show's model plays your side, so your line is refused", async () => {
    const { B, id } = await bosMove();
    await t.db.query(`update episodes set handed_over = 'b', handed_over_at = now() where id = $1`, [id]);
    const r = await call("submit_own_date_step", { episode_id: id, output: line(1) }, B.ctx);
    expect(r.structuredContent).toMatchObject({ code: "date_finished", state: "handed_over" });
  });

  it("lapsed: state gone, for both agents", async () => {
    const { A, B, id } = await bosMove();
    expect(await clearStaleOwnDates(t.db, new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    for (const who of [A, B]) {
      const r = await call("submit_own_date_step", { episode_id: id, output: line(1) }, who.ctx);
      expect(r.structuredContent).toMatchObject({ code: "date_finished", state: "gone" });
      expect(r.content[0].text).toMatch(/lapsed after 24 hours/);
    }
    // A date that was never theirs is still "not found".
    const stranger = await agent("Cy Wren");
    expect((await call("submit_own_date_step", { episode_id: id, output: line(1) }, stranger.ctx)).content[0].text).toMatch(/No self-performed date of yours/);
  });
});

describe("3. browse_episodes with open: true says when a date really airs", () => {
  async function housed() {
    const host = await agent("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = (await call("go_on_date", { character_id: host.id, partner_id: HOUSE_PARTNER_ID }, host.ctx)).structuredContent;
    return { host, id: booked.episode.id as string, airs_at: booked.airs_at as string };
  }

  it("lists airs_at, minutes_left and that predictions stay open until it airs", async () => {
    const { id, airs_at } = await housed();
    const viewer = await agent("Bo Quill");
    const r = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent;
    const e = r.episodes.find((x: Any) => x.id === id);
    expect(e).toMatchObject({ airs_at, airs: "scheduled", predictions_close: "when_it_airs" });
    expect(e.minutes_left).toBeGreaterThan(0);
    expect(e.minutes_left).toBeLessThanOrEqual(10);
    expect(r.airs_at_note).toMatch(/Predictions stay open until it actually airs/);
    expect(JSON.stringify(r)).not.toMatch(/the latest a date airs/);
  });

  it("a date still being written airs once finished (when_ready), a due one any moment, a watch party's in its room", async () => {
    const { id } = await housed();
    const now = new Date();
    await t.db.query(`update episodes set status = 'generating', created_at = now() - interval '30 minutes' where id = $1`, [id]);
    expect((await airTimings(t.db, [id], now)).get(id)).toMatchObject({ airs: "when_ready", minutes_left: 0, airs_at: now.toISOString() });
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [id]);
    expect((await airTimings(t.db, [id], now)).get(id)).toMatchObject({ airs: "due", minutes_left: 0 });
    const at = new Date(now.getTime() + 45 * 60_000);
    await t.db.query(`insert into watch_parties (id, episode_id, kind, starts_at) values ('wp-1', $1, 'premiere', $2)`, [id, at.toISOString()]);
    expect((await airTimings(t.db, [id], now)).get(id)).toMatchObject({ airs: "watch_party", airs_at: at.toISOString(), minutes_left: 45 });
  });
});

describe("4. points: when they land, said the way the code counts them", () => {
  it("predict says it scores the moment it airs, never 'at the latest'; an unlisted date takes no predictions", async () => {
    const host = await agent("Ada Lumen");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = (await call("go_on_date", { character_id: host.id, partner_id: HOUSE_PARTNER_ID }, host.ctx)).structuredContent;
    const viewer = await agent("Bo Quill");
    const pick = (await call("predict", { episode_id: booked.episode.id, pick: "friends", drama_pick: "a" }, viewer.ctx)).structuredContent;
    expect(pick.note).toMatch(/scored the moment it airs/);
    expect(pick.note).not.toMatch(/at the latest/);
    expect(pick).toMatchObject({ airs: "scheduled", predictions_close: "when_it_airs" });
    const status = (await call("my_status", {}, viewer.ctx)).structuredContent;
    expect(status.predictions.points_waiting).toBe(15); // the ending and the drama pick
    expect(status.predictions.note).toMatch(/counted while it stays public/);

    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [booked.episode.id]);
    const refused = await call("predict", { episode_id: booked.episode.id, pick: "friends" }, viewer.ctx);
    expect(refused.structuredContent).toMatchObject({ code: "not_public" });
    expect(refused.content[0].text).toMatch(/only public dates take predictions/);
  });

  it("the docs no longer say predictions close before a date airs", async () => {
    const { init } = await connect();
    expect(init.instructions).not.toMatch(/once predictions close|airs_at is the latest/);
    const all = JSON.stringify(MCP_TOOLS);
    expect(all).not.toMatch(/once predictions close|airs_at is the latest/);
  });
});

describe("5. notices say what happened", () => {
  it("a 'Book it' notice for a date the agents perform themselves says so and links the date (#552)", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill", { open_to_dates: true });
    const [lo, hi] = [A.id, B.id].sort();
    await notify(t.db, A.agentId, { kind: "date_agreed", title: "📅 Ada and Bo want to go on a date", body: "Book it", link: `/messages/${lo}/${hi}` });
    await new Promise((r) => setTimeout(r, 5));
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    const n = (await listNotifications(t.db, A.agentId)).find((x) => x.kind === "date_agreed")!;
    expect(n.body).toBe("Booked: you're performing this date yourself (get_own_date_step has your move).");
    expect(n.body).not.toMatch(/filmed/);
    expect(n).toMatchObject({ link: `/episodes/${id}`, booked: { episode_id: id, status: "generating", performed: "you" } });
    expect(bookedBody("generating", "show")).toMatch(/being filmed on the show's model/);
    expect(bookedBody("generating", "agents")).toMatch(/agents are performing/);
  });

  it("a match notice for an agent names the calls, not a page it can't click", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    await createMatch(t.db, A.id, B.id);
    const n = (await listNotifications(t.db, A.agentId)).find((x) => x.kind === "matched")!;
    expect(n.body).toMatch(/send_text .*answer_match/);
    expect(n.body).not.toMatch(/from their page/);
  });

  it("match_taken and partner_style name the partner in full, with its id and whether it's the house cast (#553)", async () => {
    const visitor = await agent("Ada Lumen", { open_to_dates: true });
    const B = await agent("Xan Morrow", { open_to_dates: true });
    await call("update_character", { character_id: B.id, partner_style: "one" }, B.ctx);
    const [mlo, mhi] = [visitor.id, B.id].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, agreed_at) values ($1, $2, true, true, now())`, [mlo, mhi]);
    const house = (await t.db.query<{ name: string }>(`select name from characters where id = $1`, [HOUSE_PARTNER_ID])).rows[0].name;
    const [lo, hi] = [B.id, HOUSE_PARTNER_ID].sort();
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, 'dating')`, [lo, hi]);
    await settleCommitment(t.db, lo, hi);
    const taken = (await listNotifications(t.db, visitor.agentId)).find((n) => n.kind === "match_taken")!;
    expect(taken.title).toBe(`💍 Xan Morrow is now dating ${house} (house cast) and closed to other dates`);
    expect(taken.body).toContain(`(character ${HOUSE_PARTNER_ID})`);
    const own = (await listNotifications(t.db, B.agentId)).find((n) => n.kind === "partner_style")!;
    expect(own.body).toContain(`Partner: ${house} (house cast), character ${HOUSE_PARTNER_ID}.`);
    const s = (await call("my_status", {}, visitor.ctx)).structuredContent;
    expect(s.matches_closed[0]).toMatchObject({ with: B.id, taken_by: { id: HOUSE_PARTNER_ID, name: house, house: true } });
  });
});

describe("6. a heads-up before a character goes exclusive, and the opt-out", () => {
  async function sparks(style: "one" | "open" | "decide") {
    const B = await agent("Xan Morrow", { open_to_dates: true });
    const P = await agent("Pell Ortega", { open_to_dates: true });
    if (style !== "decide") await call("update_character", { character_id: B.id, partner_style: style }, B.ctx);
    const [lo, hi] = [B.id, P.id].sort();
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 1, 1, 'sparks')`, [lo, hi]);
    return { B, P, lo, hi };
  }

  it("a one-partner character's owner hears it one date before, with partner_style \"open\" to stay open; my_status lists it", async () => {
    const { B, lo, hi } = await sparks("one");
    expect(await warnBeforeExclusive(t.db, lo, hi)).toBeGreaterThanOrEqual(1);
    const n = (await listNotifications(t.db, B.agentId)).find((x) => x.kind === "exclusive_soon")!;
    expect(n.title).toBe("⏳ Xan is one date from going exclusive with Pell Ortega");
    expect(n.body).toMatch(/one more date that ends in a second date makes them a Dating couple.*you set them to one partner.*update_character with partner_style: "open"/);
    const s = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(s.exclusive_soon).toEqual([expect.objectContaining({ character_id: B.id, with: expect.objectContaining({ name: "Pell Ortega" }) })]);
    expect(s.exclusive_soon_note).toMatch(/partner_style: "open"/);
  });

  it("opted out (partner_style \"open\"): no heads-up, not listed, and it doesn't close", async () => {
    const { B, lo, hi } = await sparks("open");
    await warnBeforeExclusive(t.db, lo, hi);
    expect((await listNotifications(t.db, B.agentId)).some((x) => x.kind === "exclusive_soon")).toBe(false);
    expect((await call("my_status", {}, B.ctx)).structuredContent.exclusive_soon).toBeUndefined();
    await t.db.query(`update relationships set stage = 'dating' where character_a = $1 and character_b = $2`, [lo, hi]);
    await settleCommitment(t.db, lo, hi);
    expect((await t.db.query(`select open_to_dates from characters where id = $1`, [B.id])).rows[0].open_to_dates).toBe(true);
  });

  it("go_on_date and my_status document it", () => {
    for (const name of ["go_on_date", "my_status"]) expect(MCP_TOOLS.find((x) => x.name === name)!.description).toMatch(/exclusive_soon/);
    expect(MCP_TOOLS.find((x) => x.name === "go_on_date")!.description).toMatch(/opt out with partner_style "open"/);
  });
});

describe("7. one wait: my_status wakes for texts and own-date moves, and says which", () => {
  it("a text wakes it: woke_for texts, and the item names the thread", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    const [lo, hi] = [A.id, B.id].sort();
    const start = (await call("my_status", {}, A.ctx)).structuredContent.cursor;
    setTimeout(() => void notify(t.db, A.agentId, { kind: "texted", title: "💬 Bo Quill texted Ada Lumen", body: "hi", link: `/messages/${lo}/${hi}` }), 800);
    const got = (await call("my_status", { since: start, wait_seconds: 6 }, A.ctx)).structuredContent;
    expect(got).toMatchObject({ returned_because: "new", woke_for: ["texts"] });
    expect(got.new_since[0]).toMatchObject({ kind: "texted", character_id: A.id, with: B.id });
  });

  it("a turn notice wakes it with the date named", async () => {
    const { A, B, id } = await bosMove();
    const start = (await call("my_status", {}, A.ctx)).structuredContent.cursor;
    setTimeout(() => void call("submit_own_date_step", { episode_id: id, output: line(1) }, B.ctx), 800);
    const got = (await call("my_status", { since: start, wait_seconds: 6 }, A.ctx)).structuredContent;
    expect(got).toMatchObject({ returned_because: "new", woke_for: ["own_date_turn"] });
    expect(got.new_since[0]).toMatchObject({ kind: "own_date_turn", episode_id: id });
  });

  it("a move nobody is told of (the show took the quiet side and played it) wakes it too", async () => {
    const { A, id } = await bosMove();
    const start = (await call("my_status", {}, A.ctx)).structuredContent.cursor;
    await t.db.query(`update episodes set last_move_at = now() - interval '4 minutes' where id = $1`, [id]);
    scriptedModel([showLine(1)]);
    const got = (await call("my_status", { since: start, wait_seconds: 6 }, A.ctx)).structuredContent;
    expect(got).toMatchObject({ returned_because: "new", woke_for: ["own_date_turn"] });
    expect(got.new_since.find((x: Any) => x.episode_id === id)).toMatchObject({ kind: "own_date_turn" });
    // Passing the cursor back doesn't wake for the same move again.
    const again = (await call("my_status", { since: got.cursor, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(again.new_since.filter((x: Any) => x.kind === "own_date_turn")).toEqual([]);
  });
});

describe("8. onboarding", () => {
  it("instructions open with five short lines: what it is, three calls, a plain-HTTP call, and when agent_id is needed", async () => {
    const { init } = await connect();
    const top = init.instructions.split("\n\n")[0].split("\n");
    expect(top).toEqual(START_HERE());
    expect(top.length).toBeLessThanOrEqual(5);
    expect(top[0]).toMatch(/^START HERE\. Botchelor is a comedic blind-date show/);
    expect(top[1]).toMatch(/1 my_status.*2 create_character.*3 go_on_date/);
    expect(top[2]).toMatch(/curl -s \S+\/api\/mcp -H 'content-type: application\/json' -H 'mcp-session-id: <from initialize>' -d '\{"jsonrpc":"2\.0".*"method":"tools\/call"/);
    expect(top[3]).toMatch(/with that header the session is enough.*pass the agent_id .* on every call/);
    expect(init.instructions).toMatch(/\nQUICKSTART/);
  });
});

describe("9. smaller items", () => {
  it("search_characters says who's behind each result and whether it's live, and takes only: live_agents", async () => {
    const viewer = await agent("Ada Lumen");
    const other = await agent("Bo Quill", { open_to_dates: true });
    const all = (await call("search_characters", {}, viewer.ctx)).structuredContent;
    for (const c of all.characters) expect(c).toEqual(expect.objectContaining({ made_by: expect.any(String), run_by: expect.any(String), live: expect.any(Boolean) }));
    expect(all.characters.find((c: Any) => c.made_by === "house")).toMatchObject({ run_by: "house", live: true });
    const live = (await call("search_characters", { only: "live_agents" }, viewer.ctx)).structuredContent;
    expect(live.only).toBe("live_agents");
    expect(live.characters.map((c: Any) => c.id)).toEqual([other.id]);
    expect(live.characters[0]).toMatchObject({ run_by: "agent", live: true, agent_active: "active now" });
  });

  it("a text that names a weekday or a clock time gets a warning (check_only too), and still sends", async () => {
    expect(namesWhen("Let's do the night market, Friday at 8?")).toBe(true);
    expect(namesWhen("Meet me at 7pm by the pier")).toBe(true);
    expect(namesWhen("The night market, then: the dumpling stall?")).toBe(false);
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    await createMatch(t.db, A.id, B.id);
    const checked = (await call("send_text", { character_id: A.id, to: B.id, text: "The night market on Friday at 8?", check_only: true }, A.ctx)).structuredContent;
    expect(checked).toMatchObject({ would_send: true, when_warning: expect.stringMatching(/never a weekday or a clock time/) });
    const sent = (await call("send_text", { character_id: A.id, to: B.id, text: "The night market on Friday at 8?" }, A.ctx)).structuredContent;
    expect(sent.sent).toBeTruthy();
    expect(sent.when_warning).toBeTruthy();
    const plain = (await call("send_text", { character_id: A.id, to: B.id, text: "The night market, then: the dumpling stall?" }, A.ctx)).structuredContent;
    expect(plain.when_warning).toBeUndefined();
  });

  it("no batch on a two-agent date, and the error says why (turns alternate)", async () => {
    const { B, id } = await bosMove();
    const r = await call("submit_own_date_step", { episode_id: id, outputs: [line(1), line(3)] }, B.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/turns alternate, so you never have two lines in a row/);
  });
});
