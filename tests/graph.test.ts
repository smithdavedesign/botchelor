import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { communities, constellation, kindMatrix, MASKED_WEIGHT, publicStory, publicWeight, triangles } from "@/lib/graph";
import type { HistoryItem } from "@/lib/relationships";
import { relationshipMetrics } from "@/lib/relationship-metrics";
import { tieStrength } from "@/lib/relationships";
import { setDbForTests } from "@/lib/db";
import { createSim, pick, settle } from "@/app/graph/sim";
import { startTestDb } from "./helpers";

// The Constellation (/graph): the public social graph page. lib/graph.ts must apply the privacy rules the
// existing edge readers skip (private → name only, deleted owners gone), sim.ts must lay the sky out
// deterministically, and the page must render its no-JS ledger.

vi.mock("next/dynamic", () => ({ default: () => () => null }));

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
});
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = new Date("2026-10-22T12:00:00Z");
const TWO_DAYS_AGO = "2026-10-20T12:00:00Z";

/** Ids sort a < b < c < d < p < z so pair ordering (character_a < character_b) is predictable. */
const ANA = "graph-a-ana";
const BOB = "graph-b-bob";
const CYD = "graph-c-cyd";
const DEE = "graph-d-dee";
const PRI = "graph-p-private";
const DEL = "graph-z-deleted";

async function seed() {
  const mk = (id: string, name: string, owner: string, visibility = "public") =>
    t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
       values ($1, $2, false, $3, 30, 'bio', '["kind"]'::jsonb, 'love', 'rudeness', $4)`,
      [id, owner, name, visibility],
    );
  await mk(ANA, "Ana Vale", "owner-1");
  await mk(BOB, "Bob Rook", "owner-2");
  await mk(CYD, "Cyd Lune", "owner-3");
  await mk(DEE, "Dee Moss", "owner-4");
  await mk(PRI, "Pria Veil", "owner-5", "private");
  await mk(DEL, "Del Gone", "deleted");

  const edge = (a: string, b: string, dates: number, second: number, stage: string | null) =>
    t.db.query(
      `insert into relationships (character_a, character_b, dates, second_dates, public_dates, public_second_dates,
                                  public_last_ending, public_stage, public_last_at, computed_at)
       values ($1, $2, $3, $4, $3, $4, 'second_date', $5, $6, now())`,
      [a, b, dates, second, stage, TWO_DAYS_AGO],
    );
  await edge(ANA, BOB, 3, 1, "dating");
  await edge(BOB, PRI, 2, 0, "sparks");
  await edge(CYD, DEL, 5, 2, "going_steady"); // must vanish with its deleted-owner end
}

describe("lib/graph constellation: the public layer with the directory's privacy rules", () => {
  it("masks a private character to name + id and keeps nothing else", async () => {
    await seed();
    const { nodes } = await constellation(t.db, NOW);
    const pri = nodes.find((n) => n.id === PRI)!;
    expect(pri).toMatchObject({ name: "Pria Veil", private: true, hue: null, origin: null, portrait: null });
  });

  it("an edge touching a private character keeps the pair's existence only", async () => {
    await seed();
    const { edges } = await constellation(t.db, NOW);
    const masked = edges.find((e) => e.b_id === PRI)!;
    expect(masked).toMatchObject({ masked: true, dates: 0, second_dates: 0, last_ending: null, stage: null, last_at: null, weight: MASKED_WEIGHT });
  });

  it("drops a deleted account's characters and their edges entirely, and degrees agree", async () => {
    await seed();
    const { nodes, edges } = await constellation(t.db, NOW);
    expect(nodes.find((n) => n.id === DEL)).toBeUndefined();
    expect(edges.find((e) => e.a_id === CYD || e.b_id === CYD)).toBeUndefined();
    // Cyd's only partner was deleted, so Cyd is in orbit, not a ghost edge.
    expect(nodes.find((n) => n.id === CYD)!.degree).toBe(0);
    expect(nodes.find((n) => n.id === BOB)!.degree).toBe(2);
  });

  it("only pairs with public dates are edges, weighted by tieStrength on the public layer", async () => {
    await seed();
    // A pair with private dates only: no public edge.
    await t.db.query(
      `insert into relationships (character_a, character_b, dates, public_dates, computed_at) values ($1, $2, 4, 0, now())`,
      [ANA, CYD],
    );
    const { edges } = await constellation(t.db, NOW);
    expect(edges.find((e) => e.a_id === ANA && e.b_id === CYD)).toBeUndefined();
    const ab = edges.find((e) => e.a_id === ANA && e.b_id === BOB)!;
    const expected = tieStrength({ dates: 3, second_dates: 1, mutual_yes: 0, chemistry: null, last_at: new Date(TWO_DAYS_AGO).toISOString() }, NOW, true);
    expect(ab.weight).toBe(expected);
    expect(ab.stage).toBe("💞 Dating");
    expect(publicWeight({ dates: 3, second_dates: 1, last_at: new Date(TWO_DAYS_AGO).toISOString() }, NOW)).toBe(expected);
  });

  it("stats: aggregates only, the deepest open pair and the most connected public character", async () => {
    await seed();
    const { nodes, stats } = await constellation(t.db, NOW);
    // The house cast is seeded too, so count against the returned nodes (my five, minus the deleted one, plus the cast).
    expect(stats.characters).toBe(nodes.length);
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    expect(stats.singles).toBe(nodes.filter((n) => n.degree === 0).length);
    expect(stats).toMatchObject({ couples: 2, dates: 5 });
    expect(stats.most_connected).toMatchObject({ id: BOB, degree: 2 });
    expect(stats.deepest).toMatchObject({ a: "Ana Vale", b: "Bob Rook", dates: 3 });
  });
});

describe("sim.ts: the hand-rolled force layout", () => {
  const nodes = [
    { id: "n-a", degree: 2 },
    { id: "n-b", degree: 2 },
    { id: "n-c", degree: 1 },
    { id: "n-d", degree: 1 },
    { id: "n-single", degree: 0 },
  ];
  const edges = [
    { a_id: "n-a", b_id: "n-b", weight: 0.9 },
    { a_id: "n-a", b_id: "n-c", weight: 0.9 },
    { a_id: "n-b", b_id: "n-d", weight: 0.2 },
  ];

  it("settles to rest and keeps everyone on stage", () => {
    const sim = createSim(nodes, edges, 900, 600);
    settle(sim);
    expect(sim.alpha).toBe(0);
    for (const n of sim.nodes) {
      expect(n.x).toBeGreaterThan(-200);
      expect(n.x).toBeLessThan(1100);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("a strong tie ends closer than a weak one, and connected pairs beat strangers", () => {
    const sim = createSim(nodes, edges, 900, 600);
    settle(sim);
    const at = (id: string) => sim.nodes.find((n) => n.id === id)!;
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    const strong = d(at("n-a"), at("n-b")); // weight 0.9
    const weak = d(at("n-b"), at("n-d")); // weight 0.2
    const strangers = d(at("n-c"), at("n-d")); // no edge
    expect(strong).toBeLessThan(weak);
    expect(weak).toBeLessThan(strangers);
  });

  it("zero-degree nodes sit on the orbit ring, deterministically", () => {
    const a = createSim(nodes, edges, 900, 600);
    const b = createSim(nodes, edges, 900, 600);
    const singleA = a.nodes.find((n) => n.id === "n-single")!;
    const singleB = b.nodes.find((n) => n.id === "n-single")!;
    expect(singleA.orbit).toBe(true);
    expect(singleA.x).toBe(singleB.x);
    expect(singleA.y).toBe(singleB.y);
    // On the ring: distance from center ≈ 0.46 * min(w, h).
    expect(Math.hypot(singleA.x - 450, singleA.y - 300)).toBeCloseTo(0.46 * 600, 0);
  });

  it("pick finds the node under a point, then the edge, then nothing", () => {
    const sim = createSim(nodes, edges, 900, 600);
    settle(sim);
    const a = sim.nodes.find((n) => n.id === "n-a")!;
    const b = sim.nodes.find((n) => n.id === "n-b")!;
    expect(pick(sim, a.x, a.y)).toMatchObject({ kind: "node" });
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const got = pick(sim, mid.x, mid.y);
    // The midpoint of a short edge can fall inside a node's slack; either hit is correct, never null.
    expect(got).not.toBeNull();
    expect(pick(sim, -5000, -5000)).toBeNull();
  });
});

describe("the /graph page: server-rendered ledger (no JS needed) and JSON-LD", () => {
  it("renders the ledger with the private treatment and the missing-data panel", async () => {
    await seed();
    const { default: GraphPage } = await import("@/app/graph/page");
    const html = renderToStaticMarkup(await GraphPage());
    expect(html).toContain("The Constellation");
    expect(html).toContain("Ana Vale × Bob Rook");
    expect(html).toContain(`/couples/${ANA}/${BOB}`);
    // The masked pair: names shown, never linked, nothing about their dates.
    expect(html).toContain("Pria Veil");
    expect(html).not.toContain(`/couples/${BOB}/${PRI}`);
    expect(html).not.toContain(`/characters/${PRI}`);
    expect(html).toContain("🔒");
    // Singles in orbit, stats and the honest gaps.
    expect(html).toContain("Dee Moss");
    expect(html).toContain("waiting for a first date");
    expect(html).toContain("What the network doesn");
    expect(html).toContain("application/ld+json");
  });
});

/* ------------------------------------- Tier 3: kinds, directions, timelines ------------------------------------- */

const kind = (id: string, extras: Record<string, unknown>) => t.db.query(`update characters set extras = $2::jsonb where id = $1`, [id, JSON.stringify(extras)]);
let epSeq = 0;
/** One date between two characters, aired and public unless told otherwise, with its drama answer. */
async function date(a: string, b: string, q: "rejected" | "leaves_first", ans: "a" | "b" | "neither", o: { visibility?: string; aired?: boolean; varies?: string; reports?: number } = {}) {
  const id = `graph-ep-${++epSeq}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript,
                           drama_question, drama_answer, visibility, revealed_at, varies_episode_id)
     values ($1, 'x', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb, $4, $5, $6, $7, $8)`,
    [id, a, b, q, ans, o.visibility ?? "public", o.aired === false ? null : TWO_DAYS_AGO, o.varies ?? null],
  );
  for (let i = 0; i < (o.reports ?? 0); i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [id, `r${i}`]);
  return id;
}
const item = (over: Partial<HistoryItem>): HistoryItem => ({
  episode_id: `h-${++epSeq}`,
  at: "2026-10-01T00:00:00.000Z",
  aired_at: "2026-10-01T01:00:00.000Z",
  ending: "second_date",
  venue: null,
  wants: [true, true],
  chemistry: 80,
  trust: 70,
  public: true,
  private: false,
  creator: "owner-1",
  followup_of: null,
  ...over,
});

describe("Tier 3: what the Constellation adds, and that a private character still gives nothing away", () => {
  it("a private node and a masked edge carry nothing but who and that they exist (any field added later too)", async () => {
    await seed();
    await kind(PRI, { kind: "other", kind_label: "Moon moth" });
    await kind(BOB, { kind: "robot" });
    await date(BOB, PRI, "rejected", "a");
    const data = await constellation(t.db, NOW);
    const pri = data.nodes.find((n) => n.id === PRI)!;
    for (const [k, v] of Object.entries(pri)) if (!["id", "name", "private", "degree"].includes(k)) expect(v, k).toBeNull();
    const masked = data.edges.find((e) => e.b_id === PRI)!;
    for (const [k, v] of Object.entries(masked)) {
      if (["a_id", "b_id", "masked", "weight"].includes(k)) continue;
      expect([null, 0, false].includes(v as never) || (Array.isArray(v) && v.length === 0), `${k}: ${JSON.stringify(v)}`).toBe(true);
    }
    const all = JSON.stringify(data);
    expect(all).not.toContain("Moon moth");
    expect(all).not.toMatch(/owner-\d/);
    expect(data.kinds.some((k) => k.a === "other" || k.b === "other")).toBe(false);
  });

  it("kinds on stars, the cross-kind count and the who-dates-whom table (public pairs only)", async () => {
    await seed();
    await kind(ANA, { kind: "vampire" });
    await kind(BOB, { kind: "robot" });
    await kind(PRI, { kind: "vampire" });
    const data = await constellation(t.db, NOW);
    expect(data.nodes.find((n) => n.id === ANA)).toMatchObject({ kind: "vampire", kind_label: "🧛 Vampire" });
    expect(data.stats.cross_kind).toBe(1);
    // Bob × the private vampire isn't counted anywhere.
    expect(data.kinds).toEqual([{ a: "vampire", b: "robot", pairs: 1, dates: 3 }]);
    expect(kindMatrix(data.nodes, data.edges)).toEqual(data.kinds);
    expect(data.stats.kind_coverage).not.toBeNull();
  });

  it("turned down and left first come only from aired, public, unhidden dates that aren't replays", async () => {
    await seed();
    const real = await date(BOB, ANA, "rejected", "a"); // Bob is the episode's a: Ana turned Bob down
    await date(ANA, BOB, "leaves_first", "neither");
    await date(ANA, BOB, "leaves_first", "a");
    await date(ANA, BOB, "rejected", "b", { visibility: "private" });
    await date(ANA, BOB, "rejected", "b", { visibility: "unlisted" });
    await date(ANA, BOB, "rejected", "b", { aired: false });
    await date(ANA, BOB, "rejected", "b", { varies: real });
    await date(ANA, BOB, "rejected", "b", { reports: 3 });
    const ab = (await constellation(t.db, NOW)).edges.find((e) => e.a_id === ANA && e.b_id === BOB)!;
    expect(ab.turned_down).toEqual({ a: 1, b: 0 });
    expect(ab.left_first).toEqual({ a: 1, b: 0, together: 1 });
  });

  it("the timeline is the public dates only, with the stage after each, and nothing private per date", () => {
    const history = [
      item({ ending: "second_date", aired_at: "2026-10-01T01:00:00.000Z" }),
      item({ ending: "friends", public: false, private: true }),
      item({ ending: "second_date", aired_at: "2026-10-05T01:00:00.000Z" }),
    ];
    const story = publicStory(history, 3);
    expect(story.timeline).toEqual([
      { at: "2026-10-01T01:00:00.000Z", ending: "second_date", stage: "✨ Sparks" },
      { at: "2026-10-05T01:00:00.000Z", ending: "second_date", stage: "💞 Dating" },
    ]);
    expect(story.first_at).toBe("2026-10-01T01:00:00.000Z");
    expect(JSON.stringify(story)).not.toMatch(/wants|chemistry|trust|creator|owner/);
  });

  it("how they met: coarse, and only when their first public date was their first date", () => {
    expect(publicStory([item({ met_via: "blind" })], 1).met_via).toBe("set_up");
    expect(publicStory([item({ met_via: "show" })], 1).met_via).toBe("set_up");
    expect(publicStory([item({ met_via: "match" })], 1).met_via).toBe("asked");
    expect(publicStory([item({ met_via: "proposal" })], 1).met_via).toBe("asked");
    // A private first date, a follow-up first in public, a truncated history, or nothing recorded: no answer.
    expect(publicStory([item({ met_via: "blind", public: false }), item({ met_via: "chosen" })], 2).met_via).toBeNull();
    expect(publicStory([item({ met_via: "second_date", followup_of: "x" })], 1).met_via).toBeNull();
    expect(publicStory([item({ met_via: "blind" })], 31).met_via).toBeNull();
    expect(publicStory([item({})], 1).met_via).toBeNull();
  });

  it("the edge ships its story from the stored history", async () => {
    await seed();
    await t.db.query(`update relationships set detail = $3::jsonb, dates = 1 where character_a = $1 and character_b = $2`, [
      ANA,
      BOB,
      JSON.stringify({ history: [item({ met_via: "blind" })], facts: [], jokes: [], plans: [] }),
    ]);
    const ab = (await constellation(t.db, NOW)).edges.find((e) => e.a_id === ANA && e.b_id === BOB)!;
    expect(ab).toMatchObject({ met_via: "set_up", first_at: "2026-10-01T01:00:00.000Z" });
    expect(ab.timeline).toHaveLength(1);
    // The stored history's private parts (each side's wish, the night's numbers, who booked it) never ship.
    expect(JSON.stringify(ab)).not.toMatch(/wants|chemistry|trust|owner-1|"blind"/);
  });

  it("triangles and clusters: two separate triads are two triangles and two clusters, the same every time", () => {
    const tri = (x: string, y: string, z: string) => [
      { a_id: x, b_id: y, weight: 0.5 },
      { a_id: x, b_id: z, weight: 0.5 },
      { a_id: y, b_id: z, weight: 0.5 },
    ];
    const edges = [...tri("a1", "a2", "a3"), ...tri("b1", "b2", "b3"), { a_id: "b3", b_id: "b4", weight: 0.5 }];
    expect(triangles(edges)).toBe(2);
    const c1 = communities(edges);
    const c2 = communities([...edges].reverse());
    expect([...c1]).toEqual([...c2]);
    expect(new Set(c1.values()).size).toBe(2);
    expect(c1.get("a1")).toBe(c1.get("a3"));
    expect(c1.get("b4")).toBe(c1.get("b1"));
    expect(c1.get("b1")).toBe(0); // the bigger cluster first
  });

  it("the page tells the truth about what it doesn't know, and shows the kind table", async () => {
    await seed();
    await kind(ANA, { kind: "vampire" });
    await kind(BOB, { kind: "robot" });
    const { default: GraphPage } = await import("@/app/graph/page");
    const html = renderToStaticMarkup(await GraphPage());
    expect(html).toContain("Who dates whom, by kind");
    expect(html).toContain("🧛 Vampire × 🤖 Robot");
    expect(html).toContain("What they are is self-reported");
    expect(html).toContain("How they met starts on 22 October 2026");
    for (const gone of ["Species and archetype aren", "No public first-met date", "Chemistry and trust never go public"]) expect(html).not.toContain(gone);
  });

  it("the admin north star counts cross-kind pairs next to human × agent ones", async () => {
    await seed();
    await kind(ANA, { kind: "vampire" });
    await kind(BOB, { kind: "robot" });
    await kind(PRI, { kind: "robot" });
    const m = await relationshipMetrics(t.db, NOW);
    expect(m.north_star).toMatchObject({ cross_kind_pairs: 1, top_kind_pairs: [{ a: "robot", b: "vampire", pairs: 1 }] });
    expect(typeof m.north_star.cross_species_pairs).toBe("number");
    expect(m.north_star.kind_coverage).toBeGreaterThan(0);
  });
});
