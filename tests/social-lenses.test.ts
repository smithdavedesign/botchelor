import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterLens, lensCounts, lensGraph, type SkyNode } from "@/app/graph/lens";
import type { GraphNode } from "@/lib/graph";
import {
  directedWords,
  endWords,
  foldTies,
  groupOf,
  groupOn,
  LENS_GROUPS,
  lensHref,
  lensNumbers,
  lensParam,
  LINE_STYLES,
  parseLens,
  styleOf,
  toggleGroup,
  type FoldTie,
  type LensSky,
} from "@/lib/social/lenses";
import { TIE_KIND_IDS, TIE_KINDS } from "@/lib/social/kinds";
import { SKY_LENSES } from "@/lib/social/types";

// The Constellation's social views (docs/PRDs/social-network.md section 9, Phase 3): their vocabulary
// (lib/social/lenses.ts) and what the page does with a view's payload (app/graph/lens.ts). Pure, no database.

const tie = (from: string, to: string, kind: FoldTie["kind"], o: Partial<FoldTie> = {}): FoldTie => ({
  from,
  to,
  kind,
  layer: TIE_KINDS[kind].layer,
  directed: TIE_KINDS[kind].directed,
  valence: TIE_KINDS[kind].valence,
  closeness: TIE_KINDS[kind].closeness,
  status: "active",
  ...o,
});

/** A house line, said `count` times. */
const said = (from: string, to: string, kind: "told" | "talked_about", count: number) => ({ ...tie(from, to, kind), detail: { count } });

describe("the views' names and links", () => {
  it("?lens= picks a view; anything else is Love, which needs no parameter", () => {
    expect(parseLens("rivals")).toBe("rivals");
    expect(parseLens(" Gossip ")).toBe("gossip");
    expect(parseLens(["all", "friends"])).toBe("all");
    for (const v of ["", "nonsense", undefined, null, 3]) expect(parseLens(v)).toBe("love");
    expect(lensParam("love")).toBeNull();
    expect(lensParam("friends")).toBe("friends");
    expect(lensHref("love")).toBe("/graph");
    expect(lensHref("all")).toBe("/graph?lens=all");
  });
});

describe("how a tie is drawn and which chip it's under", () => {
  it("every kind on every layer it can be on has a look and, in Everything, a group", () => {
    for (const kind of TIE_KIND_IDS) {
      const layer = TIE_KINDS[kind].layer;
      expect(LINE_STYLES[styleOf(kind, layer, TIE_KINDS[kind].valence)], kind).toBeDefined();
      expect(LENS_GROUPS.all.some((g) => g.id === groupOf("all", kind, layer)), kind).toBe(true);
    }
  });

  it("a tie looks the same in its own view and in Everything: by family, then kind", () => {
    expect(styleOf("dated", "romance", 2)).toBe("romance");
    expect(styleOf("ex", "romance", 0)).toBe("exes");
    expect(styleOf("sibling", "kin", 1)).toBe("kin");
    expect(styleOf("coworker", "work", 1)).toBe("work");
    expect(styleOf("feud", "conflict", -1)).toBe("feud");
    expect(styleOf("feud", "conflict", 0)).toBe("calm");
    expect(styleOf("dated", "conflict", -2)).toBe("bad_blood");
    expect(styleOf("nemesis", "conflict", -2)).toBe("rival");
    expect(styleOf("grudge", "conflict", -1)).toBe("enemy");
    expect(styleOf("told", "communication", 0)).toBe("told");
    expect(styleOf("talked_about", "communication", 0)).toBe("talked_about");
    expect(styleOf("housemate", "acquaintance", 0)).toBe("met");
    // Love green, friends and family blue, conflict red: three hues, and each kind its own dash within its family.
    const tokens = new Set(Object.values(LINE_STYLES).map((s) => s.token));
    expect(tokens).toEqual(new Set(["--social-love", "--social-friends", "--social-conflict", "--social-talk", "--social-met", "--social-calm"]));
    for (const family of ["--social-friends", "--social-conflict"]) {
      const dashes = Object.values(LINE_STYLES)
        .filter((s) => s.token === family)
        .map((s) => s.dash.join(","));
      expect(new Set(dashes).size, family).toBe(dashes.length);
    }
  });

  it("each view's chips hold only its own layers", () => {
    expect(groupOf("friends", "best_friend", "friendship")).toBe("friendship");
    expect(groupOf("friends", "dated", "romance")).toBeNull();
    expect(groupOf("rivals", "dated", "conflict")).toBe("bad_blood");
    expect(groupOf("rivals", "frenemy", "conflict")).toBe("rival");
    expect(groupOf("rivals", "told", "communication")).toBeNull();
    expect(groupOf("gossip", "talked_about", "communication")).toBe("talked_about");
    expect(groupOf("gossip", "feud", "conflict")).toBeNull();
    for (const lens of SKY_LENSES) expect(new Set(LENS_GROUPS[lens].map((g) => g.id)).size).toBe(LENS_GROUPS[lens].length);
  });

  it("chips: one off, the rest on; every one on again is the default", () => {
    const off = toggleGroup("rivals", null, "feud");
    expect(groupOn(off, "feud")).toBe(false);
    expect(groupOn(off, "rival")).toBe(true);
    expect(toggleGroup("rivals", off, "feud")).toBeNull();
  });
});

describe("a pair's ties fold into its lines", () => {
  it("one line a group, strongest first; its worst feeling, and over only when every tie is", () => {
    const pairs = foldTies("all", [
      tie("b", "a", "dated", { layer: "romance", valence: 0, closeness: 0.8, status: "ended" }),
      tie("a", "b", "coworker", { closeness: 0.4 }),
      tie("a", "b", "feud", { closeness: 0.4, valence: -1 }),
      tie("a", "b", "rival", { closeness: 0.3, valence: -1, status: "ended" }),
      tie("c", "a", "told"),
      tie("a", "c", "told"),
      tie("a", "c", "talked_about"),
    ]);
    expect(pairs.map((p) => `${p.a}-${p.b}`)).toEqual(["a-b", "a-c"]);
    const ab = pairs[0];
    expect(ab.w).toBe(0.8);
    // In the chips' order: Love, then Work, then Conflict.
    expect(ab.lines.map((l) => l.g)).toEqual(["romance", "work", "conflict"]);
    expect(ab.lines[0]).toEqual({ g: "romance", s: "exes", k: ["dated"], v: 0, d: 0, e: 1 });
    // The feud and the rivalry share a line: the feud's look (the stronger), both kinds, not over (the feud isn't).
    expect(ab.lines[2]).toEqual({ g: "conflict", s: "feud", k: ["feud", "rival"], v: -1, d: 0 });
    // Who told whom is its own line from who talked about whom, each with its own direction (a < c: 1 is a to c).
    const ac = pairs[1].lines;
    expect(ac).toEqual([
      { g: "communication", s: "told", k: ["told"], v: 0, d: 3 },
      { g: "communication", s: "talked_about", k: ["talked_about"], v: 0, d: 1 },
    ]);
  });

  it("a view leaves out what it doesn't draw", () => {
    const ties = [tie("a", "b", "dated", { layer: "romance" }), tie("a", "b", "friend"), tie("a", "c", "feud", { valence: -1 })];
    expect(foldTies("friends", ties).map((p) => p.lines.map((l) => l.g))).toEqual([["friendship"]]);
    expect(foldTies("rivals", ties).map((p) => `${p.a}-${p.b}`)).toEqual(["a-c"]);
    expect(foldTies("gossip", ties)).toEqual([]);
  });

  it("says a tie in words, from either end", () => {
    expect(directedWords("told", "Ada", "Bea")).toBe("Ada told Bea");
    expect(directedWords("talked_about", "Ada", "Bea")).toBe("Ada talked about Bea");
    expect(directedWords("mentor", "Ada", "Bea")).toBe("Ada → Bea: mentor");
    // Ada told Bea: to Ada, Bea is someone she told; to Bea, Ada told her something.
    expect(endWords("told", true)).toBe("someone they told");
    expect(endWords("told", false)).toBe("told them something");
    expect(endWords("rival", true)).toBe("rival");
  });
});

describe("a view's numbers line", () => {
  const names = new Map([
    ["a", "Ada"],
    ["b", "Bea"],
    ["c", "Cal"],
  ]);

  it("rivals: feuds over the whole view, those that cleared the air, and who's most at odds", () => {
    const n = lensNumbers("rivals", {
      byKind: { feud: { active: 9, ended: 3 }, rival: { active: 2, ended: 0 }, dated: { active: 1, ended: 0 } },
      ties: [tie("a", "b", "feud", { valence: -1 }), tie("a", "c", "feud", { valence: 0 }), tie("a", "x", "rival", { valence: -1 })],
      names,
      places: 0,
      characters: 4,
    });
    expect(n).toEqual([
      { n: 12, words: "feuds" },
      { n: 1, words: "cleared the air" },
      { n: 2, words: "rivalries" },
      { n: 1, words: "ended in bad blood" },
      { n: 3, words: "most at odds", who: { id: "a", name: "Ada" } },
    ]);
  });

  it("gossip: lines of gossip, the most talked about and the biggest talker; a private character is never named", () => {
    const n = lensNumbers("gossip", {
      byKind: { told: { active: 2, ended: 0 }, talked_about: { active: 2, ended: 0 } },
      ties: [
        said("b", "a", "talked_about", 3),
        said("x", "c", "talked_about", 9),
        said("b", "c", "told", 2),
        said("x", "a", "talked_about", 7),
      ],
      names,
      places: 0,
      characters: 4,
    });
    expect(n).toEqual([
      { n: 21, words: "lines of gossip" },
      { n: 10, words: "most talked about", who: { id: "a", name: "Ada" } },
      { n: 5, words: "biggest talker", who: { id: "b", name: "Bea" } },
    ]);
  });

  it("an empty view has no numbers", () => {
    for (const lens of SKY_LENSES) expect(lensNumbers(lens, { byKind: {}, ties: [], names, places: 0, characters: 0 })).toEqual([]);
  });
});

const node = (id: string, o: Partial<GraphNode> = {}): GraphNode => ({
  id,
  name: `Name ${id}`,
  hue: null,
  origin: "person",
  portrait: null,
  private: false,
  degree: 1,
  kind: null,
  kind_label: null,
  community: null,
  ...o,
});

/** Friends: a and b friends, b and c coworkers, d private; a, b and e regulars at the bar (three spokes), c and d at the gym. */
const SKY: LensSky = {
  lens: "friends",
  nodes: [node("a", { origin: "cast", kind: "vampire" }), node("b"), node("c"), node("d", { private: true, origin: null }), node("e", { kind: "vampire" })],
  pairs: [
    { a: "a", b: "b", w: 0.5, lines: [{ g: "friendship", s: "friendship", k: ["friend"], v: 1, d: 0 }] },
    { a: "b", b: "c", w: 0.4, lines: [{ g: "work", s: "work", k: ["coworker"], v: 1, d: 0 }] },
  ],
  places: [
    { id: "place:bar:regular", place_id: "bar", name: "The Bar", words: "Regulars at The Bar", kind: "venue", role: "regular", group: "place", w: 0.25, count: 5, members: ["a", "b", "e"], community: 0 },
    { id: "place:gym:works", place_id: "gym", name: "The Gym", words: "Coworkers at The Gym", kind: "workplace", role: "works", group: "work", w: 0.4, count: 2, members: ["c", "d"], community: 1 },
  ],
  numbers: [],
  ties: 2,
  shown: 2,
};
const ids = (ns: SkyNode[]) => ns.map((n) => n.id).sort();

describe("a view's sky in the page (app/graph/lens.ts)", () => {
  it("draws each place as a star with a spoke to each member, in its group's look", () => {
    const g = lensGraph(SKY);
    const bar = g.nodes.find((n) => n.id === "place:bar:regular")!;
    expect(bar.place).toMatchObject({ words: "Regulars at The Bar", group: "place", count: 5 });
    const spokes = g.edges.filter((e) => e.spoke);
    expect(spokes.map((e) => `${e.a_id}>${e.b_id}`)).toEqual(["place:bar:regular>a", "place:bar:regular>b", "place:bar:regular>e", "place:gym:works>c", "place:gym:works>d"]);
    expect(spokes[3].lines).toEqual([{ g: "work", s: "work", k: [], v: 1, d: 0 }]);
  });

  it("counts each place once on its chip, and each line on its own", () => {
    expect(lensCounts(LENS_GROUPS.friends, lensGraph(SKY))).toEqual({ kin: 0, friendship: 1, work: 2, place: 1 });
  });

  it("who made them: the group and whoever they're tied to, a place staying while two of its members do", () => {
    const g = lensGraph(SKY);
    const cast = filterLens(g, { origin: "cast", kind: "all", groups: null, world: null });
    // a (the cast) and her friend b; the bar's spoke to a is a's, but a place with one member left isn't shared.
    expect(ids(cast.nodes)).toEqual(["a", "b"]);
    expect(cast.edges.every((e) => !e.spoke)).toBe(true);
  });

  it("what they are: only characters of that kind, never a private one; their places if two are left", () => {
    const vamps = filterLens(lensGraph(SKY), { origin: "all", kind: "vampire", groups: null, world: null });
    expect(ids(vamps.nodes)).toEqual(["a", "e", "place:bar:regular"]);
  });

  it("the chips cut lines to their groups, and a star whose lines all went goes too", () => {
    const work = filterLens(lensGraph(SKY), { origin: "all", kind: "all", groups: new Set(["work"]), world: null });
    expect(ids(work.nodes)).toEqual(["b", "c", "d", "place:gym:works"]);
  });

  it("their corner: two steps along what's left, a place counting as a step", () => {
    const corner = filterLens(lensGraph(SKY), { origin: "all", kind: "all", groups: null, world: "e" });
    expect(ids(corner.nodes)).toEqual(["a", "b", "e", "place:bar:regular"]);
    // The centre stays when nothing of theirs is left, to say so.
    const alone = filterLens(lensGraph(SKY), { origin: "all", kind: "all", groups: new Set(["kin"]), world: "e" });
    expect(ids(alone.nodes)).toEqual(["e"]);
  });
});

describe("the views are safe in the browser", () => {
  it("their client modules import lib/graph.ts and the server's social modules for types only", () => {
    for (const file of ["lib/social/lenses.ts", "app/graph/lens.ts", "app/graph/LensPanel.tsx", "app/graph/LineSwatch.tsx", "app/graph/ConstellationApp.tsx", "app/graph/ConstellationCanvas.tsx"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toMatch(/^import (?!type )[^;]*from "(@\/lib\/graph|\.\.\/graph|\.\/graph|@\/lib\/db|\.\.\/db|@\/lib\/social\/(read|ties|cache|lens-sky|derive|places|people|world)|\.\/(read|ties|cache|lens-sky|derive|places|people|world))";/m);
    }
  });
});
