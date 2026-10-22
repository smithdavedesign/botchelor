import { describe, expect, it } from "vitest";
import { guardTotals, nightLines, scoreNight } from "../scripts/sim-after-dark.mjs";

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
