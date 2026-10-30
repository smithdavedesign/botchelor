import { describe, expect, it } from "vitest";
import {
  bestLine,
  buildTurnMessages,
  ConversationError,
  critiqueTurn,
  parseTurn,
  parseTurnResult,
  simulateConversation,
  trimTo,
  type Turn,
  storedDraftReason,
} from "@/lib/conversation";
import {
  fixedEngine,
  NEUTRAL_SIGNALS,
  type CharacterSheet,
  type DateInput,
  type Outcome,
  type SideOutcome,
  type SideSetup,
} from "@/lib/engine";
import { assembleCharacter, type Character } from "@/lib/character";
import type { StoredSoul } from "@/lib/souls";
import type { ChatMessage, Model } from "@/lib/model";
import type { DatePlan } from "@/lib/beats";
import { CONVERSATION_TURNS, ENDING_LABELS, TURN_DIALOGUE_MAX } from "@/lib/rules";
import { pickVenue } from "@/lib/venues";

const ALPHA = "ALPHASECRET";
const BETA = "BETASECRET";
const AGENDA_A = "find_adventurous" as const; // label: "Find someone adventurous"
const AGENDA_B = "test_sincerity" as const; // label: "Test whether the other is sincere"
const AGENDA_A_LABEL = "Find someone adventurous";
const AGENDA_B_LABEL = "Test whether the other is sincere";

const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };

const side = (sheet: CharacterSheet, agendaId: typeof AGENDA_A | typeof AGENDA_B): SideSetup => ({
  sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId, note: null, gameBudget: 25,
});

const INPUT: DateInput = { a: side(sheetA, AGENDA_A), b: side(sheetB, AGENDA_B) };
// The soul text now reaches the model through the assembled Character (not a separate souls array). The
// secret markers live in each soul so the privacy checks below can assert each agent gets only its own.
const soul = (marker: string): StoredSoul =>
  ({ values: `honesty ${marker}`, insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: soul(ALPHA), memory: null }),
  assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(BETA), memory: null }),
];
const VENUE = pickVenue(1);
const PRODUCER = "a_hard_question" as const;

const sideOutcome = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = fixedEngine({ ending: "second_date", sides: [sideOutcome(true), sideOutcome(false)] }).decide(INPUT, 1);

// One-word actions: a repeated multi-word stage direction is a tell the critic sends back.
const turnJson = (dialogue: string, interest = 0.5) =>
  JSON.stringify({ dialogue, action: "asks", emotion: "curious", interest_signal: interest });

/** A model that returns (or throws) scripted outputs in order and records the messages it was given. */
function turnModel(outputs: Array<string | Error>): { model: Model; calls: ChatMessage[][] } {
  const queue = [...outputs];
  const calls: ChatMessage[][] = [];
  return {
    calls,
    model: {
      async complete(messages) {
        calls.push(messages);
        const next = queue.shift();
        if (next === undefined) throw new Error("scripted model out of outputs");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

// Only the USER message carries the per-agent data; the system prompt is fixed (and names "your_arc"
// in its instructions), so leak/steering checks look at what data the agent was actually given.
const content = (messages: ChatMessage[]) => messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

describe("buildTurnMessages — privacy and steering", () => {
  it("gives character A its own soul and agenda, and never the other's", () => {
    const { messages, side: who, act } = buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 0);
    expect(who).toBe("a");
    expect(act).toBe(0);
    const text = content(messages);
    expect(text).toContain(ALPHA);
    expect(text).toContain(AGENDA_A_LABEL);
    expect(text).not.toContain(BETA);
    expect(text).not.toContain(AGENDA_B_LABEL);
  });

  it("gives character B its own soul and agenda, and never the other's", () => {
    const { messages, side: who } = buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 1);
    expect(who).toBe("b");
    const text = content(messages);
    expect(text).toContain(BETA);
    expect(text).toContain(AGENDA_B_LABEL);
    expect(text).not.toContain(ALPHA);
    expect(text).not.toContain(AGENDA_A_LABEL);
  });

  it("does not expose the other side's hidden dealbreaker in the prompt", () => {
    // B never sees A's dealbreaker ("hates surprises"); it must emerge through the date, not be handed over.
    const a = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 1).messages); // B's turn
    expect(a).not.toContain("hates surprises");
  });

  it("every act carries this side's private intention; only the last act carries the ending", () => {
    const early = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 0).messages);
    expect(early).toContain("your_intention");
    expect(early).not.toContain(ENDING_LABELS.second_date);

    // Sixteen turns: turns 11-15 are the final act.
    const finalA = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 14).messages); // side a
    expect(finalA).toContain(ENDING_LABELS.second_date);
    expect(finalA).toContain("You want to see them again"); // sides[0].wants_another === true

    const finalB = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 15).messages); // side b
    expect(finalB).toContain("something in you says no"); // sides[1].wants_another === false, even on a second date
  });

  it("meets the other as a blind date does: name, pronouns, what you can see — never their profile", () => {
    const bTurn = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 1).messages);
    expect(bTurn).toContain("Mira"); // her name…
    expect(bTurn).not.toContain("a cartographer"); // …but not her bio
    expect(bTurn).not.toContain("a map reader"); // …or her want
    expect(bTurn).not.toContain("hates surprises"); // …or her dealbreaker
  });

  it("hands the speaker the other's last line to answer, with who offered what (#982)", () => {
    const said: Turn[] = [
      { side: "a", dialogue: "Hi, I'm Mira.", action: "", emotion: "nervous", interest: 0.5, act: 0 },
      { side: "b", dialogue: "Rafe. Lovely to meet you.", action: "", emotion: "warm", interest: 0.5, act: 0 },
      { side: "a", dialogue: "Sit, sit. Tea is on me tonight.", action: "pours", emotion: "playful", interest: 0.6, act: 0 },
    ];
    const dataOf = (t: Turn[], i: number) => JSON.parse(content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, t, i).messages).replace(/^[^\n]*\n/, ""));
    const data = dataOf(said, 3);
    expect(data.they_just_said).toMatchObject({ who: "Mira", said: "Sit, sit. Tea is on me tonight.", did: "pours" });
    expect(data.they_just_said.note).toMatch(/answers this first/);
    // It comes after the whole conversation, the last thing the speaker reads before replying.
    const keys = Object.keys(data);
    expect(keys.indexOf("they_just_said")).toBeGreaterThan(keys.indexOf("conversation_so_far"));
    // Mira answers Rafe; nothing to answer on the first line, or when the last line is the speaker's own.
    expect(dataOf([], 0).they_just_said).toBeUndefined();
    expect(dataOf(said.slice(0, 2), 2).they_just_said).toMatchObject({ who: "Rafe" });
    expect(dataOf([...said, { ...said[2], side: "b" }], 3).they_just_said).toBeUndefined();
  });

  it("a director plan's private beats reach only their own side", () => {
    const plan: DatePlan = {
      source: "director",
      spine: "PLANSPINE",
      acts: [0, 1, 2].map(() => ({ scene: "PUBLICSCENE", a: "AINTENT", b: "BINTENT" })) as DatePlan["acts"],
    };
    const a = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 0, "classic", {}, { plan }).messages);
    const b = content(buildTurnMessages(INPUT, OUTCOME, CHARS, PRODUCER, VENUE, [], 1, "classic", {}, { plan }).messages);
    expect(a).toContain("AINTENT");
    expect(a).not.toContain("BINTENT");
    expect(b).toContain("BINTENT");
    expect(b).not.toContain("AINTENT");
    expect(a).toContain("PUBLICSCENE");
    expect(b).toContain("PUBLICSCENE");
    expect(a + b).not.toContain("PLANSPINE"); // the spine is the narrator's, not the agents'
  });
});

describe("the turn critic", () => {
  it("sends back a line that reads the other's profile, and says why", () => {
    const leak: Turn = { side: "b", act: 0, dialogue: "A cartographer who wants a map reader, huh?", action: "", emotion: "", interest: 0.5 };
    expect(critiqueTurn([], leak, INPUT, CHARS, VENUE)).toMatch(/haven't told you/);
    const fine: Turn = { side: "b", act: 0, dialogue: "So what do you actually do when you're not out on a date?", action: "", emotion: "", interest: 0.5 };
    expect(critiqueTurn([], fine, INPUT, CHARS, VENUE)).toBeNull();
  });

  it("sends back a stage direction the date already used, and a name said line after line", () => {
    const before: Turn[] = [
      { side: "a", act: 0, dialogue: "Is it always this cold up here, Rafe?", action: "pulls the blanket tighter", emotion: "", interest: 0.5 },
      { side: "b", act: 0, dialogue: "Only when the oven's off.", action: "", emotion: "", interest: 0.5 },
    ];
    const copy: Turn = { side: "b", act: 0, dialogue: "Here, take the warm end.", action: "pulls blanket tighter", emotion: "", interest: 0.5 };
    expect(critiqueTurn(before, copy, INPUT, CHARS, VENUE)).toMatch(/already happened tonight/);
    const again: Turn = { side: "a", act: 0, dialogue: "You're a gentleman, Rafe.", action: "", emotion: "", interest: 0.5 };
    expect(critiqueTurn(before, again, INPUT, CHARS, VENUE)).toMatch(/name last time too/);
  });

  it("revises a flagged line once and keeps the revision", async () => {
    const { model, calls } = turnModel([
      turnJson("Hi. I'm Mira. I brought a compass, just in case."), // turn 0 (Mira): fine
      turnJson("A cartographer who wants a map reader, huh?"), // turn 1 (Rafe) reads her profile → sent back
      turnJson("So what do you do when you're not on a date?"), // the revision
      ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`Line ${i}: something friendly to say.`)),
    ]);
    const transcript = await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE);
    expect(transcript).toHaveLength(CONVERSATION_TURNS);
    // turn 0 (side a) is fine; turn 1 (side b) was the leak and got revised.
    expect(transcript[1].dialogue).toBe("So what do you do when you're not on a date?");
    expect(calls[2].at(-1)?.content).toMatch(/^Revise that line:/);
  });

  it("hands the replaced draft to onDraft — the rejected half of a pair — and nothing when the draft stood", async () => {
    const drafts: unknown[] = [];
    const { model } = turnModel([
      turnJson("Hi. I'm Mira. I brought a compass, just in case."),
      turnJson("A cartographer who wants a map reader, huh?"), // sent back
      turnJson("So what do you do when you're not on a date?"), // the revision wins
      ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`Line ${i}: something friendly to say.`)),
    ]);
    await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE, undefined, undefined, undefined, undefined, undefined, undefined, {
      onDraft: (d) => drafts.push(d),
    });
    expect(drafts).toEqual([{ turn_index: 1, side: "b", reason: expect.stringMatching(/haven't told you/), rejected: "A cartographer who wants a map reader, huh?" }]);

    const kept: unknown[] = [];
    const { model: m2 } = turnModel([
      turnJson("hello there, stranger"),
      turnJson("A cartographer who wants a map reader, huh?"),
      "not json", // the revision fails, so the draft stands: no rejected pair
      ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`Line ${i}: something friendly to say.`)),
    ]);
    await simulateConversation(m2, INPUT, OUTCOME, CHARS, PRODUCER, VENUE, undefined, undefined, undefined, undefined, undefined, undefined, { onDraft: (d) => kept.push(d) });
    expect(kept).toEqual([]);
  });

  it("never stores a never_says phrase in a draft's reason: the model is told it, the kept reason names it generically", async () => {
    const drafts: { reason: string; rejected: string }[] = [];
    const rafe = assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(BETA), memory: null, extras: { never_says: ["Splendid Weather"] } });
    const { model, calls } = turnModel([
      turnJson("Hi. I'm Mira. I brought a compass, just in case."),
      turnJson("Well, splendid weather for it, isn't it?"), // sent back: Rafe never says that
      turnJson("So what do you do when you're not on a date?"), // the revision wins
      ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`Line ${i}: something friendly to say.`)),
    ]);
    await simulateConversation(model, INPUT, OUTCOME, [CHARS[0], rafe], PRODUCER, VENUE, undefined, undefined, undefined, undefined, undefined, undefined, {
      onDraft: (d) => drafts.push(d),
    });
    // The revision prompt still names the phrase, so the model can fix it.
    expect(calls[2].at(-1)?.content).toMatch(/never say "Splendid Weather"/);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].reason).toMatch(/never_says list/);
    expect(drafts[0].reason.toLowerCase()).not.toContain("splendid weather");
  });

  it("storedDraftReason: the critic's never-say note and any other quote of the phrase, whatever the case", () => {
    const notes = `you'd never say "no worries" — put it your own way; you started the same way as an earlier line ("No worries, I…") — say it differently`;
    const out = storedDraftReason(notes, ["no worries"]);
    expect(out).toBe(`the line used a phrase on the character's never_says list — put it your own way; you started the same way as an earlier line ("[never_says], I…") — say it differently`);
    expect(storedDraftReason("say it differently", undefined)).toBe("say it differently");
    expect(storedDraftReason("a (b) c", ["(b)"])).toBe("a [never_says] c");
  });

  it("keeps the first draft when the revision doesn't parse (the critic never costs a date, or a third call)", async () => {
    const { model, calls } = turnModel([
      turnJson("hello there, stranger"),
      turnJson("A cartographer who wants a map reader, huh?"),
      "not json",
      ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`Line ${i}: something friendly to say.`)),
    ]);
    const transcript = await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE);
    expect(transcript[1].dialogue).toBe("A cartographer who wants a map reader, huh?");
    expect(transcript[2].dialogue).toBe("Line 0: something friendly to say."); // turn 2 got the next output
    expect(calls).toHaveLength(CONVERSATION_TURNS + 1); // one revision, nothing more
  });
});

describe("simulateConversation", () => {
  it("produces one bounded, alternating transcript across the three acts", async () => {
    const { model } = turnModel(Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`line ${i}`, i / 10)));
    const transcript = await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE);
    expect(transcript).toHaveLength(CONVERSATION_TURNS);
    expect(transcript.map((t) => t.side)).toEqual(Array.from({ length: CONVERSATION_TURNS }, (_, i) => (i % 2 ? "b" : "a")));
    // Acts are non-decreasing and cover all three.
    expect(transcript[0].act).toBe(0);
    expect(transcript.at(-1)!.act).toBe(2);
    expect(new Set(transcript.map((t) => t.act))).toEqual(new Set([0, 1, 2]));
  });

  it("hands over each finished line as it's written, for the live theater, and a failing listener can't cost the date", async () => {
    const { model } = turnModel(Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(`line ${i}`, i / 10)));
    const seen: number[] = [];
    const transcript = await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE, undefined, undefined, undefined, undefined, undefined, (lines) => {
      seen.push(lines.length);
      if (lines.length === 2) throw new Error("db down");
    });
    expect(seen).toEqual(Array.from({ length: CONVERSATION_TURNS }, (_, i) => i + 1));
    expect(transcript).toHaveLength(CONVERSATION_TURNS);
  });

  it("retries a bad turn, then gives up so the caller can fall back", async () => {
    // First turn: unusable on every attempt -> the whole conversation throws, with the reasons.
    const { model } = turnModel(["not json", "still not json", JSON.stringify({ line: "no dialogue" })]);
    const err = await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConversationError);
    expect((err as ConversationError).reasons).toEqual(["turn_0_json", "turn_0_json", "turn_0_schema"]);
  });

  it("recovers from bad replies via the retries (two in a row is not the end of the date)", async () => {
    const outputs: Array<string | Error> = [];
    for (let i = 0; i < CONVERSATION_TURNS; i++) {
      if (i === 2) outputs.push("garbage"); // one bad attempt, then a good one on retry
      if (i === 5) outputs.push("garbage", new Error("HTTP 503")); // two bad attempts, then a good third
      outputs.push(turnJson(`line ${i}`));
    }
    const { model } = turnModel(outputs);
    const transcript = await simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE);
    expect(transcript).toHaveLength(CONVERSATION_TURNS);
  });

  it("gives up when the model errors on every attempt", async () => {
    const { model } = turnModel([new Error("boom"), new Error("boom"), new Error("boom")]);
    await expect(simulateConversation(model, INPUT, OUTCOME, CHARS, PRODUCER, VENUE)).rejects.toBeInstanceOf(ConversationError);
  });
});

describe("parseTurn", () => {
  it("accepts a valid turn and clamps the interest signal to 0..1", () => {
    expect(parseTurn(turnJson("hi", 5), "a", 0)?.interest).toBe(1);
    expect(parseTurn(turnJson("hi", -2), "a", 0)?.interest).toBe(0);
    expect(parseTurn(JSON.stringify({ dialogue: "hi" }), "a", 0)?.interest).toBe(0.5); // missing -> default
  });

  it("tolerates code fences and missing optional fields", () => {
    const fenced = "```json\n" + JSON.stringify({ dialogue: "hello" }) + "\n```";
    const turn = parseTurn(fenced, "b", 1);
    expect(turn?.dialogue).toBe("hello");
    expect(turn?.side).toBe("b");
  });

  it("rejects invalid JSON, an empty line, and anything the content filter flags", () => {
    expect(parseTurn("{nope", "a", 0)).toBeNull();
    expect(parseTurn(JSON.stringify({ dialogue: "" }), "a", 0)).toBeNull();
    // A line with no words (date 1 ended on "[b] .", date 4 on "..."): rejected, not kept as a blank bubble.
    expect(parseTurn(JSON.stringify({ dialogue: "." }), "a", 0)).toBeNull();
    expect(parseTurn(JSON.stringify({ dialogue: "..." }), "a", 0)).toBeNull();
    expect(parseTurn(turnJson("Honestly this feels like a porn shoot"), "a", 0)).toBeNull();
    expect(parseTurnResult(JSON.stringify({ dialogue: "hi", action: "takes off everything, naked" }), "a", 0)).toEqual({ rejected: "filtered", reason: "sexual" });
    // #474: the show's model's lines get the same innuendo check as an agent's own (and say which rule).
    expect(parseTurnResult(turnJson("Is that a compass in your pocket or are you just pleased to see me?"), "a", 0)).toEqual({ rejected: "filtered", reason: "innuendo" });
  });

  it("trims a line that runs long instead of throwing it away", () => {
    const long = `${"I have a lot to say about lighthouses. ".repeat(9)}And one more thing.`;
    const turn = parseTurn(JSON.stringify({ dialogue: long, action: "gestures at the sea, the sky, the gulls, the rocks, the whole coastline, at length" }), "a", 0);
    expect(turn).not.toBeNull();
    expect(turn!.dialogue.length).toBeLessThanOrEqual(TURN_DIALOGUE_MAX);
    expect(turn!.dialogue.endsWith("lighthouses.")).toBe(true); // cut at a sentence end
    expect(turn!.action.length).toBeLessThanOrEqual(80);
    expect(trimTo("short", 10)).toBe("short");
    expect(trimTo("one two three four five", 12)).toBe("one two…");
  });
});

describe("bestLine", () => {
  it("returns the most-interested line, or null for an empty transcript", () => {
    const transcript: Turn[] = [
      { side: "a", act: 0, dialogue: "meh", action: "", emotion: "", interest: 0.1 },
      { side: "b", act: 0, dialogue: "the good one", action: "", emotion: "", interest: 0.9 },
    ];
    expect(bestLine(transcript)).toBe("the good one");
    expect(bestLine([])).toBeNull();
  });
});
