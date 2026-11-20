import { describe, expect, it } from "vitest";
import { STAGES } from "@/lib/relationship-stages";
import { DATE_VENUES } from "@/lib/venues";
import { HOUSE_PLACES } from "@/lib/house-scenes";
import { canDeclare, isDerivedOnly, isTieKind, kindDef, kindsOnLayer, layerOfDated, otherEnd, TIE_KIND_IDS, TIE_KINDS, tieKey, valenceOfDated } from "@/lib/social/kinds";
import { mergeEvidence, tieChanges, tieIdOf } from "@/lib/social/ties";
import { checkPerson } from "@/lib/social/people";
import { hometownOf, placeIdOf, slugify } from "@/lib/social/places";
import { socialDeclareOn, socialTiesOn } from "@/lib/social/switch";
import { HOUSE_PLACE, NEIGHBOURHOODS, neighbourhoodOfVenue, WORLD_CITY, worldPlaces } from "@/lib/social/world";
import { EVIDENCE_KEPT, LAYERS, RINGS, type Evidence, type Tie } from "@/lib/social/types";

// The social network's pure parts (docs/PRDs/social-network.md): the kinds registry, keys and ids, evidence, the words
// checks, hometowns and the seeded world. The database side is tests/social-ties.test.ts and tests/social-world.test.ts.

/** The PRD's kinds, layer by layer (section 5.1): the registry has every one, on that layer, and nothing else. */
const PRD_KINDS: Record<string, string[]> = {
  kin: ["parent", "sibling", "half_sibling", "step_sibling", "cousin", "grandparent", "aunt_uncle", "in_law", "family"],
  romance: ["spouse", "partner", "engaged", "ex", "crush", "first_love", "situationship", "fake_couple", "dated"],
  friendship: ["best_friend", "close_friend", "friend", "childhood_friend", "old_friend", "roommate", "pen_pal"],
  work: ["coworker", "manager", "business_partner", "mentor", "classmate", "teammate", "bandmate"],
  place: ["neighbour"],
  conflict: ["rival", "nemesis", "enemy", "grudge", "frenemy", "feud", "bad_blood"],
  acquaintance: ["acquaintance", "met_at_group_night", "housemate", "met_on_show"],
  communication: ["talked_about", "told"],
};

describe("the kinds registry", () => {
  it("has every kind the PRD names, on its layer, and no other", () => {
    for (const [layer, kinds] of Object.entries(PRD_KINDS)) expect(kindsOnLayer(layer as (typeof LAYERS)[number]).sort(), layer).toEqual([...kinds].sort());
    expect(TIE_KIND_IDS.length).toBe(Object.values(PRD_KINDS).flat().length);
    expect(Object.keys(PRD_KINDS).sort()).toEqual([...LAYERS].sort());
  });

  it("marks the PRD's directed, exclusive and derived kinds", () => {
    expect(TIE_KIND_IDS.filter((k) => TIE_KINDS[k].directed).sort()).toEqual(["aunt_uncle", "crush", "grandparent", "grudge", "manager", "mentor", "parent", "talked_about", "told"]);
    expect(Object.fromEntries(TIE_KIND_IDS.filter((k) => TIE_KINDS[k].exclusive).map((k) => [k, TIE_KINDS[k].exclusive]))).toEqual({
      spouse: 1,
      engaged: 1,
      first_love: 1,
      best_friend: 3,
      nemesis: 1,
    });
    expect(TIE_KIND_IDS.filter(isDerivedOnly).sort()).toEqual(["bad_blood", "dated", "feud", "housemate", "met_at_group_night", "met_on_show", "talked_about", "told"]);
  });

  it("keeps every kind's numbers and words in range", () => {
    for (const k of TIE_KIND_IDS) {
      const d = kindDef(k);
      expect(d.id).toBe(k);
      expect(LAYERS, k).toContain(d.layer);
      expect(RINGS, k).toContain(d.ring);
      expect(d.valence, k).toBeGreaterThanOrEqual(-2);
      expect(d.valence, k).toBeLessThanOrEqual(2);
      expect(d.closeness, k).toBeGreaterThan(0);
      expect(d.closeness, k).toBeLessThanOrEqual(1);
      if (d.halfLifeDays !== null) expect(d.halfLifeDays, k).toBeGreaterThan(0);
      // A conflict is negative, and only a conflict; nothing negative feels warm.
      expect(d.negative, k).toBe(d.layer === "conflict");
      if (d.negative) expect(d.valence, k).toBeLessThan(0);
      // A directed kind reads two ways; a symmetric one the same both ways, and only a symmetric one has a cap.
      if (d.directed) {
        expect(d.inverse, k).toBeTruthy();
        expect(d.words.from, k).not.toBe(d.words.to);
        expect(d.exclusive, k).toBeUndefined();
      } else {
        expect(d.inverse, k).toBeUndefined();
        expect(d.words.from, k).toBe(d.words.to);
      }
      expect(d.emoji.length, k).toBeGreaterThan(0);
    }
  });

  it("lets anyone but what aired declare the declarable kinds, and nobody the derived ones", () => {
    expect(canDeclare("sibling", "owner")).toBe(true);
    expect(canDeclare("sibling", "agent")).toBe(true);
    expect(canDeclare("rival", "house")).toBe(true);
    expect(canDeclare("dated", "owner")).toBe(false);
    expect(canDeclare("feud", "admin")).toBe(false);
    expect(isTieKind("sibling")).toBe(true);
    expect(isTieKind("archnemesis")).toBe(false);
    expect(isTieKind("toString")).toBe(false);
  });
});

describe("the dated projection", () => {
  it("puts every shown stage on a layer, with a valence", () => {
    for (const s of STAGES) {
      expect(LAYERS, s).toContain(layerOfDated(s));
      expect([-2, -1, 0, 1, 2], s).toContain(valenceOfDated(s));
    }
    expect(["dating", "going_steady", "casual", "official", "moved_in", "engaged", "married", "back_together", "sparks"].map((s) => layerOfDated(s as never))).toEqual(Array(9).fill("romance"));
    expect(layerOfDated("friends")).toBe("friendship");
    expect([layerOfDated("exes"), layerOfDated("broke_up"), layerOfDated("divorced")]).toEqual(["romance", "romance", "romance"]);
    expect([valenceOfDated("exes"), valenceOfDated("broke_up"), valenceOfDated("divorced")]).toEqual([0, 0, 0]);
    expect([layerOfDated("bad_blood"), valenceOfDated("bad_blood")]).toEqual(["conflict", -2]);
    expect([layerOfDated("just_met"), layerOfDated("didnt_click")]).toEqual(["acquaintance", "acquaintance"]);
    expect([valenceOfDated("going_steady"), valenceOfDated("married"), valenceOfDated("dating")]).toEqual([2, 2, 1]);
    expect([layerOfDated(null), valenceOfDated(undefined)]).toEqual(["acquaintance", 0]);
  });
});

describe("keys and ids", () => {
  it("orders a symmetric pair, and keeps a directed tie's and a person's order", () => {
    expect(tieKey({ from: "b", to: "a", kind: "sibling" })).toEqual({ from_id: "a", to_id: "b", to_person_id: null, kind: "sibling" });
    expect(tieKey({ from: "a", to: "b", kind: "sibling" })).toEqual({ from_id: "a", to_id: "b", to_person_id: null, kind: "sibling" });
    expect(tieKey({ from: "b", to: "a", kind: "parent" })).toEqual({ from_id: "b", to_id: "a", to_person_id: null, kind: "parent" });
    expect(tieKey({ from: "b", toPerson: "per_1", kind: "sibling" })).toEqual({ from_id: "b", to_id: null, to_person_id: "per_1", kind: "sibling" });
  });

  it("hashes a key to the same id either way round, and a different one for another kind or end", () => {
    const id = tieIdOf({ from: "a", to: "b", kind: "friend" });
    expect(id).toMatch(/^tie_[0-9a-f]{32}$/);
    expect(tieIdOf({ from: "b", to: "a", kind: "friend" })).toBe(id);
    expect(tieIdOf({ from_id: "a", to_id: "b", to_person_id: null, kind: "friend" })).toBe(id);
    expect(tieIdOf({ from: "a", to: "b", kind: "rival" })).not.toBe(id);
    expect(tieIdOf({ from: "a", to: "b", kind: "parent" })).not.toBe(tieIdOf({ from: "b", to: "a", kind: "parent" }));
    expect(tieIdOf({ from: "a", toPerson: "b", kind: "friend" })).not.toBe(id);
    expect(placeIdOf("venue:dive_bar")).toBe(placeIdOf("venue:dive_bar"));
    expect(placeIdOf("venue:dive_bar")).toMatch(/^pl_[0-9a-f]{24}$/);
  });

  it("says the other end of a tie as the one looking sees it", () => {
    const parent = { from_id: "ada", to_id: "bea", to_person_id: null, kind: "parent" as const };
    expect(otherEnd(parent, "ada")).toEqual({ id: "bea", person: false, word: "parent" });
    expect(otherEnd(parent, "bea")).toEqual({ id: "ada", person: false, word: "child" });
    expect(otherEnd({ from_id: "ada", to_id: null, to_person_id: "per_mum", kind: "parent" }, "ada")).toEqual({ id: "per_mum", person: true, word: "parent" });
    expect(otherEnd({ from_id: "ada", to_id: "bea", to_person_id: null, kind: "sibling" }, "bea")).toEqual({ id: "ada", person: false, word: "sibling" });
    expect(otherEnd(parent, "cy")).toBeNull();
  });
});

describe("evidence and changes", () => {
  const ev = (n: number): Evidence => ({ ref: `episode:${n}`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() });

  it("keeps each ref once, newest first, and at most EVIDENCE_KEPT", () => {
    let kept: Evidence[] = [];
    for (let n = 1; n <= 25; n++) kept = mergeEvidence(kept, ev(n)).evidence;
    expect(kept).toHaveLength(EVIDENCE_KEPT);
    expect(kept.map((e) => e.ref)).toEqual(Array.from({ length: 20 }, (_, i) => `episode:${25 - i}`));
    expect(mergeEvidence(kept, ev(25))).toEqual({ evidence: kept, added: false });
    // One older than all twenty it keeps isn't kept, and says so.
    expect(mergeEvidence(kept, { ref: "episode:old", at: "2025-01-01T00:00:00.000Z" }).added).toBe(false);
    // One that falls in the middle goes in its place, and the oldest falls off.
    const middle = mergeEvidence(kept, { ref: "scene:x", at: new Date(Date.UTC(2026, 0, 1, 0, 10, 30)).toISOString() });
    expect(middle.added).toBe(true);
    expect(middle.evidence).toHaveLength(EVIDENCE_KEPT);
    expect(middle.evidence.at(-1)?.ref).toBe("episode:7");
    expect(mergeEvidence([], null)).toEqual({ evidence: [], added: false });
  });

  it("logs each changed field as [from, to], a detail key as detail.<key>, and nothing else", () => {
    const tie = { valence: 1, closeness: 0.5, status: "active", detail: { stage: "dating", dates: 2 }, story: null, created_by: "u1" } as unknown as Tie;
    const after = { ...tie, valence: 2, detail: { stage: "going_steady", dates: 2 }, created_by: "u2" } as unknown as Tie;
    expect(tieChanges(tie, after)).toEqual({ valence: [1, 2], "detail.stage": ["dating", "going_steady"] });
    expect(tieChanges(tie, { ...tie, detail: { dates: 2, stage: "dating" } } as Tie)).toEqual({});
  });
});

describe("words", () => {
  it("checks a person's name, pronouns and note", () => {
    expect(checkPerson({ name: "  Mum  ", pronouns: " she/her ", note: "" })).toEqual({ ok: true, name: "Mum", pronouns: "she/her", note: null });
    expect(checkPerson({ name: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(checkPerson({ name: "x".repeat(41) })).toEqual({ ok: false, reason: "too_long" });
    expect(checkPerson({ name: "Jo", pronouns: "x".repeat(21) })).toEqual({ ok: false, reason: "too_long" });
    expect(checkPerson({ name: "Jo", note: "x".repeat(161) })).toEqual({ ok: false, reason: "too_long" });
    expect(checkPerson({ name: "Jo", note: "She was only fifteen" })).toEqual({ ok: false, reason: "unsafe" });
    // A patch that leaves the name alone checks only what it gives.
    expect(checkPerson({ note: "runs the bakery" })).toEqual({ ok: true, name: undefined, pronouns: undefined, note: "runs the bakery" });
  });

  it("reads a hometown from what a sheet says", () => {
    expect(hometownOf("Leeds")).toEqual({ key: "hometown:leeds", name: "Leeds" });
    expect(hometownOf("Lagos, then Atlanta")?.key).toBe("hometown:lagos");
    expect(hometownOf("Lagos then Atlanta")?.key).toBe("hometown:lagos");
    expect(hometownOf("Leeds (mostly)")?.key).toBe("hometown:leeds");
    expect(hometownOf("just outside Leeds")).toEqual({ key: "hometown:leeds", name: "Leeds" });
    expect(hometownOf("The Hague")?.key).toBe(hometownOf("the hague")?.key);
    expect(hometownOf("The Hague")?.name).toBe("The Hague");
    expect(hometownOf("São Paulo")?.key).toBe("hometown:sao-paulo");
    expect(hometownOf("St. Ives — Cornwall")?.key).toBe("hometown:st-ives");
    expect(hometownOf("  ")).toBeNull();
    expect(hometownOf(null)).toBeNull();
    expect(hometownOf("!!!")).toBeNull();
    expect(slugify("Rock 'n' Roll Café")).toBe("rock-n-roll-cafe");
    expect(slugify("a".repeat(60)).length).toBeLessThanOrEqual(48);
  });
});

describe("switches", () => {
  it("are on unless set to 0, and declaring needs ties on", () => {
    expect(socialTiesOn({})).toBe(true);
    expect(socialTiesOn({ SOCIAL_TIES: "0" })).toBe(false);
    expect(socialTiesOn({ SOCIAL_TIES: " 0 " })).toBe(false);
    expect(socialTiesOn({ SOCIAL_TIES: "1" })).toBe(true);
    expect(socialDeclareOn({})).toBe(true);
    expect(socialDeclareOn({ SOCIAL_DECLARE: "0" })).toBe(false);
    expect(socialDeclareOn({ SOCIAL_TIES: "0" })).toBe(false);
  });
});

describe("the seeded world", () => {
  it("has the city, its neighbourhoods, the house and its rooms, and every date venue, parents first", async () => {
    const places = await worldPlaces();
    const keys = places.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(WORLD_CITY.key);
    expect(keys).toContain(HOUSE_PLACE.key);
    for (const room of HOUSE_PLACES) expect(keys).toContain(`house:${room.id}`);
    for (const v of DATE_VENUES) expect(keys).toContain(`venue:${v.id}`);
    expect(places).toHaveLength(1 + NEIGHBOURHOODS.length + 1 + HOUSE_PLACES.length + DATE_VENUES.length);
    // Every parent is a place of the world that comes before it.
    for (const [i, p] of places.entries()) {
      if (!p.parentKey) continue;
      expect(keys.indexOf(p.parentKey), p.key).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf(p.parentKey), p.key).toBeLessThan(i);
    }
    for (const p of places) {
      expect(p.name.length, p.key).toBeGreaterThan(0);
      expect(p.name.length, p.key).toBeLessThanOrEqual(60);
      expect((p.description ?? "").length, p.key).toBeLessThanOrEqual(200);
      expect(p.source).toBe("house");
    }
    expect(places.filter((p) => p.kind === "hangout").every((p) => !!p.venue_id)).toBe(true);
  });

  it("puts each neighbourhood's venues in it, names only real venues, and leaves the rest out of town", () => {
    const ids = new Set<string>(DATE_VENUES.map((v) => v.id));
    const listed = NEIGHBOURHOODS.flatMap((n) => [...n.venues]);
    expect(listed.filter((v) => !ids.has(v))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
    expect(NEIGHBOURHOODS.length).toBeGreaterThanOrEqual(5);
    expect(neighbourhoodOfVenue("dive_bar")?.name).toBe("Neon Mile");
    expect(neighbourhoodOfVenue("no_such_venue")).toBeNull();
  });
});
