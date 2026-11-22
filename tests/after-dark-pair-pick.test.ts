import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PairPicker from "@/app/after-dark/PairPicker";
import { byName, capGroups, FACES_SHOWN, oneFaceGroups, pairOf, pairPath, pickerData, pickGroups, surprisePair, whoseCounts, whoseFilters } from "@/lib/adult/pair-pick";
import type { CastMember, CastPair } from "@/lib/adult/scenes";

// The hub's pair picker (lib/adult/pair-pick.ts; David, 2026-11-18: "change the choose a new pair to be better ux like a
// picker with a search"): what the panel shows for what's picked and typed, the filters, 🎲, and the page's data.

const who = (id: string, name: string, extra: Partial<CastMember> = {}): CastMember => ({ id, name, portrait: null, ...extra });
const sweet = who("c-sweet", "Sweet Calloway", { house: true });
const star = who("c-star", "Star Okonkwo", { house: true });
const ines = who("c-ines", "Inès Valdecasas", { mine: true });
const juniper = who("c-juniper", "Juniper Hale", { house: true });
const dex = who("c-dex", "Dex Morrow");
const gone = who("c-gone", "Rafe Gone", { house: true });
const everyone = [sweet, star, ines, juniper, dex];

/** Every pair of the cast as listCastPairs makes them (ids in order), some under way, plus one kept from October. */
function allPairs(going: Record<string, Partial<CastPair>> = {}): CastPair[] {
  const sorted = [...everyone].sort((x, y) => (x.id < y.id ? -1 : 1));
  const out: CastPair[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const path = pairPath(sorted[i].id, sorted[j].id);
      out.push({ a: sorted[i], b: sorted[j], lines: 0, path, ...(going[path] ?? {}) });
    }
  out.push({ a: gone, b: sweet, lines: 40, path: pairPath(gone.id, sweet.id), earlier: "From October's cast", updated_at: "2026-10-30T00:00:00Z" });
  return out;
}
const names = (groups: ReturnType<typeof pickGroups>) => groups.map((g) => [g.label, g.faces.map((f) => f.c.name.split(" ")[0])]);

describe("the picker's data", () => {
  it("is the cast once each (A to Z, not who left) and the nights under way, latest first: never every pair", () => {
    const pairs = allPairs({
      [pairPath(star.id, sweet.id)]: { lines: 38, updated_at: "2026-11-10T00:00:00Z", a: { ...star, photo: "/face-star" } },
      [pairPath(dex.id, juniper.id)]: { lines: 0, chapter: 2, updated_at: "2026-11-12T00:00:00Z" },
    });
    const data = pickerData(pairs);
    expect(data.cast.map((c) => c.name)).toEqual(["Dex Morrow", "Inès Valdecasas", "Juniper Hale", "Star Okonkwo", "Sweet Calloway"]);
    // The face kept for this viewer wins over the bare portrait, whichever pair carried it.
    expect(data.cast.find((c) => c.id === star.id)?.photo).toBe("/face-star");
    expect(data.nights.map((p) => p.path)).toEqual([pairPath(dex.id, juniper.id), pairPath(star.id, sweet.id), pairPath(gone.id, sweet.id)]);
    expect(data.firstScene).toBe(pairs[0].path);
  });

  it("makes a pair nobody has started from its two faces, at the server's address, either way round", () => {
    const { cast, nights } = pickerData(allPairs({ [pairPath(star.id, sweet.id)]: { lines: 3 } }));
    expect(pairOf(cast, nights, sweet.id, star.id)?.lines).toBe(3);
    const fresh = pairOf(cast, nights, juniper.id, dex.id)!;
    expect(fresh.path).toBe(allPairs().find((p) => [p.a.id, p.b.id].sort().join() === [dex.id, juniper.id].sort().join())!.path);
    expect(fresh.lines).toBe(0);
    expect(pairOf(cast, nights, dex.id, juniper.id)?.path).toBe(fresh.path);
    expect(pairOf(cast, nights, dex.id, dex.id)).toBeNull();
    // Who left the cast isn't a face to start a new pair with.
    expect(pairOf(cast, nights, gone.id, dex.id)).toBeNull();
  });
});

describe("what the panel shows", () => {
  const data = pickerData(
    allPairs({
      [pairPath(star.id, sweet.id)]: { lines: 38, updated_at: "2026-11-10T00:00:00Z" },
      [pairPath(dex.id, juniper.id)]: { lines: 6, chapter: 3, updated_at: "2026-11-12T00:00:00Z" },
    }),
  );
  const groups = (one: string | null, query = "", whose: "all" | "house" | "mine" = "all") => pickGroups(data.cast, data.nights, { one, query, whose });

  it("first, the faces from their nights (latest played first), then everyone else A to Z", () => {
    expect(names(groups(null))).toEqual([
      ["From your nights", ["Dex", "Juniper", "Star", "Sweet"]],
      ["Everyone else", ["Inès"]],
    ]);
  });

  it("finds by any part of a name, accents and case aside, a name that starts with it first", () => {
    expect(names(groups(null, "INES"))).toEqual([["1 match", ["Inès"]]]);
    // "o" starts Okonkwo, and is only inside Morrow and Calloway.
    expect(names(groups(null, "o"))).toEqual([["3 matches", ["Star", "Dex", "Sweet"]]]);
    expect(groups(null, "nobody")).toEqual([]);
  });

  it("one face at a time (Step in's set-up): whole names A to Z, or the search's matches, a word that starts with it first", () => {
    const step = [sweet, star, ines, juniper, dex, who("c-alex-r", "Alex Reyes"), who("c-alex-m", "Alex Moreau")].map(({ id, name }) => ({ id, name }));
    expect(byName(step, "").map((c) => c.name)).toEqual(["Alex Moreau", "Alex Reyes", "Dex Morrow", "Inès Valdecasas", "Juniper Hale", "Star Okonkwo", "Sweet Calloway"]);
    expect(byName(step, "alex").map((c) => c.name)).toEqual(["Alex Moreau", "Alex Reyes"]);
    expect(byName(step, " VALDE ").map((c) => c.id)).toEqual(["c-ines"]);
    // "mor" starts Moreau and Morrow; nothing has it inside.
    expect(byName(step, "mor").map((c) => c.name)).toEqual(["Alex Moreau", "Dex Morrow"]);
    expect(byName(step, "o").map((c) => c.name)).toEqual(["Star Okonkwo", "Alex Moreau", "Dex Morrow", "Sweet Calloway"]);
    expect(byName(step, "nobody")).toEqual([]);
  });

  it("Step in's groups: from their scenes (latest first), the house cast, everyone else; one list of matches once typed", () => {
    const step = [sweet, star, ines, juniper, dex].map(({ id, name, house }) => ({ id, name, house }));
    const label = (g: { label: string; faces: { name: string }[] }[]) => g.map((x) => [x.label, x.faces.map((f) => f.name.split(" ")[0])]);
    expect(label(oneFaceGroups(step, [], ""))).toEqual([
      ["House cast", ["Juniper", "Star", "Sweet"]],
      ["Everyone else", ["Dex", "Inès"]],
    ]);
    expect(label(oneFaceGroups(step, [dex.id, star.id, dex.id, "c-gone"], ""))).toEqual([
      ["From your scenes", ["Dex", "Star"]],
      ["House cast", ["Juniper", "Sweet"]],
      ["Everyone else", ["Inès"]],
    ]);
    expect(label(oneFaceGroups([ines, dex].map(({ id, name }) => ({ id, name })), [], ""))).toEqual([["Everyone · 2", ["Dex", "Inès"]]]);
    expect(label(oneFaceGroups(step, [dex.id], "ines"))).toEqual([["1 match", ["Inès"]]]);
    expect(oneFaceGroups(step, [dex.id], "nobody")).toEqual([]);
  });

  it("filters to the house cast or theirs", () => {
    expect(names(groups(null, "", "mine"))).toEqual([["Everyone · 1", ["Inès"]]]);
    expect(names(groups(null, "", "house")).flatMap(([, n]) => n)).toEqual(["Juniper", "Star", "Sweet"]);
  });

  it("once one is picked, who they can be with: their nights first, saying how far, then someone new, the house cast first", () => {
    expect(groups(sweet.id)).toEqual([
      { label: "Their nights with Sweet", faces: [{ c: expect.objectContaining({ id: star.id }), meta: "38 lines" }] },
      { label: "Someone new", faces: ["Juniper", "Dex", "Inès"].map((n) => ({ c: expect.objectContaining({ name: expect.stringMatching(new RegExp(`^${n}`)) }) })) },
    ]);
    expect(groups(juniper.id)[0]).toMatchObject({ faces: [{ meta: "Chapter 3" }] });
    expect(names(groups(ines.id))).toEqual([["Who Inès can be with · 4", ["Juniper", "Star", "Sweet", "Dex"]]]);
    // Typed, the matches by how well they match, as before.
    expect(names(groups(ines.id, "sw"))).toEqual([["Who Inès can be with · 1", ["Sweet"]]]);
  });

  it("with no nights yet: the house cast, then everyone else (only where the house cast is some of them)", () => {
    const fresh = pickerData(allPairs());
    expect(names(pickGroups(fresh.cast, [], { one: null, query: "", whose: "all" }))).toEqual([
      ["House cast", ["Juniper", "Star", "Sweet"]],
      ["Everyone else", ["Dex", "Inès"]],
    ]);
    const house = [star, sweet];
    expect(names(pickGroups(house, [], { one: null, query: "", whose: "all" }))).toEqual([["Everyone · 2", ["Star", "Sweet"]]]);
  });
});

describe("a short panel (the 2026-11-22 audit: all 227 faces were drawn and loaded)", () => {
  const many = (n: number, extra: Partial<CastMember> = {}) => Array.from({ length: n }, (_, i) => who(`c-${String(i).padStart(3, "0")}`, `Person ${String(i).padStart(3, "0")}`, extra));
  const house = many(16, { house: true }).map((c, i) => ({ ...c, id: `h-${i}`, name: `House ${String(i).padStart(2, "0")}` }));
  const rest = many(211);
  const cast = [...house, ...rest];

  it("cuts each group to FACES_SHOWN, saying how many it leaves out, and shows them all on request", () => {
    const groups = pickGroups(cast, [], { one: null, query: "", whose: "all" });
    const short = capGroups(groups, FACES_SHOWN);
    expect(short.map((g) => [g.label, g.faces.length, g.hidden])).toEqual([
      ["House cast", 12, 4],
      ["Everyone else", 12, 199],
    ]);
    expect(capGroups(groups, Infinity).map((g) => [g.faces.length, g.hidden])).toEqual([
      [16, 0],
      [211, 0],
    ]);
    // A short group stays whole.
    expect(capGroups([{ label: "x", faces: [{ c: sweet }] }], 12)).toEqual([{ label: "x", faces: [{ c: sweet }], hidden: 0 }]);
  });

  it("the hub draws the short groups with a Show all, and leaves the hero's night out of Continue", () => {
    const pairs: CastPair[] = [
      { a: house[0], b: rest[0], lines: 12, path: pairPath(house[0].id, rest[0].id), updated_at: "2026-11-21T00:00:00Z", last: null, chapter: 1 },
      { a: house[1], b: rest[1], lines: 3, path: pairPath(house[1].id, rest[1].id), updated_at: "2026-11-20T00:00:00Z", last: null, chapter: 1 },
    ];
    const html = renderToStaticMarkup(createElement(PairPicker, { cast, nights: pairs, firstScene: pairs[0].path, featured: pairs[0].path }));
    // Their 4 from the nights, then 12 of the other 14 house faces, then 12 of the other 209.
    expect(html.match(/data-face=/g)?.length).toBe(4 + 12 + 12);
    expect(html).toContain("Show all 14");
    expect(html).toContain("Show all 209");
    expect(html).not.toContain(`data-night="${pairs[0].path}"`);
    expect(html).toContain(`data-night="${pairs[1].path}"`);
    // With only the hero's night under way, no Continue list at all.
    const one = renderToStaticMarkup(createElement(PairPicker, { cast, nights: pairs.slice(0, 1), firstScene: pairs[0].path, featured: pairs[0].path }));
    expect(one).not.toContain("data-night=");
    expect(one).not.toMatch(/>Continue</);
  });
});

describe("the filters and 🎲", () => {
  it("shows a filter only where it splits the cast", () => {
    expect(whoseFilters(whoseCounts(everyone))).toEqual(["all", "house", "mine"]);
    expect(whoseFilters(whoseCounts([sweet, star]))).toEqual([]);
    expect(whoseFilters(whoseCounts([dex, ines]))).toEqual(["all", "mine"]);
    expect(whoseFilters(whoseCounts([sweet, dex]))).toEqual(["all", "house"]);
  });

  it("draws a pair they haven't started, and any pair once they've started them all", () => {
    const { cast, nights } = pickerData(allPairs({ [pairPath(star.id, sweet.id)]: { lines: 1 } }));
    for (let i = 0; i < 20; i++) {
      const p = surprisePair(cast, nights, Math.random)!;
      expect(p.lines).toBe(0);
      expect(p.a.id).not.toBe(p.b.id);
    }
    const two = pickerData([{ a: star, b: sweet, lines: 4, path: pairPath(star.id, sweet.id) }]);
    expect(surprisePair(two.cast, two.nights)?.lines).toBe(4);
    expect(surprisePair([star], [])).toBeNull();
  });
});
