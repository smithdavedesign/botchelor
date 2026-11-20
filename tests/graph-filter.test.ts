import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeFilters,
  DEFAULT_FILTER,
  filterSky,
  linesNarrowed,
  parseStill,
  parseWhen,
  stageCounts,
  stagesNarrowed,
  stillSeeing,
  whenParam,
  whenSince,
  type SkyFilter,
} from "@/app/graph/filter";
import { createSim, warmStart, WARM } from "@/app/graph/sim";
import { GROUP_LABEL, groupHint, LINE_STYLE, parseStages, STAGE_GROUPS, stageGroup, stageOn, stagesParam, toggleStage } from "@/app/graph/stages";
import type { GraphData, GraphEdge, GraphNode } from "@/lib/graph";
import { STAGES, type Stage } from "@/lib/relationship-stages";

// The Constellation's lines say where a pair stands (2026-11-20, the social network's first phase): the shown stages in
// five groups, each with its own line and a chip that is its legend and its filter. Everything here is pure: no
// database, no browser.

const node = (id: string, degree: number, o: Partial<GraphNode> = {}): GraphNode => ({
  id,
  name: `Name ${id}`,
  hue: null,
  origin: "person",
  portrait: null,
  private: false,
  degree,
  kind: null,
  kind_label: null,
  community: null,
  ...o,
});
const edge = (a_id: string, b_id: string, stage_id: Stage | null, o: Partial<GraphEdge> = {}): GraphEdge => ({
  a_id,
  b_id,
  masked: false,
  dates: 1,
  second_dates: 0,
  stage: stage_id,
  stage_id,
  last_at: null,
  weight: 0.5,
  first_at: null,
  turned_down: null,
  left_first: null,
  met_via: null,
  ...o,
});
const masked = (a_id: string, b_id: string): GraphEdge =>
  edge(a_id, b_id, null, { masked: true, dates: 0, weight: 0.15 });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
const pairs = (es: { a_id: string; b_id: string }[]) => es.map((e) => `${e.a_id}-${e.b_id}`).sort();

/**
 * A couple (c1–c2, dating), a spark (s1–s2), friends (f1–f2), exes (x1–x2, broke up), two first dates (c1–n1 just met,
 * s2–n2 didn't click), a private pair (c2–p) and a single (o, no public date).
 */
const SKY: GraphData = {
  nodes: [
    node("c1", 2),
    node("c2", 2),
    node("s1", 1),
    node("s2", 2),
    node("f1", 1),
    node("f2", 1),
    node("x1", 1),
    node("x2", 1),
    node("n1", 1),
    node("n2", 1),
    node("p", 1, { private: true, origin: null }),
    node("o", 0),
  ],
  edges: [
    edge("c1", "c2", "dating", { dates: 3 }),
    edge("s1", "s2", "sparks"),
    edge("f1", "f2", "friends", { dates: 2 }),
    edge("x1", "x2", "broke_up", { dates: 5 }),
    edge("c1", "n1", "just_met"),
    edge("s2", "n2", "didnt_click"),
    masked("c2", "p"),
  ],
  stats: {} as GraphData["stats"],
  kinds: [],
};

describe("the stage groups (app/graph/stages.ts)", () => {
  it("puts every stage in exactly one group, as the brief groups them", () => {
    const of = (g: string) => STAGES.filter((s) => stageGroup(s) === g).sort();
    expect(of("together")).toEqual(["back_together", "casual", "dating", "engaged", "going_steady", "married", "moved_in", "official"]);
    expect(of("sparks")).toEqual(["sparks"]);
    expect(of("friends")).toEqual(["friends"]);
    expect(of("exes")).toEqual(["bad_blood", "broke_up", "divorced", "exes"]);
    expect(of("first")).toEqual(["didnt_click", "just_met"]);
    expect(STAGES.every((s) => stageGroup(s) !== null)).toBe(true);
  });

  it("knows no group for a private pair, a missing stage or a word it doesn't know (not even an object's own keys)", () => {
    expect(stageGroup(null)).toBeNull();
    expect(stageGroup(undefined)).toBeNull();
    expect(stageGroup("💞 Dating")).toBeNull();
    expect(stageGroup("toString")).toBeNull();
    expect(stageGroup("constructor")).toBeNull();
  });

  it("names each group, and says what it holds in the stages' own words", () => {
    expect(STAGE_GROUPS.map((g) => GROUP_LABEL[g])).toEqual(["Together", "Sparks", "Friends", "Exes & bad blood", "First date"]);
    expect(groupHint("together")).toBe("Dating, going steady, keeping it casual, official, moved in together, engaged, married or back together");
    expect(groupHint("sparks")).toBe("Their last date ended with both wanting another.");
    expect(groupHint("first")).toBe("One date so far: just met or didn't click");
    expect(groupHint("exes")).toBe("Exes, broke up, divorced or bad blood");
  });

  it("gives every group a line that reads without colour: its own dash, or (first dates) faint", () => {
    const looks = STAGE_GROUPS.map((g) => `${LINE_STYLE[g].dash.join(",")}|${LINE_STYLE[g].faint}`);
    expect(new Set(looks).size).toBe(STAGE_GROUPS.length);
    expect(LINE_STYLE.together.dash).toEqual([]);
    expect(LINE_STYLE.first).toMatchObject({ dash: [], faint: true });
    // A dot is a zero-length dash, drawn with round caps; no pattern has a negative or missing step.
    for (const g of STAGE_GROUPS) expect(LINE_STYLE[g].dash.every((d) => Number.isFinite(d) && d >= 0), g).toBe(true);
  });

  it("reads and writes ?stage=: every group (or none, or nonsense) is the default and needs no parameter", () => {
    expect(parseStages("together,sparks")).toEqual(new Set(["together", "sparks"]));
    expect(parseStages(" Friends , nonsense")).toEqual(new Set(["friends"]));
    expect(parseStages(["together", "exes"])).toEqual(new Set(["together", "exes"]));
    expect(parseStages(undefined)).toBeNull();
    expect(parseStages("")).toBeNull();
    expect(parseStages("nonsense")).toBeNull();
    expect(parseStages(STAGE_GROUPS.join(","))).toBeNull();
    // In the chips' order whatever order it was picked in, so one sky has one address.
    expect(stagesParam(new Set(["first", "together"]))).toBe("together,first");
    expect(stagesParam(null)).toBeNull();
    expect(stagesParam(new Set())).toBeNull();
    expect(stagesParam(new Set(STAGE_GROUPS))).toBeNull();
    expect(parseStages(stagesParam(new Set(["sparks", "exes"])))).toEqual(new Set(["sparks", "exes"]));
  });

  it("a chip turns its group off and on, and every group on again is the default", () => {
    const noFirst = toggleStage(null, "first");
    expect(noFirst).toEqual(new Set(["together", "sparks", "friends", "exes"]));
    expect(stageOn(noFirst, "first")).toBe(false);
    expect(stageOn(noFirst, "sparks")).toBe(true);
    expect(stageOn(null, "first")).toBe(true);
    expect(toggleStage(noFirst, "first")).toBeNull();
  });
});

describe("the stage filter (app/graph/filter.ts)", () => {
  it("draws every line by default, the private pair too, and every star", () => {
    const all = filterSky(SKY, DEFAULT_FILTER);
    expect(all.edges).toHaveLength(SKY.edges.length);
    expect(all.nodes).toHaveLength(SKY.nodes.length);
    expect(stagesNarrowed(null)).toBe(false);
    expect(stagesNarrowed(new Set(STAGE_GROUPS))).toBe(false);
    expect(linesNarrowed(DEFAULT_FILTER)).toBe(false);
  });

  it("draws only the groups picked, and leaves out the private pair, whose stage isn't public", () => {
    const couples = filterSky(SKY, { ...DEFAULT_FILTER, stages: new Set(["together"]) });
    expect(pairs(couples.edges)).toEqual(["c1-c2"]);
    const noFirst = filterSky(SKY, { ...DEFAULT_FILTER, stages: toggleStage(null, "first") });
    expect(pairs(noFirst.edges)).toEqual(["c1-c2", "f1-f2", "s1-s2", "x1-x2"]);
    expect(noFirst.edges.some((e) => e.masked)).toBe(false);
    const firsts = filterSky(SKY, { ...DEFAULT_FILTER, stages: new Set(["first"]) });
    expect(pairs(firsts.edges)).toEqual(["c1-n1", "s2-n2"]);
  });

  it("a star whose every line was filtered out leaves; one with no public date stays on the orbit, unless the orbit is off", () => {
    const couples = filterSky(SKY, { ...DEFAULT_FILTER, stages: new Set(["together"]) });
    expect(ids(couples.nodes)).toEqual(["c1", "c2", "o"]);
    expect(ids(filterSky(SKY, { ...DEFAULT_FILTER, stages: new Set(["together"]), showSingles: false }).nodes)).toEqual(["c1", "c2"]);
    // Nothing picked: no line, and only the orbit.
    const none = filterSky(SKY, { ...DEFAULT_FILTER, stages: new Set() });
    expect(none.edges).toEqual([]);
    expect(ids(none.nodes)).toEqual(["o"]);
  });

  it("every line it keeps has both its stars on the sky (the canvas relies on that)", () => {
    for (const stages of [null, new Set(["together"] as const), new Set(["sparks", "first"] as const), new Set(["exes"] as const)]) {
      const sky = filterSky(SKY, { ...DEFAULT_FILTER, stages });
      const on = new Set(sky.nodes.map((n) => n.id));
      expect(sky.edges.every((e) => on.has(e.a_id) && on.has(e.b_id))).toBe(true);
    }
  });

  it("composes with who's on the sky: a kind filter's stars and only their pairs of the kinds picked", () => {
    const sky: GraphData = {
      ...SKY,
      nodes: SKY.nodes.map((n) => (["c1", "c2", "n1"].includes(n.id) ? { ...n, kind: "vampire" } : n)),
    };
    const vampires = filterSky(sky, { ...DEFAULT_FILTER, kind: "vampire", stages: toggleStage(null, "together") });
    expect(pairs(vampires.edges)).toEqual(["c1-n1"]);
    expect(ids(vampires.nodes)).toEqual(["c1", "n1"]);
  });

  it("counts each group's pairs for the chips, and counts the private pair in none", () => {
    expect(stageCounts(SKY.edges)).toEqual({ together: 1, sparks: 1, friends: 1, exes: 1, first: 2 });
    // A payload from before stage_id (a cached sky) counts nothing rather than guessing.
    expect(stageCounts([{ ...SKY.edges[0], stage_id: undefined as never }])).toEqual({ together: 0, sparks: 0, friends: 0, exes: 0, first: 0 });
  });
});

describe("when they dated (app/graph/filter.ts)", () => {
  // 2026-11-20 noon UTC: this season began 2026-11-01 (lib/season-window.ts), the last 30 days on 2026-10-21.
  const NOW = Date.parse("2026-11-20T12:00:00.000Z");
  const at = (iso: string) => ({ last_at: `${iso}T12:00:00.000Z` });
  const DATED: GraphData = {
    ...SKY,
    edges: [
      edge("c1", "c2", "dating", { dates: 3, ...at("2026-11-18") }), // this season, still seeing each other
      edge("s1", "s2", "sparks", at("2026-11-02")), // this season, one date
      edge("f1", "f2", "friends", { dates: 2, ...at("2026-10-25") }), // last 30 days, not this season
      edge("x1", "x2", "broke_up", { dates: 5, ...at("2026-11-19") }), // recent, but over
      edge("c1", "n1", "just_met", at("2026-10-01")), // before both windows
      edge("s2", "n2", "didnt_click", { dates: 2, ...at("2026-11-10") }), // a second date that didn't click either
      masked("c2", "p"),
    ],
  };
  const sky = (o: Partial<SkyFilter>) => filterSky(DATED, { ...DEFAULT_FILTER, ...o }, undefined, NOW);

  it("All time draws every pair; This season and Last 30 days draw the pairs whose last date fell in them", () => {
    expect(pairs(sky({}).edges)).toHaveLength(7);
    expect(pairs(sky({ when: "season" }).edges)).toEqual(["c1-c2", "s1-s2", "s2-n2", "x1-x2"]);
    expect(pairs(sky({ when: "30d" }).edges)).toEqual(["c1-c2", "f1-f2", "s1-s2", "s2-n2", "x1-x2"]);
  });

  it("a private pair's dates aren't public, so a time filter leaves it out; its stars go unless another line keeps them", () => {
    const s = sky({ when: "season" });
    expect(s.edges.some((e) => e.masked)).toBe(false);
    expect(ids(s.nodes)).not.toContain("p");
    expect(ids(s.nodes)).toContain("o"); // the orbit stays: no public date at all
  });

  it("still seeing each other: more than one date, the last in the last 30 days, and not over", () => {
    expect(pairs(sky({ still: true }).edges)).toEqual(["c1-c2", "f1-f2"]);
    expect(stillSeeing(DATED.edges[0], NOW)).toBe(true);
    expect(stillSeeing(DATED.edges[1], NOW)).toBe(false); // one date
    expect(stillSeeing(DATED.edges[3], NOW)).toBe(false); // broke up
    expect(stillSeeing(DATED.edges[5], NOW)).toBe(false); // didn't click, twice
    expect(stillSeeing(DATED.edges[0], NOW + 40 * 86_400_000)).toBe(false); // 42 days on
    expect(stillSeeing(DATED.edges[6], NOW)).toBe(false); // private
  });

  it("composes with the stage chips and the season", () => {
    expect(pairs(sky({ still: true, when: "season" }).edges)).toEqual(["c1-c2"]);
    expect(pairs(sky({ stages: new Set(["first"]), when: "30d" }).edges)).toEqual(["s2-n2"]);
  });

  it("reads and writes ?when= and ?still=", () => {
    expect(parseWhen("season")).toBe("season");
    expect(parseWhen(" 30D ")).toBe("30d");
    expect(parseWhen(["30d", "season"])).toBe("30d");
    for (const v of [undefined, "", "all", "forever", "toString"]) expect(parseWhen(v)).toBe("all");
    expect(whenParam("all")).toBeNull();
    expect(whenParam("season")).toBe("season");
    expect(parseStill("1")).toBe(true);
    expect(parseStill(["1"])).toBe(true);
    for (const v of [undefined, "0", "yes", ""]) expect(parseStill(v)).toBe(false);
  });

  it("This season starts on the season's first day, Last 30 days thirty days back", () => {
    expect(new Date(whenSince("season", NOW)!).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(whenSince("30d", NOW)!).toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(whenSince("all", NOW)).toBeNull();
  });

  it("counts the filters behind the phone's Filters button (the chips on the sky aren't among them)", () => {
    expect(activeFilters(DEFAULT_FILTER)).toBe(0);
    expect(activeFilters({ ...DEFAULT_FILTER, stages: new Set(["together"]) })).toBe(0);
    expect(activeFilters({ ...DEFAULT_FILTER, when: "season", still: true, showSingles: false })).toBe(3);
    expect(activeFilters({ ...DEFAULT_FILTER, origin: "cast", partners: false, kind: "human" })).toBe(3);
  });
});

describe("a filter change keeps the sky where it was (app/graph/sim.ts warmStart)", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, degree: 1 }));
  const edges = [
    { a_id: "a", b_id: "b", weight: 0.5 },
    { a_id: "c", b_id: "d", weight: 0.5 },
  ];

  it("everyone still on the sky keeps their place, and the sky only gently resettles", () => {
    const before = createSim(nodes, edges, 800, 600);
    before.nodes.forEach((n, i) => Object.assign(n, { x: 100 + i * 50, y: 200 }));
    before.alpha = 0.05;
    const after = createSim(nodes.slice(0, 3), edges.slice(0, 1), 800, 600);
    warmStart(before, after);
    expect(after.nodes.map((n) => [n.x, n.y])).toEqual([
      [100, 200],
      [150, 200],
      [200, 200],
    ]);
    expect(after.alpha).toBe(WARM);
  });

  it("a sky that never ticked (on arrival) is still a fresh layout, and a mostly new sky starts afresh", () => {
    const fresh = createSim(nodes, edges, 800, 600);
    const again = createSim(nodes, edges, 800, 600);
    warmStart(fresh, again);
    expect(again.alpha).toBe(1);
    const small = createSim(nodes.slice(0, 1), [], 800, 600);
    small.alpha = 0.05;
    const bigger = createSim([...nodes, ...["e", "f", "g"].map((id) => ({ id, degree: 1 }))], edges, 800, 600);
    warmStart(small, bigger);
    expect(bigger.alpha).toBe(1);
  });
});

describe("the sky's line colours (app/globals.css)", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
  const token = (block: string, name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const light = css.match(/^:root \{([\s\S]*?)\n\}/m)![1];
  const dark = css.match(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m)![1];

  it("every line clears 3:1 on the sky in both themes (a graphic, WCAG 1.4.11), and the colours are tokens", () => {
    const skies = [token(light, "constellation-bg")!, token(dark, "constellation-bg") ?? token(light, "constellation-bg")!];
    for (const g of STAGE_GROUPS) {
      const name = LINE_STYLE[g].token.replace(/^--/, "");
      const colour = token(light, name);
      expect(colour, `${name} is defined on :root`).toMatch(/^#[0-9a-f]{6}$/i);
      for (const sky of skies) expect(ratio(colour!, sky), `${name} on ${sky}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("is browser-safe: the new client modules take nothing but types from lib/graph.ts", () => {
    for (const file of ["app/graph/stages.ts", "app/graph/LineSwatch.tsx", "app/graph/filter.ts", "app/graph/sim.ts"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toMatch(/^import (?!type )[^;]*from "(@\/lib\/graph|\.\/graph)";/m);
    }
    // stages.ts takes values from lib/relationship-stages.ts, which must stay import-free at runtime (types only).
    const stagesLib = readFileSync(join(__dirname, "..", "lib", "relationship-stages.ts"), "utf8");
    expect(stagesLib).not.toMatch(/^import (?!type )/m);
  });
});
