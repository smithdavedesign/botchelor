import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as mcpGet } from "@/app/api/mcp/route";
import { proposeDate } from "@/lib/date-proposals";
import { argEnums, CORE_MCP_TOOLS, ENUM_SOURCES, handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, partnerStyleEcho, type McpContext } from "@/lib/mcp";
import { listNotifications } from "@/lib/notifications";
import { nameAndJobClose, originality, RECENT_HOURS } from "@/lib/originality";
import { ONE_LINE_DEFAULTS, oneLineTurn, RECAP_EXAMPLE, TURN_EXAMPLE } from "@/lib/own-date";
import { settleCommitment } from "@/lib/partners";
import { createMatch } from "@/lib/swipes";
import { BASE_URL, episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// MCP 2.4.3, from the 2026-10-21-0419 simulated-agent run: exclusivity as a visible choice, a compact my_status that
// leaves the static blocks out, originality against recent characters, notices that say who started a date and who
// performs it, a stable browse order, invites first in next, one text-item shape, a one-line mode for own dates, enums
// in every tool list, and the crowd's exact names (tests/loop-crowd.test.ts).
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
async function connect(client = "run-0419-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
async function agent(name = "Ada Lumen", extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const made = await call("create_character", validCharacter({ name, keep_name: true, ...extra }), ctx);
  if (made.isError) throw new Error(made.content[0].text);
  return { ctx, agentId: made.structuredContent.agent_id as string, id: made.structuredContent.character.id as string, made: made.structuredContent };
}
const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn, honestly?`, action: "", emotion: "curious", interest_signal: 0.6 });

it("is MCP 2.4.3", () => {
  expect(MCP_SERVER_INFO.version).toMatch(/^2\.4\./);
});

describe("1. exclusivity is a visible choice on create_character (#555)", () => {
  it("documents partner_style with its values, default and meaning", () => {
    const p = (MCP_TOOLS.find((x) => x.name === "create_character")!.inputSchema as Any).properties.partner_style;
    expect(p).toMatchObject({ type: "string", enum: ["one", "open", "decide"], default: "decide" });
    expect(p.description).toMatch(/one: once it's in a Dating couple \(one great date can be enough\) it closes to other dates\. open: it keeps dating others\. decide \(default\)/);
    expect(ENUM_SOURCES["create_character.partner_style"]).toEqual(["one", "open", "decide"]);
  });

  it("accepts it up front, saves it and echoes it in the create result and in get_character", async () => {
    const { ctx, id, made } = await agent("Ada Lumen", { partner_style: "open" });
    expect(made).toMatchObject({ partner_style: "open", character: { partner_style: "open" }, partner_style_note: expect.stringMatching(/keeps dating others/) });
    expect((await t.db.query(`select partner_style from characters where id = $1`, [id])).rows[0].partner_style).toBe("open");
    const seen = (await call("get_character", { character_id: id }, ctx)).structuredContent;
    expect(seen).toMatchObject({ partner_style: "open", partner_style_note: expect.stringMatching(/update_character/) });
  });

  it("left out, it's decide (the character's own call), said so; check_only echoes it; a wrong value is refused", async () => {
    const { ctx, id, made } = await agent("Ada Lumen");
    expect(made.partner_style).toBe("decide");
    expect(made.partner_style_note).toMatch(/Its own call \(the default\).*closes to other dates once it's in a Dating couple/);
    expect((await t.db.query(`select partner_style from characters where id = $1`, [id])).rows[0].partner_style).toBeNull();
    expect((await call("get_character", { character_id: id }, ctx)).structuredContent.partner_style).toBe("decide");
    const checked = (await call("create_character", validCharacter({ name: "Bo Quill", partner_style: "one", check_only: true }), ctx)).structuredContent;
    expect(checked).toMatchObject({ saved: false, partner_style: "one", partner_style_note: expect.stringMatching(/One partner: once it's in a Dating couple/) });
    const bad = await call("create_character", validCharacter({ name: "Cy Moss", partner_style: "poly" }), ctx);
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/partner_style is one of one, open, decide \(default decide\)/);
  });

  it("one closes to other dates in a Dating couple; open doesn't; get_character says what decide settled on", async () => {
    const one = await agent("Ada Lumen", { partner_style: "one", open_to_dates: true });
    const open = await agent("Bo Quill", { partner_style: "open", open_to_dates: true });
    for (const c of [one, open]) {
      const [lo, hi] = [c.id, HOUSE_PARTNER_ID].sort();
      await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, 'dating')`, [lo, hi]);
      await settleCommitment(t.db, lo, hi);
    }
    const openNow = async (id: string) => (await t.db.query(`select open_to_dates from characters where id = $1`, [id])).rows[0].open_to_dates;
    expect(await openNow(one.id)).toBe(false);
    expect(await openNow(open.id)).toBe(true);
    expect(partnerStyleEcho("decide", "one")).toMatchObject({ partner_style: "decide", partner_style_decided: "one", partner_style_note: expect.stringMatching(/settled on one partner/) });
  });
});

describe("2. my_status compact: true leaves the static blocks out after a session's first call", () => {
  it("first compact call has the house cast; the next leaves it out and says how to get it back; compact: false and the default keep it", async () => {
    const { ctx } = await agent("Ada Lumen");
    const fresh = await connect();
    const first = (await call("my_status", { compact: true }, fresh)).structuredContent;
    expect(first.house_cast.length).toBeGreaterThan(0);
    expect(first.left_out).toBeUndefined();
    // The agent's own session already had my_status? Not yet: its first call is this one.
    const a1 = (await call("my_status", { compact: true }, ctx)).structuredContent;
    expect(a1.house_cast.length).toBeGreaterThan(0);
    const a2 = (await call("my_status", { compact: true }, ctx)).structuredContent;
    expect(a2.house_cast).toBeUndefined();
    expect(a2.others).toBeUndefined();
    expect(a2.left_out).toEqual({ blocks: ["house_cast", "others"], back: expect.stringMatching(/compact: false/) });
    expect(JSON.stringify(a2).length).toBeLessThan(JSON.stringify(a1).length);
    expect((await call("my_status", { compact: false }, ctx)).structuredContent.house_cast[0].traits).toBeDefined();
    const plain = (await call("my_status", {}, ctx)).structuredContent;
    expect(plain.house_cast[0].traits).toBeDefined();
    expect(plain.house_cast_note).toBeDefined();
    expect(plain.left_out).toBeUndefined();
  });

  it("without a session, passing since (so it has called before) leaves them out too; the schema says how to get them back", async () => {
    const { agentId } = await agent("Ada Lumen");
    const cursor = (await call("my_status", { agent_id: agentId }, {})).structuredContent.cursor;
    const later = (await call("my_status", { agent_id: agentId, compact: true, since: cursor }, {})).structuredContent;
    expect(later.house_cast).toBeUndefined();
    expect(later.left_out.blocks).toContain("house_cast");
    const schema = (MCP_TOOLS.find((x) => x.name === "my_status")!.inputSchema as Any).properties.compact;
    expect(schema.default).toBe(false);
    expect(schema.description).toMatch(/after this session's first my_status no house cast.*compact: false brings it back/);
  });
});

describe("3. originality against characters made recently by anyone", () => {
  const sheet = (name: string, bio: string, occupation: string) =>
    validCharacter({ name, bio, traits: ["dry", "patient", "exacting"], want: "Someone who will argue about tides", dealbreaker: "Littering", extras: { occupation } });

  it("a close name doing the same job as a recent character: flagged, with a concrete different job or name, before saving", async () => {
    const A = await agent("Odalys Fenn", { ...sheet("Odalys Fenn", "Draws coastline charts for a ferry company and redraws them when the sandbanks move.", "cartographer"), keep_name: true });
    const B = await connect();
    const r = (await call("create_character", { ...sheet("Odalis Crane", "Spends weekends painting lighthouses badly, and weekdays at a drawing table.", "cartographer"), check_only: true }, B)).structuredContent;
    const twin = r.originality.similar.find((s: Any) => s.id === A.id);
    expect(twin).toMatchObject({ kind: "concept", recent: true, name_and_job: true, why: expect.stringMatching(new RegExp(`made in the last ${RECENT_HOURS} hours, has a close name and the same job \\(cartographer\\)`)) });
    expect(r.originality.suggestion.text).toMatch(/^Too close to Odalys Fenn .*Pick a different job or name before saving: a name like .+, or a job like .+\.$/);
    expect(r.originality.suggestion.names.length).toBeGreaterThan(0);
    expect(r.originality.suggestion.jobs.length).toBeGreaterThan(0);
    expect(r.originality.suggestion.names.every((n: string) => !/^Odal/i.test(n))).toBe(true);
    expect(r.originality.tips[0]).toBe(r.originality.suggestion.text);
    // The save says it too.
    const saved = (await call("create_character", sheet("Odalis Crane", "Spends weekends painting lighthouses badly, and weekdays at a drawing table.", "cartographer"), B)).structuredContent;
    expect(saved.suggestion).toMatch(/Pick a different job or name/);
  });

  it("not for an older character, a private one, a different job, or a different name", async () => {
    const A = await agent("Odalys Fenn", sheet("Odalys Fenn", "Draws coastline charts for a ferry company and redraws them when the sandbanks move.", "cartographer"));
    const draft = { name: "Odalis Crane", bio: "Spends weekends painting lighthouses badly.", traits: ["dry", "patient", "exacting"], want: "x", dealbreaker: "y", extras: { occupation: "cartographer" } };
    expect((await originality(t.db, draft)).suggestion).toBeDefined();
    expect((await originality(t.db, { ...draft, extras: { occupation: "beekeeper" } })).suggestion).toBeUndefined();
    expect((await originality(t.db, { ...draft, name: "Wren Crane" })).suggestion).toBeUndefined();
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [A.id]);
    expect((await originality(t.db, draft)).suggestion).toBeUndefined();
    await t.db.query(`update characters set visibility = 'public', created_at = now() - interval '3 days' where id = $1`, [A.id]);
    expect((await originality(t.db, draft)).suggestion).toBeUndefined();
    expect(nameAndJobClose({ name: "Odalis Crane", extras: { occupation: "cartographer" } }, { id: "x", name: "Odalys Fenn", extras: { occupation: "cartographer" } })).toEqual(["cartographer"]);
  });

  it("the recent pass reads through an index on created_at", async () => {
    const { rows } = await t.db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'characters' and indexname = 'characters_created_idx'`);
    expect(rows).toHaveLength(1);
  });
});

describe("4. date notices say who started it and who performs each side", () => {
  it("date_agreed: the side that liked first, and who performs on go_on_date or start_own_date", async () => {
    const A = await agent("Ada Lumen", { open_to_dates: true });
    const B = await agent("Bo Quill", { open_to_dates: true });
    await t.db.query(`insert into swipes (swiper, target, liked, created_at) values ($1, $2, true, now() - interval '1 hour'), ($2, $1, true, now())`, [B.id, A.id]);
    await createMatch(t.db, A.id, B.id);
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const n = (await listNotifications(t.db, A.agentId)).find((x) => x.kind === "date_agreed")!;
    expect(n.body).toMatch(/^Started by Bo \(liked first\)\. Book it with go_on_date .*: the show's model performs both sides\. Or start_own_date, same ids: you perform Ada, their agent Bo\.$/);
  });

  it("an invite to a two-agent date: started by their agent; their side theirs, yours yours", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill", { open_to_dates: true });
    await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx);
    const n = (await listNotifications(t.db, B.agentId)).find((x) => x.kind === "own_date_invite")!;
    expect(n.body).toMatch(/started by Ada's agent\. Ada: their agent performs\. Bo: you do, on your own model .*the show's model takes it/);
    expect(n.body!.length).toBeLessThanOrEqual(300);
  });

  it("a date proposal: started by their creator; if accepted the show's model performs both sides", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    expect((await proposeDate(t.db, A.agentId, A.id, B.id)).ok).toBe(true);
    const n = (await listNotifications(t.db, B.agentId)).find((x) => x.kind === "date_proposal")!;
    expect(n.body).toMatch(/^Started by Ada's creator \(they proposed it\)\. .*the show's model performs both sides, Ada and Bo/);
  });
});

describe("5. browse_episodes open: true sorts stably, and predict states the lead time", () => {
  it("by minutes_left ascending, then id", async () => {
    const host = await agent("Ada Lumen");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      scriptOutcome({ ending: "friends" });
      scriptedModel([episodeJson()]);
      const booked = (await call("go_on_date", { character_id: host.id, partner_id: HOUSE_PARTNER_ID, again: true }, host.ctx)).structuredContent;
      ids.push(booked.episode.id);
    }
    // Two air at the same moment (a tie), one sooner.
    await t.db.query(`update episodes set air_after = now() + interval '8 minutes' where id = any($1)`, [[ids[0], ids[1]]]);
    await t.db.query(`update episodes set air_after = now() + interval '3 minutes' where id = $1`, [ids[2]]);
    const viewer = await agent("Bo Quill");
    const order = async () => ((await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent.episodes as Any[]).map((e) => e.id);
    const tied = [ids[0], ids[1]].sort();
    expect(await order()).toEqual([ids[2], ...tied]);
    expect(await order()).toEqual([ids[2], ...tied]);
    const listed = (await call("browse_episodes", { open: true }, viewer.ctx)).structuredContent.episodes as Any[];
    expect(listed.map((e) => e.minutes_left)).toEqual([...listed.map((e) => e.minutes_left)].sort((x, y) => x - y));
  });

  it("predict says when predictions close (the lead time) and lists its picks as enums", () => {
    const predict = MCP_TOOLS.find((x) => x.name === "predict")!;
    expect(predict.description).toMatch(/Lead time: open from booking until it airs, about \d+ minutes later/);
    expect((predict.inputSchema as Any).properties.pick.enum).toEqual(["second_date", "friends", "disaster"]);
    expect((predict.inputSchema as Any).properties.drama_pick.enum).toEqual(["a", "b", "neither"]);
    expect(MCP_TOOLS.find((x) => x.name === "browse_episodes")!.description).toMatch(/by minutes_left then id/);
  });
});

describe("6. another agent's invite leads my_status.next", () => {
  it("a two-agent date waiting on you: get_own_date_step first, with the invite named", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill", { open_to_dates: true });
    const id: string = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, output: line(0) }, A.ctx);
    const s = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(s.next[0]).toBe("get_own_date_step");
    expect(s.invites).toEqual([expect.objectContaining({ kind: "own_date", episode_id: id, from: { id: A.id, name: "Ada Lumen" }, started_by: "Ada Lumen's agent", you_perform: "Bo Quill" })]);
    // The host isn't invited: its own date isn't an invite.
    expect((await call("my_status", {}, A.ctx)).structuredContent.invites).toBeUndefined();
  });

  it("a date proposal waiting on you: answer_match first, even with a second date ready", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    await proposeDate(t.db, A.agentId, A.id, B.id);
    const s = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(s.next[0]).toBe("answer_match");
    expect(s.invites[0]).toMatchObject({ kind: "proposal", from: { id: A.id }, your_character: { id: B.id }, call: expect.stringMatching(/^answer_match \(character_id: /) });
  });
});

describe("7. one text-item shape (#556)", () => {
  async function thread() {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    await createMatch(t.db, A.id, B.id);
    await call("send_text", { character_id: A.id, to: B.id, text: "Found a map with a river that moved." }, A.ctx);
    return { A, B };
  }

  it("read_texts: every item has from, text and at; markers are from the show", async () => {
    const { A, B } = await thread();
    const r = (await call("read_texts", { character_id: B.id, with: A.id }, B.ctx)).structuredContent;
    for (const i of r.items) expect(i).toEqual(expect.objectContaining({ id: expect.any(String), kind: expect.any(String), from: expect.any(String), text: expect.any(String), at: expect.any(String) }));
    expect(r.items.find((i: Any) => i.kind === "matched")).toMatchObject({ from: "show", text: "💘 They matched" });
    expect(r.items.at(-1)).toMatchObject({ from: "them", text: "Found a map with a river that moved.", kind: "between_dates", written_by: "them" });
    expect(r.items_note).toBeUndefined();
    // Nothing after the newest: items_note says it's nothing new, not an empty thread.
    const after = (await call("read_texts", { character_id: B.id, with: A.id, after: r.items.at(-1).id }, B.ctx)).structuredContent;
    expect(after).toMatchObject({ items: [], items_note: expect.stringMatching(/^Nothing new since your cursor/) });
    // The description says the shape.
    expect(MCP_TOOLS.find((x) => x.name === "read_texts")!.description).toMatch(/Every item is \{id, kind, from, text, at, \.\.\.\}/);
  });

  it("an empty thread says so (not an error), and a wait that times out says which", async () => {
    const A = await agent("Ada Lumen");
    const B = await agent("Bo Quill");
    const empty = (await call("read_texts", { character_id: A.id, with: B.id }, A.ctx)).structuredContent;
    expect(empty).toMatchObject({ items: [], items_note: expect.stringMatching(/^This thread is empty/) });
    const waited = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(waited).toMatchObject({ items: [], still_waiting: true, items_note: expect.stringMatching(/^This thread is empty/) });
    await createMatch(t.db, A.id, B.id);
    await call("send_text", { character_id: A.id, to: B.id, text: "Hello from the map room." }, A.ctx);
    const quiet = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(quiet.items_note).toMatch(/^Nothing new from them since your cursor/);
  });

  it("a wait's texts, send_text's reply and my_status's text items use the same shape", async () => {
    const { A, B } = await thread();
    const sent = (await call("send_text", { character_id: B.id, to: A.id, text: "Rivers do that. Slowly." }, B.ctx)).structuredContent;
    expect(sent.sent).toEqual(expect.objectContaining({ from: "this_character", text: "Rivers do that. Slowly.", at: expect.any(String) }));
    // my_status first (the wait below reads the thread, which reads its notice).
    const status = (await call("my_status", {}, A.ctx)).structuredContent;
    const texted = status.new_since.find((i: Any) => i.kind === "texted");
    expect(texted).toMatchObject({ from: "them", text: "Rivers do that. Slowly.", at: expect.any(String), character_id: A.id, with: B.id });
    const got = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 2 }, A.ctx)).structuredContent;
    expect(got.items[0]).toEqual(expect.objectContaining({ from: "them", text: "Rivers do that. Slowly.", at: expect.any(String) }));
  });
});

describe("8. a one-line mode for own dates", () => {
  async function ownDate() {
    const A = await agent("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true }), A.ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: A.id, partner_id: b, format: "speed_date" }, A.ctx)).structuredContent.step;
    return { A, step, id: step.episode_id as string };
  }

  it("a plain string, or { line }, is a turn with action, emotion and interest filled in; the full format still works", async () => {
    const { A, id } = await ownDate();
    const r1 = (await call("submit_own_date_step", { episode_id: id, output: "You never asked about the wind." }, A.ctx)).structuredContent;
    expect(r1.accepted).toBe(true);
    const r2 = (await call("submit_own_date_step", { episode_id: id, output: { line: "I was saving it for the second act.", see_again: true } }, A.ctx)).structuredContent;
    expect(r2.accepted).toBe(true);
    const r3 = (await call("submit_own_date_step", { episode_id: id, output: line(2) }, A.ctx)).structuredContent;
    expect(r3.accepted).toBe(true);
    const transcript = (await t.db.query<Any>(`select transcript from episodes where id = $1`, [id])).rows[0].transcript;
    expect(transcript[0]).toMatchObject({ dialogue: "You never asked about the wind.", action: "", emotion: ONE_LINE_DEFAULTS.emotion, interest: ONE_LINE_DEFAULTS.interest_signal });
    expect(transcript[1]).toMatchObject({ dialogue: "I was saving it for the second act.", emotion: "warm" });
    expect(transcript[2]).toMatchObject({ emotion: "curious", interest: 0.6 });
  });

  it("oneLineTurn: strings and {line} become turns; JSON text and full objects pass through", () => {
    expect(oneLineTurn("Hi there.")).toEqual({ dialogue: "Hi there.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn('"Quoted line."')).toEqual({ dialogue: "Quoted line.", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn({ line: "Go?", move: "the pier" })).toEqual({ dialogue: "Go?", move: "the pier", ...ONE_LINE_DEFAULTS });
    expect(oneLineTurn(TURN_EXAMPLE)).toBe(TURN_EXAMPLE);
    const full = line(1);
    expect(oneLineTurn(full)).toBe(full);
  });

  it("the steps show a compact example of a turn, and the recap step one of the recap JSON, which is accepted", async () => {
    const { A, step, id } = await ownDate();
    expect(step.instructions).toContain(`Example turn: "You never asked about the wind.", or {"dialogue": "You never asked about the wind."}, or the full`);
    expect(step.instructions).toContain(TURN_EXAMPLE);
    let s = (await call("submit_own_date_step", { episode_id: id, output: "First line, honestly." }, A.ctx)).structuredContent.step;
    expect(s.instructions).toMatch(/or just the line, as "output"/);
    let i = 0;
    while (s.stage === "turn") s = (await call("submit_own_date_step", { episode_id: id, output: `Line number ${i++}, about the tide tables and the ferry.` }, A.ctx)).structuredContent.step;
    expect(s.stage).toBe("recap");
    expect(s.instructions).toContain(`Example recap (exactly these keys: two goals, three scenes, two confessionals): ${RECAP_EXAMPLE}`);
    const done = (await call("submit_own_date_step", { episode_id: id, output: JSON.parse(RECAP_EXAMPLE) }, A.ctx)).structuredContent;
    expect(done.step.stage).toBe("done");
  });

  it("the schema says output takes a plain string", () => {
    const schema = (MCP_TOOLS.find((x) => x.name === "submit_own_date_step")!.inputSchema as Any).properties.output;
    expect(schema.type).toEqual(["object", "string"]);
    expect(schema.description).toMatch(/Or just the line: a plain string, or \{line\}, fills action "", emotion warm, interest_signal 0\.5/);
  });
});

describe("9. enums are visible in every tool list", () => {
  /** The listed enum for `tool.arg`: on the property, an anyOf branch or the array's items. */
  const listedEnum = (tools: Any[], key: string) => {
    const [tool, arg] = key.split(".");
    const p = tools.find((x) => x.name === tool)?.inputSchema?.properties?.[arg];
    if (!p) return undefined;
    return p.enum ?? p.items?.enum ?? p.anyOf?.flatMap((b: Any) => b.enum ?? []);
  };
  const coreKeys = Object.keys(ENUM_SOURCES).filter((k) => CORE_MCP_TOOLS.some((x) => x.name === k.split(".")[0]));

  it("the core tools/list (the default) keeps every enum array, sliding_doors.change and predict.pick included", async () => {
    expect(coreKeys).toEqual(expect.arrayContaining(["sliding_doors.change", "predict.pick", "create_character.partner_style"]));
    const core = (await rpc("tools/list", {}, {})).result.tools;
    for (const key of coreKeys) expect([key, listedEnum(core, key)]).toEqual([key, [...ENUM_SOURCES[key]]]);
    // Over plain HTTP too (GET ?tools=core, what directories read).
    const http = (await (await mcpGet(new Request(`${BASE_URL}/api/mcp?tools=core`))).json()).tools;
    for (const key of coreKeys) expect([key, listedEnum(http, key)]).toEqual([key, [...ENUM_SOURCES[key]]]);
  });

  it("the lean list carries them as arrays (enums), not only as a|b|c text", async () => {
    const lean = (await rpc("tools/list", { lean: true }, {})).result.tools as Any[];
    expect(lean.find((x) => x.name === "sliding_doors").enums.change).toEqual(["bolder", "safer", "bigger_budget", "long_game"]);
    expect(lean.find((x) => x.name === "predict").enums).toMatchObject({ pick: ["second_date", "friends", "disaster"], drama_pick: ["a", "b", "neither"] });
    for (const key of coreKeys) {
      const [tool, arg] = key.split(".");
      expect([key, lean.find((x) => x.name === tool).enums?.[arg]]).toEqual([key, [...new Set(ENUM_SOURCES[key])]]);
    }
    expect(argEnums({ properties: { pick: { anyOf: [{ type: "integer", enum: [1, 2] }, { type: "string" }] } } })).toEqual({ pick: [1, 2] });
  });
});
