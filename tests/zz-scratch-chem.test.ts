import { describe, expect, it } from "vitest";
import { chemistryTest, SCORE_BANDS, type TestSheet } from "@/lib/chemistry-test";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ENDINGS } from "@/lib/rules";

// The OC chemistry test (lib/chemistry-test.ts) over every ordered pair of the house cast: a wide sample of real sheets,
// checked for what any visitor would notice. (The acceptance tests are in oc-chemistry-test.test.ts.)
const cast: TestSheet[] = HOUSE_CHARACTERS.map((c) => ({ name: c.name, traits: [...c.traits] as [string, string, string], want: c.want, dealbreaker: c.dealbreaker }));
const pairs = cast.flatMap((a) => cast.filter((b) => b !== a).map((b) => [a, b] as const));

describe("the chemistry test across the house cast", () => {
  it("has pairs to check", () => {
    expect(pairs.length).toBeGreaterThan(100);
  });

  it("gives every ending a real share, so the test isn't a foregone conclusion", () => {
    const counts = Object.fromEntries(ENDINGS.map((e) => [e, 0])) as Record<string, number>;
    for (const [a, b] of pairs) counts[chemistryTest(a, b).ending]++;
    for (const e of ENDINGS) expect(counts[e] / pairs.length, e).toBeGreaterThan(0.15);
  });

  it("gives every pair three distinct one-line reasons that name only these two", () => {
    const others = HOUSE_CHARACTERS.map((c) => c.name.split(" ")[0]);
    for (const [a, b] of pairs) {
      const r = chemistryTest(a, b);
      const label = `${a.name} × ${b.name}`;
      expect(new Set(r.reasons).size, label).toBe(3);
      const [lo, hi] = SCORE_BANDS[r.ending];
      expect(r.score >= lo && r.score <= hi, label).toBe(true);
      for (const line of r.reasons) {
        expect(line.length, `${label}: ${line}`).toBeLessThanOrEqual(140);
        expect(line, label).not.toMatch(/\n|undefined|null|NaN/);
        for (const name of others) {
          if (name !== a.name.split(" ")[0] && name !== b.name.split(" ")[0]) expect(line, label).not.toContain(name);
        }
      }
      if (r.tripped.length) expect(r.reasons[0], label).toContain("dealbreaker goes off");
    }
  });

  it("comes out as GROWTH.md says (update both together)", () => {
    const counts = Object.fromEntries(ENDINGS.map((e) => [e, 0])) as Record<string, number>;
    const scores = pairs.map(([a, b]) => {
      const r = chemistryTest(a, b);
      counts[r.ending]++;
      return r.score;
    });
    expect({ pairs: pairs.length, ...counts, lowest: Math.min(...scores), highest: Math.max(...scores) }).toEqual({
      pairs: 210, second_date: 38, friends: 119, disaster: 53, lowest: 0, highest: 82,
    });
  });

  it("trips an 'out loud' dealbreaker on Sable's 'loud': the trait is named word for word", () => {
    const sable = cast.find((c) => c.name === "Sable Quist")!;
    for (const name of ["Marisol Pine", "Teo Brandt"]) {
      const other = cast.find((c) => c.name === name)!;
      expect(other.dealbreaker).toMatch(/out loud/);
      for (const [a, b] of [[other, sable], [sable, other]]) {
        const r = chemistryTest(a, b);
        expect(r.ending, `${a.name} × ${b.name}`).toBe("disaster");
        expect(r.reasons[0]).toBe(`${name.split(" ")[0]}'s dealbreaker goes off: Sable is “loud”, and that ends it.`);
      }
    }
  });

  it("explains a second date with what went right, and a disaster without a dealbreaker with what didn't", () => {
    for (const [a, b] of pairs) {
      const r = chemistryTest(a, b);
      if (r.ending === "disaster" && !r.tripped.length) {
        expect(r.reasons[0], `${a.name} × ${b.name}`).toMatch(/Neither|Nothing|slow to let|cool|Not enough/);
      }
      if (r.ending === "second_date") expect(r.reasons[0], `${a.name} × ${b.name}`).not.toMatch(/^(Neither|Nothing)/);
    }
  });
});
