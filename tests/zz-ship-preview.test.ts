import { describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { shipNames, shipPair } from "@/lib/ship-names";

// The ship name generator (lib/ship-names.ts) over every pair of the house cast's first names: a wide sample of real
// inputs, checked for what any visitor would notice. (The acceptance tests are in ship-name-generator.test.ts.)
const firstNames = [...new Set(HOUSE_CHARACTERS.map((c) => c.name.split(" ")[0]))];
const pairs = firstNames.flatMap((a, i) => firstNames.slice(i + 1).map((b) => [a, b] as const));
const hasVowel = (name: string) => /[aeiou]/i.test(name.normalize("NFD"));

describe("ship names across the house cast", () => {
  it("has pairs to check", () => {
    expect(pairs.length).toBeGreaterThan(20);
  });

  it("gives every pair at least 5 ship names, each with a real vowel, none a copy of either name", () => {
    for (const [a, b] of pairs) {
      const pair = shipPair(a, b);
      expect(pair.ok, `${a} × ${b}`).toBe(true);
      const names = shipNames(a, b).map((n) => n.name);
      expect(names.length, `${a} × ${b}`).toBeGreaterThanOrEqual(5);
      for (const n of names) {
        expect(hasVowel(n), `${a} × ${b}: ${n}`).toBe(true);
        expect([a.toLowerCase(), b.toLowerCase()]).not.toContain(n.toLowerCase());
      }
    }
  });

  it("never leads with a name that piles up three consonants", () => {
    for (const [a, b] of pairs) {
      const [top] = shipNames(a, b);
      expect(/[bcdfghjklmnpqrstvwxz]{3}/i.test(top.name), `${a} × ${b}: ${top.name}`).toBe(false);
    }
  });

  it("is the same list whichever way the pair is typed in case, and every run", () => {
    for (const [a, b] of pairs.slice(0, 10)) {
      expect(shipNames(a.toUpperCase(), b.toLowerCase())).toEqual(shipNames(a, b));
    }
  });
});
