import { describe, expect, it } from "vitest";
import { armLabel, guardTotals, nightLines, NEW_CHARACTER, parseArms, parseCharacter, parsePenalties, parseSteers, scoreNight } from "../scripts/sim-after-dark.mjs";

// The After Dark model simulation's scoring (scripts/sim-after-dark.mjs): pure functions over what a run saved.
describe("the After Dark simulation's night", () => {
  const notes = {
    a: { id: "x", name: "Teodor Vance" },
    b: { id: "house-sable", name: "Sable Quist" },
    current: {
      chapter: 2,
      lines: [{ who: "a" as const, text: "Still here.", why: "He wants her to know the night isn't over for him.", memory: null }],
      steps: [{ id: "s3", flags: { actions_cut: 1, held: 0 }, dropped: [{}] }],
    },
    nights: [
      {
        chapter: 1,
        lines: [
          { who: "b" as const, text: "Your place?", why: "the moment", memory: null },
          { who: "a" as const, text: "Mine.", why: "He says yes the only way he knows, in one word.", memory: "F1" },
        ],
        // The same step listed under the chapter and the running scene counts once.
        steps: [{ id: "s1", flags: { actions_cut: 2 }, dropped: [] }, { id: "s3", flags: { actions_cut: 1, held: 0 }, dropped: [{}] }],
      },
    ],
  };

  it("reads the lines in order: the saved chapters, then the running scene", () => {
    expect(nightLines(notes).map((l) => [l.chapter, l.text])).toEqual([
      [1, "Your place?"],
      [1, "Mine."],
      [2, "Still here."],
    ]);
    expect(nightLines(null)).toEqual([]);
  });

  it("sums what the guards did across the steps, each step once", () => {
    expect(guardTotals(notes)).toMatchObject({ actions_cut: 3, held: 0, dropped_lines: 1 });
  });

  it("scores a clean night high and a broken one low, part by part", () => {
    const clean = {
      lines: 120,
      findings: [],
      summary: {
        drift: { a: { sheet_detail_rate: 0.6, cliche_rate: 0, question_ending_share: 0.1, hook: { share: 0.1 } }, b: { sheet_detail_rate: 0.7, cliche_rate: 0, question_ending_share: 0.2 } },
        share_memory: 0.3,
        unfounded_memories: 0,
        sensory_detail_share: 0.2,
        verbatim_repeats: 0,
        near_repeats: 0,
        unprovoked_moves: 0,
        limit_overridden: 0,
        wrong_pronouns: 0,
      },
    };
    const steps = Array.from({ length: 20 }, (_, i) => ({ step: i + 1, added: 6, stage: Math.min(4, Math.floor(i / 4)) }));
    const good = Array.from({ length: 120 }, () => ({ chapter: 1, who: "a" as const, text: "…", why: "Because she said the thing about the kiln first." }));
    expect(scoreNight(clean, steps, good).score).toBe(100);
    const broken = {
      lines: 40,
      findings: [{ check: "limit_overridden" }],
      summary: { drift: { a: { sheet_detail_rate: 0.1, cliche_rate: 8, question_ending_share: 0.6, hook: { share: 0.5 } } }, share_memory: 0, unfounded_memories: 4, verbatim_repeats: 5, unprovoked_moves: 3, wrong_pronouns: 3 },
    };
    const failing = [...Array.from({ length: 6 }, (_, i) => ({ step: i + 1, error: "no lines" })), { step: 7, added: 1, stage: 1 }];
    const r = scoreNight(broken, failing, [{ chapter: 1, who: "a" as const, text: "…", why: "the moment" }]);
    expect(r.score).toBeLessThan(10);
    expect(r.breakdown.safety_limit_overridden).toEqual({ value: 1, points: 2.5, of: 5 });
  });
});

// A night replayed from a file (--steers), another character (--character), and each model's hosts (--models a@x+y).
describe("the After Dark simulation's inputs", () => {
  it("reads a night's steps in order, one a step, each with its mode", () => {
    const plan = parseSteers([
      { scenario: "elevator" },
      { direction: 'He says "Stay a while."', mode: "direct" },
      { direction: "They slow down.", mode: "nudge" },
      { direction: "Something from their first date comes back." },
      { set_scene: "her flat" },
      {},
    ]);
    expect(plan.steps).toEqual([
      { kind: "scenario", scenario: "elevator" },
      { kind: "write", direction: 'He says "Stay a while."', mode: "direct" },
      { kind: "write", direction: "They slow down.", mode: "nudge" },
      { kind: "write", direction: "Something from their first date comes back.", mode: "nudge" },
      { kind: "set_scene", place: "her flat" },
      { kind: "write", direction: null, mode: null },
    ]);
    expect(plan.turnOns).toEqual({ character: [], partner: [] });
  });

  it("takes each one's turn-ons from the object form", () => {
    const plan = parseSteers({ turn_ons: { character: ["slow_dancing"], partner: [" praise "] }, steers: [{}] });
    expect(plan.turnOns).toEqual({ character: ["slow_dancing"], partner: ["praise"] });
    expect(plan.steps).toHaveLength(1);
  });

  it("refuses a file it can't replay faithfully", () => {
    expect(() => parseSteers({ steps: [] })).toThrow(/array of steps/);
    expect(() => parseSteers(["go on"])).toThrow(/step 1: an object/);
    expect(() => parseSteers([{ direction: "x", set_scene: "y" }])).toThrow(/step 1: one of direction, set_scene or scenario/);
    expect(() => parseSteers([{}, { direction: "x", mode: "shove" }])).toThrow(/step 2: mode is direct or nudge/);
    expect(() => parseSteers([{ mode: "direct" }])).toThrow(/a mode goes with a direction/);
    expect(() => parseSteers([{ direction: "  " }])).toThrow(/direction is text/);
    expect(() => parseSteers([{ whisper: "x" }])).toThrow(/unknown whisper/);
    expect(() => parseSteers({ turn_ons: { partner: "praise" }, steers: [] })).toThrow(/turn_ons.partner/);
  });

  it("gives each model the hosts it names, else the run's own ADULT_TEXT_PROVIDERS, else none (the app's list)", () => {
    expect(parseArms("deepseek/deepseek-chat-v3.1@coreweave+deepinfra, cognitivecomputations/dolphin-mistral-24b-venice-edition@Venice")).toEqual([
      { model: "deepseek/deepseek-chat-v3.1", hosts: ["coreweave", "deepinfra"] },
      { model: "cognitivecomputations/dolphin-mistral-24b-venice-edition", hosts: ["venice"] },
    ]);
    expect(parseArms("a/b,c/d@x", "coreweave, deepinfra")).toEqual([
      { model: "a/b", hosts: ["coreweave", "deepinfra"] },
      { model: "c/d", hosts: ["x"] },
    ]);
    // The default run: no hosts anywhere, so every model keeps the app's reviewed two.
    expect(parseArms("cognitivecomputations/dolphin-mistral-24b-venice-edition,deepseek/deepseek-chat-v3.1", undefined).map((a) => a.hosts)).toEqual([null, null]);
  });

  it("runs a local: model on this machine's Ollama, with no OpenRouter hosts", () => {
    expect(parseArms("local:tiger-gemma-12b, z-ai/glm-4.7", "deepinfra")).toEqual([
      { model: "local:tiger-gemma-12b", local: "tiger-gemma-12b", hosts: null },
      { model: "z-ai/glm-4.7", hosts: ["deepinfra"] },
    ]);
  });

  it("gives each model its own penalties in --models' order, the app's own where a place is empty, and names them in the key", () => {
    expect(parsePenalties("0.3,0", 2)).toEqual([0.3, 0]);
    expect(parsePenalties(",0", 2)).toEqual([null, 0]);
    expect(parsePenalties("", 2)).toEqual([null, null]);
    expect(parsePenalties(undefined, 1)).toEqual([null]);
    expect(() => parsePenalties("0,0,0", 2)).toThrow(/3 values for 2 models/);
    expect(() => parsePenalties("lots", 1)).toThrow(/isn't a number from -2 to 2/);
    expect(() => parsePenalties("3", 1)).toThrow(/from -2 to 2/);
    // The same model twice reads as two runs in the key.
    expect(armLabel({ model: "deepseek/deepseek-chat-v3.1", hosts: ["coreweave", "deepinfra"], penalty: 0 })).toBe("deepseek/deepseek-chat-v3.1 (penalties 0) @ coreweave, deepinfra");
    expect(armLabel({ model: "deepseek/deepseek-chat-v3.1", hosts: null, penalty: null })).toBe("deepseek/deepseek-chat-v3.1");
  });

  it("takes another character in NEW_CHARACTER's shape, and names what a save is missing", () => {
    expect(parseCharacter(NEW_CHARACTER)).toBe(NEW_CHARACTER);
    expect(() => parseCharacter({ name: "Only a name" })).toThrow(/needs age, bio, traits, want, dealbreaker/);
    expect(() => parseCharacter([NEW_CHARACTER])).toThrow(/a JSON object/);
  });
});
