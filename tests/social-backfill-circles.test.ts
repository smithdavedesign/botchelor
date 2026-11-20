import { describe, expect, it } from "vitest";
import {
  circleMessages,
  familyHints,
  offerWorkplaces,
  parseArgs,
  parseReply,
  pickCandidates,
  queue,
  remember,
  tieIndex,
  toCircle,
  type ShowCharacter,
  type World,
} from "../scripts/social/backfill-circles.mjs";

// The backfill of the show's characters' circles (scripts/social/backfill-circles.mjs): who's written in what order,
// whom each is offered to know, the prompt, and how a reply becomes what the site checks. The writing is the site's
// (tests/social-circles.test.ts).

const char = (id: string, o: Partial<ShowCharacter> = {}): ShowCharacter => ({
  id,
  name: `${id[0].toUpperCase()}${id.slice(1)} Doe`,
  kind: "agent",
  age: 33,
  pronouns: "she/her",
  bio: "Fixes clocks and keeps none of them on time.",
  archetype: "The tinkerer",
  occupation: "Clockmaker",
  hometown: "Leeds",
  voice: null,
  traits: [],
  has_circle: false,
  dated: [],
  circle: { people: [], ties: [] },
  ...o,
});
const world: World = {
  city: { key: "city:heartsease-on-sea", name: "Heartsease-on-Sea" },
  neighbourhoods: [
    { key: "neighbourhood:old-town", name: "Old Town", description: "Cobbled lanes." },
    { key: "neighbourhood:the-front", name: "The Front", description: "The seafront." },
  ],
  hangouts: [{ key: "venue:dive_bar", name: "A sticky dive bar on trivia night", neighbourhood: "Neon Mile" }],
  workplaces: [{ key: "workplace:the-salt-lantern", name: "The Salt Lantern", kind: "workplace", neighbourhood: "The Front" }],
};

describe("the backfill's run", () => {
  it("needs a limit, and takes the rest as flags", () => {
    expect(() => parseArgs([])).toThrow(/--limit/);
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--limit", "3", "--loud"])).toThrow(/unknown flag/);
    expect(parseArgs(["--limit", "3", "--dry-run", "--only", "a,b", "--base", "http://localhost:3000/"])).toEqual({
      limit: 3,
      dryRun: true,
      force: false,
      only: ["a", "b"],
      base: "http://localhost:3000",
    });
    expect(parseArgs(["--limit", "400", "--force"])).toMatchObject({ limit: 400, force: true, base: "https://botchelor.com" });
  });

  it("writes the cast first, then the house, then the agent cast; those with a circle only when forced", () => {
    const all = [char("zed", { kind: "agent" }), char("amy", { kind: "agent", has_circle: true }), char("hal", { kind: "house" }), char("cat", { kind: "cast" })];
    expect(queue(all, { limit: 10 }).map((c) => c.id)).toEqual(["cat", "hal", "zed"]);
    expect(queue(all, { limit: 10, force: true }).map((c) => c.id)).toEqual(["cat", "hal", "amy", "zed"]);
    expect(queue(all, { limit: 1 }).map((c) => c.id)).toEqual(["cat"]);
    expect(queue(all, { limit: 10, only: ["zed", "amy"] }).map((c) => c.id)).toEqual(["zed"]);
  });

  it("offers others on the same side of the show, the least tied first, never someone they dated or know already", () => {
    const me = char("me", { dated: ["ex"] });
    const all = [me, char("ex"), char("old"), char("busy"), char("free"), char("house1", { kind: "house" }), char("cast1", { kind: "cast" })];
    const ties = tieIndex([{ ...char("old"), circle: { people: [], ties: [{ with: "me", relation: "old friend" }] } }]);
    ties.add("busy", "zz1");
    ties.add("busy", "zz2");
    const picked = pickCandidates(me, all, ties, { n: 3, random: () => 0.5 }).map((c) => c.id);
    expect(picked).toEqual(["free", "busy", "house1"]);
    expect(ties.has("old", "me")).toBe(true);
    // The house is offered the house first.
    expect(pickCandidates(char("cast1", { kind: "cast" }), all, ties, { n: 1 }).map((c) => c.id)).toEqual(["house1"]);
  });

  it("passes a sibling's parents on, so two siblings have the same mum", () => {
    const sib = char("sib", { circle: { people: [{ name: "Rosa", relation: "parent" }, { name: "Gil", relation: "friend" }], ties: [] } });
    const me = char("me", { circle: { people: [], ties: [{ with: "sib", relation: "sibling" }] } });
    expect(familyHints(me, new Map([["sib", sib]]))).toEqual(["Sib is their sibling, so Sib's family is theirs too: Rosa (parent)."]);
    expect(familyHints(char("x"), new Map())).toEqual([]);
  });
});

describe("the prompt and the reply", () => {
  it("asks in the character's terms, with the world and the others to know", () => {
    const sib = char("sib", { circle: { people: [{ name: "Rosa", relation: "parent" }], ties: [] } });
    const me = char("me", { circle: { people: [{ name: "Tom", relation: "sibling" }], ties: [{ with: "sib", relation: "sibling" }, { with: "x", relation: "mentor", phrase: "they are Xi's mentor" }] } });
    const [system, user] = circleMessages(me, { world, candidates: [char("ola", { occupation: "Ferry pilot" })], byId: new Map([["sib", sib], ["x", char("xi")]]), workplaces: world.workplaces });
    expect(system.content).toMatch(/fictional adult/);
    expect(system.content).toMatch(/single/);
    expect(user.content).toContain("The character: Me Doe, 33 (she/her). The tinkerer; works as Clockmaker; from Leeds.");
    expect(user.content).toContain("Tom (their sibling); Sib Doe (their sibling, on the show); Xi Doe (they are Xi's mentor, on the show)");
    expect(user.content).toContain("Rosa (parent)");
    expect(user.content).toContain("Old Town (Cobbled lanes.)");
    expect(user.content).toContain("dive_bar (A sticky dive bar on trivia night, Neon Mile)");
    expect(user.content).toContain("The Salt Lantern (The Front)");
    expect(user.content).toContain("- Ola Doe: The tinkerer, Ferry pilot, from Leeds");
  });

  it("finds the JSON in a reply", () => {
    expect(parseReply('Sure! {"people": []} hope that helps')).toEqual({ people: [] });
    expect(parseReply("no json")).toBeNull();
    expect(parseReply("[1, 2]")).toBeNull();
    expect(parseReply('{"broken": ')).toBeNull();
  });

  it("turns a reply into what the site checks: places by key or name, and the others it knows by name to ids", () => {
    const ola = char("ola", { name: "Ola Brandt" });
    const reply = {
      people: [{ name: "Rosa", relation: "mother", pronouns: "she/her", note: "Bakes.", deceased: false }, { name: "", relation: "x" }, { relation: "friend" }],
      lives: "Old Town",
      works: { name: "the salt lantern", neighbourhood: "The Front" },
      regular: "dive_bar",
      knows: [{ name: "Ola Brandt", relation: "cousin", story: "Shared a pram." }, { name: "Ola", relation: "rival" }, { name: "Nobody Known", relation: "friend" }],
    };
    expect(toCircle(char("me"), reply, { candidates: [ola], workplaces: world.workplaces })).toEqual({
      character_id: "me",
      people: [{ name: "Rosa", relation: "mother", pronouns: "she/her", note: "Bakes.", deceased: false }],
      places: [
        { role: "lives", place: "Old Town" },
        { role: "works", place: "workplace:the-salt-lantern" },
        { role: "regular", place: "dive_bar" },
      ],
      ties: [
        { with: "ola", relation: "cousin", story: "Shared a pram." },
        { with: "ola", relation: "rival", story: null },
      ],
    });
    expect(toCircle(char("me"), { works: { name: "Brine & Daughters", neighbourhood: "Old Town" } }, { candidates: [], workplaces: [] }).places).toEqual([
      { role: "works", name: "Brine & Daughters", neighbourhood: "Old Town" },
    ]);
  });

  it("remembers what was written: the ties both ways, a new workplace for the next character", () => {
    const me = char("me", { name: "Mae Rook" });
    const ola = char("ola");
    const byId = new Map([["me", me], ["ola", ola]]);
    const ties = tieIndex([]);
    const workplaces = [...world.workplaces];
    const circle = toCircle(me, { people: [{ name: "Rosa", relation: "mother" }, { name: "Gus", relation: "llama" }], works: { name: "Brine & Daughters", neighbourhood: "Old Town" }, knows: [{ name: "Ola Doe", relation: "mentor" }] }, { candidates: [ola], workplaces });
    remember(me, circle, { character_id: "me", status: "written", people: 1, places: 1, ties: 1, refused: [{ item: "person", what: "Gus", reason: "not a relation: llama" }] }, { byId, ties, workplaces, world });
    expect(me.circle!.people).toEqual([{ name: "Rosa", relation: "mother" }]);
    expect(ties.has("ola", "me")).toBe(true);
    expect(ola.circle!.ties).toEqual([{ with: "me", relation: "mentor", phrase: "they are Mae's mentor" }]);
    expect(workplaces.at(-1)).toEqual({ key: "workplace:brine-daughters", name: "Brine & Daughters", kind: "workplace", neighbourhood: "Old Town" });
    expect(me.has_circle).toBe(true);
    // A dry run or a skip remembers nothing.
    const other = char("other");
    remember(other, circle, { character_id: "other", status: "checked", people: 1, places: 1, ties: 1, refused: [] }, { byId, ties, workplaces, world });
    expect(other.has_circle).toBe(false);
  });

  it("offers the newest workplaces and a few older ones", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `workplace:w${i}`, name: `W${i}`, kind: "workplace", neighbourhood: null }));
    const offered = offerWorkplaces(many, { n: 6, random: () => 0.5 });
    expect(offered).toHaveLength(6);
    expect(offered.slice(-3).map((w) => w.name)).toEqual(["W17", "W18", "W19"]);
    expect(offerWorkplaces(many.slice(0, 3), { n: 6 })).toHaveLength(3);
  });
});
