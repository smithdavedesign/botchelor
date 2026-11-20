import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { DATE_VENUES } from "@/lib/venues";
import { addPerson, getPerson, peopleOf, promotePerson, removePerson, updatePerson } from "@/lib/social/people";
import {
  endMembership,
  ensurePlace,
  ensurePlaces,
  getPlaceByKey,
  hometownOf,
  membersOf,
  membershipsOf,
  placeIdOf,
  placesByIds,
  placesIn,
  removeMembership,
  setMembership,
  venueKey,
} from "@/lib/social/places";
import { findTie, upsertTie } from "@/lib/social/ties";
import { ensureWorld, HOUSE_PLACE, NEIGHBOURHOODS, WORLD_CITY, worldPlaces } from "@/lib/social/world";
import { PEOPLE_CAP } from "@/lib/social/types";
import { startTestDb } from "./helpers";

// Off-screen people, places and the seeded world (lib/social/people.ts, places.ts, world.ts; docs/PRDs/social-network.md
// section 5.4), against the test database.
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

const [A, B, C] = HOUSE_CHARACTERS.map((c) => c.id);
const ON = {};
const count = async (table: string) => (await t.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;

describe("off-screen people", () => {
  it("adds up to twelve a character, each word checked, and no more", async () => {
    for (let i = 1; i <= PEOPLE_CAP; i++) expect(await addPerson(t.db, { holderId: A, name: `Cousin ${i}`, source: "owner", created_by: "user-1" }, ON)).toMatchObject({ ok: true });
    expect(await addPerson(t.db, { holderId: A, name: "One too many", source: "owner" }, ON)).toEqual({ ok: false, reason: "cap" });
    // Another character's count is its own.
    expect(await addPerson(t.db, { holderId: B, name: "Mum", source: "owner" }, ON)).toMatchObject({ ok: true });
    expect(await addPerson(t.db, { holderId: B, name: "x".repeat(41), source: "owner" }, ON)).toEqual({ ok: false, reason: "too_long" });
    expect(await addPerson(t.db, { holderId: B, name: "Gran", note: "She was only fifteen", source: "owner" }, ON)).toEqual({ ok: false, reason: "unsafe" });
    expect(await peopleOf(t.db, A)).toHaveLength(PEOPLE_CAP);
    expect(await peopleOf(t.db, B)).toHaveLength(1);
  });

  it("changes, hides, promotes and removes a person, and their ties go with them", async () => {
    const added = await addPerson(t.db, { holderId: A, name: "Mum", pronouns: "she/her", source: "owner" }, ON);
    if (!added.ok) throw new Error(added.reason);
    const mum = added.person;
    expect(mum).toMatchObject({ holder_id: A, name: "Mum", pronouns: "she/her", note: null, deceased: false, visibility: "public", promoted_to: null });
    expect(mum.id).toMatch(/^per_/);
    expect(await updatePerson(t.db, mum.id, { note: "Runs the bakery on the corner.", visibility: "owner" }, ON)).toMatchObject({ ok: true, person: { name: "Mum", note: "Runs the bakery on the corner.", visibility: "owner", pronouns: "she/her" } });
    expect(await updatePerson(t.db, mum.id, { pronouns: null }, ON)).toMatchObject({ ok: true, person: { pronouns: null, note: "Runs the bakery on the corner." } });
    expect(await updatePerson(t.db, mum.id, { name: "" }, ON)).toEqual({ ok: false, reason: "empty" });
    expect(await updatePerson(t.db, "per_nope", { deceased: true }, ON)).toEqual({ ok: false, reason: "not_found" });
    expect(await peopleOf(t.db, A, { visibility: ["public"] })).toEqual([]);
    expect((await peopleOf(t.db, A, { visibility: ["public", "owner"] })).map((p) => p.id)).toEqual([mum.id]);
    expect(await promotePerson(t.db, mum.id, B)).toBe(true);
    expect((await getPerson(t.db, mum.id))?.promoted_to).toBe(B);
    await upsertTie(t.db, { from: A, toPerson: mum.id, kind: "parent", source: "owner" }, ON);
    expect(await count("social_ties")).toBe(1);
    expect(await removePerson(t.db, mum.id)).toBe(true);
    expect(await getPerson(t.db, mum.id)).toBeNull();
    expect(await count("social_ties")).toBe(0);
  });
});

describe("places", () => {
  it("makes a place once by key, with an id from the key, and keeps it unless told to refresh", async () => {
    const leeds = hometownOf("Leeds, mostly")!;
    const first = await ensurePlace(t.db, { key: leeds.key, kind: "hometown", name: leeds.name, source: "derived" });
    expect(first).toMatchObject({ id: placeIdOf("hometown:leeds"), key: "hometown:leeds", kind: "hometown", name: "Leeds", parent_id: null, source: "derived" });
    const again = await ensurePlace(t.db, { key: leeds.key, kind: "hometown", name: "LEEDS", source: "owner" });
    expect(again).toEqual(first);
    const refreshed = await ensurePlace(t.db, { key: leeds.key, kind: "hometown", name: "Leeds (West Yorkshire)", source: "house" }, { refresh: true });
    expect(refreshed).toMatchObject({ id: first.id, name: "Leeds (West Yorkshire)", source: "derived" });
    expect(await getPlaceByKey(t.db, "hometown:leeds")).toEqual(refreshed);
  });

  it("seeds the world once, parents linked, and writes nothing when it's already as the code says", async () => {
    const places = await worldPlaces();
    const n = await ensureWorld(t.db, ON);
    // The world may already be here from an earlier test in this file (it stays across resets): then nothing is new.
    expect([0, places.length]).toContain(n);
    expect(await ensureWorld(t.db, ON)).toBe(n);
    expect(await ensurePlaces(t.db, places, { refresh: true })).toBe(0);
    expect(await count("social_places")).toBe(places.length);
    const city = (await getPlaceByKey(t.db, WORLD_CITY.key))!;
    expect((await placesIn(t.db, city.id)).map((p) => p.key).sort()).toEqual(NEIGHBOURHOODS.map((h) => h.key).sort());
    const diveBar = (await getPlaceByKey(t.db, venueKey("dive_bar")))!;
    expect(diveBar).toMatchObject({ kind: "hangout", venue_id: "dive_bar", name: DATE_VENUES.find((v) => v.id === "dive_bar")!.name, parent_id: placeIdOf("neighbourhood:neon-mile") });
    const house = (await getPlaceByKey(t.db, HOUSE_PLACE.key))!;
    expect(house.parent_id).toBe(placeIdOf("neighbourhood:the-heights"));
    expect((await placesIn(t.db, house.id)).map((p) => p.key).sort()).toEqual(["house:kitchen", "house:laundry", "house:pool", "house:sofa", "house:stairs", "house:terrace"]);
    // A venue no neighbourhood lists is out of town: no parent.
    const outOfTown = DATE_VENUES.find((v) => !NEIGHBOURHOODS.some((h) => h.venues.includes(v.id)));
    if (outOfTown) expect((await getPlaceByKey(t.db, venueKey(outOfTown.id)))?.parent_id).toBeNull();
    // A renamed place in the code is written over the old on the next seed.
    await t.db.query("update social_places set name = 'Old name' where key = $1", [WORLD_CITY.key]);
    expect(await ensurePlaces(t.db, places, { refresh: true })).toBe(1);
    expect((await getPlaceByKey(t.db, WORLD_CITY.key))?.name).toBe(WORLD_CITY.name);
    expect((await placesByIds(t.db, [city.id, house.id])).map((p) => p.key).sort()).toEqual([WORLD_CITY.key, HOUSE_PLACE.key].sort());
    expect(await ensureWorld(t.db, { SOCIAL_TIES: "0" })).toBe(0);
  });
});

describe("memberships", () => {
  const visit = (characterId: string, visits: number, source: "derived" | "owner" = "derived") =>
    setMembership(t.db, { placeId: placeIdOf(venueKey("dive_bar")), characterId, role: "visited", source, detail: { visits } }, ON);

  beforeEach(async () => {
    await ensureWorld(t.db, ON);
  });

  it("puts a character in a place by role, merges detail, and leaves a repeat alone", async () => {
    const first = (await visit(A, 1))!;
    expect(first).toMatchObject({ place_id: placeIdOf(venueKey("dive_bar")), character_id: A, role: "visited", source: "derived", visibility: "public", detail: { visits: 1 }, ended_at: null });
    const same = (await visit(A, 1))!;
    expect(same.updated_at).toBe(first.updated_at);
    expect((await visit(A, 2))!.detail).toEqual({ visits: 2 });
    await visit(B, 1);
    await setMembership(t.db, { placeId: placeIdOf(HOUSE_PLACE.key), characterId: A, role: "lives", source: "derived", detail: { seasons: ["2026-11"] } }, ON);
    expect((await membershipsOf(t.db, A)).map((m) => m.role).sort()).toEqual(["lives", "visited"]);
    expect((await membershipsOf(t.db, A, { roles: ["lives"] })).map((m) => m.place_id)).toEqual([placeIdOf(HOUSE_PLACE.key)]);
    expect((await membersOf(t.db, placeIdOf(venueKey("dive_bar")))).map((m) => m.character_id).sort()).toEqual([A, B].sort());
    expect(await setMembership(t.db, { placeId: placeIdOf(venueKey("dive_bar")), characterId: C, role: "visited", source: "derived" }, { SOCIAL_TIES: "0" })).toBeNull();
  });

  it("keeps what someone declared when what aired writes over it, and makes a derived one theirs when they declare it", async () => {
    const place = placeIdOf(venueKey("dive_bar"));
    await setMembership(t.db, { placeId: place, characterId: A, role: "regular", source: "owner", since_text: "since uni", visibility: "owner", created_by: "user-1" }, ON);
    const over = (await setMembership(t.db, { placeId: place, characterId: A, role: "regular", source: "derived", since_text: null, visibility: "public", detail: { visits: 3 } }, ON))!;
    expect(over).toMatchObject({ source: "owner", since_text: "since uni", visibility: "owner", created_by: "user-1", detail: { visits: 3 } });
    await setMembership(t.db, { placeId: place, characterId: B, role: "regular", source: "derived", detail: { visits: 3 } }, ON);
    const mine = (await setMembership(t.db, { placeId: place, characterId: B, role: "regular", source: "owner", since_text: "every Friday", created_by: "user-2" }, ON))!;
    expect(mine).toMatchObject({ source: "owner", since_text: "every Friday", created_by: "user-2", detail: { visits: 3 } });
    // Ended memberships drop out of a place's current members; removed ones are gone.
    expect(await endMembership(t.db, place, A, "regular", "2026-11-01T00:00:00Z")).toBe(true);
    expect(await endMembership(t.db, place, A, "regular")).toBe(false);
    expect((await membersOf(t.db, place, { roles: ["regular"] })).map((m) => m.character_id)).toEqual([B]);
    expect((await membersOf(t.db, place, { roles: ["regular"], ended: true })).map((m) => m.character_id).sort()).toEqual([A, B].sort());
    expect(await removeMembership(t.db, place, B, "regular")).toBe(true);
    expect(await membersOf(t.db, place, { roles: ["regular"] })).toEqual([]);
  });
});

describe("a character's deletion", () => {
  it("takes its people, ties and places with it", async () => {
    await ensureWorld(t.db, ON);
    const id = `social-del-${crypto.randomUUID()}`;
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values ($1, 'user-1', false, 'Gone Soon', 30, 'x', '["dry"]'::jsonb, 'x', 'x')`,
      [id],
    );
    const person = await addPerson(t.db, { holderId: id, name: "Dad", source: "owner" }, ON);
    if (!person.ok) throw new Error(person.reason);
    await upsertTie(t.db, { from: id, toPerson: person.person.id, kind: "parent", source: "owner" }, ON);
    await upsertTie(t.db, { from: id, to: A, kind: "friend", source: "owner" }, ON);
    await setMembership(t.db, { placeId: placeIdOf(venueKey("dive_bar")), characterId: id, role: "visited", source: "derived" }, ON);
    await t.db.query("delete from characters where id = $1", [id]);
    expect(await count("social_people")).toBe(0);
    expect(await count("social_ties")).toBe(0);
    expect(await count("social_place_members")).toBe(0);
    expect(await findTie(t.db, { from: id, to: A, kind: "friend" })).toBeNull();
  });
});
