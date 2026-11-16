/**
 * The turn (lib/date-turn.ts, EARNED_ENDINGS): a rules plan for a date that ends badly, or "just friends", carries the
 * moment the ending comes from, in the middle of the date; a date that ends well may carry a wobble that is met. It is
 * built from each side's own material only, placed by the date's planned length, and it never touches what the engine
 * decided. Both switch states. No paid calls: a model that answers each prompt from the prompt alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { rulesPlan, type DatePlan, type DateTurn } from "@/lib/beats";
import type { Character } from "@/lib/character";
import { buildTurnMessages } from "@/lib/conversation";
import { EARNED_ENDINGS_DEFAULT, earnedEndingsOn, turnFor, turnNote, turnStart, withTurn } from "@/lib/date-turn";
import { fixedEngine, type Outcome, type SideOutcome } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import type { ChatMessage } from "@/lib/model";
import { generateDate, type GenerateOptions } from "@/lib/pipeline";
import { agenda } from "@/lib/rules";
import type { Heard, StoryState } from "@/lib/story-state";
import { planJson } from "./helpers";
import { promptModel } from "./prompt-model";

const classic = EVAL_CASES.find((x) => x.id === "rafe-juniper")!;
const speed = EVAL_CASES.find((x) => x.format === "speed_date")!;
const side = (over: Partial<SideOutcome> = {}): SideOutcome => ({ wants_another: false, agenda_met: true, satisfied: false, dealbreaker_hit: null, want_met: null, note_followed: null, ...over });

/** A date with the outcome forced, deep-frozen: anything that tried to write to it would throw. */
function date(ending: Outcome["ending"], sides: [SideOutcome, SideOutcome], c = classic, over: Partial<Outcome> = {}) {
  const built = buildEvalDate(c);
  const decided = fixedEngine({ ending, sides, ...over }).decide(built.input, built.seed);
  const freeze = <T>(o: T): T => {
    if (o && typeof o === "object") for (const v of Object.values(o)) freeze(v);
    return Object.freeze(o);
  };
  return { built, decided: freeze(decided), characters: built.characters as [Character, Character] };
}

const heardOf = (me: Character, them: Character, claim: string, by: string | null): StoryState => {
  const h: Heard = { id: "h1", holder_id: me.id, about_id: them.id, about_name: them.name, about_b_id: null, about_b_name: null, claim, told_by: by ? "teller" : null, told_by_name: by, source: "test", is_true: true, heard_at: "2026-11-15T00:00:00Z", used_at: null, used_in: null };
  return { holder_id: me.id, with_id: them.id, opinions: [], heard: [h], want: null };
};

const notesFor = (t: DateTurn, s: "a" | "b"): string => [...t.steps.filter((x) => x.side === s).map((x) => x.note), t.after?.[s] ?? ""].join(" ");
const dataOf = (messages: ChatMessage[]): Record<string, unknown> => {
  const user = messages.find((m) => m.role === "user")!.content;
  return JSON.parse(user.slice(user.indexOf("\n") + 1));
};

afterEach(() => vi.unstubAllEnvs());

describe("the switch", () => {
  it("EARNED_ENDINGS: 1 on, 0 off, the default otherwise", () => {
    expect(earnedEndingsOn({ EARNED_ENDINGS: "1" })).toBe(true);
    expect(earnedEndingsOn({ EARNED_ENDINGS: "0" })).toBe(false);
    expect(earnedEndingsOn({})).toBe(EARNED_ENDINGS_DEFAULT);
    expect(earnedEndingsOn({ EARNED_ENDINGS: " 1 " })).toBe(true);
  });
});

describe("which turn a date gets", () => {
  it("a disaster with a missed agenda: its owner makes the opening, the other fails it, the owner takes it, and both cool after", () => {
    const { built, decided, characters } = date("disaster", [side(), side({ agenda_met: false })]);
    const t = turnFor(built.input, decided, characters)!;
    expect(t.kind).toBe("agenda");
    expect(t.on).toBe("b");
    expect(t.steps.map((s) => s.side)).toEqual(["b", "a", "b"]);
    expect(t.after!.b).toContain("you've cooled toward them");
    expect(t.after!.a).toContain("the ease between you has gone");
    expect(t.steps[2].note).toContain("Don't laugh it off");
  });

  it("both agendas missed: the side the drama names as put off is the one it lands on", () => {
    const sides: [SideOutcome, SideOutcome] = [side({ agenda_met: false }), side({ agenda_met: false })];
    const leaves = date("disaster", sides, classic, { drama_question: "leaves_first", drama_answer: "a" });
    expect(turnFor(leaves.built.input, leaves.decided, leaves.characters)!.on).toBe("a");
    // Turned down: the one who does the turning down is the one put off.
    const rejected = date("disaster", sides, classic, { drama_question: "rejected", drama_answer: "a" });
    expect(turnFor(rejected.built.input, rejected.decided, rejected.characters)!.on).toBe("b");
  });

  it("a tripped dealbreaker comes first: its owner reacts to its own dealbreaker, and the other is never told what it is", () => {
    const { built, decided, characters } = date("disaster", [side({ dealbreaker_hit: "loud", agenda_met: false }), side()]);
    const t = turnFor(built.input, decided, characters)!;
    expect(t.kind).toBe("dealbreaker");
    expect(t.on).toBe("a");
    expect(t.steps.map((s) => s.side)).toEqual(["b", "a", "b"]);
    expect(notesFor(t, "a")).toContain(characters[0].dealbreaker);
    expect(notesFor(t, "b")).not.toContain(characters[0].dealbreaker);
    expect(notesFor(t, "b")).not.toContain("loud");
  });

  it("something heard about the other is raised to their face, with who said it; the other's note never carries the claim", () => {
    const { built, decided, characters } = date("disaster", [side(), side()]);
    characters[1].story = heardOf(characters[1], characters[0], "Rafe rehearses his toasts in the mirror.", "Sable Quist");
    const t = turnFor(built.input, decided, characters)!;
    expect(t.kind).toBe("heard");
    expect(t.on).toBe("b");
    expect(t.steps[0]).toMatchObject({ side: "b" });
    expect(t.steps[0].note).toContain("what Sable told you about them");
    expect(t.steps[0].note).toContain("Rafe rehearses his toasts in the mirror.");
    expect(t.steps[0].note).toContain('put 1 in "brought_up"');
    expect(notesFor(t, "a")).not.toContain("mirror");
    expect(notesFor(t, "a")).not.toContain("Sable");
    // Something already brought up on an earlier date isn't raised again: the date turns on something else.
    characters[1].story!.heard[0].used_at = "2026-11-14T00:00:00Z";
    expect(turnFor(built.input, decided, characters)!.kind).not.toBe("heard");
  });

  it("two opinions that collide: each says its own, and neither note carries the other's", () => {
    const { built, decided, characters } = date("disaster", [side(), side()]);
    characters[0].hotTakes = ["Pineapple belongs on every pizza."];
    characters[1].hotTakes = ["Pineapple ruins a pizza."];
    const t = turnFor(built.input, decided, characters)!;
    expect(t.kind).toBe("takes");
    const [mine, theirs] = t.on === "a" ? (["a", "b"] as const) : (["b", "a"] as const);
    expect(notesFor(t, "a")).toContain("belongs on every pizza");
    expect(notesFor(t, "a")).not.toContain("ruins a pizza");
    expect(notesFor(t, "b")).toContain("ruins a pizza");
    expect(notesFor(t, "b")).not.toContain("belongs on every pizza");
    expect(t.steps.map((s) => s.side)).toEqual([theirs, mine, theirs]);
  });

  it("with nothing else in the facts, a disaster turns on a want that went unmet: its owner tests for it", () => {
    const { built, decided, characters } = date("disaster", [side(), side()]);
    const t = turnFor(built.input, decided, characters)!;
    expect(t.kind).toBe("want");
    const on = t.on === "a" ? 0 : 1;
    expect(notesFor(t, t.on)).toContain(characters[on].persona.want);
    expect(notesFor(t, t.on === "a" ? "b" : "a")).not.toContain(characters[on].persona.want);
    // A want the engine says WAS met is never the reason: the other side's is.
    const met = date("disaster", [side({ want_met: "maps" }), side()]);
    expect(turnFor(met.built.input, met.decided, met.characters)!.on).toBe("b");
  });

  it('"just friends": a missed agenda lands lightly; with none, one says a friend\'s line and both hear it; nobody cools', () => {
    const friends = (o: Partial<SideOutcome> = {}) => side({ wants_another: true, satisfied: true, ...o });
    const missed = date("friends", [friends(), friends({ agenda_met: false })]);
    const t = turnFor(missed.built.input, missed.decided, missed.characters)!;
    expect(t.kind).toBe("agenda");
    expect(t.steps[2].note).toContain("this isn't a romance");
    expect(t.after!.a).toContain("this is a friendship, not a romance");
    expect(JSON.stringify(t)).not.toContain("cooled toward them");

    const none = date("friends", [friends(), friends()]);
    const f = turnFor(none.built.input, none.decided, none.characters)!;
    expect(f.kind).toBe("friends");
    expect(f.steps).toHaveLength(2);
    expect(f.steps[0].side).not.toBe(f.steps[1].side);
    expect(f.steps[0].note).toContain("only say to a friend");
  });

  it("a date that ends well: no turn, unless an agenda missed, and then a wobble that is met and let go (nothing after it)", () => {
    const keen = (o: Partial<SideOutcome> = {}) => side({ wants_another: true, satisfied: true, ...o });
    const good = date("second_date", [keen(), keen()]);
    expect(turnFor(good.built.input, good.decided, good.characters)).toBeNull();
    const wobbly = date("second_date", [keen({ agenda_met: false }), keen()]);
    const w = turnFor(wobbly.built.input, wobbly.decided, wobbly.characters)!;
    expect(w.kind).toBe("wobble");
    expect(w.steps.map((s) => s.side)).toEqual(["a", "b", "a", "b", "a"]);
    expect(w.after).toBeUndefined();
    expect(w.steps[4].note).toContain("Let the doubt go");
  });

  it("no note ever carries the other side's private words: its want, its dealbreaker, its secret agenda", () => {
    const outcomes: [Outcome["ending"], [SideOutcome, SideOutcome]][] = [
      ["disaster", [side({ agenda_met: false }), side({ agenda_met: false })]],
      ["disaster", [side(), side()]],
      ["disaster", [side({ dealbreaker_hit: "x" }), side({ dealbreaker_hit: "y" })]],
      ["friends", [side({ wants_another: true, agenda_met: false }), side({ wants_another: true })]],
      ["friends", [side({ wants_another: true }), side({ wants_another: true })]],
      ["second_date", [side({ wants_another: true }), side({ wants_another: true, agenda_met: false })]],
    ];
    for (const c of EVAL_CASES) {
      for (const [ending, sides] of outcomes) {
        const d = date(ending, sides, c);
        const t = turnFor(d.built.input, d.decided, d.characters)!;
        for (const s of [0, 1] as const) {
          const mine = notesFor(t, s === 0 ? "a" : "b");
          const them = d.characters[s === 0 ? 1 : 0];
          const theirSetup = s === 0 ? d.built.input.b : d.built.input.a;
          // (A one-word want like the thin fixture's "fun" is inside ordinary words; a phrase is what could leak.)
          for (const secret of [them.persona.want, them.dealbreaker, agenda(theirSetup.agendaId).label]) {
            if (secret.trim().includes(" ")) expect(mine).not.toContain(secret);
          }
        }
      }
    }
  });
});

describe("where the turn sits", () => {
  const three = (first: "a" | "b"): DateTurn => ({ kind: "agenda", on: first, steps: [{ side: first, note: "one" }, { side: first === "a" ? "b" : "a", note: "two" }, { side: first, note: "three" }], after: { a: "after a", b: "after b" } });
  const five = (first: "a" | "b"): DateTurn => ({ kind: "wobble", on: first, steps: ["1", "2", "3", "4", "5"].map((note, i) => ({ side: (i % 2 === 0) === (first === "a") ? "a" : "b", note })) as DateTurn["steps"] });

  it("a third of the way in, on its first speaker's line, never the opening line and never the last", () => {
    // Twelve lines: a speaks the even lines. A's turn starts on line 5 (index 4), B's on line 6.
    expect(turnStart(three("a"), 12)).toBe(4);
    expect(turnStart(three("b"), 12)).toBe(5);
    // A speed date's six lines: it still fits, with a line left after it.
    expect(turnStart(three("a"), 6)).toBe(2);
    expect(turnStart(three("b"), 6)).toBe(1);
    for (const total of [6, 8, 12, 16, 20, 28]) {
      for (const first of ["a", "b"] as const) {
        const at = turnStart(three(first), total)!;
        expect(at).toBeGreaterThan(0);
        expect(at % 2).toBe(first === "a" ? 0 : 1);
        // The moment is over with at least one line to go: the ending never arrives on the last line.
        expect(at + 3).toBeLessThanOrEqual(total - 1);
        // And it is in the first half of the date, so the rest can cool.
        expect(at).toBeLessThan(total / 2);
      }
    }
  });

  it("a wobble needs room to be met before the goodbye: a date too short for it has none", () => {
    expect(turnStart(five("a"), 12)).toBe(4);
    expect(turnStart(five("b"), 12)).toBe(5);
    expect(turnStart(five("a"), 6)).toBeNull();
    expect(turnNote(five("a"), 3, 6, "a")).toEqual({});
  });

  it("each line gets its own note and nothing else: nothing before, the speaker's on the moment, where it left them after", () => {
    const t = three("b");
    expect(turnNote(undefined, 6, 12, "a")).toEqual({});
    expect(turnNote(t, 4, 12, "a")).toEqual({});
    expect(turnNote(t, 5, 12, "b")).toEqual({ this_moment: "one" });
    expect(turnNote(t, 6, 12, "a")).toEqual({ this_moment: "two" });
    expect(turnNote(t, 7, 12, "b")).toEqual({ this_moment: "three" });
    expect(turnNote(t, 8, 12, "a")).toEqual({ since_then: "after a" });
    expect(turnNote(t, 11, 12, "b")).toEqual({ since_then: "after b" });
    // A line the date gained by moving somewhere else is still after it.
    expect(turnNote(t, 15, 12, "b")).toEqual({ since_then: "after b" });
    // A wobble leaves nothing behind.
    expect(turnNote(five("a"), 9, 12, "b")).toEqual({});
  });
});

describe("the plan and the prompt", () => {
  it("withTurn adds the turn to a rules plan, drops the vague version of the same behaviour, and leaves the outcome alone", () => {
    const { built, decided, characters } = date("disaster", [side(), side({ agenda_met: false })]);
    const before = structuredClone(decided);
    const plain = rulesPlan(built.input, decided, characters, built.setup.producer, built.setup.venue);
    expect(plain.turn).toBeUndefined();
    expect(plain.acts[1].a).toContain("At some point this act, you");
    const plan = withTurn(plain, built.input, decided, characters);
    expect(plan.turn?.kind).toBe("agenda");
    // A does the thing that fails B's agenda on one line now, so its act beat no longer also asks for it "at some point".
    expect(plan.acts[1].a).not.toContain("At some point this act, you");
    expect(plan.acts[1].b).toBe(plain.acts[1].b);
    expect(plan.acts[0]).toEqual(plain.acts[0]);
    expect(plan.acts[2]).toEqual(plain.acts[2]);
    // The engine's decision: read, never written (it is frozen, and it is what it was).
    expect(decided).toEqual(before);
  });

  it("the actor is handed its note on its line of the moment, in the middle of the date, and how to read it; a plan without a turn is prompted exactly as before", () => {
    const { built, decided, characters } = date("disaster", [side(), side({ agenda_met: false })]);
    const plain = rulesPlan(built.input, decided, characters, built.setup.producer, built.setup.venue);
    const plan = withTurn(plain, built.input, decided, characters);
    const at = turnStart(plan.turn!, 12)!;
    const said = (n: number) => Array.from({ length: n }, (_, i) => ({ side: i % 2 === 0 ? ("a" as const) : ("b" as const), act: 0, dialogue: `Line ${i}.`, action: "", emotion: "easy", interest: 0.5 }));
    const prompt = (p: DatePlan, i: number) => buildTurnMessages(built.input, decided, characters, built.setup.producer, built.setup.venue, said(i), i, "classic", {}, { plan: p, totalTurns: 12 }).messages;

    // The opening line: no note yet, but the system prompt says how to read one.
    expect(dataOf(prompt(plan, 0))).not.toHaveProperty("this_moment");
    expect(prompt(plan, 0)[0].content).toContain("THE MOMENT IT TURNS");
    // The moment: B opens it, A fails it, B takes it. Each sees its own note only.
    expect(dataOf(prompt(plan, at)).this_moment).toBe(plan.turn!.steps[0].note);
    expect(dataOf(prompt(plan, at + 1)).this_moment).toBe(plan.turn!.steps[1].note);
    expect(dataOf(prompt(plan, at + 2)).this_moment).toBe(plan.turn!.steps[2].note);
    expect(JSON.stringify(dataOf(prompt(plan, at + 1)))).not.toContain(plan.turn!.steps[0].note);
    // Every line after: where it left that side, to the last line.
    expect(dataOf(prompt(plan, at + 3)).since_then).toBe(plan.turn!.after!.a);
    expect(dataOf(prompt(plan, 10)).since_then).toBe(plan.turn!.after!.a);
    expect(dataOf(prompt(plan, 11)).since_then).toBe(plan.turn!.after!.b);
    expect(dataOf(prompt(plan, 11))).not.toHaveProperty("this_moment");

    // Without a turn (the switch off, a director's plan, a night plan): no section, no blocks, on any line.
    for (let i = 0; i < 12; i++) {
      const m = prompt(plain, i);
      expect(m[0].content).not.toContain("THE MOMENT IT TURNS");
      expect(dataOf(m)).not.toHaveProperty("this_moment");
      expect(dataOf(m)).not.toHaveProperty("since_then");
    }
  });
});

describe("generateDate: both switch states", () => {
  const options = (over: Partial<GenerateOptions> = {}): GenerateOptions => ({ formatId: classic.format, formatCtx: {}, conversation: true, afterglow: false, reflection: false, plan: "rules", ...over });
  /** Each line's prompt data, by line (a line the critic sent back is asked twice with the same data: once here). */
  const lineData = (model: ReturnType<typeof promptModel>) => {
    const byLine = new Map<number, Record<string, unknown>>();
    for (const x of model.seen.filter((y) => y.kind === "line")) {
      const d = dataOf(x.messages);
      const n = (d.conversation_so_far as unknown[]).length;
      if (!byLine.has(n)) byLine.set(n, d);
    }
    return [...byLine.entries()].sort((p, q) => p[0] - q[0]).map(([, d]) => d);
  };

  it("on: a date decided as a disaster plays from a rules plan with the turn, mid-date, and ends exactly as the engine decided", async () => {
    vi.stubEnv("EARNED_ENDINGS", "1");
    const { built, decided } = date("disaster", [side(), side({ agenda_met: false })]);
    const before = structuredClone(decided);
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options());
    expect(gen.plan?.source).toBe("rules");
    expect(gen.plan?.turn?.kind).toBe("agenda");
    // No call was added for it: no plan call, and as many line calls as the same date makes with the switch off.
    expect(model.count("plan")).toBe(0);
    vi.stubEnv("EARNED_ENDINGS", "0");
    const plainModel = promptModel();
    await generateDate({ actor: plainModel, director: plainModel }, built, decided, options());
    expect(model.seen.length).toBe(plainModel.seen.length);
    const lines = lineData(model);
    const moment = lines.flatMap((d, i) => ("this_moment" in d ? [i] : []));
    expect(moment).toEqual([5, 6, 7]);
    expect(lines.slice(8).every((d) => "since_then" in d)).toBe(true);
    // The engine's ending, untouched: the same object's worth of facts, the same ending on the date.
    expect(decided).toEqual(before);
    expect(gen.outcome).toEqual(before);
    expect(gen.outcome.ending).toBe("disaster");
  });

  it("off: the rules plan and every prompt are what they were", async () => {
    vi.stubEnv("EARNED_ENDINGS", "0");
    const { built, decided } = date("disaster", [side(), side({ agenda_met: false })]);
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options());
    expect(gen.plan).toEqual(rulesPlan(built.input, decided, built.characters, built.setup.producer, built.setup.venue));
    expect(gen.plan?.turn).toBeUndefined();
    expect(lineData(model).some((d) => "this_moment" in d || "since_then" in d)).toBe(false);
    expect(model.seen.some((x) => x.messages[0].content.includes("THE MOMENT IT TURNS"))).toBe(false);
    expect(gen.outcome).toEqual(decided);
  });

  it("the same lines and the same ending with the switch on or off (the model answers from the lines so far)", async () => {
    const run = async (v: "0" | "1") => {
      vi.stubEnv("EARNED_ENDINGS", v);
      const { built, decided } = date("disaster", [side(), side({ agenda_met: false })]);
      return generateDate({ actor: promptModel(), director: promptModel() }, built, decided, options());
    };
    const off = await run("0");
    const on = await run("1");
    expect(on.transcript.map((l) => l.dialogue)).toEqual(off.transcript.map((l) => l.dialogue));
    expect(on.outcome).toEqual(off.outcome);
  });

  it("on: a plan somebody else wrote (the producer's at night, the director's) is left as written", async () => {
    vi.stubEnv("EARNED_ENDINGS", "1");
    const { built, decided } = date("disaster", [side(), side({ agenda_met: false })]);
    const { parsePlan } = await import("@/lib/beats");
    const stored = parsePlan(planJson(), built.input, decided, built.characters, built.setup.producer, built.setup.venue, { source: "producer" })!;
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ plan: stored }));
    expect(gen.plan?.source).toBe("producer");
    expect(gen.plan?.turn).toBeUndefined();
    expect(lineData(model).some((d) => "this_moment" in d)).toBe(false);
  });

  it("on: a speed date's six lines still turn before the last one", async () => {
    vi.stubEnv("EARNED_ENDINGS", "1");
    const { built, decided } = date("disaster", [side(), side({ agenda_met: false })], speed);
    const model = promptModel();
    await generateDate({ actor: model, director: model }, built, decided, options({ formatId: "speed_date" }));
    const lines = lineData(model);
    expect(lines).toHaveLength(6);
    const moment = lines.flatMap((d, i) => ("this_moment" in d ? [i] : []));
    expect(moment).toEqual([1, 2, 3]);
    expect("since_then" in lines[5]).toBe(true);
  });

  it("the characters' own answers still weigh in as they did (engine v5): the turn changes no rule of theirs", async () => {
    vi.stubEnv("EARNED_ENDINGS", "1");
    const built = buildEvalDate(classic);
    // A real decision (with its score), not a forced one, so applyChoices has its rules to apply.
    const { deterministicEngine } = await import("@/lib/engine");
    const { applyChoices } = await import("@/lib/choices");
    const decided = deterministicEngine.decide(built.input, built.seed, 5 as never);
    const before = structuredClone(decided);
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ wishes: true, engineVersion: 5 }));
    expect(decided).toEqual(before);
    // Whatever the answers were, the ending is the one applyChoices gives for them: nothing else moved it.
    const { a, b } = gen.inner!.choices!;
    expect(gen.outcome).toEqual(applyChoices(decided, { a: a!, b: b! }, 5));
  });
});
