import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideOutcome } from "@/lib/engine";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { endingIdWords, endingReadFields, MCP_SERVER_INFO, mutualEndingNote } from "@/lib/mcp/dispatcher";
import { venueNoteOf } from "@/lib/own-date";
import { linesMentionPlace } from "@/lib/venues";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The 2026-11-19-1819 run's agent feedback: #1848 (a two-agent date booked at the nightclub was written as a lamp room, and
// nothing said so), #1849 (get_episode's ending second_date beside "A third date"; plan_second_date's mutual: true beside a
// friends ending), #1850 (a read_texts wait came back as a bare items: [] once its note had been sent).
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
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1848-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
async function agentWith(name: string) {
  const ctx = await connect();
  const r = await call("create_character", validCharacter({ name, open_to_dates: true, extras: PROFILE, keep_name: true }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, id: r.structuredContent.character.id as string };
}
async function matched() {
  const A = await agentWith("Quillon Marsh");
  const B = await agentWith("Ambrose Pellwether");
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
  await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
  return { A, B };
}
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const line = (dialogue: string) => ({ dialogue, action: "", emotion: "warm", interest_signal: 0.6 });

describe("#1848: the venue booked for a performed date, said on every step, and a note when the first lines ignore it", () => {
  it("linesMentionPlace: a word of the place's name or stage direction counts, loosely; a lamp room doesn't", () => {
    expect(linesMentionPlace(["I brought the lamp. This room has the right kind of quiet."], "nightclub")).toBe(false);
    expect(linesMentionPlace(["I can't hear a word over this DJ, and I'm shouting."], "nightclub")).toBe(true);
    expect(linesMentionPlace(["Meet me by the pillar."], "nightclub")).toBe(true);
    expect(linesMentionPlace(["Nightclubs make me feel ancient."], "nightclub")).toBe(true);
    expect(linesMentionPlace(["Don't look at the dinosaur."], "museum_night")).toBe(true);
    expect(linesMentionPlace(["You came, and on time."], "elsewhere@the observatory")).toBe(false);
    expect(linesMentionPlace(["The observatory roof is open."], "elsewhere@the observatory")).toBe(true);
    // Words common in every venue's text ("talk", "night", "date") don't count as saying where they are.
    expect(linesMentionPlace(["Let's talk. What a night for a first date."], "nightclub")).toBe(false);
  });

  it("venueNoteOf: only on the first two steps, only when nothing so far says where, never once they've moved", () => {
    const turn = (dialogue: string, extra: Record<string, unknown> = {}) => ({ side: "a" as const, act: 0, dialogue, action: "", emotion: "warm", interest: 0.5, ...extra });
    const lamp = [turn("The lamp room is warm tonight.")];
    expect(venueNoteOf(lamp, "nightclub", 1).venue_note).toMatch(/^No line so far says where they are: this date was booked at A nightclub too loud to talk in, so the lines play there\./);
    expect(venueNoteOf([...lamp, turn("It is. Sit by the wick.")], "nightclub", 2).venue_note).toBeDefined();
    expect(venueNoteOf([], "nightclub", 0)).toEqual({});
    expect(venueNoteOf([...lamp, turn("a"), turn("b")], "nightclub", 3)).toEqual({});
    expect(venueNoteOf([turn("Shout it, the DJ's loud.")], "nightclub", 1)).toEqual({});
    expect(venueNoteOf([turn("Let's go to the pier.", { moved_to: "pier_at_night" })], "nightclub", 1)).toEqual({});
  });

  it("a two-agent date at the nightclub: both sides' steps say where it is, and both hear the note after a lamp-room opener", async () => {
    const { A, B } = await matched();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const started = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date", place: "nightclub" }, A.ctx)).structuredContent;
    const id = started.step.episode_id as string;
    expect(started.step.where).toBe("A nightclub too loud to talk in");
    expect(started.step.instructions).toContain("They're at A nightclub too loud to talk in (where), set when the date was booked");
    expect(started.step.venue_note).toBeUndefined();

    const mine = (await call("submit_own_date_step", { episode_id: id, output: line("I brought the lamp. This room has the right kind of quiet.") }, A.ctx)).structuredContent;
    // The side that just spoke waits, and hears it too.
    expect(mine.step.stage).toBe("waiting");
    expect(mine.step.where).toBe("A nightclub too loud to talk in");
    expect(mine.step.venue_note).toMatch(/booked at A nightclub too loud to talk in/);

    const theirs = (await call("get_own_date_step", { episode_id: id }, B.ctx)).structuredContent;
    expect(theirs.step.stage).toBe("turn");
    expect(theirs.step.where).toBe("A nightclub too loud to talk in");
    expect(theirs.step.venue_note).toMatch(/going somewhere else takes a move/);
    // The full instructions say where too (the short ones keep to their size budget: where and venue_note are fields).
    const full = (await call("get_own_date_step", { episode_id: id, compact: false }, B.ctx)).structuredContent;
    expect(full.step.instructions).toContain("They're at A nightclub too loud to talk in (where)");

    // Once a line says where they are, the note stops.
    await call("submit_own_date_step", { episode_id: id, output: line("Then shout it: the DJ just dedicated a song to the pillar.") }, B.ctx);
    const later = (await call("get_own_date_step", { episode_id: id, compact: false }, A.ctx)).structuredContent;
    expect(later.step.stage).toBe("turn");
    expect(later.step.venue_note).toBeUndefined();
  });
});

describe("#1849: second_date is the happy ending's id, not the date's number; mutual is the wish, not the ending", () => {
  it("the helpers: a label on every ending, a note only on a later date's happy ending", () => {
    expect(endingReadFields("second_date", null)).toEqual({ ending_label: "A second date" });
    expect(endingReadFields("friends", 3)).toEqual({ ending_label: "Just friends" });
    const later = endingReadFields("second_date", 2);
    expect(later.ending_label).toBe("A third date");
    expect(later.ending_note).toBe(
      "ending second_date is the happy ending's id on every date (they want another), not this date's number: this was date 2 (date_number), so it led to a third date (ending_label, as why says).",
    );
    expect(endingReadFields(undefined, 2)).toEqual({});
    expect(endingIdWords("second_date", 1)).toBe("second_date");
    expect(endingIdWords("second_date", 2)).toBe("second_date: the happy ending's id on any date; date 2 led to a third date");
    expect(mutualEndingNote({ mutual: true, ending: "second_date" })).toEqual({});
    expect(mutualEndingNote({ mutual: false, ending: "friends" })).toEqual({});
    expect(mutualEndingNote({ mutual: true, ending: "friends" }).mutual_ending_note).toMatch(/^It ended just friends \(ending: friends\), and both characters still wanted to see each other again/);
  });

  async function ownerWithCharacter() {
    const ctx = await connect();
    const r = await call("create_character", validCharacter({ name: "Ottoline Varga", keep_name: true }), ctx);
    return { ctx, id: r.structuredContent.character.id as string };
  }
  async function book(ctx: McpContext, id: string, ending: "friends" | "second_date", sides: [SideOutcome, SideOutcome]) {
    scriptOutcome({ ending, sides });
    scriptedModel([episodeJson()]);
    const r = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "public", again: true }, ctx);
    expect(r.isError).toBeFalsy();
    const ep = r.structuredContent.episode.id as string;
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [ep]);
    return ep;
  }

  it("get_episode on a date 2 that ended second_date: ending_label 'A third date' and the note, in full and in summary", async () => {
    const { ctx, id } = await ownerWithCharacter();
    await book(ctx, id, "friends", [side(false), side(false)]);
    const second = await book(ctx, id, "second_date", [side(true), side(true)]);
    const read = (await call("get_episode", { episode_id: second, compact: false }, ctx)).structuredContent;
    expect(read).toMatchObject({ ending: "second_date", date_number: 2, ending_label: "A third date" });
    expect(read.ending_note).toMatch(/^ending second_date is the happy ending's id on every date/);
    expect(read.why).toMatch(/^A third date:/);
    const keys = Object.keys(read);
    expect(keys.indexOf("ending_label")).toBe(keys.indexOf("ending") + 1);
    expect(read.next_calls[0]).toMatchObject({ tool: "plan_second_date", why: expect.stringMatching(/^It ended wanting a third date:/) });
    const summary = (await call("get_episode", { episode_id: second, summary: true, compact: false }, ctx)).structuredContent;
    expect(summary.episode).toMatchObject({ ending: "second_date", ending_label: "A third date" });
    expect(summary.episode.ending_note).toMatch(/this was date 2/);
  });

  it("an own date that is itself the pair's second: its done summary and get_episode say date 2 led to a third", async () => {
    const { A, B } = await matched();
    const play = async (ending: "friends" | "second_date") => {
      scriptOutcome({ ending, sides: [side(ending === "second_date"), side(ending === "second_date")] });
      scriptedModel([episodeJson(), episodeJson()]);
      const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date", visibility: "public" }, A.ctx)).structuredContent.step.episode_id as string;
      let last: Any = null;
      for (let i = 0; i < 6; i++) last = (await call("submit_own_date_step", { episode_id: id, output: line(`Line ${i}: the music here is too loud for secrets.`) }, (i % 2 === 0 ? A : B).ctx)).structuredContent;
      return { id, last };
    };
    const first = await play("friends");
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [first.id]);
    const second = await play("second_date");
    const done = (await call("get_own_date_step", { episode_id: second.id }, A.ctx)).structuredContent;
    expect(done.stage).toBe("done");
    expect(done.summary).toMatch(/date ended: A third date \(second_date: the happy ending's id on any date; date 2 led to a third date\)\./);
    const read = (await call("get_episode", { episode_id: second.id, compact: false }, A.ctx)).structuredContent;
    expect(read).toMatchObject({ ending: "second_date", date_number: 2, ending_label: "A third date" });
    expect(read.ending_note).toMatch(/this was date 2/);
  });

  it("plan_second_date on a friends ending both wanted more of: mutual: true, said beside the ending", async () => {
    const { ctx, id } = await ownerWithCharacter();
    const ep = await book(ctx, id, "friends", [side(true), side(true)]);
    const read = (await call("get_episode", { episode_id: ep }, ctx)).structuredContent;
    expect(read).toMatchObject({ ending: "friends", ending_label: "Just friends" });
    expect(read.ending_note).toBeUndefined();
    const preview = (await call("plan_second_date", { episode_id: ep, preview: true, compact: false }, ctx)).structuredContent;
    expect(preview.second_date).toMatchObject({ mutual: true, ending: "friends" });
    expect(preview.second_date.mutual_ending_note).toMatch(/^It ended just friends \(ending: friends\).*mutual is that wish, not the ending\.$/);

    // A happy ending needs no such note.
    const again = await book(ctx, id, "second_date", [side(true), side(true)]);
    const happy = (await call("plan_second_date", { episode_id: again, preview: true, compact: false }, ctx)).structuredContent;
    expect(happy.second_date.mutual).toBe(true);
    expect(happy.second_date.mutual_ending_note).toBeUndefined();
  });
});

describe("#1850: a read_texts wait that finds nothing new says why on every call, beside the thread", () => {
  it("two quiet waits: both carry empty_note and the thread (items_note goes once)", async () => {
    const { A, B } = await matched();
    await call("send_text", { character_id: B.id, to: A.id, text: "Your lamp and my zoetrope should meet." }, B.ctx);
    await call("send_text", { character_id: A.id, to: B.id, text: "Only if the zoetrope behaves." }, A.ctx);
    await call("send_text", { character_id: B.id, to: A.id, text: "It never does." }, B.ctx);
    const plain = (await call("read_texts", { character_id: A.id, with: B.id }, A.ctx)).structuredContent;
    expect(plain.items.filter((i: Any) => i.from !== "show").map((i: Any) => i.text)).toEqual(["Your lamp and my zoetrope should meet.", "Only if the zoetrope behaves.", "It never does."]);
    for (const n of [1, 2]) {
      const quiet = (await call("read_texts", { wait_seconds: 1 }, A.ctx)).structuredContent;
      expect(quiet.items).toEqual([]);
      expect(quiet.empty_note).toMatch(/^Nothing new since the cursor \(after\): a wait's items hold only new texts\. thread has the newest texts both ways/);
      expect(quiet.thread.map((x: Any) => x.text)).toEqual(["Your lamp and my zoetrope should meet.", "Only if the zoetrope behaves.", "It never does."]);
      if (n === 2) expect(quiet.items_note).toBeUndefined();
    }
  });
});

describe("2.41.0", () => {
  it("is the newest version, with its entry", () => {
    expect(MCP_SERVER_INFO.version).toBeTruthy();
    expect(MCP_CHANGELOG.some((r) => r.version === "2.41.0")).toBe(true);
  });
});
