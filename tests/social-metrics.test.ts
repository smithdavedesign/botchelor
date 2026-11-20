import { describe, expect, it } from "vitest";
import { ALL_LAYERS } from "@/lib/social/analytics";
import { answerable, byLayer, measureLayer, metricRows, networkRow, type MetricNode, type MetricTie } from "@/lib/social/metrics";

// The social network's daily numbers (docs/PRDs/social-network.md §5.5, §10): lib/social/metrics.ts turns the public
// ties into social_metrics rows per character and layer, and one social_network_daily row.

/**
 * A small world: Ada dated Bo, Bo's best friend Cy is Ada's rival and has a crush on her, Dee and Bo have crushes on each
 * other; apart from them, Eve and Fay work together and Fay is Eve's manager.
 */
const tie = (from_id: string, to_id: string, kind: string, layer: string, valence: number, closeness: number, directed = false): MetricTie => ({
  from_id,
  to_id,
  kind,
  layer,
  directed,
  valence,
  closeness,
});
const WORLD: MetricTie[] = [
  tie("ada", "bo", "dated", "romance", 1, 0.8),
  tie("bo", "cy", "best_friend", "friendship", 2, 0.9),
  tie("ada", "cy", "rival", "conflict", -1, 0.5),
  tie("cy", "ada", "crush", "romance", 1, 0.3, true),
  tie("dee", "bo", "crush", "romance", 1, 0.6, true),
  tie("bo", "dee", "crush", "romance", 1, 0.4, true),
  tie("eve", "fay", "coworker", "work", 1, 0.7),
  tie("fay", "eve", "manager", "work", 0, 0.7, true),
];
const NODES: MetricNode[] = [
  { id: "ada", kind: "vampire", origin: "cast", tags: [] },
  { id: "bo", kind: "vampire", origin: "cast", tags: [] },
  { id: "cy", kind: "vampire", origin: "person", tags: [] },
  { id: "dee", kind: "vampire", origin: "agent", tags: [] },
  { id: "eve", kind: "robot", origin: "agent", tags: [] },
  { id: "fay", kind: "robot", origin: "person", tags: [] },
];

const measured = () => Promise.all(byLayer(WORLD).map(([layer, ties]) => measureLayer(layer, ties, { seed: "2026-11-20" })));

describe("byLayer", () => {
  it("puts every tie in all, then each layer once in name order", () => {
    const layers = byLayer(WORLD);
    expect(layers.map(([l, ties]) => [l, ties.length])).toEqual([
      [ALL_LAYERS, 8],
      ["conflict", 1],
      ["friendship", 1],
      ["romance", 4],
      ["work", 2],
    ]);
  });
});

describe("measureLayer and metricRows", () => {
  it("gives each character a row on every layer they have a tie on, and all", async () => {
    const rows = (await measured()).flatMap(metricRows);
    const has = (layer: string) => rows.filter((r) => r.layer === layer).map((r) => r.character_id);
    expect(has(ALL_LAYERS)).toEqual(["ada", "bo", "cy", "dee", "eve", "fay"]);
    expect(has("romance")).toEqual(["ada", "bo", "cy", "dee"]);
    expect(has("conflict")).toEqual(["ada", "cy"]);
    expect(has("friendship")).toEqual(["bo", "cy"]);
    expect(has("work")).toEqual(["eve", "fay"]);
  });

  it("counts each pair once, adds up its ties, and averages how they feel", async () => {
    const all = metricRows((await measured())[0]);
    const ada = all.find((r) => r.character_id === "ada")!;
    // Ada: Bo (dated) and Cy (a rivalry and his crush on her, one pair).
    expect(ada.degree).toBe(2);
    expect(ada.weighted_degree).toBeCloseTo(0.8 + 0.5 + 0.3, 9);
    // Toward Ada: the date 1, the rivalry −1, the crush 1. From her: the date and the rivalry.
    expect(ada.in_valence).toBeCloseTo(1 / 3, 9);
    expect(ada.out_valence).toBeCloseTo(0, 9);
    // Her one-way ties: Cy's crush, unanswered.
    expect(ada.reciprocity).toBe(0);
    const bo = all.find((r) => r.character_id === "bo")!;
    expect(bo.reciprocity).toBe(1); // he and Dee answered each other's crush
    // Eve and Fay's one-way tie is a role (a manager, on the work layer): not counted, so not "unanswered".
    expect(all.find((r) => r.character_id === "eve")!.reciprocity).toBeNull();
    expect(answerable(WORLD[7])).toBe(false);
    expect(answerable(WORLD[3])).toBe(true);
  });

  it("forms communities from ties that aren't negative, and keeps the centrality numbers on every tie", async () => {
    const [all] = await measured();
    const rows = new Map(metricRows(all).map((r) => [r.character_id, r]));
    // Two crowds: the four around Bo, and the two at work. The rivalry doesn't join anyone.
    expect(rows.get("ada")!.community).toBe(rows.get("bo")!.community);
    expect(rows.get("dee")!.community).toBe(rows.get("bo")!.community);
    expect(rows.get("eve")!.community).toBe(rows.get("fay")!.community);
    expect(rows.get("eve")!.community).not.toBe(rows.get("bo")!.community);
    // On the conflict layer alone, nobody has a non-negative tie: no community.
    const conflict = (await measured()).find((m) => m.layer === "conflict")!;
    expect(metricRows(conflict).map((r) => r.community)).toEqual([null, null]);
    // Bo is the hub: the most PageRank, the only one others' shortest paths pass through.
    const top = [...rows.values()].sort((a, b) => b.pagerank - a.pagerank)[0];
    expect(top.character_id).toBe("bo");
    expect(rows.get("bo")!.betweenness).toBeGreaterThan(0);
    expect(rows.get("eve")!.betweenness).toBe(0);
    expect(rows.get("ada")!.clustering).toBe(1); // her two people know each other
    expect(rows.get("ada")!.kcore).toBe(2);
    // The rings and triangles come from lib/social/algorithms.ts, filled by the job.
    expect(rows.get("ada")!.triads_balanced).toBeNull();
  });

  it("gives the same numbers on the same day whatever order the ties came in, pausing or not", async () => {
    let pauses = 0;
    const pause = async () => {
      pauses++;
    };
    const reversed = await Promise.all(byLayer([...WORLD].reverse()).map(([layer, ties]) => measureLayer(layer, ties, { seed: "2026-11-20", pause })));
    expect(reversed.flatMap(metricRows)).toEqual((await measured()).flatMap(metricRows));
    expect(pauses).toBeGreaterThan(0);
  });
});

describe("networkRow", () => {
  it("sums up the whole network", async () => {
    const layers = await measured();
    const row = networkRow(layers[0], layers, NODES);
    expect(row.nodes).toBe(6);
    expect(row.ties).toEqual({ [ALL_LAYERS]: 8, conflict: 1, friendship: 1, romance: 4, work: 2 });
    expect(row.stats.pairs).toBe(5);
    expect(row.density).toBeCloseTo(5 / 15, 9);
    expect(row.avg_degree).toBeCloseTo(10 / 6, 9);
    expect(row.giant_component).toBe(4);
    expect(row.communities).toBe(2);
    expect(row.modularity).toBeGreaterThan(0);
    // Three answerable crushes, two answered.
    expect(row.reciprocity).toBeCloseTo(2 / 3, 9);
    // Vampires only link vampires and robots robots; nobody has a tag, so there's nothing to say about tags.
    expect(row.assortativity.kind).toBeCloseTo(1, 9);
    expect(row.assortativity.tags).toBeNull();
    expect(row.assortativity.origin).not.toBeNull();
    expect(row.stats.triangles).toBe(1);
    expect(row.balance).toBeNull();
  });

  it("is an empty network with no ties", async () => {
    const [all] = await Promise.all(byLayer([]).map(([layer, ties]) => measureLayer(layer, ties, { seed: "d" })));
    const row = networkRow(all, [all], []);
    expect(row).toMatchObject({ nodes: 0, ties: { [ALL_LAYERS]: 0 }, density: 0, avg_degree: 0, communities: 0, giant_component: 0, reciprocity: null });
    expect(metricRows(all)).toEqual([]);
  });
});
