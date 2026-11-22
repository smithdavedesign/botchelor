// /admin/after-dark/graph's data (lib/adult/graph.ts): every pair's After Dark content as one edge, whichever way round
// each row was stored, and one pair's whole content with "a" always the first character asked for.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AfterDarkGraphPage from "@/app/admin/after-dark/graph/page";
import { afterDarkGraph, labelAt, nodeRadius, layout, pairContent, pairKey, splitPair } from "@/lib/adult/graph";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

let admin: string | null = "admin";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/adult/mode", async (load) => ({ ...(await load<object>()), signedInAdmin: async () => admin }));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const [X, Y, Z] = HOUSE_CHARACTERS.slice(0, 3).map((c) => c.id);
const line = (who: "a" | "b", text: string) => ({ who, text, why: "private note" });

async function seed() {
  const q = (sql: string, args: unknown[]) => t.db.query(sql, args);
  // The scene stored X→Y, a night and a video stored Y→X: one pair.
  await q(`insert into adult_scenes (id, owner_id, character_a, character_b, lines) values ('s1', 'admin', $1, $2, $3::jsonb)`, [X, Y, JSON.stringify([line("a", "X speaks"), line("b", "Y answers"), line("a", "X again")])]);
  await q(`insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage) values ('n1', 'admin', $1, $2, $3::jsonb, 'the pier', 3)`, [Y, X, JSON.stringify([line("a", "Y first")])]);
  const shots = [
    { line: 0, who: "a", text: "Y first", motion: "", status: "ready", media_id: "m-shot" },
    { line: 1, who: "b", text: "X", motion: "", status: "failed", reason: "Venice 402" },
  ];
  await q(`insert into adult_reels (id, owner_id, character_a, character_b, status, shots) values ('r1', 'admin', $1, $2, 'ready', $3::jsonb)`, [Y, X, JSON.stringify(shots)]);
  await q(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime) values ('m-base', 'admin', $1, null, 'baseline', 'X portrait', 'image/png')`, [X]);
  await q(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime) values ('m-scene', 'admin', $1, $2, 'scene', 'the pier', 'image/png')`, [Y, X]);
  await q(`insert into adult_steps (id, owner_id, character_a, character_b, kind, status) values ('st1', 'admin', $1, $2, 'write', 'ok'), ('st2', 'admin', $2, $1, 'write', 'refused')`, [X, Y]);
  // Z is switched in with nothing yet.
  await q(`insert into adult_characters (character_id, owner_id) values ($1, 'admin')`, [Z]);
}

describe("the After Dark graph", () => {
  it("joins a pair's rows into one edge whichever way round they were stored, and lists everyone switched in", async () => {
    await seed();
    const g = await afterDarkGraph(t.db);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ key: pairKey(X, Y), lines: 3, nights: 1, videos: 1, shots: 1, pictures: 1, steps: 2 });
    expect(g.edges[0].last).toMatch(/^\d{4}-/);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get(X)).toMatchObject({ portrait: "m-base", lines: 3, pairs: 1 });
    expect(byId.get(Y)).toMatchObject({ portrait: null, lines: 3, pairs: 1 });
    expect(byId.get(Z)).toMatchObject({ lines: 0, pairs: 0 });
    expect(g.nodes[0].id).not.toBe(Z); // the busiest first
  });

  it("gives one pair's content with a always the first asked for, private notes left in the row only", async () => {
    await seed();
    const c = (await pairContent(t.db, X, Y))!;
    expect(c.a.id).toBe(X);
    expect(c.scene?.lines.map((l) => [l.who, l.text])).toEqual([["a", "X speaks"], ["b", "Y answers"], ["a", "X again"]]);
    // Stored Y→X: flipped, so Y's line is b's.
    expect(c.nights[0]).toMatchObject({ place: "the pier", stage: 3 });
    expect(c.nights[0].lines[0]).toMatchObject({ who: "b", text: "Y first" });
    expect(c.reels[0].shots.map((s) => s.who)).toEqual(["b", "a"]);
    expect(c.pictures.map((p) => p.id).sort()).toEqual(["m-base", "m-scene"]);
    expect(c.steps).toEqual(expect.arrayContaining([{ status: "ok", n: 1 }, { status: "refused", n: 1 }]));
    // Asked the other way round, the same content with a and b swapped.
    const back = (await pairContent(t.db, Y, X))!;
    expect(back.scene?.lines[0]).toMatchObject({ who: "b", text: "X speaks" });
    expect(await pairContent(t.db, "nobody", "no-one")).toBeNull();
  });

  it("keys a pair the same either way, refuses a malformed key, and lays nodes out in the box", () => {
    expect(pairKey("b", "a")).toBe("a~b");
    expect(splitPair("a~b")).toEqual(["a", "b"]);
    expect(splitPair("a")).toBeNull();
    expect(splitPair("a~b~c")).toBeNull();
    const at = layout([1, 2, 3, 4].map((i) => ({ id: `c${i}`, name: `C${i}`, portrait: null, lines: 0, pairs: 0 })));
    for (const p of at.values()) for (const v of [p.x, p.y]) expect(v >= 0 && v <= 100).toBe(true);
    expect(at.get("c1")).toEqual({ x: 50, y: 12 });
  });

  it("keeps 37 names apart: smaller nodes that never touch, each name outside the ring along its own radius", () => {
    const nodes = Array.from({ length: 37 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, portrait: null, lines: 0, pairs: 0 }));
    const at = layout(nodes);
    const r = nodeRadius(nodes.length);
    const [a, b] = [at.get("c0")!, at.get("c1")!];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * r); // neighbours' circles don't overlap
    expect(nodeRadius(4)).toBe(4.6); // a small graph keeps full-size faces
    for (const p of at.values()) {
      const l = labelAt(p, r);
      // Starts beyond its own circle, on the line from the middle through the node, and reads outward.
      expect(Math.hypot(l.x - 50, l.y - 50)).toBeGreaterThan(Math.hypot(p.x - 50, p.y - 50) + r);
      expect(Math.abs((l.x - 50) * (p.y - 50) - (l.y - 50) * (p.x - 50))).toBeLessThan(1e-6);
      expect(l.anchor).toBe(p.x >= 50 - 1e-6 ? "start" : "end");
      expect(Math.abs(l.rotate)).toBeLessThanOrEqual(90 + 1e-6); // never upside down
    }
    const lone = labelAt({ x: 50, y: 50 }, 4.6);
    expect(lone).toMatchObject({ x: 50, rotate: 0, anchor: "middle" });
    expect(lone.y).toBeCloseTo(57.6);
  });

  it("the page: the graph, the pairs table and the picked pair's content, for a signed-in admin only", async () => {
    await seed();
    admin = "admin";
    const page = async (pair?: string) =>
      renderToStaticMarkup(await AfterDarkGraphPage({ searchParams: Promise.resolve(pair ? { pair } : {}) })).replace(/&#x27;|&apos;/g, "'");
    const html = await page(pairKey(X, Y));
    expect(html).toContain('<svg class="ad-graph-svg"');
    expect(html).toContain("3 characters, 1 pairs.");
    expect(html).toContain("/api/admin/after-dark/media/m-base"); // the portrait on its node
    expect(html).toContain('<video controls="" preload="none"'); // shots load only when played
    expect(html).toContain("the pier · stage 3 · 1 lines · not recorded");
    expect(html).toContain("1 of 2 shots");
    // Which model wrote each chapter: nothing recorded for these, and nothing guessed.
    expect(html).toContain("Which model wrote it");
    expect(html).toMatch(/<td>1 \(running\)<\/td><td class="muted small">[^<]+<\/td><td>not recorded<\/td>/);
    expect(html).not.toContain("private note"); // a line's private why stays out
    expect(await page("not-a-pair")).not.toContain('id="pair"');
    admin = null;
    await expect(page()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    admin = "admin";
  });

  it("is empty with nothing made", async () => {
    expect(await afterDarkGraph(t.db)).toEqual({ nodes: [], edges: [] });
  });
});
