import { describe, expect, it } from "vitest";
import { nameIdeas } from "@/lib/oc-name-pools";
import { TIE_KINDS } from "@/lib/social/kinds";
import { familySurnameOf, FIRST_NAME_MAX, isFamilyWords, nameStyleOf, SHARES_SURNAME_KINDS, sharesSurnameWords } from "@/lib/social/person-names";
import { kindFromWords } from "@/lib/social/relations";
import {
  brokenHolders,
  circleMessages,
  familyHints,
  isTitleOnly,
  nameBook,
  nameCircle,
  nameStats,
  offerNeighbourhoods,
  offerWorkplaces,
  parseArgs,
  parseReply,
  pickCandidates,
  queue,
  remember,
  shuffled,
  statsLine,
  styleOf,
  tieIndex,
  toCircle,
  type Circle,
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
      redoBroken: false,
      stats: false,
      only: ["a", "b"],
      base: "http://localhost:3000",
    });
    expect(parseArgs(["--limit", "400", "--force"])).toMatchObject({ limit: 400, force: true, base: "https://botchelor.com" });
    expect(parseArgs(["--limit", "400", "--redo-broken"])).toMatchObject({ limit: 400, redoBroken: true, force: false });
    // The names' numbers need no limit: nothing is written.
    expect(parseArgs(["--stats"])).toMatchObject({ stats: true, limit: null });
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

  it("lists the neighbourhoods and hangouts in each character's own order (the model leans to the last one)", () => {
    const oldTownFirst = (seq: number[]) => {
      let i = 0;
      const [, user] = circleMessages(char("me"), { world, candidates: [], byId: new Map(), workplaces: [], random: () => seq[i++ % seq.length] });
      return user.content.indexOf("Old Town (") < user.content.indexOf("The Front (");
    };
    expect(oldTownFirst([0.1, 0.9])).toBe(true);
    expect(oldTownFirst([0.9, 0.1])).toBe(false);
    expect(shuffled([3, 1, 2], () => 0.5).sort()).toEqual([1, 2, 3]);
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

  it("makes someone on the show named as an off-screen person a tie when they're offered, and leaves them out otherwise", () => {
    const ola = char("ola", { name: "Ola Brandt" });
    const barn = char("barn", { name: "Barnaby Thorne" });
    const reply = {
      people: [
        { name: "ola brandt", relation: "rival" },
        { name: "Barnaby Thorne", relation: "rival" },
        { name: "Me Doe", relation: "twin" },
        { name: "Rosa", relation: "mother" },
      ],
      knows: [{ name: "Ola", relation: "cousin" }, { name: "Ola Brandt", relation: "cousin" }],
    };
    const circle = toCircle(char("me"), reply, { candidates: [ola], workplaces: [], everyone: [ola, barn, char("me")] });
    expect(circle.people.map((p) => p.name)).toEqual(["Rosa"]);
    expect(circle.ties).toEqual([
      { with: "ola", relation: "cousin", story: null },
      { with: "ola", relation: "rival", story: null },
    ]);
  });

  it("leaves out a title that isn't a name (Mum, Auntie), and keeps one with a name in it", () => {
    const reply = {
      people: [
        { name: "Mum", relation: "mother" },
        { name: "auntie", relation: "aunt" },
        { name: "The Boss", relation: "boss" },
        { name: "Auntie Meg", relation: "aunt" },
        { name: "Al", relation: "best friend" },
      ],
    };
    expect(toCircle(char("me"), reply, { candidates: [], workplaces: [] }).people.map((p) => p.name)).toEqual(["Auntie Meg", "Al"]);
    expect([isTitleOnly("Mum"), isTitleOnly(" my  mum "), isTitleOnly("Uncle Fen"), isTitleOnly("Ma Rainey")]).toEqual([true, true, false, false]);
  });

  it("remembers what was written: the ties both ways, a new workplace for the next character", () => {
    const me = char("me", { name: "Mae Rook" });
    const ola = char("ola");
    const byId = new Map([["me", me], ["ola", ola]]);
    const ties = tieIndex([]);
    const workplaces = [...world.workplaces];
    const homes = new Map<string, number>();
    const circle = toCircle(me, { people: [{ name: "Rosa", relation: "mother" }, { name: "Gus", relation: "llama" }], lives: "the front", works: { name: "Brine & Daughters", neighbourhood: "Old Town" }, knows: [{ name: "Ola Doe", relation: "mentor" }] }, { candidates: [ola], workplaces });
    remember(me, circle, { character_id: "me", status: "written", people: 1, places: 2, ties: 1, refused: [{ item: "person", what: "Gus", reason: "not a relation: llama" }] }, { byId, ties, workplaces, world, homes });
    expect(homes).toEqual(new Map([["neighbourhood:the-front", 1]]));
    expect(me.circle!.people).toEqual([{ name: "Rosa", relation: "mother" }]);
    expect(ties.has("ola", "me")).toBe(true);
    expect(ola.circle!.ties).toEqual([{ with: "me", relation: "mentor", phrase: "they are Mae's mentor" }]);
    expect(workplaces.at(-1)).toEqual({ key: "workplace:brine-daughters", name: "Brine & Daughters", kind: "workplace", neighbourhood: "Old Town" });
    expect(me.has_circle).toBe(true);
    // A dry run or a skip remembers nothing.
    const other = char("other");
    remember(other, circle, { character_id: "other", status: "checked", people: 1, places: 1, ties: 1, refused: [] }, { byId, ties, workplaces, world, homes });
    expect(other.has_circle).toBe(false);
    // A home the site refused isn't counted.
    const third = char("third");
    remember(third, circle, { character_id: "third", status: "written", people: 1, places: 1, ties: 1, refused: [{ item: "place", what: "lives the front", reason: "x" }] }, { byId, ties, workplaces, world, homes });
    expect(homes.get("neighbourhood:the-front")).toBe(1);
  });

  it("offers the emptiest neighbourhoods to live in, so the model can't put everyone in one", () => {
    const hoods = ["a", "b", "c", "d", "e"].map((x) => ({ key: `neighbourhood:${x}`, name: x.toUpperCase(), description: "" }));
    const homes = new Map([["neighbourhood:a", 4], ["neighbourhood:b", 1], ["neighbourhood:d", 2]]);
    expect(offerNeighbourhoods(hoods, homes, { n: 3, random: () => 0.5 }).map((h) => h.name)).toEqual(["C", "E", "B"]);
    expect(offerNeighbourhoods(hoods, new Map(), { n: 9 })).toHaveLength(5);
    // The prompt names only the ones offered.
    const [, user] = circleMessages(char("me"), { world, candidates: [], byId: new Map(), workplaces: [], neighbourhoods: [world.neighbourhoods[1]] });
    expect(user.content).toContain("The Front (The seafront.)");
    expect(user.content).not.toContain("Old Town");
  });

  it("offers the newest workplaces and a few older ones", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `workplace:w${i}`, name: `W${i}`, kind: "workplace", neighbourhood: null }));
    const offered = offerWorkplaces(many, { n: 6, random: () => 0.5 });
    expect(offered).toHaveLength(6);
    expect(offered.slice(-3).map((w) => w.name)).toEqual(["W17", "W18", "W19"]);
    expect(offerWorkplaces(many.slice(0, 3), { n: 6 })).toHaveLength(3);
  });
});

/** A circle as the run has it, people only. */
const peopleCircle = (id: string, people: { name: string; relation: string; pronouns?: string | null; note?: string | null }[]): Circle => ({
  character_id: id,
  people: people.map((p) => ({ pronouns: null, note: null, deceased: false, ...p })),
  places: [],
  ties: [],
});
/** A show character whose circle holds these people (as the site lists them: name and relation). */
const holder = (id: string, name: string, people: [string, string][] = [], o: Partial<ShowCharacter> = {}): ShowCharacter =>
  char(id, { name, has_circle: people.length > 0, circle: { people: people.map(([n, relation]) => ({ name: n, relation })), ties: [] }, ...o });

describe("names (the first run's repeats: 24 Eleanors, Thornes outside Barnaby Thorne's family)", () => {
  it("reads a character's style from its own words, modern unless they say otherwise", () => {
    expect(nameStyleOf("Pilots a starship between asteroid farms.")).toBe("scifi");
    expect(nameStyleOf("A court mage who brews potions badly.")).toBe("fantasy");
    expect(nameStyleOf("A vampire who keeps a crypt tidy.")).toBe("gothic");
    expect(nameStyleOf("Runs the bakery on the corner.")).toBe("cozy");
    // Words ordinary bios use don't count.
    expect(nameStyleOf("Night nurse, waiting for a knight in shining armour, saving the planet, fairy lights everywhere; that spells trouble.")).toBe("modern");
    expect(styleOf(char("me", { bio: "Quiet.", occupation: "Baker" }))).toBe("cozy");
    expect(styleOf(char("me", { bio: "Quiet.", occupation: "Lawyer", traits: ["dry"] }))).toBe("modern");
  });

  it("offers each character a few names of its own from the name generator, the same every time", () => {
    const a = nameIdeas("char-a", "modern");
    expect(a.first).toHaveLength(6);
    expect(a.last).toHaveLength(3);
    expect(nameIdeas("char-a", "modern")).toEqual(a);
    expect(nameIdeas("char-b", "modern")).not.toEqual(a);
    // Never a name used up, or a surname a character has.
    const capped = new Set(a.first.map((f) => f.toLowerCase()));
    const taken = new Set(a.last.map((l) => l.toLowerCase()));
    const again = nameIdeas("char-a", "modern", { okFirst: (f) => !capped.has(f.toLowerCase()), okLast: (l) => !taken.has(l.toLowerCase()) });
    expect(again.first.some((f) => capped.has(f.toLowerCase()))).toBe(false);
    expect(again.last.some((l) => taken.has(l.toLowerCase()))).toBe(false);
    expect(nameIdeas("char-a", "fantasy").first.every((f) => /^[A-Z][a-z]+$/.test(f))).toBe(true);
  });

  it("puts the names, family's surname and an optional best friend in the prompt", () => {
    const names = { first: ["Imani", "Theo", "Rowan"], last: ["Okafor", "Varga"] };
    const [, user] = circleMessages(char("me", { name: "Caspar Yeoland" }), { world, candidates: [], byId: new Map(), workplaces: [], names });
    expect(user.content).toContain("First names to pick from for them (or others like these): Imani, Theo, Rowan.");
    expect(user.content).toContain(
      "Their parents, brothers, sisters and children share their surname, Yeoland; other family may have their own. Nobody else has it, nor the surname of anyone on the show: others have surnames like Okafor, Varga.",
    );
    expect(user.content).toContain("A best friend only if they really have one: most people here don't.");
    expect(user.content).toContain("mentor, roommate or best friend");
    // A one-word name, or an epithet, has no surname to share.
    for (const name of ["Zephyr", "Papiros The Inevitable", "Duke of Brine"]) {
      const [, solo] = circleMessages(char("me", { name }), { world, candidates: [], byId: new Map(), workplaces: [], names });
      expect(solo.content).toContain("Nobody has the surname of anyone on the show: use surnames like Okafor, Varga.");
    }
    expect([familySurnameOf("Caspar Yeoland"), familySurnameOf("Clemency Duarte-Holt"), familySurnameOf("Leah O’Connor"), familySurnameOf("bo lark")]).toEqual(["Yeoland", "Duarte-Holt", "O’Connor", null]);
  });

  it("knows family words as the site does (kindFromWords puts them in the kin layer)", () => {
    const words = [
      "their mother", "father", "sister", "brother", "son", "daughter", "grandmother", "cousin", "aunt", "uncle", "twin",
      "half-sibling", "step-sibling", "aunt or uncle", "in-law", "family", "grandparent", "grandchild", "child", "parent", "sibling",
      "best friend", "friend", "ex", "boss", "coworker", "neighbour", "rival", "mentor", "roommate", "childhood friend", "family friend",
    ];
    for (const w of words) {
      const kind = kindFromWords(w);
      expect([w, isFamilyWords(w)]).toEqual([w, kind ? TIE_KINDS[kind].layer === "kin" : false]);
    }
    // Close family, who share the character's surname: the kinds SHARES_SURNAME_KINDS names.
    for (const w of [...words, "younger brother", "twin sister", "half-brother", "stepsister", "grandson", "granddaughter", "grandfather", "mother-in-law"]) {
      const kind = kindFromWords(w);
      expect([w, sharesSurnameWords(w)]).toEqual([w, kind ? SHARES_SURNAME_KINDS.includes(kind) : false]);
    }
  });

  it("renames a fourth first name, family with another character's surname, and anyone else with a character's", () => {
    const me = holder("me", "Caspar Yeoland", [], { occupation: "Lawyer" });
    const barnaby = holder("barnaby", "Barnaby Thorne", [["Eleanor Vance", "friend"], ["Eleanor Moss", "sibling"], ["Eleanor Hart", "friend"]]);
    const book = nameBook([me, barnaby]);
    const out = nameCircle(
      me,
      peopleCircle("me", [
        { name: "Eleanor Thorne", relation: "mother", pronouns: "she/her", note: "Eleanor still calls him Cas." },
        { name: "Milo Thorne", relation: "best friend", pronouns: "he/him" },
        { name: "Lydia Yeoland", relation: "grandmother" },
        { name: "Sam Yeoland", relation: "coworker" },
        { name: "Ines Marr", relation: "neighbour" },
        { name: "Callum Iversen", relation: "younger brother" },
      ]),
      book,
    );
    const [mum, milo, gran, sam, ines, callum] = out.circle.people;
    // Family takes his surname over Barnaby's, and a fourth Eleanor is a new (feminine) first name; her note follows.
    expect(mum.name).toMatch(/^\S+ Yeoland$/);
    expect(mum.name.startsWith("Eleanor")).toBe(false);
    expect(mum.note).toBe(`${mum.name.split(" ")[0]} still calls him Cas.`);
    // Outside the family: never a character's surname, his own included.
    expect(milo.name.startsWith("Milo ")).toBe(true);
    expect(milo.name.endsWith("Thorne")).toBe(false);
    expect(sam.name.startsWith("Sam ")).toBe(true);
    expect(sam.name.endsWith("Yeoland")).toBe(false);
    // His brother shares his surname; his grandmother may keep her own (she has it anyway), as may his neighbour.
    expect(callum.name).toBe("Callum Yeoland");
    expect([gran.name, ines.name]).toEqual(["Lydia Yeoland", "Ines Marr"]);
    expect(out.renamed.map((r) => [r.from, r.why])).toEqual([
      ["Eleanor Thorne", "family: their surname, not another character's; 3 called Eleanor already"],
      ["Milo Thorne", "not family: not a character's surname"],
      ["Sam Yeoland", "not family: not their surname"],
      ["Callum Iversen", "close family: their surname"],
    ]);
    // What was kept is in the book: a second Ines Marr would be renamed.
    expect(book.hasFull("Ines Marr")).toBe(true);
    expect(book.firstCount("eleanor")).toBe(FIRST_NAME_MAX);
    const next = nameCircle(holder("other", "Odile Park"), peopleCircle("other", [{ name: "Ines Marr", relation: "rival" }, { name: "Ines Marr", relation: "cousin" }]), book);
    expect(next.circle.people[0].name).toMatch(/^Ines (?!Marr$)/);
    expect(next.circle.people[1].name).toMatch(/^\S+ Marr$/);
    expect(next.circle.people[1].name.startsWith("Ines")).toBe(false);
  });

  it("finds the circles that break the rules in the order they were written, so the first ones keep their names", () => {
    const everyone = [
      holder("a1", "Ada One", [["Eleanor Quill", "friend"]], { kind: "house" }),
      holder("a2", "Bea Two", [["Eleanor Moss", "friend"]], { kind: "house" }),
      holder("a3", "Cy Three", [["Eleanor Hart", "friend"], ["Maeve Fenn", "neighbour"]], { kind: "house" }),
      holder("a4", "Di Four", [["Eleanor Rook", "mother"]], { kind: "house" }),
      holder("a5", "Ed Five", [["Maeve Fenn", "coworker"]], { kind: "house" }),
      holder("a6", "Flo Six", [["Gus One", "friend"]], { kind: "house" }),
      holder("a7", "Gil Seven", [["Hal Seven", "father"], ["Ivy Two", "aunt"]], { kind: "house" }),
      holder("a8", "Hana Eight", [], { kind: "house" }),
    ];
    const broken = brokenHolders(everyone);
    expect([...broken.keys()].sort()).toEqual(["a4", "a5", "a6", "a7"]);
    expect(broken.get("a4")).toEqual(["Eleanor Rook: 3 called Eleanor already", "Eleanor Rook: close family without their surname"]);
    expect(broken.get("a5")).toEqual(["Maeve Fenn: a name someone has"]);
    expect(broken.get("a6")).toEqual(["Gus One: a character's surname"]);
    // His father may have his surname; his aunt may not have Bea Two's.
    expect(broken.get("a7")).toEqual(["Ivy Two: another character's surname"]);
    // --redo-broken writes those again, and the ones still without a circle.
    expect(queue(everyone, { limit: 99, redo: new Set(broken.keys()) }).map((c) => c.id)).toEqual(["a4", "a5", "a6", "a7", "a8"]);
    // The run's book doesn't count the circles it writes again.
    const book = nameBook(everyone, { skip: new Set(broken.keys()) });
    expect([book.firstCount("Eleanor"), book.hasFull("Maeve Fenn"), book.firstCount("Gus"), book.surnameTaken("two")]).toEqual([3, true, 0, true]);
  });

  it("counts the names for a report", () => {
    const everyone = [
      holder("a1", "Ada Quill", [["Eleanor Quill", "parent"], ["Eleanor Moss", "best friend"], ["Tom Stone", "friend"]]),
      holder("a2", "Bea Stone", [["Eleanor Hart", "friend"], ["Eleanor Hart", "coworker"], ["Rob Quill", "sibling"]]),
      holder("a3", "Cy Lone"),
    ];
    const s = nameStats(everyone);
    expect(s).toMatchObject({ holders: 2, people: 6, distinctFirst: 3, overCap: 1, fullTwice: 1, outsideTaken: 1, kin: 2, kinOwn: 1, kinOther: 1, close: 2, closeOwn: 1, bestFriends: 1 });
    expect(s.top).toEqual([["eleanor", 4], ["rob", 1], ["tom", 1]]);
    expect(statsLine(s)).toContain("6 people for 2 characters: 3 first names (most used eleanor 4, rob 1, tom 1; 1 past 3)");
    expect(statsLine(s)).toContain("1 of 2 family with the character's own (close family 1 of 2)");
  });

  it("remembers a circle written again from nobody, under the names the site gave", () => {
    const me = holder("me", "Mae Rook", [["Eleanor Old", "friend"]]);
    const byId = new Map([["me", me]]);
    const circle = peopleCircle("me", [{ name: "Nadia Brennan", relation: "friend" }, { name: "Theo Rook", relation: "brother" }]);
    remember(me, circle, { character_id: "me", status: "written", people: 2, places: 0, ties: 0, refused: [], renamed: [{ from: "Nadia Brennan", to: "Nadia Varga", why: "x" }] }, { byId, ties: tieIndex([]), workplaces: [], world, replace: true });
    expect(me.circle!.people).toEqual([{ name: "Nadia Varga", relation: "friend" }, { name: "Theo Rook", relation: "brother" }]);
  });
});

