import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getTense } from "@/app/api/graph/tense/route";
import { setDbForTests } from "@/lib/db";
import { tenseFrom, tenseSky, type TenseSky } from "@/lib/social/tense";
import { upsertTie } from "@/lib/social/ties";
import type { TieInput } from "@/lib/social/types";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Tense triangles (lib/social/tense.ts, /api/graph/tense, the section under /graph): the public network's unbalanced
// triangles as story hooks, two at odds and everyone they're both close to, or three all at odds.

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
  vi.unstubAllEnvs();
});

const row = (from: string, to: string, kind: string, valence: number, at: string | null = null) => ({ id: `${from}-${to}-${kind}`, from_id: from, to_id: to, kind, valence, at });

describe("tense triangles, from ties", () => {
  it("finds two at odds who are both close to a third, and three all at odds; a happy triangle isn't tense", () => {
    const found = tenseFrom([
      row("a", "b", "feud", -1, "2026-11-10T00:00:00Z"),
      row("a", "c", "best_friend", 2, "2026-11-01T00:00:00Z"),
      row("b", "c", "coworker", 1),
      row("d", "e", "rival", -1, "2026-11-12T00:00:00Z"),
      row("d", "f", "enemy", -2),
      row("e", "f", "feud", -1),
      row("g", "h", "friend", 1),
      row("g", "i", "friend", 1),
      row("h", "i", "friend", 1),
    ]);
    expect(found).toMatchObject({ unbalanced: 2, balanced: 1, groups: 2 });
    // The one that moved last first.
    expect(found.hooks.map((x) => x.shape)).toEqual(["three", "two"]);
    const [three, two] = found.hooks;
    expect(three).toMatchObject({ key: "d|e|f", a: "d", b: "e", about: ["f"], more: 0 });
    expect(three.sides.map((s) => s.kinds)).toEqual([["rival"], ["enemy"], ["feud"]]);
    expect(two).toMatchObject({ key: "a|b", a: "a", b: "b", about: ["c"], more: 0, warm: ["best_friend", "coworker"], at: "2026-11-10T00:00:00.000Z" });
    // Only the sour side: the card's sentence already says the rest.
    expect(two.sides).toEqual([{ a: "a", b: "b", sign: -1, kinds: ["feud"], evidence: [], at: "2026-11-10T00:00:00.000Z" }]);
  });

  it("gathers a sour pair's triangles into one hook, naming the thirds that moved last first", () => {
    const rows = [row("a", "b", "rival", -1, "2026-11-01T00:00:00Z")];
    // a and b both dated c to h; the later the date, the sooner it's named.
    for (const [i, x] of ["c", "d", "e", "f", "g", "h"].entries()) rows.push(row("a", x, "dated", 1, `2026-11-0${i + 2}T00:00:00Z`), row("b", x, "dated", 1));
    const found = tenseFrom(rows, { about: 4 });
    expect(found).toMatchObject({ unbalanced: 6, groups: 1 });
    expect(found.hooks).toHaveLength(1);
    expect(found.hooks[0]).toMatchObject({ a: "a", b: "b", about: ["h", "g", "f", "e"], more: 2, warm: ["dated"], at: "2026-11-07T00:00:00.000Z" });
  });

  it("weighs a pair's ties together: coworkers who are also rivals are neither, and make no triangle", () => {
    const found = tenseFrom([row("a", "b", "rival", -1), row("a", "b", "coworker", 1), row("a", "c", "friend", 1), row("b", "c", "friend", 1)]);
    expect(found).toMatchObject({ unbalanced: 0, balanced: 0, groups: 0, hooks: [] });
  });

  it("names a sour side by whatever pulls it each way", () => {
    // Bad blood outweighs having dated: the side is sour, and says so by its sour kind.
    const found = tenseFrom([row("a", "b", "bad_blood", -2), row("a", "b", "dated", 1), row("a", "c", "friend", 1), row("b", "c", "sibling", 1)]);
    expect(found.hooks[0].sides.map((s) => s.kinds)).toEqual([["bad_blood"]]);
    expect(found.hooks[0].warm).toEqual(["friend", "sibling"]);
  });
});

const ID = (k: string) => `tt-${k}`;
const owner = userIdOf(newUserCookie());
async function character(k: string, visibility = "public") {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, avatar_hue, extras)
     values ($1, $2, false, $3, 30, 'Keeps bees and opinions.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, 120, '{}'::jsonb)`,
    [ID(k), owner, `Tense ${k[0].toUpperCase()}${k.slice(1)}`, visibility],
  );
}
const tie = async (input: TieInput) => {
  const w = await upsertTie(t.db, input);
  if (!w.ok) throw new Error(`tie refused: ${w.reason}`);
};

describe("tense triangles on the site", () => {
  it("reads the public, active ties between public characters, names the three and keeps what made each side", async () => {
    for (const k of ["ada", "bea", "cal", "dee", "eve"]) await character(k);
    await character("zed", "private");
    await tie({ from: ID("ada"), to: ID("bea"), kind: "feud", source: "derived", evidence: { ref: "scene:tt-scene#1", at: "2026-11-18T20:00:00.000Z" } });
    await tie({ from: ID("ada"), to: ID("cal"), kind: "best_friend", source: "owner" });
    await tie({ from: ID("bea"), to: ID("cal"), kind: "coworker", source: "owner" });
    // Not on the record: a private character's ties, a tie that's over, an owner-only one.
    await tie({ from: ID("ada"), to: ID("zed"), kind: "friend", source: "owner" });
    await tie({ from: ID("bea"), to: ID("zed"), kind: "friend", source: "owner" });
    await tie({ from: ID("dee"), to: ID("ada"), kind: "rival", source: "owner", status: "ended" });
    await tie({ from: ID("dee"), to: ID("cal"), kind: "friend", source: "owner" });
    await tie({ from: ID("dee"), to: ID("eve"), kind: "enemy", source: "owner", visibility: "owner" });
    await tie({ from: ID("eve"), to: ID("cal"), kind: "friend", source: "owner" });

    const sky = (await tenseSky(t.db))!;
    expect(sky).toMatchObject({ unbalanced: 1, groups: 1 });
    expect(sky.hooks).toHaveLength(1);
    const [hook] = sky.hooks;
    expect(hook).toMatchObject({ shape: "two", a: ID("ada"), b: ID("bea"), about: [ID("cal")], more: 0 });
    expect(sky.names).toEqual({ [ID("ada")]: "Tense Ada", [ID("bea")]: "Tense Bea", [ID("cal")]: "Tense Cal" });
    expect(hook.sides).toHaveLength(1);
    expect(hook.sides[0].evidence).toEqual([{ ref: "scene:tt-scene#1", at: "2026-11-18T20:00:00.000Z" }]);
    expect(JSON.stringify(sky)).not.toContain(ID("zed"));

    const res = await getTense(new Request(`${BASE_URL}/api/graph/tense`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TenseSky;
    expect(body.hooks).toHaveLength(1);
  });

  it("is nothing with the views off", async () => {
    vi.stubEnv("SOCIAL_LENSES", "0");
    expect(await tenseSky(t.db)).toBeNull();
    expect((await getTense(new Request(`${BASE_URL}/api/graph/tense`))).status).toBe(404);
  });
});
