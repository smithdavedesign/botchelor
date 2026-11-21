import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/social/circles/route";
import { claimAdmin } from "@/lib/admins";
import { setDbForTests } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { getDirectorModel } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { CIRCLE_PROMPT_VERSION, draftMessages, generateCandidates, pairPlan, parseCircle, parseDraft } from "@/lib/season-gen";
import { circleSummaries, hasCircle, pairClash, showCharacterIds, showCharacters, TAKEN_KINDS, worldMenu, writeCircle, type CircleIn, type CircleOptions } from "@/lib/social/circles";
import { addPerson, peopleOf } from "@/lib/social/people";
import { canonicalTie, kindFromWords, mayDeclareTie, parseChoice, personChoices, tieChoices, tieFromWords, tieKinds } from "@/lib/social/relations";
import { PEOPLE_CAP } from "@/lib/social/types";
import { BASE_URL, newUserCookie, scriptedModel, startTestDb, userIdOf } from "./helpers";

// The show writes circles (lib/social/circles.ts, docs/PRDs/social-network.md section 6.2, Phase 2b): its own characters
// get off-screen people, places in the shared world and ties to each other, every item checked, as the house, with the
// model and the prompt's version; the admin route the backfill posts to; and a season's newcomers, in the draft's call.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  await t.close();
  setDbForTests(null);
});
const PW = ["circles", "pw", "tests"].join("-");
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
  // The world's own places outlive a reset (the code is their source); the ones a test names don't.
  await t.db.query(`delete from social_places where kind in ('workplace', 'school')`);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const [H1, H2] = HOUSE_CHARACTERS.map((c) => c.id);
const ADMIN = newUserCookie();
const PERSON = newUserCookie();
/** An agent-made character of the show's own (an admin's agent), or someone else's, or a private or test one. */
async function character(id: string, o: { owner?: string; via?: string; visibility?: string; name?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, created_via, extras)
     values ($1, $2, false, $3, 34, 'Restores old boats and older grudges.', '["dry"]'::jsonb, 'someone steady', 'liars', $4, $5, '{"occupation": "Boatwright", "hometown": "Whitby"}'::jsonb)`,
    [id, o.owner ?? userIdOf(ADMIN), o.name ?? `Circle ${id}`, o.visibility ?? "public", o.via ?? "mcp"],
  );
}
const [AG1, AG2, AG3, THEIRS, PRIV, TESTY] = ["sc-ag1", "sc-ag2", "sc-ag3", "sc-theirs", "sc-priv", "sc-testy"];
async function cast() {
  await claimAdmin(t.db, userIdOf(ADMIN));
  await character(AG1, { name: "Marlo Venn" });
  await character(AG2, { name: "Ines Caro" });
  await character(AG3, { name: "Pell Dacre" });
  await character(THEIRS, { owner: userIdOf(PERSON), via: "web", name: "Someone Else" });
  await character(PRIV, { visibility: "private", name: "Quiet One" });
  await character(TESTY, { name: "Test Pilot" });
}
const opts = (o: Partial<CircleOptions> = {}): CircleOptions => ({ source: "house", origin_model: "ollama_chat/test:7b", prompt_version: "test-v1", ...o });

/** A whole circle for Marlo: his mum, brother and grown son; where he lives, works and drinks; an old friend on the show. */
const marlo = (): CircleIn => ({
  character_id: AG1,
  people: [
    { name: "Rosa Venn", relation: "his mum", note: "Runs the bakery on the front and judges everyone's bread.", pronouns: "she/her" },
    { name: "Tom", relation: "younger brother", note: "Borrows the van and returns it with more stickers." },
    { name: "Jun", relation: "son", note: "Grown up, a night nurse, calls every Sunday." },
  ],
  places: [
    { role: "lives", place: "old town" },
    { role: "works", name: "The Salt Lantern", neighbourhood: "The Front", description: "A chandlery that sells rope, tide tables and gossip." },
    { role: "regular", place: "dive_bar" },
  ],
  ties: [{ with: AG2, relation: "old friend", story: "They ran the same losing pub quiz team for six years." }],
});

describe("the words of a relation", () => {
  it("reads relations as kinds, qualifiers and all", () => {
    expect(kindFromWords("his mum")).toBe("parent");
    expect(kindFromWords("Her older sister!")).toBe("sibling");
    expect(kindFromWords("son")).toBe("child");
    expect(kindFromWords("my late gran")).toBe("grandparent");
    expect(kindFromWords("ex-wife")).toBe("ex");
    expect(kindFromWords("boss")).toBe("manager");
    expect(kindFromWords("best_friend")).toBe("best_friend");
    expect(kindFromWords("work best friend")).toBe("best_friend");
    // A word that names a kind only what aired makes (the show's housemate) is the nearest declarable one.
    expect(kindFromWords("housemate")).toBe("roommate");
    expect(kindFromWords("llama wrangler")).toBeNull();
    expect(kindFromWords("")).toBeNull();
  });

  it("reads the other end of a directed kind between characters", () => {
    expect(tieFromWords("mentee")).toEqual({ kind: "mentor", reversed: true });
    expect(tieFromWords("her niece")).toEqual({ kind: "aunt_uncle", reversed: true });
    expect(tieFromWords("mentor")).toEqual({ kind: "mentor", reversed: false });
    expect(tieFromWords("sister")).toEqual({ kind: "sibling", reversed: false });
    // Off-screen, a niece is family: a tie to a person starts at its holder.
    expect(kindFromWords("niece")).toBe("family");
  });

  it("keeps one form of each tie between characters: a child is a parent from the other end", () => {
    expect(canonicalTie({ from: "a", to: "b", kind: "child" })).toEqual({ from: "b", to: "a", kind: "parent" });
    expect(canonicalTie({ from: "a", to: "b", kind: "grandchild" })).toEqual({ from: "b", to: "a", kind: "grandparent" });
    expect(canonicalTie({ from: "a", to: "b", kind: "sibling" })).toEqual({ from: "a", to: "b", kind: "sibling" });
  });

  it("offers warm kinds only toward someone else's character, every declarable one between one's own", () => {
    const theirs = tieKinds("owner", { own: false });
    const mine = tieKinds("owner", { own: true });
    expect(theirs).toContain("friend");
    expect(theirs).not.toContain("rival");
    expect(mine).toContain("rival");
    for (const k of [...theirs, ...mine]) expect(["child", "grandchild", "dated", "housemate", "talked_about", "told"]).not.toContain(k);
    expect(mayDeclareTie("child", "owner", { own: true })).toBe(true);
    expect(mayDeclareTie("nemesis", "owner", { own: false })).toBe(false);
    // A directed kind is two choices, one from each end; a symmetric one is one.
    const choices = tieChoices("owner", { own: true });
    expect(choices.filter((c) => c.kind === "mentor").map((c) => c.label)).toEqual(["Mentor", "Mentee"]);
    expect(choices.filter((c) => c.kind === "sibling")).toHaveLength(1);
    expect(parseChoice("mentor:reverse")).toEqual({ kind: "mentor", reversed: true });
    expect(parseChoice("sibling:reverse")).toBeNull();
    expect(parseChoice("nonsense")).toBeNull();
    // An off-screen person can be the younger generation, and a conflict (the boss who has it in for them).
    expect(personChoices("owner").map((c) => c.id)).toEqual(expect.arrayContaining(["child", "grandchild", "grudge"]));
  });
});

describe("the show's characters", () => {
  it("are the house (the season's cast among them) and the show's own agent cast: never a person's, a private or a test character", async () => {
    await cast();
    setSeasonCastForTests([H1]);
    const show = await showCharacterIds(t.db, null);
    expect(show.get(H1)).toBe("cast");
    expect(show.get(H2)).toBe("house");
    expect(show.get(AG1)).toBe("agent");
    for (const id of [THEIRS, PRIV, TESTY]) expect(show.has(id)).toBe(false);
    expect([...(await showCharacterIds(t.db, [AG1, THEIRS])).keys()]).toEqual([AG1]);
    const page = await showCharacters(t.db, { limit: 500 });
    expect(page.find((c) => c.id === AG1)).toMatchObject({ name: "Marlo Venn", kind: "agent", occupation: "Boatwright", hometown: "Whitby", has_circle: false });
    expect(page.find((c) => c.id === H1)?.archetype).toBeTruthy();
  });
});

describe("writing a circle", () => {
  it("writes people, places and ties as the house, public, with the model and the prompt's version", async () => {
    await cast();
    const r = await writeCircle(t.db, marlo(), opts());
    expect(r).toMatchObject({ status: "written", people: 3, places: 3, ties: 1, refused: [] });

    const people = await peopleOf(t.db, AG1);
    expect(people.map((p) => p.name).sort()).toEqual(["Jun", "Rosa Venn", "Tom"]);
    for (const p of people) expect(p).toMatchObject({ source: "house", visibility: "public", origin_model: "ollama_chat/test:7b", prompt_version: "test-v1" });
    const toPeople = (await t.db.query<{ name: string; kind: string; prompt_version: string }>(
      `select p.name, t.kind, t.prompt_version from social_ties t join social_people p on p.id = t.to_person_id where t.from_id = $1 order by p.name`,
      [AG1],
    )).rows;
    expect(toPeople).toEqual([
      { name: "Jun", kind: "child", prompt_version: "test-v1" },
      { name: "Rosa Venn", kind: "parent", prompt_version: "test-v1" },
      { name: "Tom", kind: "sibling", prompt_version: "test-v1" },
    ]);

    const places = (await t.db.query<{ key: string; role: string; source: string; origin_model: string; parent: string | null }>(
      `select p.key, m.role, m.source, m.origin_model, n.key as parent from social_place_members m join social_places p on p.id = m.place_id
         left join social_places n on n.id = p.parent_id where m.character_id = $1 order by m.role`,
      [AG1],
    )).rows;
    expect(places).toEqual([
      { key: "neighbourhood:old-town", role: "lives", source: "house", origin_model: "ollama_chat/test:7b", parent: "city:heartsease-on-sea" },
      { key: "venue:dive_bar", role: "regular", source: "house", origin_model: "ollama_chat/test:7b", parent: "neighbourhood:neon-mile" },
      { key: "workplace:the-salt-lantern", role: "works", source: "house", origin_model: "ollama_chat/test:7b", parent: "neighbourhood:the-front" },
    ]);

    const tie = (await t.db.query(`select kind, status, visibility, source, story, origin_model, prompt_version from social_ties where to_id is not null`)).rows;
    expect(tie).toEqual([
      { kind: "old_friend", status: "active", visibility: "public", source: "house", story: "They ran the same losing pub quiz team for six years.", origin_model: "ollama_chat/test:7b", prompt_version: "test-v1" },
    ]);
    expect(await hasCircle(t.db, AG1)).toBe(true);

    // What the backfill reads back: the circle from each end, and the workplace on the world's menu for the next one.
    const sums = await circleSummaries(t.db, [AG1, AG2]);
    expect(sums.get(AG1)!.people).toEqual(expect.arrayContaining([{ name: "Rosa Venn", relation: "parent" }, { name: "Jun", relation: "child" }]));
    expect(sums.get(AG2)!.ties).toEqual([{ with: AG1, kind: "old_friend", relation: "old friend" }]);
    expect((await worldMenu(t.db)).workplaces).toEqual([{ key: "workplace:the-salt-lantern", name: "The Salt Lantern", kind: "workplace", neighbourhood: "The Front" }]);
  });

  it("refuses what breaks a rule, alone, and writes the rest", async () => {
    await cast();
    // Marlo and Ines have dated: never family. Someone else's character isn't the show's to tie.
    await t.db.query(`insert into relationships (character_a, character_b, dates) values ($1, $2, 1)`, [AG1 < AG2 ? AG1 : AG2, AG1 < AG2 ? AG2 : AG1]);
    const r = await writeCircle(
      t.db,
      {
        character_id: AG1,
        people: [
          { name: "Gus", relation: "llama wrangler" },
          { name: "Bea", relation: "daughter", note: "She's 15 and already runs the ferry rota." },
          { name: "Nora", relation: "wife", note: "Keeps the books." },
          { name: "Ilse", relation: "late wife", note: "Painted every boat in the harbour blue.", deceased: true },
          { name: "Tifa Lockhart", relation: "friend" },
          { name: "Rosa", relation: "mum" },
          { name: "Rosa", relation: "aunt" },
          { name: "ines  caro", relation: "rival" },
        ],
        places: [
          { role: "lives", place: "Narnia" },
          { role: "haunts", place: "dive_bar" },
          { role: "regular", place: "the moon base" },
          { role: "regular", place: "A sticky dive bar on trivia night" },
        ],
        ties: [
          { with: AG2, relation: "sister" },
          { with: THEIRS, relation: "friend" },
          { with: AG3, relation: "rival", story: "Both bid on the same wreck at auction; neither has forgotten." },
          { with: AG1, relation: "friend" },
          { with: AG3, relation: "cousin" },
        ],
      },
      opts(),
    );
    expect(r).toMatchObject({ status: "written", people: 2, places: 1, ties: 1 });
    const why = Object.fromEntries(r.refused.map((x) => [`${x.item} ${x.what}`, x.reason]));
    expect(why).toEqual({
      "person Gus": "not a relation: llama wrangler",
      "person Bea": "unsafe",
      "person Nora": "they're single: on the show to date",
      "person Tifa Lockhart": expect.stringMatching(/^not an original: .*Final Fantasy/),
      "person Rosa": "named twice",
      // Someone with a character on the site is a tie, never an off-screen person (a first name alone is anyone's).
      "person ines caro": "a character on the site: a tie, not an off-screen person",
      "place lives Narnia": "not one of the city's neighbourhoods",
      "place haunts dive_bar": "not a role: haunts",
      "place regular the moon base": "no such place in the world",
      [`tie sister ${AG2}`]: "they've dated: never family",
      [`tie friend ${THEIRS}`]: "not one of the show's own characters",
      [`tie friend ${AG1}`]: "not another character",
      [`tie ${AG3}`]: "more than 4 in one write",
    });
    expect((await peopleOf(t.db, AG1)).map((p) => [p.name, p.deceased])).toEqual(expect.arrayContaining([["Ilse", true], ["Rosa", false]]));
    // A show character may hold a grudge against another of the show's own: the house declares both ends.
    expect((await t.db.query(`select kind from social_ties where to_id = $1 or from_id = $1`, [AG3])).rows).toEqual([{ kind: "rival" }]);
    // Never a partner on the show either; and an ex or a fake couple from before the show (a backstory link, its tie not
    // derived yet) is romance: never family.
    await t.db.query(`insert into character_links (character_a, character_b, kind, story) values ($1, $2, 'second_chance', 'They dated once.')`, [AG2, AG3].sort());
    const more = await writeCircle(t.db, { character_id: AG2, ties: [{ with: AG3, relation: "husband" }, { with: AG3, relation: "cousin" }, { with: AG1, relation: "mentee" }] }, opts());
    expect(more.refused).toEqual([
      { item: "tie", what: `husband ${AG3}`, reason: "they're single: on the show to date" },
      { item: "tie", what: `cousin ${AG3}`, reason: "they've dated: never family" },
    ]);
    // "Marlo is my mentee": the mentor tie from Marlo to Ines (Ines is Marlo's mentor).
    expect((await t.db.query(`select from_id, to_id from social_ties where kind = 'mentor'`)).rows).toEqual([{ from_id: AG1, to_id: AG2 }]);
    expect(TAKEN_KINDS.has("spouse")).toBe(true);
    expect(pairClash("parent", "a|b", { romance: new Set(["a|b"]), kin: new Set() })).toBe("they've dated: never family");
    expect(pairClash("ex", "a|b", { romance: new Set(), kin: new Set(["a|b"]) })).toBe("they're family");
  });

  it("names people by the rules: family shares the holder's surname, nobody else has a show character's, no fourth Eleanor", async () => {
    await cast();
    // Three Eleanors already in other characters' lives, and a Bo Marsh; a common surname on someone's own character.
    for (const [holder, name] of [[AG2, "Eleanor Moss"], [AG2, "Eleanor Hart"], [AG3, "Eleanor Pike"], [AG3, "Bo Marsh"]]) {
      expect((await addPerson(t.db, { holderId: holder, name, visibility: "public", source: "house" })).ok).toBe(true);
    }
    await character("sc-chen", { owner: userIdOf(PERSON), via: "web", name: "Maya Chen" });
    const input: CircleIn = {
      character_id: AG1,
      people: [
        { name: "Maeve Caro", relation: "old friend", note: "Maeve drives him to every ferry." },
        { name: "Lydia Dacre", relation: "his mother", pronouns: "she/her" },
        { name: "Sam Venn", relation: "coworker" },
        { name: "Eleanor Moreau", relation: "aunt", note: "Eleanor knits, and Eleanor's scarves are legend." },
        { name: "Bo Marsh", relation: "neighbour" },
        { name: "Rosa Venn", relation: "sister" },
        { name: "Wen Chen", relation: "friend" },
      ],
    };
    const renames = (r: { renamed?: { from: string; to: string; why: string }[] }) => new Map((r.renamed ?? []).map((x) => [x.from, x]));
    // A dry run says the same renames, and writes nothing.
    const dry = await writeCircle(t.db, input, opts({ dryRun: true }));
    expect([...renames(dry).keys()]).toEqual(["Maeve Caro", "Lydia Dacre", "Sam Venn", "Eleanor Moreau", "Bo Marsh"]);
    expect(await peopleOf(t.db, AG1)).toEqual([]);

    const r = await writeCircle(t.db, input, opts());
    expect(r).toMatchObject({ status: "written", people: 7, refused: [] });
    const by = renames(r);
    expect([...by.keys()]).toEqual([...renames(dry).keys()]);
    // Family with another character's surname takes the holder's.
    expect(by.get("Lydia Dacre")).toEqual({ from: "Lydia Dacre", to: "Lydia Venn", why: "family: their surname, not another character's" });
    // Anyone else keeps their first name and gets a surname no show character has, the holder's own included.
    expect(by.get("Maeve Caro")!.why).toBe("not family: not a character's surname");
    expect(by.get("Sam Venn")!.why).toBe("not family: not their surname");
    expect(by.get("Bo Marsh")!.why).toBe("a name someone has already");
    for (const from of ["Maeve Caro", "Sam Venn", "Bo Marsh"]) {
      const [first, last] = by.get(from)!.to.split(" ");
      expect(first).toBe(from.split(" ")[0]);
      // (Vesper Lark and Quist are the house's.)
      expect(["Venn", "Caro", "Dacre", "Marsh", "Lark", "Quist"]).not.toContain(last);
    }
    // A fourth Eleanor gets another first name, and the note follows, word by word.
    const aunt = by.get("Eleanor Moreau")!;
    expect(aunt.why).toBe("3 called Eleanor already");
    const [auntFirst, auntLast] = aunt.to.split(" ");
    expect(auntFirst).not.toBe("Eleanor");
    expect(auntLast).toBe("Moreau");
    const people = await peopleOf(t.db, AG1);
    expect(people.find((p) => p.name === aunt.to)!.note).toBe(`${auntFirst} knits, and ${auntFirst}'s scarves are legend.`);
    expect(people.find((p) => p.name === by.get("Maeve Caro")!.to)!.note).toBe("Maeve drives him to every ferry.");
    // Family with the holder's surname, and a surname only someone's own character has: as given.
    expect(people.map((p) => p.name)).toEqual(expect.arrayContaining(["Rosa Venn", "Wen Chen"]));
    expect(people.map((p) => p.name)).not.toEqual(expect.arrayContaining(["Maeve Caro"]));
  });

  it("holds the exclusive kinds' caps: a fourth best friend is refused, and leaves no person behind", async () => {
    await cast();
    const friends = ["Ada", "Bo", "Cy", "Di"].map((name) => ({ name, relation: "best friend" }));
    const r = await writeCircle(t.db, { character_id: AG1, people: friends }, opts());
    expect(r).toMatchObject({ people: 3, refused: [{ item: "person", what: "Di", reason: "exclusive" }] });
    expect((await peopleOf(t.db, AG1)).map((p) => p.name).sort()).toEqual(["Ada", "Bo", "Cy"]);
  });

  it("skips a character that has the show's circle; replace writes it over, never an owner's or agent's own people", async () => {
    await cast();
    await addPerson(t.db, { holderId: AG1, name: "Wendell", note: "Their agent named him.", source: "agent", visibility: "public" });
    expect((await writeCircle(t.db, marlo(), opts())).status).toBe("written");
    expect(await writeCircle(t.db, marlo(), opts())).toMatchObject({ status: "skipped", people: 0 });
    // Again with replace: the same circle, no copies, and Wendell stays.
    for (let i = 0; i < 2; i++) expect(await writeCircle(t.db, marlo(), opts({ replace: true }))).toMatchObject({ status: "written", people: 3, places: 3, ties: 1 });
    expect((await peopleOf(t.db, AG1)).map((p) => p.name).sort()).toEqual(["Jun", "Rosa Venn", "Tom", "Wendell"]);
    expect(Number((await t.db.query(`select count(*) from social_place_members where character_id = $1`, [AG1])).rows[0].count)).toBe(3);
    expect(Number((await t.db.query(`select count(*) from social_ties where to_id is not null`)).rows[0].count)).toBe(1);
  });

  it("checks without writing on a dry run, and counts the people cap", async () => {
    await cast();
    for (let i = 0; i < PEOPLE_CAP - 2; i++) await addPerson(t.db, { holderId: AG1, name: `Agent pick ${i}`, source: "agent" });
    const r = await writeCircle(t.db, marlo(), opts({ dryRun: true }));
    expect(r).toMatchObject({ status: "checked", people: 2, places: 3, ties: 1, refused: [{ item: "person", what: "Jun", reason: "cap" }] });
    expect(Number((await t.db.query(`select count(*) from social_place_members`)).rows[0].count)).toBe(0);
    expect(Number((await t.db.query(`select count(*) from social_ties`)).rows[0].count)).toBe(0);
    expect((await peopleOf(t.db, AG1))).toHaveLength(PEOPLE_CAP - 2);
  });

  it("refuses a character that isn't the show's, and writes nothing with the social network off", async () => {
    await cast();
    expect(await writeCircle(t.db, { ...marlo(), character_id: THEIRS }, opts())).toMatchObject({ status: "refused", reason: "not one of the show's own characters" });
    vi.stubEnv("SOCIAL_TIES", "0");
    expect(await writeCircle(t.db, marlo(), opts())).toMatchObject({ status: "refused", reason: "off" });
    expect((await peopleOf(t.db, AG1))).toHaveLength(0);
  });
});

describe("POST and GET /api/admin/social/circles", () => {
  const call = (method: "GET" | "POST", body?: unknown, key: string | null = PW, query = "") =>
    (method === "GET" ? GET : POST)(
      new Request(`${BASE_URL}/api/admin/social/circles${query}`, {
        method,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "x-frontier-key": key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const write = (o: Record<string, unknown> = {}) => ({ origin_model: "ollama_chat/test:7b", prompt_version: "test-v1", circles: [marlo()], ...o });

  it("is the admin's only", async () => {
    await cast();
    expect((await call("GET", undefined, null)).status).toBe(403);
    expect((await call("POST", write(), "wrong")).status).toBe(403);
  });

  it("lists the show's characters with their circle so far and the world to place them in", async () => {
    await cast();
    await writeCircle(t.db, marlo(), opts());
    const body = await (await call("GET", undefined, PW, "?limit=500")).json();
    expect(body.on).toBe(true);
    const ids = body.characters.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([H1, AG1, AG2]));
    expect(ids).not.toContain(THEIRS);
    expect(body.characters.find((c: { id: string }) => c.id === AG2).circle.ties).toEqual([{ with: AG1, kind: "old_friend", relation: "old friend" }]);
    expect(body.world.neighbourhoods.length).toBeGreaterThanOrEqual(5);
    expect(body.world.hangouts).toEqual(expect.arrayContaining([{ key: "venue:dive_bar", name: expect.any(String), neighbourhood: "Neon Mile" }]));
    const missing = await (await call("GET", undefined, PW, "?limit=500&missing=1")).json();
    expect(missing.characters.map((c: { id: string }) => c.id)).not.toContain(AG1);
    // Pages by id.
    const first = await (await call("GET", undefined, PW, "?limit=2")).json();
    expect(first.characters).toHaveLength(2);
    expect(first.next).toBe(first.characters[1].id);
  });

  it("writes what passes, as the house, and a dry run writes nothing", async () => {
    await cast();
    const dry = await (await call("POST", write({ dry_run: true }))).json();
    expect(dry).toMatchObject({ dry_run: true, totals: { people: 3, places: 3, ties: 1, refused: 0 }, results: [{ status: "checked" }] });
    expect(await hasCircle(t.db, AG1)).toBe(false);
    const res = await call("POST", write());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dry_run: false, totals: { people: 3, places: 3, ties: 1, refused: 0 }, results: [{ status: "written" }] });
    expect((await peopleOf(t.db, AG1)).every((p) => p.source === "house" && p.prompt_version === "test-v1")).toBe(true);
    expect(await (await call("POST", write())).json()).toMatchObject({ results: [{ status: "skipped" }] });
    expect((await call("POST", { circles: [marlo()] })).status).toBe(422);
    expect((await call("POST", write({ circles: [] }))).status).toBe(422);
  });
});

describe("a season's newcomers arrive with their circle", () => {
  it("asks for it in the draft's own call, and reads it leniently", () => {
    const plain = String(draftMessages([])[1]!.content);
    expect(plain).not.toContain('"circle"');
    const asked = String(draftMessages([], { circle: { workplaces: ["The Salt Lantern"], knows: [{ name: "Marlo Venn", archetype: "The fixer" }] } })[1]!.content);
    expect(asked).toContain('and "circle" (their life off the show');
    expect(asked).toContain("Marlo Venn (The fixer)");
    expect(asked).toContain("The Salt Lantern");
    expect(asked).toContain("dive_bar");
    expect(asked).toContain("Old Town");

    expect(parseCircle(null)).toBeNull();
    expect(parseCircle("a string")).toBeNull();
    expect(parseCircle({ people: "nobody" })).toBeNull();
    expect(parseCircle({ people: [{ name: "Rosa", relation: "mum" }, { name: 3 }, null], works: "The Salt Lantern", knows: [{ name: "Marlo Venn" }] })).toEqual({
      people: [{ name: "Rosa", relation: "mum", note: null, pronouns: null }],
      lives: null,
      works: { name: "The Salt Lantern", neighbourhood: null },
      regular: null,
      knows: [],
    });
  });

  it("writes it as the house when the candidate is saved; a broken circle never sinks the draft", async () => {
    setSeasonCastForTests([H1, H2]);
    // The first newcomer arrives knowing whoever is likely to return (pairPlan); the circle names the other one too.
    const plan = await pairPlan(t.db, "2026-12-01");
    const returning = HOUSE_CHARACTERS.find((h) => h.id === plan.returning!.id)!;
    const other = HOUSE_CHARACTERS.find((h) => h.id === (returning.id === H1 ? H2 : H1))!;
    const draft = (name: string, circle: unknown) =>
      JSON.stringify({
        name,
        age: 38,
        pronouns: "she/her",
        bio: "A ferry captain who narrates the weather to her passengers like a sports commentator. Has never once been seasick, and brags.",
        traits: ["bold", "chatty", "steady"],
        want: "Someone who laughs at her forecasts",
        dealbreaker: "People who clap when the boat lands",
        archetype: `The ${name.split(" ")[0].toLowerCase()} type`,
        voice: "Fast, booming play-by-play: everything is a match, everyone is a player, and she scores the room out loud.",
        appearance: "salt in her hair, a captain's whistle she never blows",
        look: "a woman in her late thirties with deep brown skin, short grey-streaked locs and a broad grin, in a navy pea coat",
        hue: 210,
        signals: { warmth: 0.7, openness: 0.6, guardedness: 0.2, humor: 0.8 },
        soul: { values: "Showing up.", insecurities: "Being loud.", humor: "Commentary.", boundaries: "The wheel.", romantic: "Dawn.", communication: "Loud, then honest." },
        kit: { occupation: "Ferry captain", hobbies: ["Weather", "Darts", "Karaoke"] },
        circle,
      });
    const { calls } = scriptedModel([
      draft("Odessa Brine", {
        people: [
          { name: "Mags Brine", relation: "mother", note: "Taught her to read the tide before she could read." },
          { name: "Abel", relation: "younger brother", note: "Runs the chip shop on the pier." },
          { name: "Corin", relation: "son", note: "She's 12 and loves boats." },
        ],
        lives: "The Front",
        works: { name: "Heartsease Ferries", neighbourhood: "The Docks" },
        regular: "pier_at_night",
        knows: [
          { name: other.name, relation: "cousin", story: "Their mums are sisters; they only meet at weddings." },
          { name: "Nobody Onthe Show", relation: "sister" },
        ],
      }),
      draft("Wynn Arbor", "not an object"),
    ]);
    const r = await generateCandidates(t.db, "2026-12-01", getDirectorModel(), 2);
    expect(r.made).toEqual(["house-odessa", "house-wynn"]);
    expect(String(calls[0][1].content)).toContain('"circle" (their life off the show');
    expect(String(calls[0][1].content)).toContain(`${other.name} (`);
    // The second newcomer may know the first.
    expect(String(calls[1][1].content)).toContain("Odessa Brine (");

    const people = await peopleOf(t.db, "house-odessa");
    expect(people.map((p) => p.name).sort()).toEqual(["Abel", "Mags Brine"]);
    expect(people.every((p) => p.source === "house" && p.prompt_version === CIRCLE_PROMPT_VERSION && !!p.origin_model)).toBe(true);
    const places = (await t.db.query<{ key: string; role: string }>(
      `select p.key, m.role from social_place_members m join social_places p on p.id = m.place_id where m.character_id = 'house-odessa' order by m.role`,
    )).rows;
    expect(places).toEqual([
      { key: "neighbourhood:the-front", role: "lives" },
      { key: "venue:pier_at_night", role: "regular" },
      { key: "workplace:heartsease-ferries", role: "works" },
    ]);
    const ties = (await t.db.query(`select kind, prompt_version, from_id, to_id from social_ties where to_id is not null and (from_id = 'house-odessa' or to_id = 'house-odessa')`)).rows;
    expect(ties).toEqual([{ kind: "cousin", prompt_version: CIRCLE_PROMPT_VERSION, from_id: expect.any(String), to_id: expect.any(String) }]);
    expect([ties[0].from_id, ties[0].to_id].sort()).toEqual(["house-odessa", other.id].sort());
    expect(await peopleOf(t.db, "house-wynn")).toEqual([]);
    expect(parseDraft(draft("Pip Larch", { people: [{ name: "Rosa", relation: "mum" }] }), []).ok).toBe(true);
  });
});
