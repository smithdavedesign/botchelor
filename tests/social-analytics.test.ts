import { describe, expect, it } from "vitest";
import {
  ALL_LAYERS,
  assortativity,
  averageDegree,
  betweenness,
  buildGraph,
  byId,
  clustering,
  communities,
  components,
  constraint,
  coreNumbers,
  decay,
  density,
  labelPropagation,
  layerDegrees,
  louvain,
  MIN_WEIGHT,
  modularity,
  pagerank,
  reciprocity,
  seeded,
  valences,
  type Graph,
  type Tie,
} from "@/lib/social/analytics";
import { KARATE_CLUB, KARATE_EDGES, KARATE_EXPECTED, KARATE_WEIGHTS, TOY_EXPECTED } from "./social-karate-fixture";

// lib/social/analytics.ts: the social network's graph analytics (docs/PRDs/social-network.md §5.5, §10). Each measure
// is checked against networkx 3.7's answers on Zachary's karate club and small graphs (tests/social-karate-fixture.ts),
// or against a graph small enough to count by hand.

/** Member i of the club, zero-padded so the graph's sorted ids keep the members' order. */
const member = (i: number) => `m${String(i).padStart(2, "0")}`;
const karate = (weighted = false): Graph =>
  buildGraph(KARATE_EDGES.map(([a, b], e) => ({ from: member(a), to: member(b), weight: weighted ? KARATE_WEIGHTS[e] : 1, layer: "friendship" })));

/** Every value within 1e-8 of networkx's (its answers are rounded to 10 places). */
function near(actual: ArrayLike<number>, expected: readonly number[], digits = 8) {
  expect(actual.length).toBe(expected.length);
  expected.forEach((x, i) => expect(actual[i], `at ${i}`).toBeCloseTo(x, digits));
}

const ties = (rows: [string, string, number?][], extra: Partial<Tie> = {}): Tie[] =>
  rows.map(([from, to, weight]) => ({ from, to, ...(weight === undefined ? {} : { weight }), ...extra }));

/** A shuffled copy, by a seeded draw. */
function shuffled<T>(xs: readonly T[], seed: string): T[] {
  const rand = seeded(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sum = (xs: ArrayLike<number>) => Array.from(xs).reduce((s, x) => s + x, 0);

describe("buildGraph", () => {
  const multiplex: Tie[] = [
    { from: "b", to: "a", weight: 0.5, layer: "work", kind: "coworker" },
    { from: "a", to: "b", weight: 0.3, valence: 0, layer: "romance", kind: "ex" },
    { from: "c", to: "a", weight: 0.8, valence: 2, directed: true, layer: "romance", kind: "crush" },
    { from: "c", to: "b", weight: 0.4, valence: -1, layer: "conflict", kind: "rival" },
  ];

  it("links a pair once whatever its layers, and the answer doesn't depend on the order the ties came in", () => {
    const g = buildGraph(multiplex);
    expect(g.ids).toEqual(["a", "b", "c"]);
    expect(g.pairs).toBe(3);
    // a–b combines the coworker and ex ties; a–c is the crush, linked though it's one-way.
    expect([...g.targets]).toEqual([1, 2, 0, 2, 0, 1]);
    expect(g.weights[0]).toBeCloseTo(0.8, 12);
    expect([...g.strength].map((x) => Math.round(x * 100) / 100)).toEqual([1.6, 1.2, 1.2]);
    expect(g.totalWeight).toBeCloseTo(2, 12);
    expect(g.layers).toEqual(["conflict", "romance", "work"]);
    expect(g.kinds).toEqual(["coworker", "crush", "ex", "rival"]);
    for (const seed of ["one", "two", "three"]) {
      const h = buildGraph(shuffled(multiplex, seed));
      expect([h.offsets, h.targets, h.weights, h.strength]).toEqual([g.offsets, g.targets, g.weights, g.strength]);
      expect(h.ties).toEqual(g.ties);
    }
    // A two-way tie is stored lower id first; the one-way crush keeps its direction.
    expect([...g.ties.from].map((i) => g.ids[i])).toEqual(["a", "a", "b", "c"]);
    expect([...g.ties.to].map((i) => g.ids[i])).toEqual(["b", "b", "c", "a"]);
  });

  it("combines a pair's ties by the strongest when asked", () => {
    const g = buildGraph(multiplex, { combine: "max" });
    expect(g.weights[0]).toBeCloseTo(0.5, 12); // a–b: the coworker tie outweighs the ex
    expect(byId(g, g.strength).get("a")).toBeCloseTo(0.5 + 0.8, 12);
  });

  it("keeps characters with no ties, drops ties to oneself, and gives every tie a weight", () => {
    const g = buildGraph(
      [
        { from: "a", to: "a" },
        { from: "a", to: "b", weight: 0 },
        { from: "b", to: "c", weight: Number.NaN, valence: Number.NaN },
        { from: "", to: "c" },
      ],
      { nodes: ["z", "a"] },
    );
    expect(g.ids).toEqual(["a", "b", "c", "z"]);
    expect(g.pairs).toBe(2);
    expect([...g.ties.weight]).toEqual([MIN_WEIGHT, 1]);
    expect([...g.ties.valence]).toEqual([1, 1]);
    expect(g.offsets[4] - g.offsets[3]).toBe(0);
  });
});

describe("pagerank", () => {
  it("matches networkx on the karate club, unweighted and weighted, and sums to 1", () => {
    const g = karate();
    near(pagerank(g, { weighted: false }), KARATE_EXPECTED.pagerank_unweighted);
    near(pagerank(g), KARATE_EXPECTED.pagerank_unweighted); // every weight 1
    near(pagerank(karate(true)), KARATE_EXPECTED.pagerank_weighted);
    expect(sum(pagerank(karate(true)))).toBeCloseTo(1, 12);
  });

  it("follows one-way ties by weight, and shares a node's rank with everyone when it has nowhere to go", () => {
    // a→b 1, b→c 2, c→a 1, a→c 0.5, d→c 1; e has no ties at all.
    const g = buildGraph(
      ties([["a", "b", 1], ["b", "c", 2], ["c", "a", 1], ["a", "c", 0.5], ["d", "c", 1]], { directed: true }),
      { nodes: ["e"] },
    );
    near(pagerank(g), Object.values(TOY_EXPECTED.directed_pagerank));
    // b is a sink: a→b, c→b, c→a.
    near(pagerank(buildGraph(ties([["a", "b"], ["c", "b"], ["c", "a"]], { directed: true }))), Object.values(TOY_EXPECTED.sink_pagerank));
  });

  it("is defined on the smallest graphs", () => {
    expect(pagerank(buildGraph([]))).toEqual(new Float64Array(0));
    expect([...pagerank(buildGraph([], { nodes: ["solo"] }))]).toEqual([1]);
  });
});

describe("betweenness", () => {
  it("matches networkx on the karate club, normalised and in raw pair counts", () => {
    near(betweenness(karate()), KARATE_EXPECTED.betweenness);
    near(betweenness(karate(), { normalized: false }), KARATE_EXPECTED.betweenness_raw);
  });

  it("counts the pairs a node sits between on a path, by hops whatever the weights", () => {
    const g = buildGraph(ties([["a", "b", 0.1], ["b", "c", 5], ["c", "d", 1]]));
    near(betweenness(g, { normalized: false }), [0, 2, 2, 0], 12);
    // Of the 3 pairs (in either order) that don't include b, b sits between 2.
    near(betweenness(g), [0, 2 / 3, 2 / 3, 0], 12);
  });

  it("samples seeded pivots above the exact size: reproducible, and scaled to the whole graph", () => {
    const g = karate();
    const exact = betweenness(g);
    const a = betweenness(g, { exactUpTo: 10, samples: 17, seed: "day-1" });
    expect(betweenness(g, { exactUpTo: 10, samples: 17, seed: "day-1" })).toEqual(a);
    expect(betweenness(g, { exactUpTo: 10, samples: 17, seed: "day-2" })).not.toEqual(a);
    // Half the members as pivots still finds the two leaders, and the estimate is on the same scale.
    const top2 = (xs: Float64Array) => [...xs].map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]).slice(0, 2).map(([, i]) => i).sort((p, q) => p - q);
    expect(top2(a)).toEqual([0, 33]);
    expect(sum(a) / sum(exact)).toBeGreaterThan(0.6);
    expect(sum(a) / sum(exact)).toBeLessThan(1.6);
    // As many samples as nodes is the exact answer.
    expect(betweenness(g, { exactUpTo: 10, samples: 34 })).toEqual(exact);
  });
});

describe("clustering", () => {
  it("matches networkx on the karate club: local, average and transitivity", () => {
    const c = clustering(karate());
    near(c.local, KARATE_EXPECTED.clustering);
    expect(c.average).toBeCloseTo(KARATE_EXPECTED.average_clustering, 9);
    expect(c.transitivity).toBeCloseTo(KARATE_EXPECTED.transitivity, 9);
    expect(c.triangles).toBe(45);
  });

  it("counts each triangle once: a triangle is fully clustered, a star not at all, four in a clique of four", () => {
    expect(clustering(buildGraph(ties([["a", "b"], ["b", "c"], ["a", "c"]])))).toMatchObject({ average: 1, transitivity: 1, triangles: 1 });
    const star = clustering(buildGraph(ties([["hub", "a"], ["hub", "b"], ["hub", "c"]])));
    expect([...star.local]).toEqual([0, 0, 0, 0]);
    expect(star.transitivity).toBe(0);
    const k4 = ties([["a", "b"], ["a", "c"], ["a", "d"], ["b", "c"], ["b", "d"], ["c", "d"]]);
    expect(clustering(buildGraph(k4)).triangles).toBe(4);
  });
});

describe("coreNumbers", () => {
  it("matches networkx on the karate club", () => {
    expect([...coreNumbers(karate())]).toEqual([...KARATE_EXPECTED.core]);
  });

  it("gives a clique of five its 4-core, a hanger-on 1, and a loner 0", () => {
    const k5 = ["a", "b", "c", "d", "e"];
    const g = buildGraph([...k5.flatMap((x, i) => k5.slice(i + 1).map((y) => ({ from: x, to: y }))), { from: "e", to: "f" }], { nodes: ["g"] });
    expect([...coreNumbers(g)]).toEqual([4, 4, 4, 4, 4, 1, 0]);
  });
});

describe("constraint", () => {
  it("matches networkx on the karate club, unweighted and weighted", () => {
    near(constraint(karate()), KARATE_EXPECTED.constraint);
    near(constraint(karate(true)), KARATE_EXPECTED.constraint_weighted);
  });

  it("is low for a broker, high inside a clique or on a single tie, and undefined alone", () => {
    near(constraint(buildGraph(ties([["a", "b", 2], ["a", "c", 1], ["b", "c", 1], ["c", "d", 3]]))), Object.values(TOY_EXPECTED.constraint_weighted));
    const g = buildGraph(ties([["hub", "a"], ["hub", "b"], ["hub", "c"], ["hub", "d"]]), { nodes: ["loner"] });
    const c = byId(g, constraint(g));
    expect(c.get("hub")).toBeCloseTo(1 / 4, 12);
    expect(c.get("a")).toBe(1);
    expect(c.get("loner")).toBeNaN();
    // A triangle: each tie is half your world, and half again through the third: (1/2 + 1/4)² twice.
    expect(constraint(buildGraph(ties([["a", "b"], ["b", "c"], ["a", "c"]])))[0]).toBeCloseTo(9 / 8, 12);
  });
});

describe("communities and modularity", () => {
  const club = KARATE_CLUB.map((c) => (c === "Mr. Hi" ? 0 : 1));
  /** Two cliques of four joined by one tie, and two who only know each other. */
  const twoCliques = (): Tie[] => {
    const clique = (xs: string[]) => xs.flatMap((x, i) => xs.slice(i + 1).map((y) => ({ from: x, to: y })));
    return [...clique(["a1", "a2", "a3", "a4"]), ...clique(["b1", "b2", "b3", "b4"]), { from: "a4", to: "b1" }, { from: "p", to: "q" }];
  };

  it("modularity matches networkx for the karate club's real split, unweighted and weighted, and a weighted toy", () => {
    expect(modularity(karate(), club)).toBeCloseTo(KARATE_EXPECTED.modularity_club, 9);
    expect(modularity(karate(true), club)).toBeCloseTo(KARATE_EXPECTED.modularity_club_weighted, 9);
    const toy = buildGraph(ties([["a", "b", 2], ["a", "c", 1], ["b", "c", 1], ["c", "d", 3]]));
    expect(modularity(toy, [0, 0, 1, 1])).toBeCloseTo(TOY_EXPECTED.modularity_weighted, 9);
    expect(modularity(buildGraph([], { nodes: ["a"] }), [0])).toBe(0);
  });

  it("Louvain splits the karate club about as well as it can be split", () => {
    const g = karate();
    const split = louvain(g);
    const q = modularity(g, split);
    expect(q).toBeGreaterThan(0.415);
    expect(q).toBeLessThanOrEqual(KARATE_EXPECTED.louvain_best_modularity_unweighted + 1e-9);
    expect(Math.max(...split) + 1).toBe(4);
    // The two leaders end up apart.
    expect(split[0]).not.toBe(split[33]);
  });

  it("both methods find two cliques joined by a tie, never join people with no path between them, and leave loners out", () => {
    const g = buildGraph(twoCliques(), { nodes: ["loner"] });
    const want = byId(g, louvain(g));
    for (const split of [louvain(g), labelPropagation(g, { seed: "x" }), communities(g).membership]) {
      const c = byId(g, split);
      expect(new Set(["a1", "a2", "a3", "a4"].map((x) => c.get(x))).size).toBe(1);
      expect(new Set(["b1", "b2", "b3", "b4"].map((x) => c.get(x))).size).toBe(1);
      expect(c.get("a1")).not.toBe(c.get("b1"));
      expect(c.get("p")).toBe(c.get("q"));
      expect(c.get("p")).not.toBe(c.get("a1"));
      expect(c.get("p")).not.toBe(c.get("b1"));
      expect(c.get("loner")).toBe(-1);
      expect(c).toEqual(want); // numbered by size, ties by the smallest member: the same numbers either way
    }
    expect(want.get("a1")).toBe(0);
    expect(want.get("b1")).toBe(1);
    expect(want.get("p")).toBe(2);
  });

  it("label propagation is reproducible for a seed whatever order the ties came in", () => {
    const rows = KARATE_EDGES.map(([a, b]) => ({ from: member(a), to: member(b) }));
    const a = labelPropagation(buildGraph(rows), { seed: "day-1" });
    expect(labelPropagation(buildGraph(shuffled(rows, "s")), { seed: "day-1" })).toEqual(a);
    expect(labelPropagation(buildGraph([...rows].reverse()), { seed: "day-1" })).toEqual(a);
    // Seeds differ: the classic method's weakness, and why communities() checks it against Louvain.
    const qs = new Set(["a", "b", "c", "d"].map((seed) => modularity(karate(), labelPropagation(karate(), { seed })).toFixed(6)));
    expect(qs.size).toBeGreaterThan(1);
  });

  it("communities() keeps the higher-modularity split and says which method made it", () => {
    for (const seed of ["a", "b", "c"]) {
      const g = karate();
      const c = communities(g, { seed });
      const best = Math.max(modularity(g, louvain(g)), modularity(g, labelPropagation(g, { seed })));
      expect(c.modularity).toBeCloseTo(best, 12);
      expect(c.modularity).toBeCloseTo(modularity(g, c.membership), 12);
      expect(c.count).toBe(Math.max(...c.membership) + 1);
      expect(["louvain", "label_propagation"]).toContain(c.method);
    }
    expect(communities(buildGraph([]))).toEqual({ membership: new Int32Array(0), count: 0, modularity: 0, method: "louvain" });
  });

  it("Louvain is the same whatever order the ties came in", () => {
    const rows = KARATE_EDGES.map(([a, b], e) => ({ from: member(b), to: member(a), weight: KARATE_WEIGHTS[e] }));
    expect(louvain(buildGraph(shuffled(rows, "t")))).toEqual(louvain(karate(true)));
  });
});

describe("reciprocity", () => {
  it("matches networkx on one-way ties, and ignores two-way ones", () => {
    const g = buildGraph([
      ...ties([["a", "b"], ["b", "a"], ["a", "c"], ["c", "d"], ["d", "c"], ["d", "e"]], { directed: true }),
      { from: "e", to: "f" },
    ]);
    const r = reciprocity(g);
    expect(r.overall).toBeCloseTo(TOY_EXPECTED.overall_reciprocity, 9);
    near(r.node.subarray(0, 5), Object.values(TOY_EXPECTED.node_reciprocity));
    expect(byId(g, r.node).get("f")).toBeNaN();
  });

  it("answers like with like: a crush returned is mutual, a crush met with a grudge is not", () => {
    const crush = { kind: "crush", layer: "romance", directed: true };
    expect(reciprocity(buildGraph([{ from: "a", to: "b", ...crush }, { from: "b", to: "a", ...crush }])).overall).toBe(1);
    const mixed = reciprocity(buildGraph([{ from: "a", to: "b", ...crush }, { from: "b", to: "a", kind: "grudge", layer: "conflict", directed: true }]));
    expect(mixed.overall).toBe(0);
    expect([...mixed.node]).toEqual([0, 0]);
    expect(reciprocity(buildGraph(ties([["a", "b"]]))).overall).toBeNaN();
  });
});

describe("assortativity", () => {
  it("matches networkx on the karate club by club", () => {
    const g = karate();
    expect(assortativity(g, (id) => KARATE_CLUB[Number(id.slice(1))])).toBeCloseTo(KARATE_EXPECTED.assortativity_club, 9);
    expect(assortativity(karate(true), (id) => KARATE_CLUB[Number(id.slice(1))], { weighted: false })).toBeCloseTo(
      KARATE_EXPECTED.assortativity_club,
      9,
    );
  });

  it("is 1 when like only links like, −1 when opposites only link, and undefined with one category", () => {
    const sameKind = buildGraph(ties([["v1", "v2"], ["v2", "v3"], ["r1", "r2"], ["r2", "r3"]]));
    const kindOf = (id: string) => (id.startsWith("v") ? "vampire" : "robot");
    expect(assortativity(sameKind, kindOf)).toBeCloseTo(1, 12);
    const opposites = buildGraph(ties([["v1", "r1"], ["v1", "r2"], ["v2", "r1"], ["v2", "r2"]]));
    expect(assortativity(opposites, kindOf)).toBeCloseTo(-1, 12);
    expect(assortativity(sameKind, () => "vampire")).toBeNaN();
    // A node with no category takes its links out of the count.
    const plus = buildGraph([...ties([["v1", "v2"], ["r1", "r2"]]), { from: "v1", to: "x" }, { from: "r1", to: "x" }]);
    expect(assortativity(plus, (id) => (id === "x" ? null : kindOf(id)))).toBeCloseTo(1, 12);
  });

  it("spreads a node's links evenly over its tags", () => {
    // x is tagged A and B; y is A, z is B. Half of each of x's links lands on a match: as mixed as chance.
    const g = buildGraph(ties([["x", "y"], ["x", "z"]]));
    const tags: Record<string, string[]> = { x: ["A", "B"], y: ["A"], z: ["B"] };
    expect(assortativity(g, (id) => tags[id])).toBeCloseTo(0, 12);
    // Weighting by tie strength changes which links count most.
    const w = buildGraph(ties([["v1", "v2", 3], ["v1", "r1", 1], ["r1", "r2", 1]]));
    const kindOf = (id: string) => (id.startsWith("v") ? "vampire" : "robot");
    expect(assortativity(w, kindOf, { weighted: true })).toBeGreaterThan(assortativity(w, kindOf));
  });
});

describe("layerDegrees and valences", () => {
  // a and b are coworkers (0.5) and exes (0.3, valence 0); c has a crush on a (0.8, valence 2); b and c are rivals (0.4, −1).
  const g = buildGraph([
    { from: "a", to: "b", weight: 0.5, layer: "work", kind: "coworker" },
    { from: "a", to: "b", weight: 0.3, valence: 0, layer: "romance", kind: "ex" },
    { from: "c", to: "a", weight: 0.8, valence: 2, directed: true, layer: "romance", kind: "crush" },
    { from: "b", to: "c", weight: 0.4, valence: -1, layer: "conflict", kind: "rival" },
  ]);
  const round = (xs: Float64Array) => [...xs].map((x) => Math.round(x * 1000) / 1000);

  it("counts distinct neighbours and their weight across layers and per layer", () => {
    const by = new Map(layerDegrees(g).map((l) => [l.layer, l]));
    expect([...by.keys()]).toEqual([ALL_LAYERS, "conflict", "romance", "work"]);
    expect([...by.get(ALL_LAYERS)!.degree]).toEqual([2, 2, 2]);
    expect(round(by.get(ALL_LAYERS)!.weighted)).toEqual([1.6, 1.2, 1.2]);
    expect([...by.get("romance")!.degree]).toEqual([2, 1, 1]);
    expect(round(by.get("romance")!.weighted)).toEqual([1.1, 0.3, 0.8]);
    expect([...by.get("work")!.degree]).toEqual([1, 1, 0]);
    expect([...by.get("conflict")!.degree]).toEqual([0, 1, 1]);
  });

  it("averages how the ties toward and from each character feel", () => {
    const v = valences(g);
    // a: from it coworker 1, ex 0 (the crush points at it); toward it coworker 1, ex 0, crush 2. c: crush 2 and rival −1
    // from it, only the rivalry toward it.
    expect(round(v.out)).toEqual([0.5, 0, 0.5]);
    expect(round(v.in)).toEqual([1, 0, -1]);
    expect([...v.inCount]).toEqual([3, 3, 1]);
    expect([...v.outCount]).toEqual([2, 3, 2]);
    expect(valences(buildGraph([], { nodes: ["a"] })).in[0]).toBeNaN();
  });
});

describe("components and density", () => {
  it("numbers connected groups by size and measures the whole", () => {
    const g = buildGraph(ties([["a", "b"], ["b", "c"], ["x", "y"]]), { nodes: ["loner"] });
    const c = components(g);
    expect(c.sizes).toEqual([3, 2, 1]);
    expect([...byId(g, c.membership).entries()]).toEqual([["a", 0], ["b", 0], ["c", 0], ["loner", 2], ["x", 1], ["y", 1]]);
    expect(density(g)).toBeCloseTo((2 * 3) / (6 * 5), 12);
    expect(averageDegree(g)).toBeCloseTo(1, 12);
    expect(density(karate())).toBeCloseTo(KARATE_EXPECTED.density, 9);
    expect([density(buildGraph([])), averageDegree(buildGraph([]))]).toEqual([0, 0]);
  });
});

describe("decay", () => {
  it("halves closeness every half-life without contact, and never decays kin", () => {
    expect(decay(0.8, 120, 120)).toBeCloseTo(0.4, 12);
    expect(decay(0.8, 240, 120)).toBeCloseTo(0.2, 12);
    expect(decay(0.8, 1, 120)).toBeCloseTo(0.8 * 0.5 ** (1 / 120), 12);
    expect(decay(0.8, 400, null)).toBe(0.8);
    expect(decay(0.8, 400, undefined)).toBe(0.8);
    expect([decay(0.8, 0, 120), decay(0.8, -3, 120), decay(0.8, 30, 0)]).toEqual([0.8, 0.8, 0.8]);
    expect([decay(1.5, 0, 120), decay(-0.2, 10, 120)]).toEqual([1, 0]);
    // A close friend (0.5) drops below the old-friend line (0.15) after 120·log2(0.5/0.15) ≈ 208 days apart.
    expect(decay(0.5, 208, 120)).toBeGreaterThan(0.15);
    expect(decay(0.5, 209, 120)).toBeLessThan(0.15);
  });
});

describe("seeded", () => {
  it("draws the same numbers for the same seed, in [0, 1)", () => {
    const [a, b, c] = [seeded("x"), seeded("x"), seeded("y")];
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seeded(7)()).toBe(seeded("7")());
  });
});

describe("scale", () => {
  it("runs every measure on a 100,000-character network in a daily job's time", () => {
    // Villages of 50 with most ties inside, some across, a fifth of them negative or one-way: about 300k ties.
    const rand = seeded("scale");
    const layers = ["kin", "romance", "friendship", "work", "conflict", "acquaintance"];
    const rows: Tie[] = [];
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const j = rand() < 0.8 ? Math.floor(i / 50) * 50 + Math.floor(rand() * 50) : Math.floor(rand() ** 2 * n);
        if (j === i) continue;
        const layer = layers[Math.floor(rand() * layers.length)];
        rows.push({ from: `c${i}`, to: `c${j}`, weight: rand(), valence: rand() < 0.1 ? -1 : 1, directed: rand() < 0.1, layer, kind: layer });
      }
    }
    const started = Date.now();
    const g = buildGraph(rows);
    expect(g.n).toBe(n);
    expect(sum(pagerank(g))).toBeCloseTo(1, 9);
    expect(betweenness(g, { samples: 32 }).length).toBe(n);
    expect(clustering(g).triangles).toBeGreaterThan(0);
    expect(coreNumbers(g).reduce((top, k) => Math.max(top, k), 0)).toBeGreaterThan(1);
    expect(constraint(g).length).toBe(n);
    const c = communities(g);
    expect(c.modularity).toBeGreaterThan(0.5);
    expect(reciprocity(g).overall).toBeGreaterThanOrEqual(0);
    expect(assortativity(g, (id) => ["a", "b", "c"][Number(id.slice(1)) % 3])).toBeLessThan(0.2);
    expect(layerDegrees(g)).toHaveLength(layers.length + 1);
    expect(components(g).sizes[0]).toBeGreaterThan(n / 2);
    // About 3 s on David's Mac; an accidental O(n²) would take hours.
    expect(Date.now() - started).toBeLessThan(45_000);
  }, 60_000);
});
