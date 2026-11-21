import { describe, expect, it } from "vitest";
import { rings } from "@/lib/social/algorithms";
import { TIE_KINDS, type TieKindId } from "@/lib/social/kinds";
import { bareName, midSentence } from "@/lib/social/place-name";
import type { EgoNetwork, TieView } from "@/lib/social/types";
import {
  arcPath,
  CENTRE_RADIUS,
  EDGE_RADIUS,
  labelPath,
  labelSpan,
  lineEnds,
  nameLayout,
  norm,
  PERSON_RADIUS,
  ROLE_WORDS,
  oddsArc,
  RING_RADIUS,
  ringAngles,
  spreadLabels,
  WORLD_SIZE,
  worldPicture,
  type WorldMember,
} from "@/lib/social/world-picture";

const node = (id: string, extra: Partial<{ private: boolean; portrait: string | null; hue: number | null }> = {}) => ({ id, name: id.toUpperCase(), private: false, portrait: null, hue: null, ...extra });
let n = 0;
function tie(from: string, to: string, kind: TieKindId, extra: Partial<TieView> = {}): TieView {
  const k = TIE_KINDS[kind];
  return {
    id: `t${n++}`,
    from,
    to,
    to_person: null,
    kind,
    layer: k.layer,
    directed: k.directed,
    valence: k.valence,
    closeness: k.closeness,
    status: "active",
    visibility: "public",
    source: "owner",
    source_ref: null,
    evidence: [],
    detail: {},
    story: null,
    since_text: null,
    started_at: null,
    ended_at: null,
    last_contact_at: null,
    ...extra,
  };
}

/** An ego network as lib/social/read.ts egoNetwork builds it, rings and all. */
function world(centre: string, ties: TieView[], o: Partial<EgoNetwork> = {}): EgoNetwork {
  const ids = new Set(ties.flatMap((t) => [t.from, t.to]).filter((x): x is string => Boolean(x) && x !== centre));
  const ringTies = ties.filter((t) => t.status === "active").map((t) => ({ other: t.to_person ?? (t.from === centre ? t.to! : t.from), closeness: t.closeness, ring: TIE_KINDS[t.kind].ring }));
  return {
    centre: node(centre),
    nodes: [...ids].map((id) => node(id)),
    ties,
    masked: [],
    people: [],
    memberships: [],
    places: [],
    shared: [],
    rings: rings(ringTies),
    personal: false,
    ...o,
  };
}

describe("round a ring", () => {
  it("starts at the top and goes round evenly with nobody at odds", () => {
    expect(ringAngles(4, 0)).toEqual([-90, 0, 90, -180]);
    expect(ringAngles(0, 0)).toEqual([]);
  });

  it("puts those at odds at the foot, centred on it, and the rest on round from there", () => {
    const a = ringAngles(6, 2);
    // The last two (the odds) straddle the foot.
    expect(a.slice(4)).toEqual([60, 120]);
    // Everyone's 60° apart.
    const sorted = [...a].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(60);
    expect(oddsArc(6, 2)).toEqual({ from: 90 - 30 - 12, to: 90 + 30 + 12 });
    expect(oddsArc(6, 0)).toBeNull();
    // Everyone at odds: the arc goes all the way round.
    expect(oddsArc(1, 1)).toEqual({ from: 90 - 12, to: 90 + 12 });
    expect(oddsArc(3, 3)).toEqual({ from: -90, to: 270 });
  });
});

describe("labels round the edge", () => {
  it("keep their angles when they fit, and push apart when they'd overlap, in order", () => {
    expect(spreadLabels([{ angle: -90, span: 20 }, { angle: 90, span: 20 }])).toEqual([-90, 90]);
    const [a, b] = spreadLabels([{ angle: 0, span: 30 }, { angle: 10, span: 30 }]) as number[];
    expect(b - a).toBeGreaterThanOrEqual(30);
    // Without an angle of their own, they go in evenly.
    const free = spreadLabels([{ angle: null, span: 10 }, { angle: null, span: 10 }]);
    expect(free.every((x) => x !== null)).toBe(true);
  });

  it("leaves out what can't fit round the circle, the last first", () => {
    const out = spreadLabels([{ angle: 0, span: 200 }, { angle: 90, span: 200 }]);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
  });

  it("runs upright: clockwise along the top, anticlockwise along the foot", () => {
    expect(labelPath(-90, 20)).toMatch(/ 0 0 1 /);
    expect(labelPath(90, 20)).toMatch(/ 0 0 0 /);
    expect(labelSpan("Regular at the dive bar")).toBeGreaterThan(20);
    expect(norm(270)).toBe(-90);
    expect(norm(-270)).toBe(90);
  });

  it("word a hangout mid-sentence in lower case, and a proper name as it is", () => {
    expect(ROLE_WORDS.regular("A botanic park before the rain")).toBe("Regular at a botanic park before the rain");
    expect(ROLE_WORDS.regular("An all-night diner")).toBe("Regular at an all-night diner");
    expect(ROLE_WORDS.lives("The Heights")).toBe("Lives in The Heights");
    expect(ROLE_WORDS.works("The Salt Lantern")).toBe("Works at The Salt Lantern");
    expect(midSentence("Avalon Books")).toBe("Avalon Books");
    expect(bareName("The Bean There")).toBe("Bean There");
    expect(bareName("A corner café that closes in an hour")).toBe("corner café that closes in an hour");
  });
});

describe("a world as a picture", () => {
  const ties = [
    tie("ada", "bea", "best_friend"),
    tie("ada", "cal", "sibling"),
    tie("ada", "dee", "rival"),
    tie("ada", "eve", "coworker"),
    tie("ada", "fay", "feud", { status: "ended", valence: 0 }),
    tie("bea", "ada", "told", { directed: true }),
  ];
  const pic = worldPicture(world("ada", ties));

  it("puts everyone with an active tie on their ring, inside the picture", () => {
    const byId = new Map(pic.members.map((m) => [m.id, m]));
    expect(byId.get("bea")?.ring).toBe("inner");
    expect(byId.get("cal")?.ring).toBe("inner");
    expect(byId.get("dee")?.ring).toBe("acquaintances");
    for (const m of pic.members) {
      expect(Math.hypot(m.x - WORLD_SIZE / 2, m.y - WORLD_SIZE / 2)).toBeCloseTo(RING_RADIUS[m.ring], 0);
      expect(m.x - m.r).toBeGreaterThanOrEqual(0);
      expect(m.x + m.r).toBeLessThanOrEqual(WORLD_SIZE);
    }
    expect(pic.rings.map((r) => r.ring)).toEqual(["inner", "friends", "acquaintances"]);
  });

  it("draws each one's lines in Everything's groups, and sits whoever they're at odds with on a red arc at the foot", () => {
    const bea = pic.members.find((m) => m.id === "bea")!;
    expect(bea.lines.map((l) => l.g).sort()).toEqual(["communication", "friendship"]);
    const dee = pic.members.find((m) => m.id === "dee")!;
    expect(dee.odds).toBe(true);
    expect(dee.angle).toBe(90);
    expect(pic.arcs).toEqual([{ ring: "acquaintances", r: RING_RADIUS.acquaintances, from: expect.any(Number), to: expect.any(Number) }]);
    expect(arcPath(100, 60, 120)).toMatch(/^M [\d.]+ [\d.]+ A 100 100 0 0 1 /);
  });

  it("keeps whoever's ties are all over for the list, off the rings", () => {
    expect(pic.members.some((m) => m.id === "fay")).toBe(false);
    expect(pic.before.map((m) => m.id)).toEqual(["fay"]);
  });

  it("ends a line at the edge of each face", () => {
    const bea = pic.members.find((m) => m.id === "bea")!;
    const e = lineEnds(bea);
    expect(Math.hypot(e.x1 - WORLD_SIZE / 2, e.y1 - WORLD_SIZE / 2)).toBeCloseTo(CENTRE_RADIUS, 0);
    expect(Math.hypot(e.x2 - bea.x, e.y2 - bea.y)).toBeCloseTo(bea.r, 0);
  });

  it("an off-screen person is a small grey dot in their ring; a masked pair a grey dot on the outer ring", () => {
    const person = { id: "p1", holder_id: "ada", name: "Mum", pronouns: null, note: null, deceased: false, visibility: "public" as const, promoted_to: null };
    const momTie = tie("ada", "", "parent", { to: null, to_person: "p1" });
    const w = world("ada", [momTie, tie("ada", "bea", "friend")], { people: [person], nodes: [node("bea"), node("zed", { private: true })], masked: [{ a: "ada", b: "zed", masked: true }] });
    const p = worldPicture(w);
    const mum = p.members.find((m) => m.id === "p1")!;
    expect(mum).toMatchObject({ person: true, name: "Mum", ring: "inner" });
    const zed = p.members.find((m) => m.id === "zed")!;
    expect(zed).toMatchObject({ masked: true, private: true, ring: "acquaintances", lines: [], odds: false });
  });

  it("labels the places they belong to round the edge, each near those who share it", () => {
    const place = { id: "pl1", key: "venue:dive", kind: "venue" as const, name: "the dive bar", parent_id: null, venue_id: null, description: null };
    const w = world("ada", ties, {
      places: [place],
      memberships: [{ place_id: "pl1", role: "regular", since_text: null, started_at: null, ended_at: null, detail: {}, visibility: "public" }],
      shared: [{ a: "ada", b: "eve", place_id: "pl1", role: "regular", layer: "place", words: "Regulars at the dive bar" }],
    });
    const p = worldPicture(w);
    expect(p.places).toHaveLength(1);
    expect(p.places[0]).toMatchObject({ words: "Regular at the dive bar", with: ["eve"] });
    const eve = p.members.find((m) => m.id === "eve")!;
    expect(Math.abs(norm(p.places[0].angle - eve.angle))).toBeLessThan(1);
    expect(EDGE_RADIUS).toBeGreaterThan(RING_RADIUS.acquaintances);
  });
});

describe("names on the picture", () => {
  const MID = WORLD_SIZE / 2;
  const member = (id: string, x: number, y: number, o: Partial<WorldMember> = {}): WorldMember => ({
    id,
    name: id,
    person: false,
    private: false,
    hue: null,
    portrait: null,
    ring: "close",
    angle: 0,
    x,
    y,
    r: o.person ? PERSON_RADIUS : 16,
    lines: [],
    odds: false,
    masked: false,
    ties: [],
    shared: [],
    ...o,
  });
  const text = (m: WorldMember) => m.name;

  it("puts a face's name under it and an off-screen person's beside their dot, on the outer side", () => {
    const names = nameLayout([member("Juniper", MID - 60, MID + 100), member("Amara Okoye", MID + 150, MID - 40, { person: true }), member("Mum", MID - 150, MID - 40, { person: true })], text);
    expect(names.get("Juniper")).toEqual({ x: MID - 60, y: MID + 100 + 16 + 4, anchor: "middle" });
    expect(names.get("Amara Okoye")).toMatchObject({ x: MID + 150 + PERSON_RADIUS + 4, anchor: "start" });
    expect(names.get("Mum")).toMatchObject({ x: MID - 150 - PERSON_RADIUS - 4, anchor: "end" });
  });

  it("turns a person's name inward when the outer side would run into the places round the edge", () => {
    const kofi = member("Kofi Dabo", MID + RING_RADIUS.acquaintances, MID, { person: true, ring: "acquaintances" });
    expect(nameLayout([kofi], text).get("Kofi Dabo")).toMatchObject({ x: kofi.x - PERSON_RADIUS - 4, anchor: "end" });
  });

  it("moves or leaves off a name that would overlap one already down, the inner circle's first", () => {
    // Zenobia's name hangs under the face; Amara's dot sits just above that, so Amara's goes the other way, then under.
    const zenobia = member("Zenobia", MID + 160, MID + 60, { ring: "inner", r: 22 });
    const amara = member("Amara Okoye", MID + 150, MID + 92, { person: true });
    const names = nameLayout([amara, zenobia], text);
    expect(names.get("Zenobia")).toMatchObject({ anchor: "middle" });
    expect(names.get("Amara Okoye")?.anchor).not.toBe("start");
    // Two people on one spot: the second has nowhere left that's clear on its own side, so one of them yields.
    const crowd = [0, 1, 2, 3].map((i) => member(`Person ${i}`, MID + 150, MID - 40 + i, { person: true }));
    expect(nameLayout(crowd, text).size).toBeLessThan(4);
    // Nothing over the centre's face.
    const near = member("Near", MID + 30, MID - 30, { person: true });
    expect(nameLayout([near], text).get("Near")).toBeUndefined();
  });

  it("names only the inner and close rings' faces", () => {
    const far = member("Far", MID, MID - RING_RADIUS.friends, { ring: "friends", r: 11 });
    expect(nameLayout([far], text).has("Far")).toBe(false);
  });
});
