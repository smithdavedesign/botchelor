import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink, linkBetween, linkContext, linksOf } from "@/lib/character-links";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { buildDate, DEFAULT_DATE_REQUEST, type CharacterForDate } from "@/lib/simulation";
import { startTestDb } from "./helpers";

// Who already knew whom before the show (lib/character-links.ts, PRD styles-and-storylines phase 4): stored once a pair,
// and told to both sides of their dates. Season-gen's linked newcomers are tests/season-gen.test.ts.
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

const [A, B, C] = HOUSE_CHARACTERS;
const forDate = (c: (typeof HOUSE_CHARACTERS)[number]): CharacterForDate => ({
  id: c.id,
  sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: true },
});

describe("links", () => {
  it("keeps one link a pair, either way round, and a later one replaces it", async () => {
    await addLink(t.db, B.id, A.id, "rivals", "They both bid on the same lighthouse.");
    expect(await linkBetween(t.db, A.id, B.id)).toEqual({ ...ordered(A.id, B.id), kind: "rivals", story: "They both bid on the same lighthouse.", source: "season_gen" });
    await addLink(t.db, A.id, B.id, "second_chance", "They dated one summer.", "admin");
    expect(await linkBetween(t.db, B.id, A.id)).toMatchObject({ kind: "second_chance", source: "admin" });
    await addLink(t.db, A.id, C.id, "friends_to_more", "Neighbours for a decade.");
    expect((await linksOf(t.db, [A.id])).map((l) => l.kind)).toEqual(["second_chance", "friends_to_more"]);
    expect(await linksOf(t.db, [C.id])).toHaveLength(1);
    expect(await linkBetween(t.db, B.id, C.id)).toBeNull();
    // Nobody is linked to themselves.
    await addLink(t.db, A.id, A.id, "rivals", "x");
    expect(await linksOf(t.db, [A.id])).toHaveLength(2);
  });

  it("says the link as one side hears it, by the other's first name", () => {
    const link = { lo: A.id, hi: B.id, kind: "second_chance" as const, story: "They dated one summer.", source: "season_gen" };
    expect(linkContext(link, "Rafe Calloway")).toEqual({ before_the_show: "You and Rafe are exes: They dated one summer." });
    expect(linkContext({ ...link, kind: "fake_dating" }, "Rafe Calloway")?.before_the_show).toMatch(/^You and Rafe once pretended to be a couple: /);
    expect(linkContext(null, "Rafe")).toBeNull();
  });
});

describe("a linked pair's date", () => {
  it("tells both sides who they were to each other before the show, and leaves an unlinked pair's date as it was", async () => {
    const plain = await buildDate(t.db, "link-ep-1", forDate(A), forDate(B), DEFAULT_DATE_REQUEST);
    expect(plain.characters.map((c) => c.pair?.before_the_show)).toEqual([undefined, undefined]);
    await addLink(t.db, A.id, B.id, "rivals", "They both bid on the same lighthouse.");
    const linked = await buildDate(t.db, "link-ep-1", forDate(A), forDate(B), DEFAULT_DATE_REQUEST);
    const first = (name: string) => name.split(" ")[0];
    expect(linked.characters[0].pair?.before_the_show).toBe(`You and ${first(B.name)} are old rivals: They both bid on the same lighthouse.`);
    expect(linked.characters[1].pair?.before_the_show).toBe(`You and ${first(A.name)} are old rivals: They both bid on the same lighthouse.`);
    // The director and the narrator get it in the third person; it's words both already know.
    expect(linked.characters[0].knownBefore).toBe(`${first(A.name)} and ${first(B.name)} knew each other before the show: they are old rivals. They both bid on the same lighthouse.`);
    expect(linked.characters[0].pairShared).toContain("They both bid on the same lighthouse.");
    expect(plain.characters[0].knownBefore).toBeUndefined();
    // Flavour only: the engine's input is the same date.
    expect(linked.input).toEqual(plain.input);
  });
});

function ordered(x: string, y: string) {
  return x < y ? { lo: x, hi: y } : { lo: y, hi: x };
}
