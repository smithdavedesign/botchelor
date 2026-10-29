import { describe, expect, it, vi } from "vitest";
import { simulateAfterglow } from "@/lib/afterglow";
import { buildTextMessages } from "@/lib/between-dates";
import { assembleCharacter, type Character } from "@/lib/character";
import { fixedEngine, NEUTRAL_SIGNALS, type DateInput, type SideSetup } from "@/lib/engine";
import { ModelError, type ChatMessage, type Model } from "@/lib/model";
import { critiqueText, planAlreadyMade, writeCritiquedText, type ThreadText } from "@/lib/text-critic";

// Chud × Nell (2026-10-18): the date held together; the texts after it didn't. Chud opened 11 of 12 texts with
// "Hello good looking", and the two re-proposed "meet me by the east wing" ten times. Texts had no critic.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const sheet = (name: string, bio: string) => ({ name, age: 33, bio, traits: ["playful", "bold", "warm"], want: "someone who laughs easily", dealbreaker: "liars", house: false });
const CHUD = sheet("Chud the crusher", "An engineer who wings every instruction manual.");
const NELL = sheet("Nell Abiodun", "A museum conservator who measures everything twice.");
const chud: Character = assembleCharacter({ id: "chud", sheet: CHUD, soul: null, memory: null });
const nell: Character = assembleCharacter({ id: "nell", sheet: NELL, soul: null, memory: null });
const say = (from: Character, text: string): ThreadText => ({ from: from.name, text });

describe("critiqueText: the repetition checks, on texts", () => {
  it("flags Chud opening a second text with 'Hello good looking'", () => {
    const thread = [
      say(chud, "Hello good looking. Still thinking about those spare keys and after-hours sculpture halls."),
      say(nell, "The spare keys are still in my pocket."),
    ];
    expect(critiqueText(thread, "Hello good looking. Meet me by the east wing.", chud, nell)).toMatch(/started a text with "hello good…"/);
  });

  it("flags a text that echoes the other's last one", () => {
    const thread = [say(nell, "Bring your engineering degree; the second-century archway needs a proper structural inspection.")];
    expect(critiqueText(thread, "Sure, I'll bring my engineering degree; the second-century archway needs a proper look.", chud, nell)).toMatch(/echoing Nell's last text/);
  });

  it("leaves a fresh text alone", () => {
    const thread = [say(chud, "Hello good looking."), say(nell, "Good morning. The humidity is at forty per cent.")];
    expect(critiqueText(thread, "Forty per cent? Is that good for marble or bad for my hair?", chud, nell)).toBeNull();
  });
});

describe("planAlreadyMade: a plan both have talked about is settled", () => {
  it("returns the latest plan once both sides have made or answered one", () => {
    const thread = [
      say(chud, "Meet me by the east wing and I'll show you how an engineer handles it."),
      say(nell, "The east wing entrance is secure. Bring your engineering degree."),
    ];
    expect(planAlreadyMade(thread)).toBe("The east wing entrance is secure. Bring your engineering degree.");
  });

  it("is null for a single proposal, or one side talking to itself", () => {
    expect(planAlreadyMade([say(chud, "Meet me by the east wing?")])).toBeNull();
    expect(planAlreadyMade([say(chud, "Meet me by the east wing?"), say(chud, "Let's say the archway, then.")])).toBeNull();
    expect(planAlreadyMade([say(chud, "How did you sleep?"), say(nell, "Badly. The radiator clanks.")])).toBeNull();
  });

  it("reaches the texting prompt as you_already_made_a_plan, with the purpose-first prompt", () => {
    const thread = [say(chud, "Meet me by the east wing tomorrow?"), say(nell, "It's a date. Bring the stopwatch.")];
    const messages = buildTextMessages(chud, nell, null, thread, { nudge: null, alsoSeeing: [], reply: true });
    const data = JSON.parse(messages[1].content.replace(/^[^\n]*\n/, ""));
    expect(data.you_already_made_a_plan).toBe("It's a date. Bring the stopwatch.");
    expect(messages[0].content).toMatch(/PURPOSE/);
    expect(messages[0].content).toMatch(/that plan is settled: don't propose or confirm it again/);
  });
});

describe("writeCritiquedText: one revision, never a lost text", () => {
  const model = (outputs: string[]) => {
    const calls: ChatMessage[][] = [];
    const m: Model = { async complete(messages) { calls.push(messages); const next = outputs.shift(); if (next === undefined) throw new Error("out"); return next; } };
    return { m, calls };
  };
  const parse = (raw: string) => { try { return JSON.parse(raw).text as string; } catch { return null; } };
  const flagFirst = (text: string) => (text.startsWith("Hello good looking") ? "you've started a text that way before" : null);

  it("sends a flagged text back once and keeps the revision", async () => {
    const { m, calls } = model([JSON.stringify({ text: "Hello good looking, again." }), JSON.stringify({ text: "Did the archway survive the night?" })]);
    expect((await writeCritiquedText(m, [{ role: "user", content: "x" }], parse, flagFirst, "test")).text).toBe("Did the archway survive the night?");
    expect(calls[1].at(-1)?.content).toMatch(/^Revise that text:/);
  });

  it("keeps the first draft when the revision doesn't parse", async () => {
    const { m } = model([JSON.stringify({ text: "Hello good looking, again." }), "not json"]);
    expect((await writeCritiquedText(m, [{ role: "user", content: "x" }], parse, flagFirst, "test")).text).toBe("Hello good looking, again.");
  });

  it("costs one call when nothing's flagged", async () => {
    const { m, calls } = model([JSON.stringify({ text: "Morning. How's the stopwatch?" })]);
    expect((await writeCritiquedText(m, [{ role: "user", content: "x" }], parse, flagFirst, "test")).text).toBe("Morning. How's the stopwatch?");
    expect(calls).toHaveLength(1);
  });

  it("says why there's no text: the model's last refusal, or none when it answered without one, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refusing: Model = { async complete() { throw new ModelError("Google: out of credit. Top up.", 429); } };
    const none = await writeCritiquedText(refusing, [{ role: "user", content: "x" }], parse, flagFirst, "test");
    expect(none).toEqual({ text: null, error: expect.objectContaining({ message: "Google: out of credit. Top up.", status: 429 }) });
    const { m } = model(["not json", "still not"]);
    expect(await writeCritiquedText(m, [{ role: "user", content: "x" }], parse, flagFirst, "test")).toEqual({ text: null, error: null });
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["[test] no text after two tries: Google: out of credit. Top up.", "[test] no text after two tries: the replies had no text in them"]);
    warn.mockRestore();
  });
});

describe("the morning after runs the critic too", () => {
  it("a repeated opener in the afterglow goes back once", async () => {
    const side = (s: typeof CHUD): SideSetup => ({ sheet: s, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_funny", note: null, gameBudget: 25 });
    const input: DateInput = { a: side(CHUD), b: side(NELL) };
    const outcome = fixedEngine({ ending: "second_date" }).decide(input, 1);
    const outputs = [
      JSON.stringify({ text: "Hello good looking. Still thinking about the spare keys." }),
      JSON.stringify({ text: "The spare keys are still in my pocket." }),
      JSON.stringify({ text: "Hello good looking. Meet me by the east wing." }), // flagged: repeated opener
      JSON.stringify({ text: "So what does a conservator do on a day off?" }), // the revision
    ];
    const calls: ChatMessage[][] = [];
    const m: Model = { async complete(messages) { calls.push(messages); const next = outputs.shift(); if (next === undefined) throw new Error("out"); return next; } };
    const thread = await simulateAfterglow(m, input, outcome, [chud, nell], "rainy_campsite", "classic", 3);
    expect(thread.map((t) => t.text)).toEqual([
      "Hello good looking. Still thinking about the spare keys.",
      "The spare keys are still in my pocket.",
      "So what does a conservator do on a day off?",
    ]);
    expect((calls[3].at(-1) as Any).content).toMatch(/^Revise that text:/);
  });
});
