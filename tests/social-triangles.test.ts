// The triangle tension (docs/PRDs/social-network.md section 7, Balance): two of the cast at odds who are both close to
// a third, from the public ties only (lib/social/dynamics.ts unbalancedTriangles, over 2a's signedTriads), becomes the
// story state's `unbalanced_triangle` tension (lib/story-state.ts tensions) and a beat the producer can stage.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { shortName } from "@/lib/names";
import { beatLines, beatTwists, beatWants, type Stage } from "@/lib/producer";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonIdOf } from "@/lib/season-window";
import { unbalancedTriangles } from "@/lib/social/dynamics";
import { upsertTie } from "@/lib/social/ties";
import { tensions, type Tension } from "@/lib/story-state";
import { startTestDb } from "./helpers";

const [A, B, C, D] = HOUSE_CHARACTERS.map((c) => c.id);
const nm = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id);
const NOW = new Date("2026-11-12T12:00:00Z");
const ON = {};

describe("the triangle tension", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    setSeasonCastForTests([A, B, D]);
  });
  afterEach(() => {
    setSeasonCastForTests(null);
  });

  /** A and B are rivals; C is A's friend and B's best friend. */
  async function triangle() {
    const ids: string[] = [];
    for (const [from, to, kind] of [
      [A, B, "rival"],
      [A, C, "friend"],
      [B, C, "best_friend"],
    ] as const) {
      const w = await upsertTie(t.db, { from, to, kind, source: "house" }, ON);
      if (w.ok) ids.push(w.tie.id);
    }
    return ids.sort();
  }

  it("finds two of the cast at odds who are both close to a third, from public ties only", async () => {
    const ids = await triangle();
    const [found] = await unbalancedTriangles(t.db, [A, B, D], ON);
    expect([found.a, found.b].sort()).toEqual([A, B].sort());
    expect(found.about).toBe(C);
    expect([...found.ties].sort()).toEqual(ids);
    // Off, or the two at odds not both in the cast: nothing.
    expect(await unbalancedTriangles(t.db, [A, B, D], { SOCIAL_DYNAMICS: "0" })).toEqual([]);
    expect(await unbalancedTriangles(t.db, [A, D], ON)).toEqual([]);
    // A side that isn't public, or a private third: nothing.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [C]);
    expect(await unbalancedTriangles(t.db, [A, B, D], ON)).toEqual([]);
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [C]);
    await t.db.query(`update social_ties set visibility = 'owner' where kind = 'best_friend'`);
    expect(await unbalancedTriangles(t.db, [A, B, D], ON)).toEqual([]);
  });

  it("leaves out three at odds (nobody's in the middle) and a pair whose ties net out", async () => {
    await upsertTie(t.db, { from: A, to: B, kind: "rival", source: "house" }, ON);
    await upsertTie(t.db, { from: A, to: C, kind: "rival", source: "house" }, ON);
    await upsertTie(t.db, { from: B, to: C, kind: "rival", source: "house" }, ON);
    expect(await unbalancedTriangles(t.db, [A, B, C], ON)).toEqual([]);
    await t.db.query(`delete from social_ties`);
    await triangle();
    // Rivals who are also coworkers net out: no sign, no triangle.
    await upsertTie(t.db, { from: A, to: B, kind: "coworker", source: "house" }, ON);
    expect(await unbalancedTriangles(t.db, [A, B, D], ON)).toEqual([]);
  });

  it("is a story-state tension, weighed under a confrontation, with its ties as evidence and no private word", async () => {
    const ids = await triangle();
    const list = await tensions(t.db, seasonIdOf(NOW), { now: NOW });
    const tri = list.find((x) => x.kind === "unbalanced_triangle")!;
    expect(tri).toMatchObject({ about: C, weight: 4, line: `${nm(tri.a)} and ${nm(tri.b)} don't get on, and both are close to ${nm(C)}.` });
    expect([tri.a, tri.b].sort()).toEqual([A, B].sort());
    expect([...(tri.evidence.ties ?? [])].sort()).toEqual(ids);
    expect(
      (await tensions(t.db, seasonIdOf(NOW), { now: NOW })).filter((x) => x.kind === "unbalanced_triangle"),
    ).toHaveLength(1);
  });

  it("the producer stages it: the lines, the wants and a room for the two", () => {
    const tri: Tension = { kind: "unbalanced_triangle", a: A, b: B, about: C, weight: 4, line: "x", evidence: { ties: [] } };
    const lines = beatLines(tri, nm, false);
    expect(lines.previously).toContain(`${nm(C)} is close to both of them`);
    const cast = new Set([A, B, C]);
    expect(beatWants(tri, nm, cast).map((w) => [w.holder, w.kind])).toEqual([
      [A, "settle_score"],
      [B, "settle_score"],
      [C, "protect"],
    ]);
    const stage: Stage = { cast, lead: null, venues: [] };
    const room = beatTwists(tri, nm, stage, "2026-11-12")!;
    expect(room).toHaveLength(2);
    expect(room.every((x) => x.premise.endsWith(`for ${nm(C)}'s sake.`))).toBe(true);
  });
});
