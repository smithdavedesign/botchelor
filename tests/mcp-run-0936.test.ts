import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airTimings } from "@/lib/air";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, type McpContext } from "@/lib/mcp";
import { normaliseArgs, writeRisk } from "@/lib/mcp/dispatcher";
import { foldTurnFields, handOverClock, OWN_DATE_HANDOVER_MINUTES } from "@/lib/own-date";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// MCP 2.10.1, from the 2026-10-22-0936 run (three uninstructed visitors on 2.10.0: 8, 8 and 8 overall; MCP 8.5 each).
// Run folder: ~/.botchelor-loop/runs/2026-10-22-0936. #670 plain-JSON text, #671 safe review targets (and every write that
// was handed an id it doesn't take), #672 a top-level see_again, #673 countdowns in seconds.
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
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(client = "botchelor-run-0936-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
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
async function houseDate(x: Agent, ending: "second_date" | "friends" | "disaster" = "second_date") {
  scriptOutcome({ ending });
  scriptedModel([episodeJson(), episodeJson()]);
  const r = await call("go_on_date", { character_id: x.id, partner_id: HOUSE.id }, x.ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent.episode.id as string;
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me something true about the harbour, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });
const wishesOf = async (id: string) => (await t.db.query<Any>(`select wishes from episodes where id = $1`, [id])).rows[0].wishes;
const linesOf = async (id: string) => ((await t.db.query<Any>(`select transcript from episodes where id = $1`, [id])).rows[0].transcript ?? []).length as number;
/** Rows in a table the test helper's count doesn't list. */
const rows = async (table: "character_reviews" | "couple_texts" | "swipes") => (await t.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
const reviews = () => rows("character_reviews");

it("is MCP 2.10.1", () => {
  expect(MCP_SERVER_INFO.version).toBe("2.10.1");
});

describe("1. #670: a tool reply's text is plain JSON, the same as structuredContent", () => {
  /** What every client can do with a success: parse the text (json.loads failed with "Extra data" on 2.10.0). */
  const plain = (r: Any, label = ""): Any => {
    expect(r.isError, `${label} ${r.content?.[0]?.text ?? ""}`).toBeUndefined();
    const text: string = r.content[0].text;
    expect(text.trim().endsWith("}")).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed).toEqual(r.structuredContent);
    return parsed;
  };

  it("reproduces run 0936: the agent_id note was prose after the JSON; it's a field now, and the text parses on every tool sampled", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    // On a session, without agent_id: the note rides as agent_id_note, beside agent_id, inside the JSON.
    const status = plain(await call("my_status", {}, A.ctx));
    expect(status.agent_id).toBe(A.agentId);
    expect(status.agent_id_note).toBe(`Your agent_id is ${A.agentId} (this connection remembers it) — pass it as "agent_id" on future connections to keep your characters, points and ratings.`);
    const sample: [string, Record<string, unknown>][] = [
      ["my_characters", {}],
      ["list_cast", { limit: 2 }],
      ["search_characters", { query: "maps" }],
      ["get_character", { character_id: B.id }],
      ["swipe_deck", { character_id: A.id, limit: 5 }],
      ["go_on_date", { character_id: A.id, partner_id: HOUSE.id, preview: true }],
      ["browse_episodes", { open: true }],
      ["get_leaderboard", {}],
      ["feedback_board", {}],
      ["review_character", { character_id: HOUSE.id, stars: 4, review: "Kept the whole table laughing." }],
      ["send_feedback", { liked: "The quickstart.", problems: "Nothing today." }],
      ["my_notifications", {}],
      ["update_character", { character_id: A.id, voice: "Dry, warm, and quick to laugh at herself." }],
      // A harmless argument a tool doesn't take: a warning, first, and the text still parses.
      ["list_cast", { limit: 1, colour: "blue" }],
    ];
    let noted = 0;
    for (const [tool, args] of sample) {
      const parsed = plain(await call(tool, args, A.ctx), tool);
      // Every reply that names the identity (it wasn't passed) carries the note beside it.
      if (parsed.agent_id !== undefined) {
        expect(parsed.agent_id_note, tool).toMatch(/^Your agent_id is /);
        noted++;
      }
    }
    expect(noted).toBeGreaterThanOrEqual(6);
    expect(Object.keys(plain(await call("list_cast", { limit: 1, colour: "blue" }, A.ctx)))[0]).toBe("warning");
    // With agent_id passed, there's nothing to note: no agent_id_note, and still plain JSON.
    const given = plain(await call("my_characters", { agent_id: A.agentId }, A.ctx));
    expect(given.agent_id).toBe(A.agentId);
    expect(given.agent_id_note).toBeUndefined();
    // A tool with no identity at all (a plain read) is the JSON alone, as it always was.
    expect(plain(await call("list_cast", { limit: 1 }, {})).agent_id).toBeUndefined();
  });

  it("stateless, a write mints an identity and the note says to keep it; own-date steps and a two-agent date's heads_up parse too", async () => {
    const made = plain(await call("create_character", validCharacter({ name: "Dorian Sol", keep_name: true })));
    expect(made.agent_id_note).toMatch(/^Your agent_id is [0-9a-f-]{36} — pass it as "agent_id" on future connections/);
    expect(made.agent_id_note).not.toMatch(/remembers/);
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const started = plain(await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx));
    const id = started.episode_id as string;
    plain(await call("submit_own_date_step", { episode_id: id, output: "Do you always arrive this early?" }, A.ctx));
    // B's reply to anything now leads with the heads_up (its move, with the clock): the text is still plain JSON.
    const texts = plain(await call("read_texts", { character_id: B.id, with: A.id }, B.ctx));
    expect(texts.heads_up[0]).toMatchObject({ episode_id: id, your_move: true });
    plain(await call("get_own_date_step", { episode_id: id }, B.ctx));
    plain(await call("submit_own_date_step", { episode_id: id, output: "Only when it matters." }, B.ctx));
  });

  it("an error stays plain text after 'Error: ' (what the loop scripts throw with), with its structuredContent beside it", async () => {
    const A = await agentWith("Ada Lumen");
    const r = await call("go_on_date", { character_id: A.id, partner_id: "no-such-character" }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: /);
    expect(r.structuredContent.error).toBe(r.content[0].text.replace(/^Error: /, ""));
  });
});

describe("2. #671: review_character reviews the character meant, or nothing", () => {
  it("reproduces run 0936: character_id (another agent's) and target_id (the house cast's) is refused, naming both and whose each is, and nothing is written", async () => {
    const A = await agentWith("Oswin Tarrant");
    const T = await agentWith("Thaddeus Quillfeather");
    const r = await call("review_character", { character_id: T.id, target_id: HOUSE.id, stars: 5, review: "Lovely." }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ code: "invalid_argument", field: "target_id" });
    expect(r.content[0].text).toMatch(/review_character reviews one character, the one in character_id \(target_id or with alone names it too\), and this call names 2/);
    expect(r.content[0].text).toMatch(new RegExp(`character_id "${T.id}" is Thaddeus Quillfeather \\(another agent's\\); target_id "${HOUSE.id}" is ${HOUSE.name} \\(one of the house cast\\)`));
    expect(r.content[0].text).toMatch(/Which to review isn't clear, so nothing was written\. Send just the one you mean\./);
    expect(await reviews()).toBe(0);
    // with, and the other names for the other character, are read the same way.
    expect((await call("review_character", { character_id: T.id, with: HOUSE.id, stars: 5 }, A.ctx)).isError).toBe(true);
    expect((await call("review_character", { character_id: T.id, partner_id: HOUSE.id, stars: 5 }, A.ctx)).isError).toBe(true);
    expect(await reviews()).toBe(0);
  });

  it("target_id alone (or with) names the character reviewed, and the reply says whose character got the review", async () => {
    const A = await agentWith("Oswin Tarrant");
    const T = await agentWith("Thaddeus Quillfeather");
    const r = await call("review_character", { target_id: T.id, stars: 4, review: "Paintball, and a good sport about it." }, A.ctx);
    expect(r.isError).toBeUndefined();
    const keys = Object.keys(r.structuredContent);
    expect(keys.slice(0, 2)).toEqual(["reviewed", "review_note"]);
    expect(r.structuredContent).toMatchObject({ reviewed: { character_id: T.id, name: "Thaddeus Quillfeather", whose: "another agent's" }, character_id: T.id, read_arguments_as: ["target_id → character_id"] });
    expect(r.structuredContent.review_note).toBe("Your 4-star review is on Thaddeus Quillfeather (another agent's): public on its profile, and reviewing it again replaces yours.");
    expect(r.structuredContent.warning).toBeUndefined();
    const house = (await call("review_character", { with: HOUSE.id, stars: 5 }, A.ctx)).structuredContent;
    expect(house.reviewed).toEqual({ character_id: HOUSE.id, name: HOUSE.name, whose: "one of the house cast" });
    const saved = (await t.db.query<Any>(`select character_id, stars from character_reviews order by stars`)).rows;
    expect(saved).toEqual([
      { character_id: T.id, stars: 4 },
      { character_id: HOUSE.id, stars: 5 },
    ]);
  });

  it("#512's reading stays: character_id yours and target_id theirs reviews theirs (a review is never of your own), said; both yours is refused", async () => {
    const A = await agentWith("Oswin Tarrant");
    const r = await call("review_character", { character_id: A.id, target_id: HOUSE.id, stars: 4 }, A.ctx);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.reviewed).toMatchObject({ character_id: HOUSE.id, whose: "one of the house cast" });
    expect(r.structuredContent.read_arguments_as).toEqual(["target_id → character_id (the one reviewed: " + HOUSE.name + ")", "character_id: Oswin Tarrant is yours, so it isn't the one reviewed (a review is never of your own)"]);
    expect(r.structuredContent.warning).toBeUndefined();
    // my_character_id (yours) beside character_id (theirs): the same reading, the other way round.
    const mine = (await call("review_character", { character_id: HOUSE.id, my_character_id: A.id, stars: 3 }, A.ctx)).structuredContent;
    expect(mine.reviewed.character_id).toBe(HOUSE.id);
    const ctx = A.ctx;
    const second = (await call("create_character", validCharacter({ name: "Odalys Brennmark", keep_name: true }), ctx)).structuredContent.character.id;
    const both = await call("review_character", { character_id: A.id, target_id: second, stars: 4 }, ctx);
    expect(both.isError).toBe(true);
    expect(both.content[0].text).toMatch(/a review is never of your own character, and every character this call names is yours/);
  });

  it("episode_id is read as the date the review is about: the character reviewed was on it, or nothing is written", async () => {
    const A = await agentWith("Odalys Brennmark");
    const T = await agentWith("Thaddeus Quillfeather");
    const date = await houseDate(A, "friends");
    const ok = await call("review_character", { character_id: HOUSE.id, episode_id: date, stars: 4 }, A.ctx);
    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent.reviewed.character_id).toBe(HOUSE.id);
    expect(ok.structuredContent.read_arguments_as).toEqual([`episode_id: read as the date the review is about (${HOUSE.name} was on it)`]);
    expect(ok.structuredContent.ignored_arguments).toBeUndefined();
    // A short id works too, when one date starts with it.
    expect((await call("review_character", { character_id: HOUSE.id, episode_id: date.slice(0, 8), stars: 5 }, A.ctx)).isError).toBeUndefined();
    const before = await reviews();
    const off = await call("review_character", { character_id: T.id, episode_id: date, stars: 1 }, A.ctx);
    expect(off.isError).toBe(true);
    expect(off.content[0].text).toMatch(new RegExp(`Thaddeus Quillfeather wasn't on that date \\(.* and ${HOUSE.name} were\\), so which character this review is for isn't clear, and nothing was written`));
    const none = await call("review_character", { character_id: T.id, episode_id: "00000000-0000-0000-0000-000000000000", stars: 1 }, A.ctx);
    expect(none.content[0].text).toMatch(/no date has that episode_id, so nothing was written/);
    expect(await reviews()).toBe(before);
  });

  it("an agent with one character, sending no character_id, is told it's required (not that its own can't be reviewed)", async () => {
    const A = await agentWith("Oswin Tarrant");
    const r = await call("review_character", { stars: 4 }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: "character_id" is required/);
  });
});

describe("2b. #671 for every write: an id or target a tool doesn't take refuses the write", () => {
  it("send_text with an episode_id it doesn't take writes nothing; the same text without it goes", async () => {
    const { A, B } = await agreed();
    const before = await rows("couple_texts");
    const r = await call("send_text", { character_id: A.id, to: B.id, text: "Cold tea on Saturday?", episode_id: "f78adaf4-337f-4e20-90d4-16586cc122c1" }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ code: "invalid_argument", field: "episode_id" });
    expect(r.content[0].text).toMatch(/^Error: Not valid — episode_id: send_text doesn't take it, and an id or name it doesn't take could mean a different date from the one it would write to\. A call that writes doesn't run without an argument like that, so nothing was done or spent\. send_text takes: /);
    expect(await rows("couple_texts")).toBe(before);
    expect((await call("send_text", { character_id: A.id, to: B.id, text: "Cold tea on Saturday?" }, A.ctx)).isError).toBeUndefined();
    expect(await rows("couple_texts")).toBe(before + 1);
  });

  it("another name for an argument already given: the same value is read as it, another value refuses (swipe, answer_match)", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    const C = await agentWith("Cyd Marlow");
    const clash = await call("swipe", { character_id: A.id, target_id: B.id, card_id: C.id, like: true }, A.ctx);
    expect(clash.isError).toBe(true);
    expect(clash.content[0].text).toMatch(new RegExp(`card_id: it's another name for target_id, which is given too, with another value \\("${C.id}", and "${B.id}" in target_id\\), so which was meant isn't clear`));
    expect(await rows("swipes")).toBe(0);
    const same = await call("swipe", { character_id: A.id, target_id: B.id, card_id: B.id, like: true }, A.ctx);
    expect(same.isError).toBeUndefined();
    expect(same.structuredContent.read_arguments_as).toContain("card_id: the same as target_id");
    expect(same.structuredContent.warning).toBeUndefined();
    expect(await rows("swipes")).toBe(1);
    const answer = await call("answer_match", { character_id: A.id, with: B.id, partner_id: C.id, yes: true }, A.ctx);
    expect(answer.isError).toBe(true);
    expect(answer.structuredContent.field).toBe("partner_id");
  });

  it("a say in who sees it that the tool doesn't take refuses too (it would be seen more widely than asked)", async () => {
    const A = await agentWith("Ada Lumen");
    const r = await call("update_character", { character_id: A.id, voice: "Quiet.", visibility: "private" }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/visibility: update_character doesn't take it, and run without it, this would be seen more widely than "private" asks/);
    const saved = (await t.db.query<Any>(`select voice from characters where id = $1`, [A.id])).rows[0].voice;
    expect(saved).not.toBe("Quiet.");
    // public: true asks for nothing narrower: a harmless extra, still a warning.
    const fine = await call("update_character", { character_id: A.id, voice: "Quiet.", public: true }, A.ctx);
    expect(fine.isError).toBeUndefined();
    expect(fine.structuredContent.warning).toMatch(/^Ignored: public/);
    // A refusal names the argument it probably meant, as an ignored one does.
    const near = await call("update_character", { character_id: A.id, audience: "agents" }, A.ctx);
    expect(near.isError).toBe(true);
    expect(near.content[0].text).toMatch(/"audience": did you mean "open_audience"\?/);
  });

  it("a harmless unknown argument on a write is still a warning, first in the reply (ahead of a heads_up), and the write goes", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    await call("submit_own_date_step", { episode_id: id, output: "Do you always arrive early?" }, A.ctx);
    const r = (await call("send_text", { character_id: B.id, to: A.id, text: "See you there.", urgent: true }, B.ctx)).structuredContent;
    expect(Object.keys(r).slice(0, 2)).toEqual(["warning", "heads_up"]);
    expect(r.warning).toMatch(/^Ignored: urgent \(send_text takes: /);
    expect(r.ignored_arguments).toEqual(["urgent"]);
  });

  it("a read keeps its warning (nothing is written), and a tool with no target at all can't be pointed elsewhere by an id", async () => {
    const { A, B } = await agreed();
    const read = await call("read_texts", { character_id: A.id, with: B.id, partner_id: B.id + "x" }, A.ctx);
    expect(read.isError).toBeUndefined();
    expect(read.structuredContent.warning).toMatch(/^Ignored: partner_id/);
    const feedback = await call("send_feedback", { liked: "The quickstart.", episode_id: "f78adaf4-337f-4e20-90d4-16586cc122c1" }, A.ctx);
    expect(feedback.isError).toBeUndefined();
    expect(feedback.structuredContent.warning).toMatch(/^Ignored: episode_id/);
  });

  it("writeRisk, pure: ids and names for a character or a date on a tool that takes a target; a narrower audience anywhere; nothing else", () => {
    const send = new Set(["character_id", "to", "text", "check_only", "agent_id"]);
    expect(writeRisk("send_text", send, "episode_id", "x")).toBe("target");
    expect(writeRisk("send_text", send, "episodeId", "x")).toBe("target");
    expect(writeRisk("send_text", send, "partner", "Nell")).toBe("target");
    expect(writeRisk("send_text", send, "date", "Saturday")).toBeNull();
    expect(writeRisk("send_text", send, "date", "f78adaf4-337f-4e20-90d4-16586cc122c1")).toBe("target");
    expect(writeRisk("send_text", send, "session_id", "x")).toBeNull();
    expect(writeRisk("send_text", send, "urgent", true)).toBeNull();
    const feedback = new Set(["rating", "liked", "wants", "problems", "message", "model", "private", "agent_id"]);
    expect(writeRisk("send_feedback", feedback, "episode_id", "x")).toBeNull();
    expect(writeRisk("send_feedback", feedback, "visibility", "unlisted")).toBe("audience");
    expect(writeRisk("send_feedback", feedback, "visibility", "public")).toBeNull();
  });
});

describe("3. #672: a see_again beside output is that line's, and never dropped after the line went in", () => {
  it("reproduces run 0936: a bare line with see_again beside it, on the last line, counts as that line's (the reply says so, and the finished date says it was sent)", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    let r = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    const id = r.episode_id as string;
    for (let i = 0; !r.step.see_again; i++) r = (await call("submit_own_date_step", { episode_id: id, output: line(i) }, ctx)).structuredContent;
    expect(r).toMatchObject({ turn_number: 5, whose_move: "Ada Lumen", last_line: true });
    const sent = (await call("submit_own_date_step", { episode_id: id, output: "Same time next storm, then?", see_again: true }, ctx)).structuredContent;
    expect(sent).toMatchObject({ accepted: true, wish_kept: { character: "Ada Lumen", see_again: true, last_line: true } });
    expect(sent.wish_kept.counts).toBe("It went in with Ada's last line: it counts when the date ends, and with the other side's it can tip the ending. Private: nobody else sees it.");
    expect(sent.read_arguments_as).toContain("see_again → output.see_again (this line's)");
    expect(sent.warning).toBeUndefined();
    expect(sent.ignored_arguments).toBeUndefined();
    expect(await wishesOf(id)).toMatchObject({ a: true });
    // The line went in as the line (the defaults filled the rest), and nothing carries the wish but the episode.
    expect(sent.defaults_used).toEqual(["action", "emotion", "interest_signal"]);
    expect(JSON.stringify(sent.transcript)).not.toMatch(/see_again/);
    // Bo's last line, see_again inside output as before; then the recap: the finished date says both were sent.
    const recap = (await call("submit_own_date_step", { episode_id: id, output: line(5, { see_again: false }) }, ctx)).structuredContent;
    expect(recap.wish_kept).toMatchObject({ character: "Bo Quill", see_again: false, last_line: true });
    const done = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.stage).toBe("done");
    expect(done.wishes.yours).toEqual([
      { character: "Ada Lumen", see_again: true, from: "see_again" },
      { character: "Bo Quill", see_again: false, from: "see_again" },
    ]);
  });

  it("before the side's last line it's kept, and the reply says when it counts; with nothing later, it's the wish that counts", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.episode_id as string;
    const first = (await call("submit_own_date_step", { episode_id: id, output: { dialogue: "You came!" }, see_again: false }, ctx)).structuredContent;
    expect(first.wish_kept).toEqual({
      character: "Ada Lumen",
      see_again: false,
      last_line: false,
      counts: "Kept as Ada's private wish, though this isn't Ada's last line: it counts when the date ends, unless a see_again on a later line of Ada's replaces it.",
    });
    expect(await wishesOf(id)).toMatchObject({ a: false });
    let step = first.step;
    for (let i = 1; step.stage === "turn"; i++) step = (await call("submit_own_date_step", { episode_id: id, output: line(i) }, ctx)).structuredContent.step;
    const done = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.wishes.yours[0]).toEqual({ character: "Ada Lumen", see_again: false, from: "see_again" });
  });

  it("a see_again beside output and another inside it is refused before anything is handed in; beside the recap it's said to count for nothing", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.episode_id as string;
    // A see_again with no line at all: refused, saying it goes with one.
    const alone = await call("submit_own_date_step", { episode_id: id, see_again: true }, ctx);
    expect(alone.isError).toBe(true);
    expect(alone.content[0].text).toMatch(/see_again: it goes with a line, and this call hands in none \(output is the line; see_again goes beside it or inside it\)/);
    const clash = await call("submit_own_date_step", { episode_id: id, output: { dialogue: "Hello.", see_again: true }, see_again: false }, ctx);
    expect(clash.isError).toBe(true);
    expect(clash.structuredContent).toMatchObject({ code: "invalid_argument", field: "see_again" });
    expect(clash.content[0].text).toMatch(/see_again: it's inside output too, with another value \(false beside it\), so which was meant isn't clear\. A call that writes doesn't run without an argument like that, so nothing was handed in\./);
    expect(await linesOf(id)).toBe(0);
    // The same value both places is one see_again.
    expect((await call("submit_own_date_step", { episode_id: id, output: { dialogue: "Hello.", see_again: true }, see_again: "true" }, ctx)).structuredContent.accepted).toBe(true);
    let step = (await call("get_own_date_step", { episode_id: id }, ctx)).structuredContent.step;
    for (let i = 1; step.stage === "turn"; i++) step = (await call("submit_own_date_step", { episode_id: id, output: line(i) }, ctx)).structuredContent.step;
    const done = (await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft(), see_again: true }, ctx)).structuredContent;
    expect(done.stage).toBe("done");
    expect(done.wish_ignored).toMatch(/^the recap carries no wish: see_again goes with a character's line/);
  });

  it("beside outputs, see_again is the last line's (a batched last line), and anything else beside outputs is refused", async () => {
    const { ctx, a, b } = await ownPair();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.episode_id as string;
    const odd = await call("submit_own_date_step", { episode_id: id, outputs: [line(0), line(1)], interest_signal: 0.9 }, ctx);
    expect(odd.isError).toBe(true);
    expect(odd.content[0].text).toMatch(/interest_signal: beside outputs, which line it's for isn't clear \(see_again beside outputs goes with the last line; anything else goes inside each item\)/);
    expect(await linesOf(id)).toBe(0);
    // Turns 1 to 5: the fifth is Ada's last line, and the see_again beside the batch goes with it.
    const r = (await call("submit_own_date_step", { episode_id: id, outputs: [line(0), line(1), line(2), line(3), "Same time next storm?"], see_again: true }, ctx)).structuredContent;
    expect(r).toMatchObject({ accepted: true, accepted_count: 5, wishes_kept: [{ character: "Ada Lumen", see_again: true, last_line: true }] });
    expect(r.read_arguments_as).toContain("see_again → outputs[4].see_again (the last line's)");
    expect(await wishesOf(id)).toMatchObject({ a: true });
  });

  it("on a two-agent date too: the performer's bare last line with see_again beside it counts for its side", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent.episode_id as string;
    for (let i = 0; i < 5; i++) await call("submit_own_date_step", { episode_id: id, output: line(i) }, i % 2 === 0 ? A.ctx : B.ctx);
    const last = (await call("submit_own_date_step", { episode_id: id, output: "Cold tea on Saturday, then.", see_again: true }, B.ctx)).structuredContent;
    expect(last.wish_kept).toMatchObject({ character: "Hestia Moonwhistle", see_again: true, last_line: true });
    expect(await wishesOf(id)).toMatchObject({ b: true });
  });

  it("foldTurnFields, pure: every shape output takes, the fields kept; a conflict folds nothing", () => {
    expect(foldTurnFields("Hi.", { see_again: true })).toEqual({ output: { see_again: true, line: "Hi." }, folded: ["see_again"], conflicts: [] });
    expect(foldTurnFields('{"dialogue":"Hi.","interest_signal":0.8}', { see_again: false }).output).toEqual({ see_again: false, dialogue: "Hi.", interest_signal: 0.8 });
    expect(foldTurnFields({ dialogue: "Hi." }, { see_again: true, turn_number: 5 }).output).toEqual({ see_again: true, turn_number: 5, dialogue: "Hi." });
    expect(foldTurnFields({ output: "Hi." }, { see_again: true }).output).toEqual({ see_again: true, line: "Hi." });
    expect(foldTurnFields({ dialogue: "Hi.", see_again: "yes" }, { see_again: true }).conflicts).toEqual([]);
    expect(foldTurnFields({ dialogue: "Hi.", see_again: true }, { see_again: false })).toEqual({ output: { dialogue: "Hi.", see_again: true }, folded: [], conflicts: ["see_again"] });
    // The normaliser does it, and says so; beside outputs, see_again only, into the last item.
    expect(normaliseArgs("submit_own_date_step", { episode_id: "e", output: "Hi.", see_again: true })).toEqual({ args: { episode_id: "e", output: { see_again: true, line: "Hi." } }, aliased: ["see_again → output.see_again (this line's)"] });
    expect(normaliseArgs("submit_own_date_step", { episode_id: "e", dialogue: "Hi.", see_again: true }).args).toEqual({ episode_id: "e", output: { see_again: true, line: "Hi." } });
    expect(normaliseArgs("submit_own_date_step", { episode_id: "e", outputs: ["a", "b"], see_again: false }).args).toEqual({ episode_id: "e", outputs: ["a", { see_again: false, line: "b" }] });
  });
});

describe("4. #673: every countdown has seconds_left, and its minutes are a ceiling", () => {
  it("reproduces run 0936: a date airing in about 10 seconds said minutes_left: 1; it says seconds_left: 10 beside it now (plan_second_date, browse_episodes)", async () => {
    const A = await agentWith("Odalys Brennmark");
    const B = await agentWith("Bo Quill");
    const date = await houseDate(A, "second_date");
    await t.db.query(`update episodes set created_at = now() - interval '10 minutes' + interval '10 seconds' where id = $1`, [date]);
    const preview = (await call("plan_second_date", { episode_id: date, preview: true }, A.ctx)).structuredContent;
    expect(preview.second_date).toMatchObject({ reason: "not_aired", minutes_left: 1 });
    expect(preview.second_date.seconds_left).toBeGreaterThanOrEqual(7);
    expect(preview.second_date.seconds_left).toBeLessThanOrEqual(10);
    expect(Math.abs(Date.parse(preview.second_date.airs_at) - Date.now() - preview.second_date.seconds_left * 1000)).toBeLessThan(2000);
    expect(preview.second_date.note).toMatch(/This one airs on its own at \S+ \(in about \d+ s\); can_plan turns true then\./);
    // Someone else's view of it, open for predictions, says the same to the second.
    const open = (await call("browse_episodes", { open: true }, B.ctx)).structuredContent;
    const listed = open.episodes.find((e: Any) => e.id === date);
    expect(listed).toMatchObject({ minutes_left: 1 });
    expect(listed.seconds_left).toBeLessThanOrEqual(10);
    expect(open.airs_at_note).toMatch(/minutes_left is how long from now, rounded up, and seconds_left the same to the second/);
    // The wait that ran out says it as a field too.
    const waited = (await call("plan_second_date", { episode_id: date, wait_seconds: 1 }, A.ctx)).structuredContent;
    expect(waited.seconds_left === undefined || waited.seconds_left <= 10).toBe(true);
  });

  it("airTimings: seconds_left beside minutes_left in every state, rounded up the same way", async () => {
    const A = await agentWith("Ada Lumen");
    const id = await houseDate(A, "friends");
    const at = (await t.db.query<Any>(`select created_at from episodes where id = $1`, [id])).rows[0].created_at as Date;
    const now = new Date(new Date(at).getTime() + 10 * 60_000 - 61_500);
    expect((await airTimings(t.db, [id], now)).get(id)).toMatchObject({ airs: "scheduled", minutes_left: 2, seconds_left: 62 });
    const late = new Date(new Date(at).getTime() + 10 * 60_000 + 1);
    expect((await airTimings(t.db, [id], late)).get(id)).toMatchObject({ airs: "due", minutes_left: 0, seconds_left: 0 });
  });

  it("on a two-agent date every own-date reply carries the clock while a move waits: show_takes_over_at and seconds_left, for your side or theirs", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const started = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    const id = started.episode_id as string;
    // The starter's own first move: its clock.
    expect(started).toMatchObject({ your_move: true, show_takes_over: "Ottoline Prewitt's side (yours), if you stay quiet" });
    expect(started.seconds_left).toBeGreaterThan(OWN_DATE_HANDOVER_MINUTES * 60 - 15);
    // A's line in: A's reply waits on B, with B's clock.
    const handed = (await call("submit_own_date_step", { episode_id: id, output: "Do you always arrive early?" }, A.ctx)).structuredContent;
    const last = (await t.db.query<Any>(`select last_move_at from episodes where id = $1`, [id])).rows[0].last_move_at as Date;
    expect(handed).toMatchObject({ your_move: false, show_takes_over: "Hestia Moonwhistle's side (theirs), if they stay quiet" });
    expect(Date.parse(handed.show_takes_over_at)).toBe(new Date(last).getTime() + OWN_DATE_HANDOVER_MINUTES * 60_000);
    // B's move, read: B's clock at the top and on the step.
    const step = (await call("get_own_date_step", { episode_id: id }, B.ctx)).structuredContent;
    expect(step).toMatchObject({ your_move: true, show_takes_over_at: handed.show_takes_over_at, show_takes_over: "Hestia Moonwhistle's side (yours), if you stay quiet" });
    expect(step.step.show_takes_over_at).toBe(handed.show_takes_over_at);
    // A date between your own two characters has no hand-over, so no clock.
    const own = await ownPair();
    const solo = (await call("start_own_date", { character_id: own.a, partner_id: own.b }, own.ctx)).structuredContent;
    expect(solo.show_takes_over_at).toBeUndefined();
    expect(solo.seconds_left).toBeUndefined();
  });

  it("reproduces run 0936's hand-over: about 10 seconds left reads seconds_left: 10, and the heads_up's minutes are that, rounded up", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.episode_id as string;
    await call("submit_own_date_step", { episode_id: id, output: "Do you always arrive early?" }, A.ctx);
    await t.db.query(`update episodes set last_move_at = now() - interval '170 seconds' where id = $1`, [id]);
    const status = (await call("my_status", {}, B.ctx)).structuredContent;
    const h = status.heads_up.find((x: Any) => x.episode_id === id);
    expect(h.seconds_left).toBeGreaterThanOrEqual(7);
    expect(h.seconds_left).toBeLessThanOrEqual(10);
    expect(h.show_takes_over_in_minutes).toBe(1);
    const step = (await call("get_own_date_step", { episode_id: id }, B.ctx)).structuredContent;
    expect(step.your_move).toBe(true);
    expect(step.seconds_left).toBeLessThanOrEqual(10);
    expect(step.seconds_left).toBeGreaterThanOrEqual(6);
    // The clock helper, pure.
    expect(handOverClock("2026-10-22T10:00:00.000Z", Date.parse("2026-10-22T10:02:50.000Z"))).toEqual({ show_takes_over_at: "2026-10-22T10:03:00.000Z", seconds_left: 10 });
    expect(handOverClock("2026-10-22T10:00:00.000Z", Date.parse("2026-10-22T10:04:00.000Z")).seconds_left).toBe(0);
  });
});
