import { describe, expect, it } from "vitest";
import { chemistryTest, FRIENDS_SCORE, SECOND_DATE_SCORE, type ChemistrySheet } from "@/lib/chemistry";
import { ENDINGS } from "@/lib/rules";

// The OC chemistry test (lib/chemistry.ts) over a sweep of generated pairs: every result well-formed, the same in either
// order, and the score's band always the ending's. (The acceptance tests are in oc-chemistry-test.test.ts.)

const TRAITS = ["curious", "stubborn", "witty", "bold", "warm", "funny", "shy", "loyal", "guarded", "kind", "cold", "playful", "dramatic", "gentle", "reckless", "sarcastic", "anxious", "calm", "chaotic", "grumpy"];
const WANTS = ["a long walk somewhere new", "someone who cooks", "someone curious", "a good argument", "someone funny and kind", "a quiet night in"];
const DEALBREAKERS = ["pineapple on pizza", "tardiness", "people who chew loudly", "someone cold", "anyone reckless", "liars"];

function sweep(): [ChemistrySheet, ChemistrySheet][] {
  const pairs: [ChemistrySheet, ChemistrySheet][] = [];
  const n = TRAITS.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j += 3) {
      const a: ChemistrySheet = { name: "Wren Ash", age: null, traits: [TRAITS[i], TRAITS[(i + 3) % n], TRAITS[(i + 7) % n]], want: WANTS[i % WANTS.length], dealbreaker: DEALBREAKERS[j % DEALBREAKERS.length] };
      const b: ChemistrySheet = { name: "Teo Marsh", age: 41, traits: [TRAITS[j], TRAITS[(j + 5) % n], TRAITS[(j + 11) % n]], want: WANTS[(i + j) % WANTS.length], dealbreaker: DEALBREAKERS[(i + 1) % DEALBREAKERS.length] };
      pairs.push([a, b]);
    }
  }
  return pairs;
}

describe("the OC chemistry test over a sweep of generated pairs", () => {
  it("always gives a whole score from 0 to 100 in its ending's band, and three distinct one-line reasons", () => {
    for (const [a, b] of sweep()) {
      const r = chemistryTest(a, b);
      const what = `${a.traits.join("/")} × ${b.traits.join("/")}`;
      expect(Number.isInteger(r.score), what).toBe(true);
      expect(ENDINGS, what).toContain(r.ending);
      const band = r.score < FRIENDS_SCORE ? "disaster" : r.score < SECOND_DATE_SCORE ? "friends" : "second_date";
      expect(band, `${what}: ${r.score} for ${r.ending}`).toBe(r.ending);
      expect(new Set(r.reasons).size, what).toBe(3);
      for (const reason of r.reasons) {
        expect(reason, what).not.toMatch(/\n/);
        expect(reason.length, what).toBeLessThanOrEqual(160);
      }
    }
  });

  it("gives the same result in either order, and on every run", () => {
    for (const [a, b] of sweep()) {
      const r = chemistryTest(a, b);
      const swapped = chemistryTest(b, a);
      expect({ score: swapped.score, ending: swapped.ending }).toEqual({ score: r.score, ending: r.ending });
      expect(chemistryTest(a, b)).toEqual(r);
    }
  });

  it("reaches every ending across the sweep", () => {
    const seen = new Set(sweep().map(([a, b]) => chemistryTest(a, b).ending));
    expect([...seen].sort()).toEqual([...ENDINGS].sort());
  });
});
