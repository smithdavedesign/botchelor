import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTurnMessages } from "@/lib/conversation";
import { fixedEngine } from "@/lib/engine";
import { assembleDate, buildDate, DEFAULT_DATE_REQUEST, type CharacterForDate } from "@/lib/simulation";
import { addPerson } from "@/lib/social/people";
import {
  lineKind,
  linesFor,
  mutualLine,
  PEOPLE_LINE_CHARS,
  PEOPLE_LINES_MAX,
  peopleForDate,
  personLine,
  roleWord,
  seenBy,
  socialPeopleInPromptsOn,
  type LineTie,
} from "@/lib/social/people-lines";
import { upsertTie } from "@/lib/social/ties";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// The people in a character's life, in its own date prompt (lib/social/people-lines.ts; docs/PRDs/social-network.md
// section 7 "Dialogue"; Phase 2b, SOCIAL_PEOPLE_IN_PROMPTS): someone both of them know first, else one of its own
// off-screen people; only what its own owner may see, so another owner's owner-only or private rows never reach it.

describe("the words (pure)", () => {
  it("says what someone is to a side in the kind's words, kin by their pronouns or a title in their name", () => {
    expect(roleWord("parent", true, { name: "Rosa Quill", pronouns: "she/her" })).toBe("mother");
    expect(roleWord("parent", false, { name: "Tam", pronouns: "he/him" })).toBe("son");
    expect(roleWord("sibling", true, { name: "Kit", pronouns: "they/them" })).toBe("sibling");
    expect(roleWord("aunt_uncle", true, { name: "Auntie Meg" })).toBe("aunt");
    expect(roleWord("aunt_uncle", true, { name: "Uncle Fen" })).toBe("uncle");
    expect(roleWord("coworker", true, { name: "Mira", pronouns: "she/her" })).toBe("coworker");
    // A directed kind read from its other end: a manager tie from X to Y makes Y X's manager, and X Y's report.
    expect(roleWord("manager", true, { name: "Mira" })).toBe("manager");
    expect(roleWord("manager", false, { name: "Mira" })).toBe("report");
  });

  it("carries family, friends, work, neighbours, rivals and past loves, never a partner, what aired or a phrase", () => {
    for (const k of ["parent", "sibling", "best_friend", "coworker", "mentor", "neighbour", "rival", "ex", "first_love"]) expect(lineKind(k)).toBe(true);
    for (const k of ["spouse", "partner", "engaged", "crush", "situationship", "dated", "feud", "met_on_show", "housemate", "talked_about", "grudge", "acquaintance", "nope"]) expect(lineKind(k)).toBe(false);
  });

  it("writes a line for someone both know and for an off-screen person, never past its length", () => {
    expect(mutualLine({ name: "Mira Vale", pronouns: "she/her" }, { kind: "coworker", fromSide: true }, "Bo Lark", { kind: "best_friend", fromSide: false })).toBe(
      "You both know Mira Vale: Mira is your coworker, and Bo's best friend.",
    );
    expect(personLine({ name: "Rosa Quill", pronouns: "she/her", note: "Runs the bakery and judges everyone's bread." }, "parent")).toBe(
      "Rosa Quill, your mother: Runs the bakery and judges everyone's bread.",
    );
    expect(personLine({ name: "Uncle Fen", deceased: true }, "aunt_uncle")).toBe("Uncle Fen, your late uncle.");
    expect(personLine({ name: "Juno", note: "x".repeat(160) }, "best_friend").length).toBeLessThanOrEqual(PEOPLE_LINE_CHARS);
  });
});

/** A tie as the lines read it, public between public ends unless told otherwise. */
const tie = (o: Partial<LineTie> & Pick<LineTie, "id" | "from_id" | "kind">): LineTie => ({
  to_id: null,
  visibility: "public",
  closeness: 0.5,
  from_owner: null,
  from_public: true,
  to_owner: null,
  to_public: true,
  to_name: null,
  to_pronouns: null,
  from_name: "",
  from_pronouns: null,
  person_id: null,
  person_name: null,
  person_pronouns: null,
  person_note: null,
  person_deceased: null,
  person_visibility: null,
  ...o,
});

describe("who may see what (pure)", () => {
  const between = tie({ id: "t1", from_id: "ada", to_id: "mira", kind: "coworker", from_owner: "ana", to_owner: "cal", to_name: "Mira" });
  it("shows a public tie between public ends to anyone, the rest only to the owner of an end, a private row to nobody", () => {
    expect(seenBy(between, null)).toBe(true);
    expect(seenBy(between, "ben")).toBe(true);
    const owners = { ...between, visibility: "owner" };
    expect(seenBy(owners, "ana")).toBe(true);
    expect(seenBy(owners, "cal")).toBe(true);
    expect(seenBy(owners, "ben")).toBe(false);
    expect(seenBy(owners, null)).toBe(false);
    expect(seenBy({ ...between, visibility: "private" }, "ana")).toBe(false);
    // A public tie to a private character is its owner's alone.
    expect(seenBy({ ...between, to_public: false }, "ben")).toBe(false);
    expect(seenBy({ ...between, to_public: false }, "cal")).toBe(true);
    // An off-screen person: public, or its holder's owner's.
    const person = tie({ id: "t2", from_id: "bo", kind: "sibling", from_owner: "ben", to_public: null, person_id: "p1", person_name: "Sam", person_visibility: "owner" });
    expect(seenBy(person, "ben")).toBe(true);
    expect(seenBy(person, "ana")).toBe(false);
    expect(seenBy({ ...person, person_visibility: "public" }, "ana")).toBe(true);
    expect(seenBy({ ...person, person_visibility: "private" }, "ben")).toBe(false);
  });

  it("puts someone both know first, strongest first and at most two, else one off-screen person by the date's seed", () => {
    const me = { id: "ada", owner: "ana", name: "Ada Quill" };
    const them = { id: "bo", owner: "ben", name: "Bo Lark" };
    const to = (from: string, other: string, kind: string, closeness: number, name: string) => tie({ id: `${from}-${other}`, from_id: from, to_id: other, kind, closeness, to_name: name, from_name: from });
    const people = [1, 2, 3, 4].map((n) =>
      tie({ id: `p${n}`, from_id: "ada", kind: n === 4 ? "spouse" : "sibling", from_owner: "ana", to_public: null, person_id: `per${n}`, person_name: `Kin ${n}`, person_note: n === 3 ? null : "a line", person_visibility: "public" }),
    );
    // Nobody both know: one of the fitting people (a spouse never), the ones with a line first, by the seed.
    const picks = new Set([0, 1, 2, 3, 4, 5].map((seed) => linesFor(me, them, people, seed).lines[0]));
    expect([...picks].sort()).toEqual(["Kin 1, your sibling: a line.", "Kin 2, your sibling: a line.", "Kin 3, your sibling."]);
    expect(linesFor(me, them, people, 7)).toEqual(linesFor(me, them, people, 7));
    const mutual = [to("ada", "m1", "coworker", 0.4, "Mira Vale"), to("bo", "m1", "friend", 0.5, "Mira Vale"), to("ada", "m2", "best_friend", 0.9, "Nia Holt"), to("bo", "m2", "rival", 0.5, "Nia Holt"), to("ada", "m3", "friend", 0.5, "Oz"), to("bo", "m3", "friend", 0.1, "Oz")];
    const out = linesFor(me, them, [...people, ...mutual], 0);
    expect(out.lines).toHaveLength(PEOPLE_LINES_MAX);
    expect(out.lines[0]).toBe("You both know Nia Holt: Nia is your best friend, and Bo's rival.");
    expect(out.lines[1]).toMatch(/^You both know Mira Vale: Mira is your coworker, and Bo's friend\.$/);
    expect(out.mutual).toEqual(["Nia Holt", "Mira Vale"]);
  });
});

describe("a date's prompts", () => {
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const ANA = userIdOf(newUserCookie());
  const BEN = userIdOf(newUserCookie());
  const CAL = userIdOf(newUserCookie());
  const [ADA, XAN, BO, PIA, MIRA, NIA] = ["pl-ada", "pl-xan", "pl-bo", "pl-pia", "pl-mira", "pl-nia"];
  const sheet = (name: string) => ({ name, age: 31, bio: "Keeps a tide table in every coat.", traits: ["wry", "warm", "steady"], want: "someone kind", dealbreaker: "liars", house: false });
  const forDate = (id: string, name: string): CharacterForDate => ({ id, sheet: sheet(name) });

  async function character(id: string, owner: string, name: string, visibility = "public", pronouns: string | null = null) {
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, pronouns)
       values ($1, $2, false, $3, 31, 'Keeps a tide table in every coat.', '["wry"]'::jsonb, 'someone kind', 'liars', $4, $5)`,
      [id, owner, name, visibility, pronouns],
    );
  }
  const declare = async (from: string, to: string, kind: Parameters<typeof upsertTie>[1]["kind"], o: { visibility?: "public" | "owner" | "private"; status?: "active" | "proposed" | "ended" } = {}) =>
    expect((await upsertTie(t.db, { from, to, kind, source: "owner", visibility: o.visibility ?? "public", status: o.status ?? "active" } as Parameters<typeof upsertTie>[1])).ok).toBe(true);
  const person = async (holder: string, name: string, kind: Parameters<typeof upsertTie>[1]["kind"], visibility: "public" | "owner" | "private", note: string) => {
    const made = await addPerson(t.db, { holderId: holder, name, note, visibility, source: "owner" });
    if (!made.ok) throw new Error(made.reason);
    expect((await upsertTie(t.db, { from: holder, toPerson: made.person.id, kind, source: "owner", visibility })).ok).toBe(true);
  };

  /** Ana's Ada and Xanthe, Ben's Bo and his private Pernille, Cal's Mira and Nimue: one tie or person of each kind of secret. */
  async function world() {
    await character(ADA, ANA, "Ada Quill", "public", "she/her");
    await character(XAN, ANA, "Xanthe Quill");
    await character(BO, BEN, "Bo Lark", "public", "he/him");
    await character(PIA, BEN, "Pernille Lark", "private");
    await character(MIRA, CAL, "Mira Vale", "public", "she/her");
    await character(NIA, CAL, "Nimue Holt");
    // Someone both know, in public: both prompts may say so.
    await declare(ADA, MIRA, "coworker");
    await declare(BO, MIRA, "best_friend");
    // Ben's secrets: Bo knows Nimue only where Ben sees it, his private Pernille is his sister, a private tie and a
    // proposal to Ana's Xanthe (Ada's brother), an owner-only and a private off-screen person. None of it is Ana's to
    // see, so none of it is in Ada's prompt.
    await declare(ADA, NIA, "friend");
    await declare(ADA, XAN, "sibling");
    await declare(BO, NIA, "ex", { visibility: "owner" });
    await declare(BO, PIA, "sibling");
    await declare(BO, XAN, "old_friend", { visibility: "private" });
    await declare(BO, XAN, "coworker", { status: "proposed" });
    await person(BO, "Sabeline Wren", "best_friend", "owner", "Knows where every body is buried, figuratively.");
    await person(BO, "Quorra Dross", "sibling", "private", "Never mentioned, ever.");
  }
  const SECRETS = ["Nimue", "Pernille", "Xanthe", "Sabeline", "Quorra"];

  it("gives each side its own lines from what its own owner may see, and never another owner's owner-only or private rows", async () => {
    await world();
    const people = (await peopleForDate(t.db, ADA, BO, "pl-ep-1"))!;
    expect(people.a).toEqual(["You both know Mira Vale: Mira is your coworker, and Bo's best friend."]);
    for (const secret of SECRETS) expect(people.a.join(" ")).not.toContain(secret);
    // Bo's own prompt may know his owner-only ex: both of them know Nimue, as Ben sees it. The stronger pair leads.
    expect(people.b).toEqual(["You both know Mira Vale: Mira is your best friend, and Ada's coworker.", "You both know Nimue Holt: Nimue is your ex, and Ada's friend."]);
    for (const secret of ["Pernille", "Xanthe", "Quorra"]) expect(people.b.join(" ")).not.toContain(secret);
    // Only a name in both sides' lines is a word both already know.
    expect(people.shared).toEqual(["Mira"]);

    // Built and prompted: Ada's actor reads her lines, Bo's his, and neither prompt has the other's.
    const built = await buildDate(t.db, "pl-ep-1", forDate(ADA, "Ada Quill"), forDate(BO, "Bo Lark"), DEFAULT_DATE_REQUEST);
    const [ca, cb] = built.characters;
    expect(ca.peopleInYourLife).toEqual(people.a);
    expect(cb.peopleInYourLife).toEqual(people.b);
    expect(ca.pairShared).toContain("Mira");
    const outcome = fixedEngine({ ending: "second_date" }).decide(built.input, built.seed);
    const prompt = (turn: number) => buildTurnMessages(built.input, outcome, built.characters, built.setup.producer, built.setup.venue, [], turn).messages.map((m) => m.content).join("\n");
    const ada = prompt(0);
    expect(ada).toContain("people_in_your_life");
    expect(ada).toContain("Mira is your coworker");
    for (const secret of SECRETS) expect(ada).not.toContain(secret);
    expect(prompt(1)).toContain("Nimue is your ex");
  });

  it("with no one both know, tells a side about one of its own people, its owner's own ones included", async () => {
    await world();
    await t.db.query(`delete from social_ties where to_id in ($1, $2)`, [MIRA, NIA]);
    const people = (await peopleForDate(t.db, ADA, BO, "pl-ep-2"))!;
    // Ada has nobody of her own off the show, and nobody she shares with Bo that Ana may see (Xanthe's proposal and
    // private tie aren't).
    expect(people.a).toEqual([]);
    expect(people.b).toEqual(["Sabeline Wren, your best friend: Knows where every body is buried, figuratively."]);
    expect(people.shared).toEqual([]);
  });

  it("is off with SOCIAL_PEOPLE_IN_PROMPTS=0 or SOCIAL_TIES=0, and a date is then built as before", async () => {
    await world();
    expect(socialPeopleInPromptsOn({})).toBe(true);
    expect(socialPeopleInPromptsOn({ SOCIAL_PEOPLE_IN_PROMPTS: "0" })).toBe(false);
    expect(socialPeopleInPromptsOn({ SOCIAL_TIES: "0" })).toBe(false);
    expect(await peopleForDate(t.db, ADA, BO, "pl-ep-3", { SOCIAL_PEOPLE_IN_PROMPTS: "0" })).toBeNull();
    vi.stubEnv("SOCIAL_PEOPLE_IN_PROMPTS", "0");
    const built = await buildDate(t.db, "pl-ep-3", forDate(ADA, "Ada Quill"), forDate(BO, "Bo Lark"), DEFAULT_DATE_REQUEST);
    expect(built.characters.map((c) => c.peopleInYourLife)).toEqual([undefined, undefined]);
    const outcome = fixedEngine({ ending: "second_date" }).decide(built.input, built.seed);
    expect(JSON.stringify(buildTurnMessages(built.input, outcome, built.characters, built.setup.producer, built.setup.venue, [], 0).messages)).not.toContain("people_in_your_life");
  });

  it("never touches the engine: the same date decides the same with and without the lines", async () => {
    await world();
    const a = forDate(ADA, "Ada Quill");
    const b = forDate(BO, "Bo Lark");
    const on = await buildDate(t.db, "pl-ep-4", a, b, DEFAULT_DATE_REQUEST);
    vi.stubEnv("SOCIAL_PEOPLE_IN_PROMPTS", "0");
    const off = await buildDate(t.db, "pl-ep-4", a, b, DEFAULT_DATE_REQUEST);
    expect(on.input).toEqual(off.input);
    expect(on.setup).toEqual(off.setup);
    // assembleDate without it is the date as ever.
    const plain = assembleDate({ episodeId: "e1", a, b, req: DEFAULT_DATE_REQUEST, seed: 7, soulA: null, soulB: null, memoryA: null, memoryB: null, history: undefined });
    expect(plain.characters.map((c) => c.peopleInYourLife)).toEqual([undefined, undefined]);
  });
});
