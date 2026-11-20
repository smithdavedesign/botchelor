import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/characters/[id]/circle/route";
import { claimAdmin } from "@/lib/admins";
import { setDbForTests } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { SOCIAL_PROPOSE_LIMITS } from "@/lib/limits";
import {
  addPersonFor,
  answerTie,
  declareTie,
  editPersonFor,
  editTieFor,
  endTieFor,
  lapseProposals,
  leavePlaceFor,
  placeMenu,
  PROPOSAL_DAYS,
  REASK_DAYS,
  removePersonFor,
  setPlaceFor,
  theirPeople,
  tieCandidates,
  type DeclareBy,
} from "@/lib/social/declare";
import { peopleOf } from "@/lib/social/people";
import { getTie } from "@/lib/social/ties";
import { PEOPLE_CAP } from "@/lib/social/types";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// An owner's word on their character's circle (lib/social/declare.ts, docs/PRDs/social-network.md section 6.2, Phase
// 2b): off-screen people, places, ties between their own characters live at once, warm proposals to someone else's that
// its owner answers (or that lapse), and what's never declared. Then the page's view and its route.

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
  await t.db.query(`delete from social_places where kind in ('workplace', 'school')`);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ANA = newUserCookie();
const BEN = newUserCookie();
const CAL = newUserCookie();
const ADMIN = newUserCookie();
const ana: DeclareBy = { userId: userIdOf(ANA), source: "owner" };
const ben: DeclareBy = { userId: userIdOf(BEN), source: "owner" };
const cal: DeclareBy = { userId: userIdOf(CAL), source: "owner" };
const [H1] = HOUSE_CHARACTERS.map((c) => c.id);
const [A1, A2, A3, B1, B2, BPRIV, C1, SHOW] = ["dc-a1", "dc-a2", "dc-a3", "dc-b1", "dc-b2", "dc-bpriv", "dc-c1", "dc-show"];

async function character(id: string, owner: string, name: string, o: { visibility?: string; via?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, created_via)
     values ($1, $2, false, $3, 31, 'Keeps a tide table in every coat.', '["wry"]'::jsonb, 'someone kind', 'liars', $4, $5)`,
    [id, owner, name, o.visibility ?? "public", o.via ?? "web"],
  );
}
async function world() {
  await claimAdmin(t.db, userIdOf(ADMIN));
  await character(A1, ana.userId, "Ada Quill");
  await character(A2, ana.userId, "Tom Quill");
  await character(A3, ana.userId, "Ivy Moss");
  await character(B1, ben.userId, "Bo Lark");
  await character(B2, ben.userId, "Bea Lark");
  await character(BPRIV, ben.userId, "Hidden Lark", { visibility: "private" });
  await character(C1, cal.userId, "Cy Fenn");
  // One of the show's own agent cast: made over MCP by an admin's agent.
  await character(SHOW, userIdOf(ADMIN), "Marlo Venn", { via: "mcp" });
}
const notices = async (user: string) =>
  (await t.db.query<{ kind: string; title: string; link: string; read_at: string | null }>(`select kind, title, link, read_at from notifications where user_id = $1 order by created_at`, [user])).rows;

describe("an owner's off-screen people", () => {
  it("adds one with the relation as a tie, changes them (the relation too), and takes them off", async () => {
    await world();
    const added = await addPersonFor(t.db, ana, A1, { name: "Rosa Quill", relation: "mum", note: "Runs the bakery.", pronouns: "she/her" });
    expect(added).toMatchObject({ ok: true, person: { name: "Rosa Quill", source: "owner", created_by: ana.userId }, tie: { kind: "parent", from_id: A1, status: "active", visibility: "public" } });
    if (!added.ok) return;
    // A kind's id from the form works as well as words.
    expect(await addPersonFor(t.db, ana, A1, { name: "Jun", relation: "child" })).toMatchObject({ ok: true, tie: { kind: "child" } });
    const changed = await editPersonFor(t.db, ana, added.person.id, { relation: "aunt_uncle", visibility: "owner", note: "Runs the bakery, and the street." });
    expect(changed).toMatchObject({ ok: true, person: { visibility: "owner", note: "Runs the bakery, and the street." }, tie: { kind: "aunt_uncle", visibility: "owner" } });
    expect((await t.db.query(`select kind from social_ties where to_person_id = $1`, [added.person.id])).rows).toEqual([{ kind: "aunt_uncle" }]);
    expect(await removePersonFor(t.db, ana, added.person.id)).toEqual({ ok: true });
    expect((await peopleOf(t.db, A1)).map((p) => p.name)).toEqual(["Jun"]);
    expect((await t.db.query(`select count(*)::int as n from social_ties where to_person_id = $1`, [added.person.id])).rows[0].n).toBe(0);
  });

  it("refuses what isn't a relation, words the show's check stops, the cap, and anyone else's character", async () => {
    await world();
    expect(await addPersonFor(t.db, ana, A1, { name: "Gus", relation: "llama wrangler" })).toMatchObject({ ok: false, status: 422, error: "invalid_relation" });
    expect(await addPersonFor(t.db, ana, A1, { name: "Bea", relation: "daughter", note: "She's 15 and runs the ferry rota." })).toMatchObject({ ok: false, status: 422, error: "unsafe_text" });
    expect(await addPersonFor(t.db, ben, A1, { name: "Rosa", relation: "mum" })).toMatchObject({ ok: false, status: 404 });
    for (let i = 0; i < PEOPLE_CAP; i++) expect((await addPersonFor(t.db, ana, A2, { name: `Friend ${i}`, relation: "friend" })).ok).toBe(true);
    expect(await addPersonFor(t.db, ana, A2, { name: "One more", relation: "friend" })).toMatchObject({ ok: false, status: 409, error: "people_cap" });
    // A spouse is one each: a second leaves no person behind.
    expect((await addPersonFor(t.db, ana, A3, { name: "Nora", relation: "wife" })).ok).toBe(true);
    expect(await addPersonFor(t.db, ana, A3, { name: "Ilse", relation: "husband" })).toMatchObject({ ok: false, error: "exclusive" });
    expect((await peopleOf(t.db, A3)).map((p) => p.name)).toEqual(["Nora"]);
  });

  it("leaves the show's characters to the show", async () => {
    await world();
    expect(await addPersonFor(t.db, { userId: userIdOf(ADMIN), source: "owner" }, SHOW, { name: "Rosa", relation: "mum" })).toMatchObject({ ok: false, status: 409, error: "show_character" });
  });
});

describe("ties between characters", () => {
  it("between two of yours: live at once, any kind, conflict too, in its one stored form", async () => {
    await world();
    expect(await declareTie(t.db, ana, A1, { with: A3, relation: "rival", story: "Both bid on the same boat." })).toMatchObject({ ok: true, status: "active", news: true, tie: { kind: "rival", source: "owner" } });
    // "Tom is Ada's son": the parent tie from Tom's other end, Ada to... stored as Ada is Tom's parent.
    expect(await declareTie(t.db, ana, A1, { with: A2, relation: "son" })).toMatchObject({ ok: true, tie: { kind: "parent", from_id: A2, to_id: A1 } });
    // A choice read from its other end: Ivy is Ada's mentee, so Ada is Ivy's mentor.
    expect(await declareTie(t.db, ana, A1, { with: A3, relation: "mentor:reverse" })).toMatchObject({ ok: true, tie: { kind: "mentor", from_id: A3, to_id: A1 } });
    // The same again is there already.
    expect(await declareTie(t.db, ana, A1, { with: A3, relation: "rival" })).toMatchObject({ ok: true, status: "active", news: false });
    // Family never dates.
    expect(await declareTie(t.db, ana, A1, { with: A2, relation: "ex" })).toMatchObject({ ok: false, status: 409, error: "clash" });
  });

  it("to someone else's: a warm kind only, as a proposal its owner answers, and both owners hear", async () => {
    await world();
    expect(await declareTie(t.db, ana, A1, { with: B1, relation: "rival" })).toMatchObject({ ok: false, status: 422, error: "not_warm" });
    const asked = await declareTie(t.db, ana, A1, { with: B1, relation: "sister", story: "Same school, same bad haircut." });
    expect(asked).toMatchObject({ ok: true, status: "proposed", news: true, tie: { kind: "sibling", status: "proposed", detail: { proposed_from: A1 } } });
    if (!asked.ok) return;
    const [notice] = await notices(ben.userId);
    expect(notice).toMatchObject({ kind: "tie_proposal", link: `/characters/${B1}?tie=${asked.tie.id}#people`, read_at: null });
    expect(notice.title).toContain("Ada and Bo");
    // Asking again changes nothing; only the asked owner answers.
    expect(await declareTie(t.db, ana, A1, { with: B1, relation: "sibling" })).toMatchObject({ ok: true, status: "proposed", news: false });
    expect(await answerTie(t.db, ana, asked.tie.id, true)).toMatchObject({ ok: false, status: 404 });
    expect(await answerTie(t.db, ben, asked.tie.id, true)).toMatchObject({ ok: true, tie: { status: "active", answered_by: ben.userId } });
    expect((await notices(ben.userId))[0].read_at).not.toBeNull();
    expect((await notices(ana.userId)).map((n) => [n.kind, n.link])).toEqual([["tie_answer", `/characters/${A1}#people`]]);
    expect(await answerTie(t.db, ben, asked.tie.id, true)).toMatchObject({ ok: false, status: 404 });
  });

  it("a no stands for a while; an unanswered proposal lapses after its days", async () => {
    await world();
    const now = new Date();
    const asked = await declareTie(t.db, ana, A1, { with: B1, relation: "friend" }, process.env, now);
    if (!asked.ok) throw new Error("not asked");
    expect(await answerTie(t.db, ben, asked.tie.id, false)).toMatchObject({ ok: true, tie: { status: "declined" } });
    expect(await declareTie(t.db, ana, A1, { with: B1, relation: "friend" }, process.env, now)).toMatchObject({ ok: false, status: 409, error: "declined_recently" });
    const later = new Date(now.getTime() + (REASK_DAYS + 1) * 86_400_000);
    expect(await declareTie(t.db, ana, A1, { with: B1, relation: "friend" }, process.env, later)).toMatchObject({ ok: true, status: "proposed" });

    const other = await declareTie(t.db, ana, A2, { with: B2, relation: "cousin" }, process.env, now);
    if (!other.ok) throw new Error("not asked");
    expect(await lapseProposals(t.db, { now: new Date(now.getTime() + (PROPOSAL_DAYS - 1) * 86_400_000) })).toBe(0);
    expect(await lapseProposals(t.db, { now: new Date(now.getTime() + (PROPOSAL_DAYS + 1) * 86_400_000) })).toBe(1);
    expect(await getTie(t.db, other.tie.id)).toMatchObject({ status: "declined", answered_by: null });
    expect((await notices(ana.userId)).map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^No answer about Tom and Bea/)]));
  });

  it("never to the house or the show's own cast, someone's private character, across a block, or family between two who've dated", async () => {
    await world();
    expect(await declareTie(t.db, ana, A1, { with: H1, relation: "friend" })).toMatchObject({ ok: false, status: 409, error: "show_character" });
    expect(await declareTie(t.db, ana, A1, { with: SHOW, relation: "friend" })).toMatchObject({ ok: false, status: 409, error: "show_character" });
    expect(await declareTie(t.db, ana, A1, { with: BPRIV, relation: "friend" })).toMatchObject({ ok: false, status: 404 });
    // Cal blocked Ana after a date between their characters.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending)
       values ('dc-ep', $1, $2, $3, 's', '["a","b"]'::jsonb, '["x","y"]'::jsonb, 't', 'f', 'friends')`,
      [ana.userId, A1, C1],
    );
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, 'dc-ep', $2)`, [cal.userId, ana.userId]);
    expect(await declareTie(t.db, ana, A1, { with: C1, relation: "friend" })).toMatchObject({ ok: false, status: 404 });
    await t.db.query(`insert into relationships (character_a, character_b, dates) values ($1, $2, 1)`, [A1 < B1 ? A1 : B1, A1 < B1 ? B1 : A1]);
    expect(await declareTie(t.db, ana, A1, { with: B1, relation: "cousin" })).toMatchObject({ ok: false, status: 409, error: "clash" });
    expect(await declareTie(t.db, ana, A1, { with: A1, relation: "friend" })).toMatchObject({ ok: false, status: 422, error: "self" });
  });

  it(`holds ${SOCIAL_PROPOSE_LIMITS.perDay} proposals a day per person`, async () => {
    await world();
    for (let i = 0; i < SOCIAL_PROPOSE_LIMITS.perDay; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ('social_propose', $1, now())`, [ana.userId]);
    expect(await declareTie(t.db, ana, A1, { with: B1, relation: "friend" })).toMatchObject({ ok: false, status: 429, error: "rate_limited" });
    // Between two of your own there's no asking, so no limit.
    expect(await declareTie(t.db, ana, A1, { with: A2, relation: "friend" })).toMatchObject({ ok: true, status: "active" });
  });

  it("ends a friendship (it stays, as past), takes family off, withdraws a proposal; what aired stays", async () => {
    await world();
    const friends = await declareTie(t.db, ana, A1, { with: A3, relation: "friend" });
    const family = await declareTie(t.db, ana, A1, { with: A2, relation: "sibling" });
    const asked = await declareTie(t.db, ana, A1, { with: B1, relation: "friend" });
    if (!friends.ok || !family.ok || !asked.ok) throw new Error("not declared");
    expect(await endTieFor(t.db, ana, friends.tie.id)).toEqual({ ok: true, ended: "ended" });
    expect(await getTie(t.db, friends.tie.id)).toMatchObject({ status: "ended" });
    expect(await endTieFor(t.db, ana, family.tie.id)).toEqual({ ok: true, ended: "removed" });
    expect(await getTie(t.db, family.tie.id)).toBeNull();
    expect(await endTieFor(t.db, ben, asked.tie.id)).toMatchObject({ ok: false, error: "answer_it" });
    expect(await endTieFor(t.db, ana, asked.tie.id)).toEqual({ ok: true, ended: "removed" });
    expect((await notices(ben.userId)).every((n) => n.read_at !== null)).toBe(true);
    await t.db.query(
      `insert into social_ties (id, from_id, to_id, kind, layer, source) values ('tie-aired', $1, $2, 'met_on_show', 'acquaintance', 'derived')`,
      [A1 < B2 ? A1 : B2, A1 < B2 ? B2 : A1],
    );
    expect(await endTieFor(t.db, ana, "tie-aired")).toMatchObject({ ok: false, error: "not_declared" });
    expect(await endTieFor(t.db, cal, friends.tie.id)).toMatchObject({ ok: false, status: 404 });
  });

  it("lets either owner hide a tie, and only the one who declared it rewrite its story", async () => {
    await world();
    const asked = await declareTie(t.db, ana, A1, { with: B1, relation: "friend", story: "Met at the pier." });
    if (!asked.ok) throw new Error("not asked");
    await answerTie(t.db, ben, asked.tie.id, true);
    expect(await editTieFor(t.db, ben, asked.tie.id, { visibility: "owner" })).toMatchObject({ ok: true, tie: { visibility: "owner" } });
    expect(await editTieFor(t.db, ben, asked.tie.id, { story: "Never met." })).toMatchObject({ ok: false, status: 403 });
    expect(await editTieFor(t.db, ana, asked.tie.id, { story: "Met at the pier, in the rain." })).toMatchObject({ ok: true, tie: { story: "Met at the pier, in the rain." } });
  });
});

describe("places", () => {
  it("picks from the world, names a new workplace (the same name is the same place), and keeps one home", async () => {
    await world();
    expect(await setPlaceFor(t.db, ana, A1, { role: "lives", place: "neighbourhood:old-town" })).toMatchObject({ ok: true, role: "lives" });
    expect(await setPlaceFor(t.db, ana, A1, { role: "lives", place: "neighbourhood:the-front" })).toMatchObject({ ok: true });
    expect((await t.db.query(`select count(*)::int as n from social_place_members where character_id = $1 and role = 'lives'`, [A1])).rows[0].n).toBe(1);
    const lantern = await setPlaceFor(t.db, ana, A1, { role: "works", name: "The Salt Lantern", neighbourhood: "the front", since: "2021" });
    expect(lantern).toMatchObject({ ok: true, place: { key: "workplace:the-salt-lantern" } });
    expect(await setPlaceFor(t.db, ben, B1, { role: "works", name: "the salt lantern" })).toMatchObject({ ok: true, place: { key: "workplace:the-salt-lantern" } });
    // A neighbourhood isn't a job, a hangout is no home, and nothing new is a neighbourhood.
    expect(await setPlaceFor(t.db, ana, A1, { role: "works", place: "neighbourhood:old-town" })).toMatchObject({ ok: false, error: "invalid_place" });
    expect(await setPlaceFor(t.db, ana, A1, { role: "lives", name: "Narnia" })).toMatchObject({ ok: false, error: "invalid_place" });
    expect(await setPlaceFor(t.db, ana, A1, { role: "haunts", place: "venue:dive_bar" })).toMatchObject({ ok: false, error: "invalid_role" });
    // Coworkers: Ada's people show Bo at the Lantern.
    const view = await theirPeople(t.db, A1, null);
    expect(view!.places.find((p) => p.role === "works")).toMatchObject({ name: "The Salt Lantern", since: "2021", declared: true, others: [expect.objectContaining({ id: B1 })] });
    expect((await placeMenu(t.db, ana.userId)).workplaces.map((w) => w.key)).toContain("workplace:the-salt-lantern");
    if (!lantern.ok) return;
    expect(await leavePlaceFor(t.db, ana, A1, lantern.place.id, "works")).toEqual({ ok: true });
    expect(await leavePlaceFor(t.db, ana, A1, lantern.place.id, "works")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("the page's view", () => {
  it("shows strangers the public, the owner what's theirs too, and a proposal waiting on the one it's to", async () => {
    await world();
    await addPersonFor(t.db, ana, A1, { name: "Rosa Quill", relation: "mum" });
    await addPersonFor(t.db, ana, A1, { name: "Secret Sam", relation: "friend", visibility: "owner" });
    const asked = await declareTie(t.db, ana, A1, { with: B1, relation: "best_friend" });
    if (!asked.ok) throw new Error("not asked");
    const stranger = await theirPeople(t.db, A1, cal.userId);
    expect(stranger!.character).toMatchObject({ mine: false, editable: false });
    expect(stranger!.people.map((p) => p.name)).toEqual(["Rosa Quill"]);
    expect(stranger!.people[0]).toMatchObject({ label: "parent", line: "their parent" });
    expect(stranger!.ties).toEqual([]);
    const owner = await theirPeople(t.db, A1, ana.userId);
    expect(owner!.character).toMatchObject({ mine: true, editable: true });
    expect(owner!.people.map((p) => p.name)).toEqual(["Rosa Quill", "Secret Sam"]);
    expect(owner!.ties).toEqual([expect.objectContaining({ other: expect.objectContaining({ id: B1 }), waiting: "on_them", line: "their best friend" })]);
    const theirs = await theirPeople(t.db, B1, ben.userId);
    expect(theirs!.ties).toEqual([expect.objectContaining({ id: asked.tie.id, waiting: "on_you", label: "best friend" })]);
    // The show's own characters: read only, even to their owner.
    expect((await theirPeople(t.db, SHOW, userIdOf(ADMIN)))!.character).toMatchObject({ show: true, editable: false });
    // Someone's private character is theirs alone.
    expect(await theirPeople(t.db, BPRIV, ana.userId)).toBeNull();
    expect(await theirPeople(t.db, BPRIV, ben.userId)).not.toBeNull();
  });

  it("finds characters to tie to: yours first, never the house, the show's cast or a private one of someone else's", async () => {
    await world();
    await character("dc-a4", ana.userId, "Lark Ana", { visibility: "private" });
    const found = await tieCandidates(t.db, ana, A1, "lark");
    expect(found.ok && found.candidates.map((c) => [c.id, c.mine])).toEqual([
      ["dc-a4", true],
      [B2, false],
      [B1, false],
    ]);
    expect(await tieCandidates(t.db, ana, A1, "marlo")).toEqual({ ok: true, candidates: [] });
    expect(await tieCandidates(t.db, ana, A1, "a")).toEqual({ ok: true, candidates: [] });
    // Only for a character of yours.
    expect(await tieCandidates(t.db, ben, A1, "lark")).toMatchObject({ ok: false, status: 404 });
  });

  it("is nothing with the switch off", async () => {
    await world();
    vi.stubEnv("SOCIAL_DECLARE", "0");
    expect(await theirPeople(t.db, A1, ana.userId)).toBeNull();
    expect(await addPersonFor(t.db, ana, A1, { name: "Rosa", relation: "mum" })).toMatchObject({ ok: false, error: "off" });
    expect(await lapseProposals(t.db)).toBe(0);
  });
});

describe("GET and POST /api/characters/[id]/circle", () => {
  const call = (cookie: string, id: string, method: "GET" | "POST", body?: unknown, query = "") =>
    (method === "GET" ? GET : POST)(
      new Request(`${BASE_URL}/api/characters/${id}/circle${query}`, {
        method,
        headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { params: Promise.resolve({ id }) },
    );

  it("changes your character's people one action at a time, and says why when it won't", async () => {
    await world();
    const res = await call(ANA, A1, "POST", { action: "add_person", person: { name: "Rosa Quill", relation: "parent" } });
    expect(res.status).toBe(201);
    const { person_id } = await res.json();
    expect((await call(ANA, A1, "POST", { action: "edit_person", person_id, person: { note: "Bakes." } })).status).toBe(200);
    const asked = await call(ANA, A1, "POST", { action: "declare_tie", with: B1, relation: "friend" });
    expect(await asked.json()).toMatchObject({ status: "proposed", news: true });
    const refused = await call(ANA, A1, "POST", { action: "declare_tie", with: B1, relation: "rival" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: "not_warm", message: expect.stringContaining("warm") });
    expect((await call(BEN, A1, "POST", { action: "add_person", person: { name: "Rosa", relation: "parent" } })).status).toBe(404);
    expect((await call(ANA, A1, "POST", { action: "fly" })).status).toBe(422);
    expect((await call(ANA, A1, "POST", { action: "set_place", role: "lives", place: "neighbourhood:old-town" })).status).toBe(200);
  });

  it("shows the circle as you may see it, and searches for characters to tie to on your own character only", async () => {
    await world();
    await addPersonFor(t.db, ana, A1, { name: "Rosa Quill", relation: "mum" });
    const view = await (await call(BEN, A1, "GET")).json();
    expect(view).toMatchObject({ character: { id: A1, editable: false }, people: [expect.objectContaining({ name: "Rosa Quill" })] });
    expect(await (await call(ANA, A1, "GET", undefined, "?q=bo")).json()).toMatchObject({ candidates: [expect.objectContaining({ id: B1, mine: false })] });
    expect((await call(BEN, A1, "GET", undefined, "?q=bo")).status).toBe(404);
    vi.stubEnv("SOCIAL_DECLARE", "0");
    expect((await call(ANA, A1, "GET")).status).toBe(409);
    expect((await call(ANA, A1, "POST", { action: "add_person", person: { name: "Rosa", relation: "parent" } })).status).toBe(409);
  });
});
