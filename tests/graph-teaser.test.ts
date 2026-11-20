import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the viewer from next/headers: hand them this cookie jar (empty: nobody's signed in).
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined), has: (name: string) => jar.cookies.has(name), getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The canvas needs a browser: the static render gets its placeholder.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GraphTeaser, { MAX_FACES, teaserStats } from "@/app/graph/GraphTeaser";
import { filterSky, DEFAULT_FILTER } from "@/app/graph/filter";
import { graphTeaser, TEASER_H, TEASER_W } from "@/app/graph/teaser";
import { setDbForTests } from "@/lib/db";
import { groupSky, type GraphData, type GraphEdge, type GraphNode } from "@/lib/graph";
import { groupMember, inOriginGroup, parseSkyGroup } from "@/lib/origin-group";
import type { Origin } from "@/lib/origin";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { newUserCookie, startTestDb } from "./helpers";

// The Characters page's way into the Constellation (2026-11-17): each tab's group drawn as a small sky (the group and
// whoever they dated), linking to /graph opened on the same group, whose filter now keeps those partners too.

const node = (id: string, origin: Origin | null, o: Partial<GraphNode> = {}): GraphNode => ({
  id,
  name: `Name ${id}`,
  hue: null,
  origin,
  portrait: null,
  private: false,
  degree: 0,
  kind: null,
  kind_label: null,
  community: null,
  ...o,
});
const edge = (a_id: string, b_id: string, dates = 1, weight = 0.5, o: Partial<GraphEdge> = {}): GraphEdge => ({
  a_id,
  b_id,
  masked: false,
  dates,
  second_dates: 0,
  stage: null,
  stage_id: null,
  last_at: null,
  weight,
  first_at: null,
  turned_down: null,
  left_first: null,
  met_via: null,
  ...o,
});
const sky = (nodes: GraphNode[], edges: GraphEdge[]): GraphData => ({ nodes, edges, stats: {} as GraphData["stats"], kinds: [] });

/**
 * Two cast (c1, c2), two people's (p1, p2), an agent and a house-run bot, a private character and a cast single:
 * c1–c2 inside the cast, c1–p1 and c2–a1 across, p1–p2 among people, a1–b1 among agents, c2–x masked.
 */
const SKY = sky(
  [
    node("c1", "cast"),
    node("c2", "cast"),
    node("c3", "cast"),
    node("p1", "person"),
    node("p2", "person"),
    node("a1", "agent"),
    node("b1", "house_bot"),
    node("x", null, { private: true }),
  ],
  [
    edge("c1", "c2", 3, 0.9),
    edge("c1", "p1", 2, 0.6),
    edge("c2", "a1", 1, 0.3),
    edge("p1", "p2", 1, 0.4),
    edge("a1", "b1", 4, 0.8),
    edge("c2", "x", 0, 0.15, { masked: true }),
  ],
);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
const pairs = (es: { a_id: string; b_id: string }[]) => es.map((e) => `${e.a_id}-${e.b_id}`).sort();

describe("origin groups (lib/graph.ts)", () => {
  it("reads ?origin= and files the house-run bots with the agents; a private character is in no group", () => {
    expect(parseSkyGroup("cast")).toBe("cast");
    expect(parseSkyGroup("person")).toBe("person");
    expect(parseSkyGroup("yours")).toBe("yours");
    expect(parseSkyGroup(["agent"])).toBeNull();
    expect(parseSkyGroup("everyone")).toBeNull();
    expect(inOriginGroup("house_bot", "agent")).toBe(true);
    expect(inOriginGroup("agent", "agent")).toBe(true);
    expect(inOriginGroup(null, "cast")).toBe(false);
  });

  it("yours goes by id: the viewer's own, a private one of theirs too, and nobody's without ids", () => {
    const mine = new Set(["p1", "x"]);
    expect(SKY.nodes.filter(groupMember("yours", mine)).map((n) => n.id)).toEqual(["p1", "x"]);
    expect(SKY.nodes.filter(groupMember("yours"))).toEqual([]);
  });

  it("groupSky for yours: your characters and whoever they dated", () => {
    const yours = groupSky(SKY, "yours", new Set(["p1"]));
    expect(ids(yours.nodes)).toEqual(["c1", "p1", "p2"]);
    expect(pairs(yours.edges)).toEqual(["c1-p1", "p1-p2"]);
  });

  it("groupSky: the group, every pair touching it, and whoever they dated; the group's singles stay", () => {
    const cast = groupSky(SKY, "cast");
    expect(ids(cast.nodes)).toEqual(["a1", "c1", "c2", "c3", "p1", "x"]);
    expect(pairs(cast.edges)).toEqual(["c1-c2", "c1-p1", "c2-a1", "c2-x"]);
    const agents = groupSky(SKY, "agent");
    expect(ids(agents.nodes)).toEqual(["a1", "b1", "c2"]);
    expect(pairs(agents.edges)).toEqual(["a1-b1", "c2-a1"]);
  });
});

describe("the Constellation's filter (app/graph/filter.ts)", () => {
  it("is safe in the browser: the client files import lib/graph.ts for types only (its values pull server code, e.g. sharp, into the bundle)", () => {
    for (const file of ["app/graph/filter.ts", "app/graph/ConstellationApp.tsx", "app/graph/ConstellationCanvas.tsx", "app/graph/SidePanel.tsx", "lib/origin-group.ts"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toMatch(/^import (?!type )[^;]*from "(@\/lib\/graph|\.\/graph)";/m);
    }
  });

  it("yours: your characters and their dates; without who they dated, only yours (no stranger's private character)", () => {
    const mine = new Set(["p1", "p2"]);
    expect(ids(filterSky(SKY, { ...DEFAULT_FILTER, origin: "yours" }, mine).nodes)).toEqual(["c1", "p1", "p2"]);
    const inside = filterSky(SKY, { ...DEFAULT_FILTER, origin: "yours", partners: false }, mine);
    expect(ids(inside.nodes)).toEqual(["p1", "p2"]);
    expect(pairs(inside.edges)).toEqual(["p1-p2"]);
    expect(filterSky(SKY, { ...DEFAULT_FILTER, origin: "yours" }).nodes).toEqual([]);
  });

  it("everyone: the whole sky", () => {
    const all = filterSky(SKY, DEFAULT_FILTER);
    expect(all.nodes).toHaveLength(SKY.nodes.length);
    expect(all.edges).toHaveLength(SKY.edges.length);
  });

  it("a group with who they dated (the default) matches groupSky; without, only pairs inside it", () => {
    const withPartners = filterSky(SKY, { ...DEFAULT_FILTER, origin: "cast" });
    expect(ids(withPartners.nodes)).toEqual(ids(groupSky(SKY, "cast").nodes));
    expect(pairs(withPartners.edges)).toEqual(pairs(groupSky(SKY, "cast").edges));
    const inside = filterSky(SKY, { ...DEFAULT_FILTER, origin: "cast", partners: false });
    expect(ids(inside.nodes)).toEqual(["c1", "c2", "c3", "x"]);
    expect(pairs(inside.edges)).toEqual(["c1-c2", "c2-x"]);
  });

  it("a partner whose dates with the group all fall to another filter leaves; every edge keeps both ends", () => {
    // Pairs with more than one date are dating, the rest just met; the masked pair has no public stage.
    const staged = sky(SKY.nodes, SKY.edges.map((e) => ({ ...e, stage_id: e.masked ? null : e.dates >= 2 ? "dating" : "just_met" })));
    const deep = filterSky(staged, { ...DEFAULT_FILTER, origin: "cast", stages: new Set(["together"]) });
    expect(ids(deep.nodes)).toEqual(["c1", "c2", "c3", "p1"]); // a1's one date with c2 is a first date; x's pair is private
    const drawn = new Set(deep.nodes.map((n) => n.id));
    expect(deep.edges.every((e) => drawn.has(e.a_id) && drawn.has(e.b_id))).toBe(true);
    expect(ids(filterSky(SKY, { ...DEFAULT_FILTER, origin: "cast", showSingles: false }).nodes)).not.toContain("c3");
  });
});

describe("the preview's layout (app/graph/teaser.ts)", () => {
  it("is null while nobody in the group has a public date", () => {
    expect(graphTeaser(sky([node("c1", "cast"), node("x", null, { private: true })], [edge("c1", "x", 0, 0.15, { masked: true })]), "cast")).toBeNull();
  });

  it("lays the group's corner out inside the box, the same way every time, with the whole group's numbers", () => {
    const t = graphTeaser(SKY, "cast")!;
    expect(t).toEqual(graphTeaser(SKY, "cast"));
    // The private one's only pair is masked: like /graph's first sky, a masked pair never brings anyone in.
    expect(ids(t.stars)).toEqual(["a1", "c1", "c2", "c3", "p1"]);
    for (const s of t.stars) {
      expect(s.x - s.r).toBeGreaterThanOrEqual(0);
      expect(s.y - s.r).toBeGreaterThanOrEqual(0);
      expect(s.x + s.r).toBeLessThanOrEqual(TEASER_W);
      expect(s.y + s.r).toBeLessThanOrEqual(TEASER_H);
    }
    expect(t.stars.filter((s) => s.member).map((s) => s.id).sort()).toEqual(["c1", "c2", "c3"]);
    expect(t.lines).toHaveLength(3);
    // Public pairs and dates only; a masked pair counts in neither.
    expect(t).toMatchObject({ members: 3, pairs: 3, dates: 6, triangles: 0 });
  });

  it("draws every one of a small group's own who has a date with a line, so the orbit holds only real singles", () => {
    // Only one pair "fits", but c2's weaker date with a1 still comes, and c3 (no dates) sits on the ring.
    const t = graphTeaser(SKY, "cast", { pairs: 1 })!;
    const linked = new Set(t.lines.flatMap((l) => [`${l.x1},${l.y1}`, `${l.x2},${l.y2}`]));
    const at = (id: string) => {
      const s = t.stars.find((x) => x.id === id)!;
      return `${s.x},${s.y}`;
    };
    expect(linked.has(at("c1"))).toBe(true);
    expect(linked.has(at("c2"))).toBe(true);
    expect(linked.has(at("c3"))).toBe(false);
  });

  it("counts love triangles in the group's own pairs (two of the three are the group's)", () => {
    const sides = [edge("c1", "p1"), edge("c1", "p2"), edge("c2", "p1")];
    const nodes = [node("c1", "cast"), node("c2", "cast"), node("p1", "person"), node("p2", "person")];
    expect(graphTeaser(sky(nodes, [...sides, edge("c1", "c2")]), "cast")!.triangles).toBe(1);
    // c1 dated p1 and p2, who dated each other: not the cast's pair to count.
    expect(graphTeaser(sky(nodes, [...sides, edge("p1", "p2")]), "cast")!.triangles).toBe(0);
  });
});

describe("the preview card (app/graph/GraphTeaser.tsx)", () => {
  it("keeps the numbers off while there are few pairs (the empty-room rule)", () => {
    expect(teaserStats({ pairs: 3, dates: 4, triangles: 0 })).toBe("");
    expect(teaserStats({ pairs: 12, dates: 30, triangles: 1 })).toBe("12 pairs · 30 public dates · 1 love triangle");
    expect(teaserStats({ pairs: 165, dates: 251, triangles: 0 })).toBe("165 pairs · 251 public dates");
    // Your own characters' numbers are yours, however few.
    expect(teaserStats({ pairs: 1, dates: 1, triangles: 0 }, "yours")).toBe("1 pair · 1 public date");
    expect(teaserStats({ pairs: 3, dates: 4, triangles: 0 }, "yours")).toBe("3 pairs · 4 public dates");
  });

  it("is one link to /graph on the same group; the sky is decoration and never names or links anyone", () => {
    const html = renderToStaticMarkup(createElement(GraphTeaser, { teaser: graphTeaser(SKY, "person")!, group: "person" }));
    expect(html).toContain('href="/graph?origin=person#all-time"');
    expect(html).toContain("Explore the constellation");
    expect(html).toContain("Who people&#x27;s characters have fallen for");
    expect(html).toMatch(/class="graph-teaser-sky" aria-hidden="true"/);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("Name x"); // the private one
    expect(html).not.toContain("/characters/");
  });

  it("draws at most MAX_FACES faces; the rest of the group are stars", () => {
    const many = Array.from({ length: MAX_FACES + 5 }, (_, i) => node(`a${String(i).padStart(2, "0")}`, "agent"));
    const t = graphTeaser(sky(many, many.slice(1).map((n) => edge(many[0].id, n.id))), "agent", { pairs: 100 })!;
    const html = renderToStaticMarkup(createElement(GraphTeaser, { teaser: t, group: "agent" }));
    expect(html.match(/class="graph-teaser-face"/g)).toHaveLength(MAX_FACES);
    expect(html.split('<span class="graph-teaser-face"')[0].match(/<circle /g)).toHaveLength(5);
  });
});

/* ------------------------------------------- the pages, on a real database ------------------------------------------- */

describe("the pages", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
    setDbForTests(null);
  });
  beforeEach(async () => {
    await t.reset();
    setDbForTests(t.db);
    jar.cookies.clear();
  });

  const HOUSE = HOUSE_CHARACTERS[0].id;
  /** A person's character with a public date with a house character (the relationship row the graph reads). */
  async function seedDate(id = "zz-teaser-person", owner = "teaser-owner") {
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
       values ($1, $2, false, 'Tess Arrow', 30, 'bio', '["kind"]'::jsonb, 'love', 'rudeness', 'public')`,
      [id, owner],
    );
    const [a, b] = [HOUSE, id].sort();
    await t.db.query(
      `insert into relationships (character_a, character_b, dates, second_dates, public_dates, public_second_dates,
                                  public_last_ending, public_stage, public_last_at, computed_at)
       values ($1, $2, 2, 1, 2, 1, 'second_date', 'dating', now() - interval '1 day', now())`,
      [a, b],
    );
  }
  const characters = async (sp: Record<string, string> = {}) =>
    renderToStaticMarkup(await (await import("@/app/characters/page")).default({ searchParams: Promise.resolve(sp) }));

  it("the cast tab draws the cast's corner and links to it; with no dates it keeps the plain link", async () => {
    const empty = await characters();
    expect(empty).toContain("See it as a constellation");
    expect(empty).not.toContain("graph-teaser");

    await seedDate();
    const html = await characters();
    expect(html).toContain('href="/graph?origin=cast#all-time"');
    expect(html).toContain("The cast&#x27;s love lives, all tangled up");
    expect(html).not.toContain("See it as a constellation");
  });

  it("the people's tab draws people's characters and who they dated", async () => {
    await seedDate();
    const html = await characters({ tab: "people" });
    expect(html).toContain('href="/graph?origin=person#all-time"');
    expect(html).toContain("The relationship graph");
    // Nobody agent-made has a date: the agents' tab has no preview.
    expect(await characters({ tab: "agents" })).not.toContain("graph-teaser");
  });

  it("/graph?origin=cast opens on the cast, with who they dated", async () => {
    await seedDate();
    const { default: GraphPage } = await import("@/app/graph/page");
    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ origin: "cast" }) }));
    expect(html).toMatch(/<button type="button" class="segmented-tab" aria-pressed="true" aria-current="page">The cast<\/button>/);
    expect(html).toContain("Who they dated");
    const plain = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ origin: "nonsense" }) }));
    expect(plain).toMatch(/aria-pressed="true" aria-current="page">Everyone<\/button>/);
    expect(plain).not.toContain("Who they dated");
  });

  it("/graph?stage=&when=&still= opens on that sky: a filtered sky can be shared", async () => {
    await seedDate();
    const { default: GraphPage } = await import("@/app/graph/page");
    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ stage: "together,friends", when: "season", still: "1" }) }));
    const chip = (group: string, on: boolean) => new RegExp(`aria-pressed="${on}" title="[^"]*" style="--chip-line:var\\(--constellation-${group}\\)"`);
    expect(html).toMatch(chip("together", true));
    expect(html).toMatch(chip("friends", true));
    expect(html).toMatch(chip("sparks", false));
    expect(html).toContain('<option value="season" selected="">This season</option>');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>\s*Still seeing each other/);

    const plain = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ when: "someday", still: "yes" }) }));
    expect(plain).toMatch(chip("sparks", true));
    expect(plain).toContain('<option value="all" selected="">All time</option>');
    expect(plain).toMatch(/<input type="checkbox"\/>\s*Still seeing each other/);
  });

  /** Signed in (the plain visitor cookie) as a new person; their id, to own characters. */
  const signIn = () => {
    const [name, value] = newUserCookie().split("=");
    jar.cookies.set(name, value);
    return value;
  };

  it("the Yours tab draws your characters and who they dated, numbers and all, linking to /graph on yours", async () => {
    await seedDate("zz-yours-dated", signIn());
    const html = await characters({ tab: "yours" });
    expect(html).toContain('href="/graph?origin=yours#all-time"');
    expect(html).toContain("Who your character has dated");
    expect(html).toContain("1 pair · 2 public dates");
  });

  it("the Yours tab, with no public date yet: a line about it and the whole constellation", async () => {
    const me = signIn();
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
       values ('zz-yours-new', $1, false, 'Nova Start', 30, 'bio', '["kind"]'::jsonb, 'love', 'rudeness', 'public')`,
      [me],
    );
    const html = await characters({ tab: "yours" });
    expect(html).toContain("Once one of yours has a public date");
    expect(html).toContain('href="/graph"');
    expect(html).not.toContain("graph-teaser");
  });

  it("/graph has a Yours filter only for someone with characters, opened by ?origin=yours", async () => {
    const { default: GraphPage } = await import("@/app/graph/page");
    await seedDate();
    // A stranger: no Yours, and ?origin=yours opens on everyone.
    const stranger = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ origin: "yours" }) }));
    expect(stranger).not.toContain(">Yours</button>");
    expect(stranger).toMatch(/aria-pressed="true" aria-current="page">Everyone<\/button>/);

    await seedDate("zz-yours-dated", signIn());
    const owner = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ origin: "yours" }) }));
    expect(owner).toMatch(/aria-pressed="true" aria-current="page">Yours<\/button>/);
    expect(owner).toContain("Who they dated");
    const everyone = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({}) }));
    expect(everyone).toMatch(/aria-pressed="false">Yours<\/button>/);
  });
});
