import { describe, expect, it } from "vitest";
import { pairSigns, rings, signedTriads, type RingTie, type SignedTie } from "@/lib/social/algorithms";

// The pure algorithms behind a character's world and the sky's tense triangles (lib/social/algorithms.ts,
// docs/PRDs/social-network.md sections 7 and 9), on small graphs with known answers.

/** A seeded generator in [0, 1) (32-bit LCG), so every run draws the same graphs and orders. */
const random = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};
const shuffled = <T>(xs: readonly T[], seed = 7): T[] => {
  const out = [...xs];
  const next = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

describe("rings", () => {
  const inner = (other: string, closeness: number): RingTie => ({ other, closeness, ring: "inner" });

  it("fills from the centre, closest first: five in the inner circle, ten more close, then friends and acquaintances", () => {
    const ties = Array.from({ length: 160 }, (_, i) => inner(`p${String(i).padStart(3, "0")}`, 1 - i / 200));
    const r = rings(shuffled(ties));
    expect(r.inner).toEqual(["p000", "p001", "p002", "p003", "p004"]);
    expect(r.close).toHaveLength(10);
    expect(r.close[0]).toBe("p005");
    expect(r.friends).toHaveLength(35);
    expect(r.acquaintances).toHaveLength(100);
    expect(r.beyond).toEqual(Array.from({ length: 10 }, (_, i) => `p${150 + i}`));
  });

  it("keeps each to the innermost ring its ties allow, however close, and takes their closest tie", () => {
    const r = rings([
      { other: "boss", closeness: 0.99, ring: "friends" }, // a coworker is at most a friend
      { other: "rival", closeness: 0.9, ring: "acquaintances" },
      { other: "bff", closeness: 0.4, ring: "friends" },
      { other: "bff", closeness: 0.85, ring: "inner" }, // coworkers and best friends: the best friend wins
      inner("mum", 0.7),
    ]);
    expect(r).toEqual({ inner: ["bff", "mum"], close: [], friends: ["boss"], acquaintances: ["rival"], beyond: [] });
  });

  it("a new best friend pushes the least close down a ring; ties at the same closeness go by id", () => {
    const five = ["a", "b", "c", "d", "e"].map((id, i) => inner(id, 0.9 - i / 100));
    expect(rings(five).inner).toEqual(["a", "b", "c", "d", "e"]);
    const six = rings([...five, inner("new", 0.95)]);
    expect(six.inner).toEqual(["new", "a", "b", "c", "d"]);
    expect(six.close).toEqual(["e"]);
    expect(rings([inner("z", 0.5), inner("y", 0.5), inner("x", 0.5)]).inner).toEqual(["x", "y", "z"]);
  });

  it("takes other caps, and skips what it can't place", () => {
    const r = rings([inner("a", 0.9), inner("b", 0.8), inner("c", 0.7), inner("d", 0.6), inner("e", 0.5), { other: "", closeness: 1, ring: "inner" }], {
      inner: 1,
      close: 2,
      friends: 3,
      acquaintances: 4,
    });
    expect(r).toEqual({ inner: ["a"], close: ["b"], friends: ["c"], acquaintances: ["d"], beyond: ["e"] });
    expect(rings([])).toEqual({ inner: [], close: [], friends: [], acquaintances: [], beyond: [] });
  });
});

describe("signedTriads", () => {
  const tie = (from: string, to: string, valence: number): SignedTie => ({ from, to, valence });

  it("a triangle is balanced when its signs multiply to positive", () => {
    const census = (ab: number, ac: number, bc: number) => signedTriads([tie("a", "b", ab), tie("a", "c", ac), tie("b", "c", bc)]);
    expect(census(1, 2, 1)).toEqual({ balanced: 1, unbalanced: 0, triads: [{ ids: ["a", "b", "c"], signs: [1, 1, 1], balanced: true }] });
    // Two friends who share a rival: balanced. Two of my friends are rivals: not. Three rivals: not.
    expect(census(1, -1, -2)).toMatchObject({ balanced: 1, unbalanced: 0 });
    expect(census(1, 1, -1)).toEqual({ balanced: 0, unbalanced: 1, triads: [{ ids: ["a", "b", "c"], signs: [1, 1, -1], balanced: false }] });
    expect(census(-1, -1, -1)).toMatchObject({ balanced: 0, unbalanced: 1 });
  });

  it("a pair's ties add up: a friend who's also a rival nets out and makes no triangle; direction doesn't matter", () => {
    const base = [tie("a", "b", 1), tie("b", "c", 1)];
    expect(signedTriads([...base, tie("a", "c", 1), tie("c", "a", -1)])).toMatchObject({ balanced: 0, unbalanced: 0, triads: [] });
    expect(signedTriads([...base, tie("c", "a", 2), tie("a", "c", -1)])).toMatchObject({ balanced: 1, unbalanced: 0 });
    // Neutral ties (exes, people who just met), self-loops and empty ends don't count.
    expect(signedTriads([...base, tie("a", "c", 0), tie("a", "a", 1), tie("", "c", 1)])).toMatchObject({ balanced: 0, unbalanced: 0 });
    expect(pairSigns([tie("b", "a", -2), tie("a", "b", 1)]).get("a")?.get("b")).toBe(-1);
  });

  it("A dating B while B's best friend is A's rival: unbalanced, listed before the balanced ones", () => {
    const census = signedTriads([
      tie("ada", "bea", 1), // dating
      tie("bea", "cal", 2), // best friends
      tie("ada", "cal", -1), // rivals
      tie("bea", "dee", 1),
      tie("cal", "dee", 1),
    ]);
    expect(census.balanced).toBe(1);
    expect(census.unbalanced).toBe(1);
    expect(census.triads.map((x) => [x.ids.join(" "), x.balanced])).toEqual([
      ["ada bea cal", false],
      ["bea cal dee", true],
    ]);
    expect(signedTriads([tie("ada", "bea", 1), tie("bea", "cal", 2), tie("ada", "cal", -1), tie("bea", "dee", 1), tie("cal", "dee", 1)], { limit: 1 }).triads).toHaveLength(1);
  });

  it("counts every triangle once, the same whatever order the ties come in (checked against brute force)", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const ties: SignedTie[] = [];
    const next = random(42);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (next() < 0.3) ties.push(tie(ids[i], ids[j], next() < 0.7 ? 1 : -1));
    const sign = new Map(ties.map((x) => [`${x.from}|${x.to}`, x.valence]));
    let balanced = 0;
    let unbalanced = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        for (let k = j + 1; k < ids.length; k++) {
          const [x, y, z] = [sign.get(`${ids[i]}|${ids[j]}`), sign.get(`${ids[i]}|${ids[k]}`), sign.get(`${ids[j]}|${ids[k]}`)];
          if (x === undefined || y === undefined || z === undefined) continue;
          if (x * y * z > 0) balanced++;
          else unbalanced++;
        }
    expect(balanced + unbalanced).toBeGreaterThan(50);
    const census = signedTriads(ties, { limit: 1000 });
    expect({ balanced: census.balanced, unbalanced: census.unbalanced }).toEqual({ balanced, unbalanced });
    expect(census.triads).toHaveLength(balanced + unbalanced);
    expect(signedTriads(shuffled(ties, 99).map((x) => (next() < 0.5 ? x : tie(x.to, x.from, x.valence))), { limit: 1000 })).toEqual(census);
    // K4, all friends: four triangles.
    const k4 = ["a", "b", "c", "d"].flatMap((x, i, all) => all.slice(i + 1).map((y) => tie(x, y, 1)));
    expect(signedTriads(k4)).toMatchObject({ balanced: 4, unbalanced: 0 });
  });
});
