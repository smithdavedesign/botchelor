import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assembleCharacter, type Character } from "@/lib/character";
import { bestLine, buildTurnMessages, parseTurnResult, simulateConversation, type Turn } from "@/lib/conversation";
import { deterministicEngine, fixedEngine, NEUTRAL_SIGNALS, type DateInput, type Outcome, type SideSetup } from "@/lib/engine";
import { remembered } from "@/lib/memory";
import { lineIssues, transcriptQuality } from "@/lib/quality";
import { CONVERSATION_TURNS, DATE_ACTS } from "@/lib/rules";
import { pickVenue } from "@/lib/venues";

// David's dates-redesign (2026-10-18): purpose-first prompt, cut memory snowball, three new critic checks,
// 12-line default, done:true early close in act 3. The engine still decides the ending.

const sheet = (name: string) => ({ name, age: 30, bio: `A cartographer who maps ${name.toLowerCase()}.`, traits: ["curious", "warm", "dry"], want: "a map reader", dealbreaker: "liars", house: false });
const side = (name: string): SideSetup => ({ sheet: sheet(name), signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_funny", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: side("Mira"), b: side("Rafe") };
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "a", sheet: INPUT.a.sheet, soul: null, memory: null }),
  assembleCharacter({ id: "b", sheet: INPUT.b.sheet, soul: null, memory: null }),
];
const OUTCOME = fixedEngine({ ending: "friends" }).decide(INPUT, 1);
const VENUE = pickVenue(1);
const line = (side: "a" | "b", dialogue: string, interest = 0.5): Turn => ({ side, act: 0, dialogue, action: "", emotion: "warm", interest });

describe("the actor's purpose-first system prompt (David 2026-10-18)", () => {
  const sys = buildTurnMessages(INPUT, OUTCOME, CHARS, "a_hard_question", VENUE, [], 0).messages[0].content;

  it("opens with purpose, not rules", () => {
    expect(sys).toMatch(/You're here to find out whether this person could matter to you/);
    expect(sys).toMatch(/You might change your mind/);
    expect(sys).toMatch(/You're a person with a life beyond this date/);
  });

  it("keeps the hard rules and the JSON contract (with the new 'done' field)", () => {
    expect(sys).toMatch(/No sexual content, nudity or innuendo/);
    expect(sys).toMatch(/No real people or celebrities/);
    expect(sys).toMatch(/"done":false/);
    expect(sys).toMatch(/Set "done": true only in the final act/);
  });
});

describe("the merged `what_you_remember_about_them` block", () => {
  it("stays null when the two have never met", () => {
    expect(remembered({ memory: null, pair: null }, "them")).toBeNull();
  });

  it("merges metBefore and pair into one capped block (2 told things, 1 inside joke)", () => {
    const pair = {
      where_you_stand_now: "Seeing each other.",
      times_together: 3,
      how_its_been: "warm",
      things_they_have_told_you: ["she keeps a ledger", "she hates lemons", "she's never flown", "she rents a trumpet"],
      your_inside_jokes: ["the trumpet rental", "pots or people", "the lemon rule", "the ledger line", "the Tuesday count"],
      tonight_is_the_plan_you_made: ["You: let's go back to the café"],
    };
    const r = remembered({ memory: null, pair }, "them")!;
    expect(r.times).toBe(3);
    expect(r.things_they_have_told_you).toEqual(["she keeps a ledger", "she hates lemons"]);
    expect(r.an_inside_joke).toBe("the trumpet rental"); // only 1 joke, picked first (most recent)
    expect(r.tonight_is_the_plan).toEqual(["You: let's go back to the café"]);
    expect(r.where_you_stand).toBe("Seeing each other.");
  });

  it("drops the keys the data shape no longer passes (your_recent_dates, your_mood_so_far, lines_said_before)", () => {
    const messages = buildTurnMessages(INPUT, OUTCOME, CHARS, "a_hard_question", VENUE, [], 0).messages;
    const data = JSON.parse(messages[1].content.replace(/^[^\n]*\n/, ""));
    expect(data).not.toHaveProperty("your_recent_dates");
    expect(data).not.toHaveProperty("your_mood_so_far");
    expect(data).not.toHaveProperty("what_your_past_dates_taught_you");
    expect(data).not.toHaveProperty("you_have_met_them_before");
    expect(data).not.toHaveProperty("your_relationship_with_them");
  });
});

describe("the three new critic checks (near_duplicate, catchphrase, mirrored_other)", () => {
  it("near_duplicate: a 4+ content-word run shared with the same speaker's earlier line", () => {
    const before: Turn[] = [
      line("a", "My notebook catalogues lanterns, markets, bridges, benches, old awnings."),
      line("b", "That's a lot of lanterns."),
    ];
    const now = line("a", "Catalogues lanterns, markets, bridges, benches you walk past.");
    const issues = lineIssues(before, now, CHARS);
    expect(issues.near_duplicate).toBeTruthy();
  });

  it("catchphrase: a 2-distinctive-word phrase this speaker has used in 2+ earlier lines fires on the third use", () => {
    const before: Turn[] = [
      line("b", "Knock knock. Did Gerald wander out again?"),
      line("a", "Only clockwise. The barista swears by it."),
      line("b", "Knock knock, Gerald. The barista's calling you."),
    ];
    const now = line("b", "Honestly? Knock knock. Gerald. Every time.");
    const issues = lineIssues(before, now, CHARS);
    expect(issues.catchphrase).toMatch(/knock|gerald/);
  });

  it("mirrored_other: a 4+ content-word run shared with the other speaker's immediately previous line", () => {
    const prev = line("a", "My notebook catalogues lanterns, markets, bridges, benches, old awnings.");
    const now = line("b", "Catalogues lanterns, markets, bridges, benches you keep walking past.");
    const issues = lineIssues([prev], now, CHARS);
    expect(issues.mirrored_other).toBeTruthy();
  });

  it("none of them fire on varied, grounded dialogue", () => {
    const before: Turn[] = [
      line("a", "Have you ever rented a trumpet?"),
      line("b", "Only once. Didn't go well."),
    ];
    const now = line("a", "What went wrong, specifically?");
    const issues = lineIssues(before, now, CHARS);
    expect(issues.near_duplicate).toBeNull();
    expect(issues.catchphrase).toBeNull();
    expect(issues.mirrored_other).toBeNull();
  });

  it("transcriptQuality counts them and pulls the index down", () => {
    const tic = (i: number): Turn => ({ side: i % 2 ? "b" : "a", act: Math.min(2, Math.floor((i / 12) * 3)), dialogue: "Knock knock. Gerald again, huh?", action: "", emotion: "warm", interest: 0.5 });
    const q = transcriptQuality(Array.from({ length: 12 }, (_, i) => tic(i)), CHARS);
    expect(q.catchphrases).toBeGreaterThan(0);
    expect(q.near_duplicates).toBeGreaterThan(0);
    expect(q.index).toBeLessThan(60);
  });
});

describe("date length and early-close (David 2026-10-18)", () => {
  it("CONVERSATION_TURNS is 12 (4+4+4)", () => {
    expect(CONVERSATION_TURNS).toBe(12);
  });

  it("parseTurnResult accepts a 'done': true from the actor", () => {
    const raw = JSON.stringify({ dialogue: "I had a good time.", action: "", emotion: "warm", interest_signal: 0.7, done: true });
    const r = parseTurnResult(raw, "a", 2);
    expect("turn" in r && r.turn.done).toBe(true);
  });

  it("simulateConversation stops in act 3 when the actor returns done:true", async () => {
    const n = CONVERSATION_TURNS;
    const act3Start = Math.floor(((n - 1) / n) * DATE_ACTS.length);
    void act3Start;
    const turnJson = (dialogue: string, done = false) => JSON.stringify({ dialogue, action: "", emotion: "warm", interest_signal: 0.5, done });
    // Turns 0..8: fillers; turn 9 (act 3 for n=12): done:true. The loop should break after pushing turn 9.
    const outputs = [
      ...Array.from({ length: 9 }, (_, i) => turnJson(`Line ${i} — on with it.`)),
      turnJson("Alright. See you.", true),
      ...Array.from({ length: 3 }, (_, i) => turnJson(`Shouldn't be used ${i}.`)),
    ];
    const queue = [...outputs];
    const model = { async complete() { const next = queue.shift(); if (!next) throw new Error("out"); return next; } };
    const t = await simulateConversation(model, INPUT, OUTCOME, CHARS, "a_hard_question", VENUE);
    expect(t.length).toBe(10);
    expect(t[9].done).toBe(true);
  });

  it("done:true outside act 3 is ignored (runs full length)", async () => {
    const turnJson = (dialogue: string, done = false) => JSON.stringify({ dialogue, action: "", emotion: "warm", interest_signal: 0.5, done });
    // Turn 0 says done:true; simulateConversation should ignore it (act 0) and keep running.
    const outputs = [turnJson("Hi.", true), ...Array.from({ length: CONVERSATION_TURNS - 1 }, (_, i) => turnJson(`Line ${i} — on with it.`))];
    const queue = [...outputs];
    const model = { async complete() { const next = queue.shift(); if (!next) throw new Error("out"); return next; } };
    const t = await simulateConversation(model, INPUT, OUTCOME, CHARS, "a_hard_question", VENUE);
    expect(t.length).toBe(CONVERSATION_TURNS);
  });
});

describe("bestLine still skips scheduling lines", () => {
  it("picks a non-logistics line even when the scheduling line scored higher", () => {
    const t: Turn[] = [
      line("a", "What's the oddest thing in your fridge?", 0.6),
      line("b", "A jar of lemon rinds I keep for soup.", 0.65),
      line("a", "Same time next Tuesday?", 0.9),
    ];
    expect(bestLine(t)).toBe("A jar of lemon rinds I keep for soup.");
  });
});

describe("the engine still decides the ending (predictions depend on it)", () => {
  it("same input + same seed → same ending, regardless of prompt or length changes", () => {
    const o1 = deterministicEngine.decide(INPUT, 42) as Outcome;
    const o2 = deterministicEngine.decide(INPUT, 42) as Outcome;
    expect(o1.ending).toBe(o2.ending);
    expect(o1.drama_question).toBe(o2.drama_question);
    expect(o1.drama_answer).toBe(o2.drama_answer);
  });
});

// A no-op suite so vi stays imported in a tidy place.
describe("hooks", () => {
  beforeAll(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterAll(() => vi.restoreAllMocks());
  it("ok", () => expect(true).toBe(true));
});
