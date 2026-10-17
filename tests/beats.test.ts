import { describe, expect, it } from "vitest";
import { buildAfterglowMessages } from "@/lib/afterglow";
import { carriesPrivate, dateFacts, parsePlan, planDate, rulesPlan, temperament } from "@/lib/beats";
import { apparentAge, assembleCharacter, characterBlindView, type Character } from "@/lib/character";
import type { Turn } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import type { ChatMessage, Model } from "@/lib/model";
import { generateDate } from "@/lib/pipeline";
import { transcriptQuality } from "@/lib/quality";
import { CONVERSATION_TURNS, ENDING_LABELS } from "@/lib/rules";
import { anchorBestLine, buildMessages } from "@/lib/showrunner";
import type { StoredSoul } from "@/lib/souls";
import { episodeJson, planJson, validEpisodeDraft } from "./helpers";

const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer of Tuesday cities", traits: ["curious", "warm", "stubborn"], want: "a map reader", dealbreaker: "hates surprises", house: false, pronouns: "she/her" };
const sheetB: CharacterSheet = { name: "Rafe", age: 34, bio: "a baker who opens only when it rains", traits: ["dramatic", "kind", "competitive"], want: "an honest taste-tester", dealbreaker: "calling cake just sugar", house: true, pronouns: "he/him" };
const soul = (marker: string): StoredSoul => ({ values: `honesty ${marker}`, insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const side = (sheet: CharacterSheet, agendaId: SideSetup["agendaId"], note: string | null = null): SideSetup => ({
  sheet, signals: { warmth: 0.7, openness: 0.5, guardedness: 0.2, humor: 0.8 }, autonomy: "balanced", strategy: "genuine_chemistry", agendaId, note, gameBudget: 25,
});
const INPUT: DateInput = { a: side(sheetA, "find_adventurous", "NOTEFROMOWNER be brave"), b: side(sheetB, "test_sincerity") };
const so = (o: Partial<SideOutcome>): SideOutcome => ({ wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null, ...o });
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "a", sheet: sheetA, soul: soul("ALPHASOUL"), memory: null }),
  assembleCharacter({ id: "b", sheet: sheetB, soul: soul("BETASOUL"), memory: null }),
];
const outcome = (o: Partial<Outcome> & { ending: Outcome["ending"] }): Outcome => fixedEngine(o).decide(INPUT, 1);

describe("rulesPlan — the engine's reasons, act by act", () => {
  it("stages a met want and a tripped dealbreaker on both sides, and lands the ending only in the last act", () => {
    const o = outcome({
      ending: "disaster",
      drama_question: "rejected",
      drama_answer: "b",
      sides: [so({ dealbreaker_hit: "dramatic", wants_another: false, satisfied: false }), so({ want_met: "curious", wants_another: false })],
    });
    const plan = rulesPlan(INPUT, o, CHARS, "a_dare", "rooftop_bar");
    expect(plan.source).toBe("rules");
    // Act 2: Mira's dealbreaker is tripped (in her own words), and Rafe shows a side that doesn't sit well with her.
    expect(plan.acts[1].a).toContain(`("${sheetA.dealbreaker}")`);
    expect(plan.acts[1].b).toMatch(/a side of yourself that doesn't sit well with them/);
    // Rafe's want is met (his own want, quoted), and Mira's side of it lands well with him.
    expect(plan.acts[1].b).toContain(`what you were hoping for ("${sheetB.want}")`);
    expect(plan.acts[1].a).toMatch(/lands well with them/);
    // The engine's cue words (matches between the two sheets) never cross sides (run 3).
    expect(plan.acts[1].a).not.toMatch(/"curious"|"dramatic"/);
    expect(plan.acts[1].b).not.toMatch(/"curious"|"dramatic"/);
    // The ending and the drama (Mira turns Rafe down) land in the last act only.
    expect(plan.acts[0].scene + plan.acts[1].scene).not.toContain(ENDING_LABELS.disaster);
    expect(plan.acts[2].scene).toContain(ENDING_LABELS.disaster);
    expect(plan.acts[2].a).toMatch(/you're the one who turns them down/);
    expect(plan.acts[2].b).toMatch(/They turn you down/);
  });

  it("plays the creator's note the way the engine decided (taken or ignored), and the engine's surprises", () => {
    const taken = rulesPlan(INPUT, outcome({ ending: "friends", sides: [so({ note_followed: true }), so({})] }), CHARS, "a_dare", "rooftop_bar");
    expect(taken.acts[1].a).toMatch(/act on it/);
    const ignored = rulesPlan(INPUT, outcome({ ending: "friends", sides: [so({ note_followed: false }), so({})] }), CHARS, "a_dare", "rooftop_bar");
    expect(ignored.acts[1].a).toMatch(/decide to ignore it/);
    const surprise = rulesPlan(INPUT, outcome({ ending: "disaster", sides: [so({ wants_another: true }), so({ wants_another: false })] }), CHARS, "a_dare", "rooftop_bar");
    expect(surprise.acts[2].a).toMatch(/against your better judgement/);
  });

  it("makes every ending legible: 'just friends' plays platonic, never as a second date", () => {
    const friends = rulesPlan(INPUT, outcome({ ending: "friends", sides: [so({ wants_another: true }), so({ wants_another: false })] }), CHARS, "a_dare", "rooftop_bar");
    expect(friends.acts[2].scene).toMatch(/no romance/);
    expect(friends.acts[2].a).toMatch(/as a friend/);
    expect(friends.acts[2].a).toMatch(/nothing about your goodbye is romantic/);
    expect(friends.acts[2].a).toMatch(/don't announce it/);
    expect(friends.acts[2].a).not.toMatch(/maybe more/);
    expect(friends.acts[2].b).toMatch(/won't be chasing a second date/);
    // Act two already leans that way, so the last act lands it instead of flipping.
    expect(friends.acts[1].scene).toMatch(/they find they get on/);
    expect(friends.acts[1].a).toMatch(/no romantic spark/);
    const disaster = rulesPlan(INPUT, outcome({ ending: "disaster", sides: [so({ wants_another: false }), so({ wants_another: false })] }), CHARS, "a_dare", "rooftop_bar");
    expect(disaster.acts[2].a).toMatch(/clear why/);
  });

  it("stages each secret goal's moment as something the OTHER side does, without naming the goal", () => {
    // Mira (a) is out to find someone adventurous; Rafe (b) is testing sincerity.
    const met = rulesPlan(INPUT, outcome({ ending: "friends", sides: [so({ agenda_met: true }), so({ agenda_met: false })] }), CHARS, "a_dare", "rooftop_bar");
    expect(met.acts[1].b).toMatch(/you say yes to a spontaneous idea/); // Mira's goal pays off through Rafe
    expect(met.acts[1].a).toMatch(/you dodge a real question with a bit/); // Rafe's test fails through Mira
    expect(met.acts[1].b).not.toMatch(/adventur/);
    const facts = dateFacts(INPUT, outcome({ ending: "friends", sides: [so({ agenda_met: true }), so({ agenda_met: false })] }), CHARS).join(" ");
    expect(facts).toContain("the moment is when Rafe says yes to a spontaneous idea");
    expect(facts).toContain("the moment is when Mira dodges a real question with a bit");
    expect(facts).toContain("Rafe would happily see Mira again, as a friend, not a date");
  });

  it("an exit follows from the date, never a sudden excuse", () => {
    const o = outcome({ ending: "friends", drama_question: "leaves_first", drama_answer: "a", sides: [so({}), so({})] });
    expect(rulesPlan(INPUT, o, CHARS, "a_dare", "rooftop_bar").acts[2].a).toMatch(/never a sudden excuse/);
  });

  it("never puts one side's private data into the other side's beats", () => {
    const plan = rulesPlan(INPUT, outcome({ ending: "friends", sides: [so({}), so({})] }), CHARS, "a_dare", "rooftop_bar");
    const aBeats = plan.acts.map((x) => x.a).join(" ");
    const bBeats = plan.acts.map((x) => x.b).join(" ");
    expect(bBeats).not.toContain("NOTEFROMOWNER");
    expect(bBeats).not.toMatch(/adventure/); // Mira's secret goal
    expect(aBeats).not.toMatch(/mean what they say/); // Rafe's secret goal
  });

  it("describes a temperament in words, and a blank one as unremarkable", () => {
    expect(temperament({ warmth: 0.8, openness: 0.1, guardedness: 0.7, humor: 0.9 })).toBe("warm, quick to joke, set in your ways, slow to let anyone in");
    expect(temperament(NEUTRAL_SIGNALS)).toBe("even-keeled");
  });

  it("lists the facts the director plans from", () => {
    const facts = dateFacts(INPUT, outcome({ ending: "second_date", sides: [so({ want_met: "kind" }), so({})] }), CHARS).join(" ");
    expect(facts).toContain(ENDING_LABELS.second_date);
    expect(facts).toContain(`Mira's hope for the date is met by Rafe's "kind" side`);
  });
});

describe("the director's plan — parsed, and privacy enforced deterministically", () => {
  const o = outcome({ ending: "friends", sides: [so({}), so({})] });
  const plan = (a: string, b: string, scene = "They meet over a soggy menu.") =>
    JSON.stringify({ spine: "A storm and a stubborn map.", acts: [0, 1, 2].map(() => ({ scene, a, b })) });

  it("accepts a valid plan", () => {
    const p = parsePlan(plan("You draw a map on a napkin.", "You offer a taste of the rain bread."), INPUT, o, CHARS, "a_dare", "rooftop_bar");
    expect(p?.source).toBe("director");
    expect(p?.acts[0].a).toBe("You draw a map on a napkin.");
  });

  it("drops a side's beats that carry the OTHER side's private words, keeping the rest", () => {
    // Rafe's beat leaks Mira's secret goal phrasing and her owner's note.
    const p = parsePlan(plan("You draw a map on a napkin.", "You sense she wants to find out whether you're up for an adventure — NOTEFROMOWNER be brave."), INPUT, o, CHARS, "a_dare", "rooftop_bar");
    const rules = rulesPlan(INPUT, o, CHARS, "a_dare", "rooftop_bar");
    expect(p?.acts.map((x) => x.b)).toEqual(rules.acts.map((x) => x.b));
    expect(p?.acts[0].a).toBe("You draw a map on a napkin.");
    expect(carriesPrivate("she hates surprises, obviously", ["hates surprises"])).toBe(true);
  });

  it("drops scenes that carry anyone's private words (both agents see the scene)", () => {
    const p = parsePlan(plan("You laugh.", "You laugh.", "Mira, who hates surprises, gets one."), INPUT, o, CHARS, "a_dare", "rooftop_bar");
    expect(p?.acts[0].scene).not.toMatch(/hates surprises/);
  });

  it("rejects malformed or unsafe plans, and planDate falls back to the rules", async () => {
    expect(parsePlan("not json", INPUT, o, CHARS, "a_dare", "rooftop_bar")).toBeNull();
    expect(parsePlan(JSON.stringify({ spine: "x", acts: [] }), INPUT, o, CHARS, "a_dare", "rooftop_bar")).toBeNull();
    const down: Model = { async complete() { throw new Error("503"); } };
    expect((await planDate(down, INPUT, o, CHARS, "a_dare", "rooftop_bar", "classic", {})).source).toBe("rules");
  });
});

describe("the recap, written from the date that happened", () => {
  const transcript: Turn[] = [
    { side: "a", act: 0, dialogue: "You bake only when it rains? That's either genius or a weather problem.", action: "", emotion: "", interest: 0.6 },
    { side: "b", act: 0, dialogue: "Genius. Obviously. The rain is my sous-chef.", action: "", emotion: "", interest: 0.9 },
  ];
  const o = outcome({ ending: "friends", sides: [so({}), so({})] });

  it("gives the narrator the lines and the plan's spine", () => {
    const text = buildMessages(INPUT, o, CHARS, "a_dare", "rooftop_bar", "classic", {}, { transcript, plan: { ...rulesPlan(INPUT, o, CHARS, "a_dare", "rooftop_bar"), spine: "SPINEMARK" } })
      .map((m: ChatMessage) => m.content).join("\n");
    expect(text).toContain("The rain is my sous-chef.");
    expect(text).toContain("SPINEMARK");
  });

  it("keeps a best line that was really said, and replaces an invented one with the date's best real line", () => {
    const real = anchorBestLine({ ...validEpisodeDraft(), best_line: "The rain is my sous-chef." } as never, transcript);
    expect(real.best_line).toBe("The rain is my sous-chef.");
    const invented = anchorBestLine({ ...validEpisodeDraft(), best_line: "A line nobody said." } as never, transcript);
    expect(invented.best_line).toBe("Genius. Obviously. The rain is my sous-chef.");
  });
});

describe("the afterglow remembers the date", () => {
  it("each texter sees what was said and how it ended — and still only its own private notes", () => {
    const o = outcome({ ending: "second_date", sides: [so({}), so({})] });
    const date: Turn[] = [{ side: "b", act: 0, dialogue: "The rain is my sous-chef.", action: "", emotion: "", interest: 0.9 }];
    const text = buildAfterglowMessages(INPUT, o, CHARS, "rooftop_bar", "classic", [], 0, {}, date).messages.map((m) => m.content).join("\n");
    expect(text).toContain("The rain is my sous-chef.");
    expect(text).toContain(ENDING_LABELS.second_date);
    expect(text).toContain("ALPHASOUL");
    expect(text).not.toContain("BETASOUL");
    expect(text).not.toContain("a baker who opens only when it rains"); // his bio stays his to tell
  });
});

describe("the pipeline — plan, conversation, then the recap", () => {
  function scripted(outputs: string[]) {
    const queue = [...outputs];
    const seen: ChatMessage[][] = [];
    const model: Model = { async complete(m) { seen.push(m); const next = queue.shift(); if (next === undefined) throw new Error("out"); return next; } };
    return { model, seen };
  }
  const turn = (i: number) => JSON.stringify({ dialogue: `Line ${i}: tell me something true about you.`, action: "asks", emotion: "curious", interest_signal: 0.5 });

  it("asks the director first, plays the turns from the plan, and narrates last from the transcript", async () => {
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const built = buildEvalDate(c);
    const o = fixedEngine({ ending: "friends" }).decide(built.input, built.seed);
    const { model, seen } = scripted([planJson(), ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turn(i)), episodeJson()]);
    const gen = await generateDate({ actor: model, director: model }, built, o, { formatId: "classic", formatCtx: {}, conversation: true, afterglow: false, reflection: false });
    expect(gen.plan?.source).toBe("director");
    expect(gen.transcript).toHaveLength(CONVERSATION_TURNS);
    expect(seen[0][0].content).toMatch(/story editor/); // the director's prompt
    expect(seen.at(-1)![1].content).toMatch(/the_date_as_it_happened/); // the recap sees the lines
    expect(gen.quality?.turns).toBe(CONVERSATION_TURNS);
    expect(gen.modelCalls).toBe(CONVERSATION_TURNS + 2);
  });

  it("a director that's down costs nothing: the rules plan, and the recap on the actor's model", async () => {
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const built = buildEvalDate(c);
    const o = fixedEngine({ ending: "friends" }).decide(built.input, built.seed);
    const down: Model = { async complete() { throw new Error("HTTP 503"); } };
    const { model } = scripted([...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turn(i)), episodeJson()]);
    const gen = await generateDate({ actor: model, director: down }, built, o, { formatId: "classic", formatCtx: {}, conversation: true, afterglow: false, reflection: false });
    expect(gen.plan?.source).toBe("rules");
    expect(gen.transcript).toHaveLength(CONVERSATION_TURNS);
    expect(gen.draft.setting).toBeTruthy();
  });
});

describe("blind view + the self-quote check", () => {
  it("shows the other as a blind date meets them, never 'teens'", () => {
    const view = JSON.stringify(characterBlindView(CHARS[1]));
    expect(view).toContain("Rafe");
    expect(view).toContain("he/him");
    expect(view).not.toContain("baker");
    expect(apparentAge(18)).toBe("about twenty");
    expect(apparentAge(34)).toBe("mid thirties");
    expect(apparentAge(500)).toMatch(/hard to place/);
  });

  it("flags a character reciting its own private notes", () => {
    const t: Turn[] = [{ side: "b", act: 1, dialogue: "Careful — calling cake just sugar is how you lose me.", action: "", emotion: "", interest: 0.5 }];
    expect(transcriptQuality(t, CHARS).self_quotes).toBe(1);
  });
});
