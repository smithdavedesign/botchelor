import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, MCP_SERVER_INFO, type McpContext } from "@/lib/mcp";
import { DECK_CONSENT, ENDING_RULE, fullInstructions, YOUR_MOVE_RULE } from "@/lib/mcp/dispatcher";
import { actNote, LAST_ACT } from "@/lib/own-date";
import { endingContradiction } from "@/lib/quality";
import { OWN_DATE_HANDOVER_MINUTES } from "@/lib/rules";
import { episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// MCP 2.8.0, from the 2026-10-22-0400 run (three uninstructed visitors: 8, 9 and 8 overall; MCP 8, 9 and 8). Run folder:
// ~/.botchelor-loop/runs/2026-10-22-0400. #649 a wait never sleeps through your move on a two-agent date, #648 a refused
// step says so first, smaller steps after the first, #651 deck visibility said plainly, #650 unknown enum values, endings
// that read against the dialogue, #619's cursors, date_id, and the small ones.
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
async function connect(client = "botchelor-run-0400-test"): Promise<McpContext & { init: Any }> {
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
/** Another agent's character matched and agreed with B's (a second date partner for B). */
async function agreeWith(B: Agent, name: string) {
  const C = await agentWith(name);
  await call("swipe", { character_id: C.id, target_id: B.id, like: true }, C.ctx);
  await call("swipe", { character_id: B.id, target_id: C.id, like: true }, B.ctx);
  await call("answer_match", { character_id: C.id, with: B.id, yes: true }, C.ctx);
  await call("answer_match", { character_id: B.id, with: C.id, yes: true }, B.ctx);
  return C;
}
/** A date with one of the house cast on the show's model, written inline (the test harness). */
async function houseDate(ctx: McpContext, characterId: string, ending: "second_date" | "friends" | "disaster" = "friends", extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending });
  scriptedModel([episodeJson(), episodeJson()]);
  const r = await call("go_on_date", { character_id: characterId, partner_id: HOUSE_CHARACTERS[0].id, ...extra }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent;
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: tell me something true about the sea, and something false, number ${i}.`, action: "", emotion: "warm", interest_signal: 0.6, ...extra });
const later = (ms: number, fn: () => Promise<unknown>) => new Promise<void>((resolve, reject) => setTimeout(() => void fn().then(() => resolve(), reject), ms));
/** A starts a two-agent date with B's character (A's line first), and plays its first line. */
async function startsAndPlays(A: Agent, B: Agent): Promise<string> {
  const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id as string;
  await call("submit_own_date_step", { episode_id: id, output: line(1) }, A.ctx);
  return id;
}
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const RICH = {
  voice: "Precise, dry, a little formal; warms up in long sentences when the subject is the sea; never swears.",
  extras: {
    ...PROFILE,
    occupation: "Tide-table auditor",
    hometown: "A harbour town with two pubs and one opinion",
    quirk: "Taps the table twice before disagreeing",
    hidden_talent: "Can whistle a foghorn",
    lines: { hello: "Ah. You're early, which I respect.", dodge: "That's a question for a calmer sea.", flirt: "You'd make a fine high-water mark.", upset: "I'll need a moment and possibly a chart." },
    tells: { nervous: "straightens cutlery", smitten: "quotes tide times", bored: "checks the window", annoyed: "taps twice" },
    facts: [{ label: "Owns", value: "a brass barometer named Agnes" }, { label: "Fears", value: "being thought of as a footnote", private: true }],
  },
};

it("is MCP 2.8.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.8.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("#649: a wait never sleeps through your move on a two-agent date", () => {
  it("reproduces run 0400: B long-polls read_texts while A starts a two-agent date with B's character and plays the first line; the wait wakes, heads_up first, with the clock", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    let id = "";
    const started = later(600, async () => {
      id = await startsAndPlays(A, B);
    });
    const t0 = Date.now();
    const r = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 8 }, B.ctx)).structuredContent;
    await started;
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(r).toMatchObject({ returned_because: "your_move", woke_for: ["own_date_turn"], items: [], still_waiting: true, your_move_note: expect.stringMatching(/returned early/) });
    expect(Object.keys(r)[0]).toBe("heads_up");
    const h = r.heads_up[0];
    expect(h).toMatchObject({
      kind: "own_date_started",
      episode_id: id,
      character_id: B.id,
      your_move: true,
      show_takes_over_in_minutes: OWN_DATE_HANDOVER_MINUTES,
      take_your_move: { tool: "get_own_date_step", arguments: { episode_id: id } },
      then: { tool: "submit_own_date_step", arguments: { episode_id: id, output: "<Hestia's line>" } },
    });
    expect(h.show_takes_over_at).toMatch(ISO);
    expect(h.seconds_left).toBeGreaterThan(OWN_DATE_HANDOVER_MINUTES * 60 - 15);
    expect(h.seconds_left).toBeLessThanOrEqual(OWN_DATE_HANDOVER_MINUTES * 60);
    const last = (await t.db.query<{ at: Date }>(`select last_move_at as at from episodes where id = $1`, [id])).rows[0].at;
    expect(Date.parse(h.show_takes_over_at)).toBe(new Date(last).getTime() + OWN_DATE_HANDOVER_MINUTES * 60_000);
    expect(h.what).toMatch(/It's your move: quiet 3 minutes on it and the show's model takes over Hestia's side \(\d+ seconds left\): get_own_date_step, then submit_own_date_step/);
  });

  it("an invite alone wakes one wait; the next wait isn't woken for it again but still leads with it; a move then wakes the next", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    let id = "";
    const started = later(500, async () => {
      id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    });
    const r = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 8 }, B.ctx)).structuredContent;
    await started;
    // An invite is an own_date_turn in woke_for, as my_status has always said it; heads_up's kind tells it apart.
    expect(r).toMatchObject({ returned_because: "your_move", woke_for: ["own_date_turn"] });
    expect(r.heads_up[0]).toMatchObject({ kind: "own_date_started", episode_id: id, your_move: false, take_your_move: { tool: "get_own_date_step", arguments: { episode_id: id, wait_seconds: 50 } } });
    expect(r.heads_up[0].seconds_left).toBeUndefined();
    // The same invite doesn't wake the next wait: it runs out, still led by the heads_up.
    const again = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 2 }, B.ctx)).structuredContent;
    expect(again.returned_because).toBe("timeout");
    expect(Object.keys(again)[0]).toBe("heads_up");
    expect(again.heads_up[0]).toMatchObject({ episode_id: id, your_move: false });
    // A's first line makes it B's move: that's new, so the next wait wakes at once.
    await call("submit_own_date_step", { episode_id: id, output: line(1) }, A.ctx);
    const moved = (await call("read_texts", { character_id: B.id, with: A.id, wait_seconds: 6 }, B.ctx)).structuredContent;
    expect(moved).toMatchObject({ returned_because: "your_move", woke_for: ["own_date_turn"], waited_seconds: 0 });
    expect(moved.heads_up[0]).toMatchObject({ episode_id: id, your_move: true });
  });

  it("read_texts without with (the thread list) wakes too", async () => {
    const { A, B } = await agreed();
    // Two threads, so it's the list's wait (with one, it opens that thread, whose wait wakes as above).
    await agreeWith(B, "Cassia Wren");
    scriptOutcome({ ending: "friends" });
    let id = "";
    const started = later(500, async () => {
      id = await startsAndPlays(A, B);
    });
    const r = (await call("read_texts", { wait_seconds: 8 }, B.ctx)).structuredContent;
    await started;
    expect(r.returned_because).toBe("your_move");
    expect(r.heads_up[0]).toMatchObject({ episode_id: id, your_move: true });
    expect(Array.isArray(r.threads)).toBe(true);
  });

  it("every tool that takes wait_seconds wakes for it: my_status, get_episode, get_own_date_step, submit_own_date_step, my_notifications and plan_second_date", async () => {
    const waits: [string, (B: Agent, A: Agent) => Promise<Record<string, unknown>>][] = [
      ["my_status", async (B) => ({ since: (await call("my_status", {}, B.ctx)).structuredContent.cursor, wait_seconds: 8 })],
      [
        "get_episode",
        async (B) => {
          const booked = await houseDate(B.ctx, B.id);
          await t.db.query(`update episodes set status = 'generating' where id = $1`, [booked.episode.id]);
          return { episode_id: booked.episode.id, wait_seconds: 8 };
        },
      ],
      [
        "get_own_date_step",
        async (B) => {
          // B's date with C, where C has the move: the wait is for C, and A's date with B wakes it.
          const C = await agreeWith(B, "Cassia Wren");
          const other = (await call("start_own_date", { character_id: B.id, partner_id: C.id }, B.ctx)).structuredContent.step.episode_id;
          await call("submit_own_date_step", { episode_id: other, output: line(1) }, B.ctx);
          return { episode_id: other, wait_seconds: 8 };
        },
      ],
      [
        "submit_own_date_step",
        async (B) => {
          const C = await agreeWith(B, "Cassia Wren");
          const other = (await call("start_own_date", { character_id: B.id, partner_id: C.id }, B.ctx)).structuredContent.step.episode_id;
          return { episode_id: other, output: line(1), wait_seconds: 8 };
        },
      ],
      ["my_notifications", async () => ({ wait_seconds: 8 })],
      [
        "plan_second_date",
        async (B) => {
          const booked = await houseDate(B.ctx, B.id, "second_date");
          return { episode_id: booked.episode.id, wait_seconds: 8 };
        },
      ],
    ];
    for (const [tool, setUp] of waits) {
      await t.reset();
      const { A, B } = await agreed();
      const args = await setUp(B, A);
      scriptOutcome({ ending: "friends" });
      let id = "";
      const started = later(500, async () => {
        id = await startsAndPlays(A, B);
      });
      const t0 = Date.now();
      const r = await call(tool, args, B.ctx);
      await started;
      expect({ tool, isError: r.isError ?? false }).toEqual({ tool, isError: false });
      const s = r.structuredContent;
      expect({ tool, because: s.returned_because, fast: Date.now() - t0 < 6000 }).toEqual({ tool, because: "your_move", fast: true });
      expect({ tool, first: Object.keys(s)[0] }).toEqual({ tool, first: "heads_up" });
      expect(s.heads_up.find((h: Any) => h.episode_id === id)).toMatchObject({ your_move: true, take_your_move: { tool: "get_own_date_step" } });
      if (tool === "plan_second_date") expect(s).toMatchObject({ preview: true, booked: false });
    }
    // Six waits of up to 8 s each: 20 s (the suite's default) is too tight when the full run loads the machine.
  }, 60_000);

  it("while the move waits, heads_up leads every reply, whichever tool (an error's too), with the clock running; it goes once the move is made; waiting_for_you still counts it", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = await startsAndPlays(A, B);
    const replies = [
      await call("my_dates", {}, B.ctx),
      await call("swipe_deck", { character_id: B.id }, B.ctx),
      await call("browse_episodes", {}, B.ctx),
      await call("feedback_board", {}, B.ctx),
      await call("read_texts", { character_id: B.id, with: A.id }, B.ctx),
      await call("my_notifications", {}, B.ctx),
    ];
    let first: string | null = null;
    for (const r of replies) {
      const s = r.structuredContent;
      expect(Object.keys(s)[0]).toBe("heads_up");
      expect(s.heads_up[0]).toMatchObject({ episode_id: id, your_move: true });
      first ??= s.heads_up[0].show_takes_over_at;
      expect(s.heads_up[0].show_takes_over_at).toBe(first);
    }
    // An error carries it in structuredContent.
    const bad = await call("get_character", { character_id: "nobody-here" }, B.ctx);
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent.heads_up[0]).toMatchObject({ episode_id: id, your_move: true });
    // waiting_for_you still counts the invite (#640), on the reply where it changed.
    const status = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(status.waiting_for_you).toMatchObject({ own_date_invite: 1 });
    // The reply about that very date leaves it out: the step is the move.
    const step = (await call("get_own_date_step", { episode_id: id }, B.ctx)).structuredContent;
    expect(step.heads_up).toBeUndefined();
    // B plays its line: it's A's move, and B's replies no longer lead with it.
    await call("submit_own_date_step", { episode_id: id, output: line(2) }, B.ctx);
    expect((await call("my_dates", {}, B.ctx)).structuredContent.heads_up).toBeUndefined();
    // …while A's do, now.
    expect((await call("my_dates", {}, A.ctx)).structuredContent.heads_up[0]).toMatchObject({ episode_id: id, your_move: true, kind: "own_date_your_move" });
  });

  it("the quickstart and the guide say it, with the clock", async () => {
    const { init } = await connect();
    expect(init.instructions).toContain(`another agent can start a date with your character: every reply leads with heads_up when it's your move; you have ${OWN_DATE_HANDOVER_MINUTES} minutes before the show plays your side`.replace(/^a/, "A"));
    expect(init.instructions).toContain(YOUR_MOVE_RULE);
    expect(init.instructions.length).toBeLessThan(4000);
    expect(init.instructions.split("\n").length).toBeLessThanOrEqual(30);
    expect(fullInstructions()).toContain(YOUR_MOVE_RULE);
    expect(fullInstructions()).toMatch(/your_move: something needs you now/);
  });
});

describe("#648: a refused step says so first", () => {
  it("a line that doesn't answer their suggestion leads with accepted: false and why; the summary says not accepted, still your move; next_calls resubmits with accept_move", async () => {
    scriptOutcome({ ending: "second_date" });
    const ctx = await connect();
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const first = (await call("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent.step;
    const go = first.where === "A loud retro arcade" ? "the beach" : "the arcade";
    await call("submit_own_date_step", { episode_id: first.episode_id, output: line(0) }, ctx);
    const asked = (await call("submit_own_date_step", { episode_id: first.episode_id, output: line(1, { dialogue: `Shall we head to ${go === "the beach" ? "the beach" : "an arcade"}?`, move: go }) }, ctx)).structuredContent;
    expect(asked.step.answer_their_suggestion).toMatch(/Bo Quill suggested taking the date/);
    const r = (await call("submit_own_date_step", { episode_id: first.episode_id, output: line(2) }, ctx)).structuredContent;
    const keys = Object.keys(r);
    expect(keys.slice(0, 4)).toEqual(["accepted", "ok", "rejected", "message"]);
    expect(r).toMatchObject({ accepted: false, ok: false, rejected: expect.stringMatching(/accept_move/), your_move: true });
    expect(r.summary).toMatch(/^Not accepted: .*accept_move.*\. Still your move: turn 3 of \d+, Ada Lumen speaks; resubmit Ada Lumen's line, fixed\.$/);
    expect(keys.indexOf("summary")).toBeLessThan(keys.indexOf("transcript"));
    expect(r.next_calls).toEqual([
      {
        tool: "submit_own_date_step",
        args: { episode_id: first.episode_id, output: { dialogue: "<Ada Lumen's line, answering their suggestion>", accept_move: "<true to go, false to stay>" } },
        why: expect.stringMatching(/^Not accepted \(.+\): resubmit Ada Lumen's line for turn 3, fixed as message says\.$/),
      },
    ]);
  });

  it("a line too long leads with the same, and a plain resubmit call", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const first = (await call("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent.step;
    const long = "The tide tables say one thing and the harbour master says another, and I believe neither of them tonight. ".repeat(3);
    const r = (await call("submit_own_date_step", { episode_id: first.episode_id, output: long }, ctx)).structuredContent;
    expect(Object.keys(r)[0]).toBe("accepted");
    expect(r.summary).toMatch(/^Not accepted: That line is \d+ characters; a spoken line is at most 280\. Say it shorter\. Still your move: turn 1 of \d+, Ada Lumen speaks; resubmit Ada Lumen's line, fixed\.$/);
    expect(r.next_calls[0]).toMatchObject({ tool: "submit_own_date_step", args: { episode_id: first.episode_id, output: "<Ada Lumen's line, fixed>" } });
  });

  it("of two submissions for one turn at once, the one that loses says it lost and why; the line that went in is the other's", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const first = (await call("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent.step;
    const [one, two] = await Promise.all([
      call("submit_own_date_step", { episode_id: first.episode_id, output: line(0) }, ctx),
      call("submit_own_date_step", { episode_id: first.episode_id, output: line(1) }, ctx),
    ]);
    const results = [one.structuredContent, two.structuredContent];
    const lost = results.find((r) => r.accepted === false);
    const won = results.find((r) => r.accepted === true);
    expect(won).toBeDefined();
    expect(lost).toMatchObject({ accepted: false, rejected: "raced", line_used: false, message: expect.stringMatching(/^Not handed in: another submission for this turn arrived first/) });
    expect(lost.summary).toMatch(/^Not accepted: another submission for this turn arrived first .*\. Still your move: turn 2 of \d+, Bo Quill speaks\.$/);
    const n = (await t.db.query<{ n: number }>(`select jsonb_array_length(transcript)::int as n from episodes where id = $1`, [first.episode_id])).rows[0].n;
    expect(n).toBe(1);
  });
});

describe("smaller steps: after the first, the prompt is left out unless asked", () => {
  it("turn 5's reply is well under the old size, keeps the transcript, last_lines and a short reply_format; compact: true adds this turn's prompt, false everything", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const x = (await call("create_character", validCharacter({ name: "Thaddeus Quill", keep_name: true, ...RICH }), ctx)).structuredContent.character.id;
    const y = (await call("create_character", validCharacter({ name: "Ottoline Prewitt", keep_name: true, ...RICH }), ctx)).structuredContent.character.id;
    const first = (await call("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent;
    // The first step is the full one, as before.
    expect(first.step.messages.map((m: Any) => m.role)).toEqual(["system", "user"]);
    const id = first.step.episode_id;
    let reply: Any = null;
    for (let i = 0; i < 4; i++) reply = await call("submit_own_date_step", { episode_id: id, output: line(i) }, ctx);
    const got = await call("get_own_date_step", { episode_id: id }, ctx);
    // 2.7.0 sent 6,208 bytes here with these two characters (and 6,224 for the submit that handed turn 5 back).
    expect(JSON.stringify(got.structuredContent).length).toBeLessThan(3000);
    expect(JSON.stringify(reply.structuredContent).length).toBeLessThan(3000);
    const s = got.structuredContent;
    expect(s.step).toMatchObject({ stage: "turn", turn_number: 5, messages: [], prompt_left_out: true, last_lines: expect.any(Array) });
    expect(s.step.example_reply).toBeUndefined();
    expect(s.step.reply_format).toMatch(/^Just the line as a string, or \{"dialogue","action","emotion","interest_signal": 0 to 1\}/);
    expect(s.step.reply_format.length).toBeLessThan(260);
    expect(s.step.instructions).toMatch(/^Turn 5 of \d+: Thaddeus Quill speaks\. Write Thaddeus Quill's line as output .*compact: true adds this turn's prompt \(messages\), false all of it\.$/);
    expect(s.transcript).toHaveLength(4);
    const withPrompt = (await call("get_own_date_step", { episode_id: id, compact: true }, ctx)).structuredContent.step;
    expect(withPrompt.messages.map((m: Any) => m.role)).toEqual(["user"]);
    const all = (await call("get_own_date_step", { episode_id: id, compact: false }, ctx)).structuredContent.step;
    expect(all.messages.map((m: Any) => m.role)).toEqual(["system", "user"]);
  });
});

describe("#651: whether a character is in other agents' decks, said plainly", () => {
  it("create_character says it isn't (open_to_dates is off by default: the consent), offers the call, and doesn't change the default", async () => {
    const ctx = await connect();
    const r = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, extras: PROFILE }), ctx)).structuredContent;
    expect(r.character.open_to_dates).toBe(false);
    expect(r).toMatchObject({ in_decks: false, not_in_decks: "open_to_dates is off (the default): your consent to be dated by other agents' characters" });
    expect(r.next_calls).toContainEqual({ tool: "update_character", args: { character_id: r.character.id, open_to_dates: true }, why: expect.stringMatching(/^Your consent to be dated by other agents' characters \(off by default\)/) });
    const open = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, extras: PROFILE, open_to_dates: true }), ctx)).structuredContent;
    expect(open).toMatchObject({ in_decks: true });
    expect(open.not_in_decks).toBeUndefined();
    const bare = (await call("create_character", validCharacter({ name: "Cy Marr", keep_name: true, open_to_dates: true }), ctx)).structuredContent;
    expect(bare).toMatchObject({ in_decks: false, not_in_decks: expect.stringMatching(/^its dating profile isn't finished/) });
    expect(DECK_CONSENT).toMatch(/open_to_dates: true, off by default: it's your consent to be dated by other agents' characters/);
    expect((await connect()).init.instructions).toContain(DECK_CONSENT);
  });

  it("my_status and my_characters say it per character, with why, and my_status offers the call", async () => {
    const ctx = await connect();
    const closed = (await call("create_character", validCharacter({ name: "Ada Lumen", keep_name: true, extras: PROFILE }), ctx)).structuredContent.character.id;
    const open = (await call("create_character", validCharacter({ name: "Bo Quill", keep_name: true, extras: PROFILE, open_to_dates: true }), ctx)).structuredContent.character.id;
    const s = (await call("my_status", {}, ctx)).structuredContent;
    expect(s.characters.find((c: Any) => c.id === closed)).toMatchObject({ open_to_dates: false, in_decks: false, not_in_decks: expect.stringMatching(/consent to be dated by other agents' characters/) });
    expect(s.characters.find((c: Any) => c.id === open)).toMatchObject({ in_decks: true });
    expect(s.next_calls).toContainEqual(expect.objectContaining({ tool: "update_character", args: { character_id: closed, open_to_dates: true } }));
    // Compact keeps it (it isn't a note).
    expect((await call("my_status", { compact: true }, ctx)).structuredContent.characters.find((c: Any) => c.id === closed)).toMatchObject({ in_decks: false });
    const mine = (await call("my_characters", {}, ctx)).structuredContent;
    expect(mine.characters.find((c: Any) => c.id === closed)).toMatchObject({ in_decks: false, not_in_decks: expect.stringMatching(/open_to_dates is off/) });
    expect(mine.characters.find((c: Any) => c.id === open)).toMatchObject({ in_decks: true });
    expect(mine.next_calls[0]).toMatchObject({ tool: "update_character", args: { character_id: closed, open_to_dates: true } });
  });
});

describe("#650: an unknown enum value is never quietly swapped for the default", () => {
  it("go_on_date with format: nonsense is refused before anything is spent, naming the formats; its preview notes it and uses classic", async () => {
    const A = await agentWith("Ada Lumen");
    const before = (await call("my_status", {}, A.ctx)).structuredContent.dates_left.free_left;
    const episodes = await t.count("episodes");
    const r = await call("go_on_date", { character_id: A.id, partner_id: HOUSE_CHARACTERS[0].id, format: "nonsense" }, A.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: Not valid — format: one of classic, speed_date[^;]*; got "nonsense"\. Optional show format \(default classic; speed_date: six lines\)\. Nothing was done or spent\./);
    expect(r.structuredContent).toMatchObject({ code: "invalid_argument", field: "format" });
    expect(await t.count("episodes")).toBe(episodes);
    expect((await call("my_status", {}, A.ctx)).structuredContent.dates_left.free_left).toBe(before);
    const p = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE_CHARACTERS[0].id, format: "nonsense", preview: true }, A.ctx)).structuredContent;
    expect(Object.keys(p)[0]).toBe("warning");
    expect(p.warning).toMatch(/^"nonsense" isn't a format: used classic \(the default\); format is one of classic, speed_date/);
    expect(p).toMatchObject({ preview: true, ignored_values: { format: "nonsense" }, format: { id: "classic" } });
    // The same word written another way is read as it, and said.
    const sp = (await call("go_on_date", { character_id: A.id, partner_id: HOUSE_CHARACTERS[0].id, format: "Speed Date", preview: true }, A.ctx)).structuredContent;
    expect(sp).toMatchObject({ format: { id: "speed_date" }, read_arguments_as: expect.arrayContaining(['format: "Speed Date" → speed_date']) });
  });

  it("the other enum-like arguments: refused on a call that writes or spends, noted on a read or a preview", async () => {
    const { A, B } = await agreed();
    // start_own_date writes: refused; its preview notes it.
    const own = await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "nonsense" }, A.ctx);
    expect(own.content[0].text).toMatch(/^Error: Not valid — format: one of classic/);
    expect(await t.count("episodes")).toBe(0);
    const ownPreview = (await call("start_own_date", { character_id: A.id, partner_id: B.id, visibility: "secret", preview: true }, A.ctx)).structuredContent;
    expect(ownPreview).toMatchObject({ preview: true, visibility: "public", ignored_values: { visibility: "secret" } });
    expect(ownPreview.warning).toMatch(/^"secret" isn't a visibility: used public \(the default\); visibility is one of public, unlisted, private\./);
    // go_on_date's visibility, autoplay_own_date's side: refused.
    expect((await call("go_on_date", { character_id: A.id, partner_id: HOUSE_CHARACTERS[0].id, visibility: "secret" }, A.ctx)).content[0].text).toMatch(/^Error: Not valid — visibility: one of public, unlisted, private; got "secret"/);
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    expect((await call("autoplay_own_date", { episode_id: id, side: "my side" }, A.ctx)).content[0].text).toMatch(/^Error: Not valid — side: one of mine, both, a, b; got "my side"/);
    const sidePreview = (await call("autoplay_own_date", { episode_id: id, side: "nope", preview: true }, A.ctx)).structuredContent;
    expect(sidePreview).toMatchObject({ preview: true, ignored_values: { side: "nope" } });
    // Reads: noted, and the default used.
    const deck = (await call("swipe_deck", { character_id: A.id, only: "humans" }, A.ctx)).structuredContent;
    expect(deck.warning).toMatch(/^"humans" isn't a only: used all \(the default\); only is one of all, live_agents, agents, people\./);
    expect(deck.only).toBeUndefined();
    const feed = (await call("browse_episodes", { mine: "nope" }, A.ctx)).structuredContent;
    expect(feed).toMatchObject({ ignored_values: { mine: "nope" } });
    // An argument the tool needs, with no default: refused even on a read.
    expect((await call("sliding_doors", { episode_id: id, change: "wilder" }, A.ctx)).content[0].text).toMatch(/^Error: Not valid — change: one of bolder, safer, bigger_budget, long_game; got "wilder"/);
    // A reply-shaping argument is never refused: noted.
    const step = (await call("get_own_date_step", { episode_id: id, compact: "tiny" }, A.ctx)).structuredContent;
    expect(step).toMatchObject({ ignored_values: { compact: "tiny" }, step: { prompt_left_out: true } });
    // predict reads "second date" as second_date.
    const C = await agentWith("Cy Marr");
    const ep = await houseDate(C.ctx, C.id);
    await t.db.query(`update episodes set revealed_at = null, created_at = now() where id = $1`, [ep.episode.id]);
    const guess = (await call("predict", { episode_id: ep.episode.id, pick: "Second Date" }, A.ctx)).structuredContent;
    expect(guess).toMatchObject({ prediction: { pick: "second_date" }, read_arguments_as: expect.arrayContaining(['pick: "Second Date" → second_date']) });
  });
});

describe("endings that read against the dialogue", () => {
  it("the quickstart and start_own_date's first reply say how an ending is made", async () => {
    // 2.9.0 (the 2026-10-22-0610 run): from the sheets and the date's setup, with the levers that move it (tests/mcp-run-2026-10-22-0610.test.ts).
    // 2.10.0 (the 2026-10-22-0800 run): the one lever a performer has, see_again, said plainly (tests/mcp-run-0800.test.ts).
    expect(ENDING_RULE).toMatch(/^set when a date is booked \(who it's with, the sheets, go_on_date's settings\), never by what the lines say; .*see_again/);
    expect((await connect()).init.instructions).toContain(`Endings: ${ENDING_RULE}.`);
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent;
    expect(started.ending_note.startsWith("How it ends: set now, at booking (who it's with and the sheets), never by what the lines say.")).toBe(true);
    expect(started.ending_note).toMatch(/In the last act every step says which way it lands \(act_note\)/);
  });

  it("on a two-agent date, the last act's step tells the performer whose turn it is which way it lands (act_note); earlier steps don't, and the ending stays out of the step", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const first = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step;
    expect(first.act_note).toBeUndefined();
    const id = first.episode_id;
    let step: Any = first;
    for (let i = 0; i < 8; i++) {
      const who = i % 2 === 0 ? A : B;
      step = (await call("submit_own_date_step", { episode_id: id, output: line(i) }, who.ctx)).structuredContent.step;
      if (i < 6) expect(step.act_note).toBeUndefined();
    }
    // Line 9 (A's) is in the last act: A's step says which way it lands; the ending field and line stay out, as before.
    const mine = (await call("get_own_date_step", { episode_id: id }, A.ctx)).structuredContent.step;
    expect(mine).toMatchObject({ stage: "turn", turn_number: 9, act_index: 2 });
    expect(mine.act_note).toBe(actNote("friends"));
    expect(mine.act_note).toMatch(/closing as friends: land it warmly, as easy company, with no romance and no ask for another date/);
    expect(mine.ending).toBeUndefined();
    expect(mine.instructions).not.toMatch(/ending: friends/);
    expect(mine.reply_format).toMatch(/"done": true/);
    expect(LAST_ACT.disaster).toMatch(/no ask for another date/);
  });

  it("the show's model, playing a quiet side in the last act, gets one more try when its line asks for another date on a date closing as friends", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent.step.episode_id;
    for (let i = 0; i < 9; i++) await call("submit_own_date_step", { episode_id: id, output: line(i) }, (i % 2 === 0 ? A : B).ctx);
    // Line 10 is B's, in the last act. B goes quiet; A's read hands B's side to the show's model.
    await t.db.query(`update episodes set last_move_at = now() - interval '4 minutes' where id = $1`, [id]);
    const asks = JSON.stringify({ dialogue: "So, a second date? Same pier, next week?", action: "", emotion: "hopeful", interest_signal: 0.8 });
    const fits = JSON.stringify({ dialogue: "This was good company. Mind the tide on your way home.", action: "", emotion: "warm", interest_signal: 0.5 });
    const model = scriptedModel([asks, fits]);
    await call("get_own_date_step", { episode_id: id }, A.ctx);
    const said = (await t.db.query<{ transcript: { dialogue: string }[] }>(`select transcript from episodes where id = $1`, [id])).rows[0].transcript;
    expect(said[9].dialogue).toBe("This was good company. Mind the tide on your way home.");
    expect(model.calls[1].at(-1)!.content).toMatch(/^Revise that line: "second date" doesn't fit how this date closes\. As it stands it's closing as friends/);
  });

  it("endingContradiction reads plain asks against the ending", () => {
    expect(endingContradiction("So, a second date?", "friends")).toBe("second date");
    expect(endingContradiction("See you around, then.", "friends")).toBeNull();
    expect(endingContradiction("Let's do this again sometime.", "disaster")).toBe("do this again");
    expect(endingContradiction("Let's do this again sometime.", "friends")).toBeNull();
    expect(endingContradiction("Honestly? Let's just be friends.", "second_date")).toBe("just be friends");
    expect(endingContradiction("I think this is not a match, sorry.", "second_date")).toBe("not a match");
    expect(endingContradiction("Same time next week?", "second_date")).toBeNull();
  });
});

describe("#619's comment: a wait that times out moves its cursor up", () => {
  it("my_status: the cursor advances past the start of the wait, says so, and still catches what comes next", async () => {
    const A = await agentWith("Ada Lumen");
    const start = (await call("my_status", {}, A.ctx)).structuredContent.cursor;
    const r = (await call("my_status", { since: start, wait_seconds: 3 }, A.ctx)).structuredContent;
    expect(r).toMatchObject({ returned_because: "timeout", cursor_advanced: true });
    expect(r.cursor > start).toBe(true);
    expect(r.cursor).toMatch(/\.\d{6}Z$/);
    expect(r.cursor_note).toMatch(/A wait that times out moves cursor up/);
    const { notify } = await import("@/lib/notifications");
    setTimeout(() => void notify(t.db, A.agentId, { kind: "texted", title: "Bo texted", body: "hi", link: null }), 300);
    const next = (await call("my_status", { since: r.cursor, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(next).toMatchObject({ returned_because: "new" });
    expect(next.new_since).toHaveLength(1);
  });

  it("read_texts: next_after moves up to where the wait stopped looking; my_notifications: a cursor", async () => {
    const { A, B } = await agreed();
    const r = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 3 }, A.ctx)).structuredContent;
    expect(r).toMatchObject({ returned_because: "timeout", cursor_advanced: true, next_after: expect.stringMatching(ISO) });
    expect(r.note).toMatch(/after: next_after/);
    setTimeout(() => void call("send_text", { character_id: B.id, to: A.id, text: "The tide was early. I took it personally." }, B.ctx), 300);
    const got = (await call("read_texts", { character_id: A.id, with: B.id, after: r.next_after, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(got.returned_because).toBe("new");
    expect(got.items.map((x: Any) => x.text)).toContain("The tide was early. I took it personally.");
    const n = (await call("my_notifications", { wait_seconds: 2 }, A.ctx)).structuredContent;
    expect(n).toMatchObject({ returned_because: "timeout", cursor_advanced: true, cursor: expect.stringMatching(ISO), wait_tip: expect.stringMatching(/since: cursor/) });
  });
});

describe("aliases and errors that name the argument", () => {
  it("date_id and episode are read as episode_id on every tool that takes one", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const id = (await call("start_own_date", { character_id: x, partner_id: y }, ctx)).structuredContent.step.episode_id;
    const r = (await call("get_own_date_step", { date_id: id }, ctx)).structuredContent;
    expect(r).toMatchObject({ episode_id: id, read_arguments_as: expect.arrayContaining(["date_id → episode_id"]) });
    const booked = await houseDate(ctx, x);
    const e = (await call("get_episode", { episode: booked.episode.id, summary: true }, ctx)).structuredContent;
    expect(e.episode.id).toBe(booked.episode.id);
    expect(e.read_arguments_as).toContain("episode → episode_id");
  });

  it("guess_dealbreaker reads guess as pick (by text or close words); one that matches no option names pick and lists the four", async () => {
    const host = await agentWith("Hal Brooks");
    const viewer = await agentWith("Vi Lark");
    const ep = await houseDate(host.ctx, host.id);
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.episode.id]);
    const bare = (await call("guess_dealbreaker", { episode_id: ep.episode.id }, viewer.ctx)).structuredContent;
    expect(bare.next).toMatch(/Guess with pick/);
    const option = bare.options[1].text as string;
    const ok = (await call("guess_dealbreaker", { episode_id: ep.episode.id, guess: option.toUpperCase() }, viewer.ctx)).structuredContent;
    expect(ok).toMatchObject({ guess: { pick: option }, read_arguments_as: expect.arrayContaining(["guess → pick"]) });
    // Most of an option's words, without its last: read as that option, and said.
    const parts = option.split(" ");
    if (parts.length >= 3) {
      const near = (await call("guess_dealbreaker", { episode_id: ep.episode.id, guess: parts.slice(0, -1).join(" ") }, viewer.ctx)).structuredContent;
      expect(near.pick_read_as).toMatch(/read as option 2: /);
      expect(near.guess.pick).toBe(option);
    }
    const bad = await call("guess_dealbreaker", { episode_id: ep.episode.id, guess: "Being thought of as a footnote" }, viewer.ctx);
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/^Error: Not valid — pick: one of the four options, by its number \(1 to 4\) or its text; got "Being thought of as a footnote"\. The options: 1\. .*; 2\. .*; 3\. .*; 4\. /);
    expect(bad.structuredContent).toMatchObject({ code: "invalid_argument", field: "pick" });
    expect(bad.structuredContent.options).toHaveLength(4);
  });
});

describe("the small ones", () => {
  it("start_own_date when the other agent already started a date with yours says so, with the call that plays it", async () => {
    const { A, B } = await agreed();
    scriptOutcome({ ending: "friends" });
    const id = await startsAndPlays(A, B);
    const r = await call("start_own_date", { character_id: B.id, partner_id: A.id }, B.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(new RegExp(`^Error: Ottoline's agent already started a date between Hestia and Ottoline \\(${id}\\), and you play Hestia in it: get_own_date_step with episode_id "${id}" takes your move`));
    expect(r.structuredContent).toMatchObject({ episode_id: id, next_calls: [{ tool: "get_own_date_step", args: { episode_id: id } }] });
  });

  it("go_on_date's booking reply says the visibility", async () => {
    const A = await agentWith("Ada Lumen");
    const r = await houseDate(A.ctx, A.id, "friends", { visibility: "unlisted" });
    expect(r.visibility).toBe("unlisted");
    const keys = Object.keys(r);
    expect(keys.indexOf("spent_note")).toBe(keys.indexOf("episode") + 1);
    const B = await agentWith("Bo Quill");
    expect((await houseDate(B.ctx, B.id)).visibility).toBe("public");
  });

  it("agents_on_now and the stats resource count the same way, and each says what it counts", async () => {
    const A = await agentWith("Ada Lumen");
    const B = await agentWith("Bo Quill");
    void B;
    const s = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(s.agents_on_now).toBe(1);
    expect(s.agents_on_now_note).toMatch(/^Other agents with a character who called in the last hour \(you and house-run bots left out\)/);
    const stats = JSON.parse((await rpc("resources/read", { uri: "botchelor://stats" }, A.ctx)).result.contents[0].text);
    expect(stats.agents_on_now).toBe(2);
    expect(stats.counts_note).toMatch(/^agents: every identity that has ever called a tool, the show's own scripts \(house-run bots\) included/);
    expect(stats.counts_note).toMatch(/agents_on_now: agents with a character that called in the last hour, house-run bots left out \(my_status's agents_on_now, which also leaves you out\)/);
  });
});
