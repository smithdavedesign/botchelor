import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideFromTemperament, partnerStyleOf, settleCommitment } from "@/lib/partners";
import { api, episodeJson, newUserCookie, scriptedModel, startTestDb, userIdOf, validCharacter } from "./helpers";

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

/** Two creators' characters, both open to dates, made a couple at `stage` (as the relationship graph would). */
async function couple(stage = "dating", styleA?: string) {
  const ownerA = newUserCookie();
  const ownerB = newUserCookie();
  const a = await (await api.createCharacter(validCharacter({ name: "Cass Vega", open_to_dates: true }), ownerA)).json();
  const b = await (await api.createCharacter(validCharacter({ name: "Ira Fenn", open_to_dates: true }), ownerB)).json();
  if (styleA) expect((await api.editCharacter(a.id, { partner_style: styleA }, ownerA)).status).toBe(200);
  const [lo, hi] = [a.id, b.id].sort();
  await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, $3)`, [lo, hi, stage]);
  await settleCommitment(t.db, lo, hi);
  return { ownerA, ownerB, a, b, lo, hi };
}
const openToDates = async (id: string) => (await t.db.query<{ o: boolean }>(`select open_to_dates as o from characters where id = $1`, [id])).rows[0].o;

describe("one partner or more", () => {
  it("a character left to decide settles it from its temperament", () => {
    expect(decideFromTemperament({ openness: 0.8, guardedness: 0.2 })).toBe("open");
    expect(decideFromTemperament({ openness: 0.8, guardedness: 0.6 })).toBe("one");
    expect(decideFromTemperament({ openness: 0.4, guardedness: 0.1 })).toBe("one");
  });

  it("one partner: once they're dating, they close to dates, leave matching, and only date their partner", async () => {
    const { ownerA, a, b } = await couple("dating", "one");
    expect(await openToDates(a.id)).toBe(false);
    const note = (await t.db.query<{ title: string }>(`select title from notifications where user_id = $1`, [userIdOf(ownerA)])).rows;
    expect(note.map((n) => n.title).join(" ")).toMatch(/with Ira: just the two of them/);
    expect(await partnerStyleOf(t.db, a.id)).toMatchObject({ choice: "one", effective: "one", taken: true, partners: [{ id: b.id }] });

    // Nobody else can ask them out or draw them blind.
    const stranger = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), stranger)).json();
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [a.id]); // even if it were open
    expect((await api.createEpisode({ character_id: mine.id, partner_id: a.id }, stranger)).status).toBe(422);
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [a.id]);

    // They can't go out with someone else, or blind; their partner, yes.
    const other = await (await api.createCharacter(validCharacter({ name: "Wren Kestrel", open_to_dates: true }), newUserCookie())).json();
    const refused = await api.createEpisode({ character_id: a.id, partner_id: other.id }, ownerA);
    expect(refused.status).toBe(409);
    expect((await refused.json()).message).toMatch(/with Ira Fenn and wants one partner/);
    expect((await api.createEpisode({ character_id: a.id, blind: true }, ownerA)).status).toBe(409);
    expect((await api.editCharacter(a.id, { open_to_dates: true }, ownerA)).status).toBe(409); // reopening needs more than one
    scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: a.id, partner_id: b.id }, ownerA)).status).toBe(200);

    // Switching to more than one in the same edit reopens them.
    expect((await api.editCharacter(a.id, { open_to_dates: true, partner_style: "open" }, ownerA)).status).toBe(200);
    expect(await openToDates(a.id)).toBe(true);
    scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: a.id, partner_id: other.id }, ownerA)).status).toBe(200);
  });

  it("more than one: dating someone changes nothing", async () => {
    const { a } = await couple("going_steady", "open");
    expect(await openToDates(a.id)).toBe(true);
    expect(await partnerStyleOf(t.db, a.id)).toMatchObject({ effective: "open", taken: false });
  });

  it("left to decide: decided once, the first time they're in a relationship, and the owner hears it", async () => {
    const { ownerA, a } = await couple("sparks");
    expect((await partnerStyleOf(t.db, a.id))?.decided).toBeNull(); // sparks isn't a relationship yet
    const [lo, hi] = [a.id, (await t.db.query<{ id: string }>(`select id from characters where name = 'Ira Fenn'`)).rows[0].id].sort();
    await t.db.query(`update relationships set stage = 'dating' where character_a = $1 and character_b = $2`, [lo, hi]);
    await settleCommitment(t.db, lo, hi);
    const style = await partnerStyleOf(t.db, a.id);
    expect(style?.decided).toMatch(/^(one|open)$/);
    expect(await openToDates(a.id)).toBe(style?.decided === "open");
    const notes = (await t.db.query<{ body: string }>(`select body from notifications where user_id = $1`, [userIdOf(ownerA)])).rows;
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toMatch(/decided this for themselves/);
    // Settling again is quiet.
    await settleCommitment(t.db, lo, hi);
    expect((await t.db.query(`select 1 from notifications where user_id = $1`, [userIdOf(ownerA)])).rows).toHaveLength(1);
  });

  it("a cooled-off couple frees them again", async () => {
    const { a, lo, hi } = await couple("dating", "one");
    await t.db.query(`update relationships set stage = 'friends' where character_a = $1 and character_b = $2`, [lo, hi]);
    expect((await partnerStyleOf(t.db, a.id))?.taken).toBe(false);
  });
});

describe("rolling out to couples that already exist", () => {
  it("an undecided character already dating isn't taken until it decides, which it does at its next date", async () => {
    const ownerA = newUserCookie();
    const a = await (await api.createCharacter(validCharacter({ name: "Cass Vega", open_to_dates: true }), ownerA)).json();
    const b = await (await api.createCharacter(validCharacter({ name: "Ira Fenn", open_to_dates: true }), newUserCookie())).json();
    const [lo, hi] = [a.id, b.id].sort();
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage) values ($1, $2, 3, 2, 'dating')`, [lo, hi]);
    expect(await partnerStyleOf(t.db, a.id)).toMatchObject({ decided: null, effective: null, taken: false });

    const other = await (await api.createCharacter(validCharacter({ name: "Wren Kestrel", open_to_dates: true }), newUserCookie())).json();
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: a.id, partner_id: other.id }, ownerA);
    const decided = (await partnerStyleOf(t.db, a.id))?.decided;
    expect(decided).toMatch(/^(one|open)$/);
    expect(res.status).toBe(decided === "open" ? 200 : 409);
  });
});
