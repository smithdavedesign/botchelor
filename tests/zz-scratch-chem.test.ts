import { describe, expect, it } from "vitest";
import { chemistryTest, SCORE_BANDS, type OcSheet } from "@/lib/chemistry-test";
import { cues } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ENDINGS } from "@/lib/rules";

// The OC chemistry test (lib/chemistry-test.ts) over every pair of the house cast's real sheets: what any visitor
// would notice if it went wrong. (The acceptance tests are in oc-chemistry-test.test.ts.)
const CAST: OcSheet[] = HOUSE_CHARACTERS.map((c) => ({ name: c.name, traits: [c.traits[0], c.traits[1], c.traits[2]], want: c.want, dealbreaker: c.dealbreaker }));
const PAIRS = CAST.flatMap((a, i) => CAST.filter((_, j) => j !== i).map((b) => [a, b] as const));
const namesTrait = (self: OcSheet, other: OcSheet) => other.traits.some((t) => [...cues(t)].some((w) => cues(self.dealbreaker).has(w)));

describe("the chemistry test over every pair of the house cast", () => {
  it("answers every pair the same both ways round, inside its ending's band, with three distinct, tidy reasons", () => {
    expect(PAIRS.length).toBeGreaterThan(20);
    for (const [a, b] of PAIRS) {
      const label = `${a.name} × ${b.name}`;
      const result = chemistryTest(a, b);
      const swapped = chemistryTest(b, a);
      expect([swapped.score, swapped.ending], label).toEqual([result.score, result.ending]);
      const [lo, hi] = SCORE_BANDS[result.ending];
      expect(result.score, label).toBeGreaterThanOrEqual(lo);
      expect(result.score, label).toBeLessThanOrEqual(hi);
      expect(new Set(result.reasons).size, label).toBe(3);
      for (const reason of result.reasons) {
        expect(reason, label).toMatch(/^[A-Z“].*\.$/);
        expect(reason, label).not.toMatch(/undefined|null|NaN|\s{2}|“”/);
        expect(reason.length, label).toBeLessThanOrEqual(120);
      }
      if (namesTrait(a, b) || namesTrait(b, a)) expect(result.ending, label).toBe("disaster");
    }
  });

  it("spreads the cast across all three endings, and across the scale", () => {
    const results = PAIRS.map(([a, b]) => chemistryTest(a, b));
    const counts = Object.fromEntries(ENDINGS.map((e) => [e, results.filter((r) => r.ending === e).length]));
    for (const ending of ENDINGS) expect(counts[ending], JSON.stringify(counts)).toBeGreaterThan(0);
    const scores = results.map((r) => r.score);
    expect(Math.min(...scores)).toBeLessThan(SCORE_BANDS.friends[0]);
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(SCORE_BANDS.second_date[0]);
    expect(Math.max(...scores)).toBeLessThan(100); // the house cast is good, not perfect: the scale has headroom
  });
});
