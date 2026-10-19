import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDatingProfile, searchCharacters } from "@/lib/dating";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { listCast } from "@/lib/mechanics";
import { DEFAULT_SEASON_CAST_SIZE, ensureSeasonCast, refreshSeasonCast, resetStoredSeasonCastForTests, seasonCast, seasonCastIds, seasonIdAt, setSeasonCastForTests, SURVIVORS } from "@/lib/season-cast";
import { seasonAt } from "@/lib/seasons";
import { api, episodeJson, newUserCookie, scriptedModel, startTestDb, validCharacter } from "./helpers";

const ROSTER = HOUSE_CHARACTERS.map((c) => c.id);
const WEEK = 7 * 86_400_000;

describe("this season's house cast (the rotation)", () => {
  beforeAll(() => setSeasonCastForTests(null));

  it("keys on the same season as the leagues", () => {
    for (const iso of ["2026-10-12T00:00:00Z", "2026-10-15T13:00:00Z", "2026-10-18T23:59:59Z", "2026-10-19T00:00:00Z", "2027-01-01T08:00:00Z"]) {
      expect(seasonIdAt(new Date(iso))).toBe(seasonAt(new Date(iso)).id);
    }
  });

  it("deals a handful of distinct house characters, the same all week", () => {
    const monday = new Date("2026-10-12T00:00:00Z");
    const ids = seasonCastIds(monday, {});
    expect(ids).toHaveLength(DEFAULT_SEASON_CAST_SIZE);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => ROSTER.includes(id))).toBe(true);
    expect(seasonCastIds(new Date("2026-10-18T22:00:00Z"), {})).toEqual(ids);
  });

  it("the stand-in deals a different cast each season, and over a few years everyone gets a turn", () => {
    const month = (i: number) => new Date(Date.UTC(2026, 10 + i, 3));
    const seasons = Array.from({ length: 12 }, (_, i) => seasonCastIds(month(i), {}).join(","));
    expect(new Set(seasons).size).toBeGreaterThan(9);
    const casts = Array.from({ length: 36 }, (_, i) => seasonCastIds(month(i), {})).flat();
    expect(new Set(casts).size).toBe(ROSTER.length);
    // Weekly before seasons went monthly: still the same all week.
    expect(seasonCastIds(new Date("2026-10-12T00:00:00Z"), {})).toEqual(seasonCastIds(new Date(Date.parse("2026-10-12T00:00:00Z") + WEEK - 1), {}));
  });

  it("can be pinned by hand, or sized, from the environment", () => {
    expect(seasonCastIds(new Date(), { BOTCHELOR_SEASON_CAST: "house-juniper, house-rafe ,house-nope" })).toEqual(["house-juniper", "house-rafe"]);
    expect(seasonCastIds(new Date(), { BOTCHELOR_SEASON_CAST: "house-juniper" })).toHaveLength(DEFAULT_SEASON_CAST_SIZE); // one isn't a cast
    expect(seasonCastIds(new Date(), { BOTCHELOR_SEASON_CAST_SIZE: "6" })).toHaveLength(6);
    expect(seasonCastIds(new Date(), { BOTCHELOR_SEASON_CAST_SIZE: "1" })).toHaveLength(DEFAULT_SEASON_CAST_SIZE);
    expect(seasonCastIds(new Date(), { BOTCHELOR_SEASON_CAST_SIZE: "99" })).toHaveLength(ROSTER.length);
  });

  it("seasonCast returns the characters in billing order", () => {
    expect(seasonCast().map((c) => c.id)).toEqual(seasonCastIds());
  });
});

describe("only this season's house cast can be booked", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let onSeason: string[];
  let offSeason: string[];
  beforeAll(async () => {
    t = await startTestDb();
    setSeasonCastForTests(null); // the real rotation, not the test harness's whole roster
    onSeason = seasonCastIds();
    offSeason = ROSTER.filter((id) => !onSeason.includes(id));
  });
  afterAll(async () => {
    setSeasonCastForTests(ROSTER);
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it("dates an on-season house character, and refuses one sitting the season out", async () => {
    const creator = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter(), creator)).json()).id;
    const { calls } = scriptedModel([episodeJson()]);
    const off = await api.createEpisode({ character_id: id, partner_id: offSeason[0] }, creator);
    expect(off.status).toBe(422);
    expect((await off.json()).message).toMatch(/this season's house cast/);
    expect(calls).toHaveLength(0);
    expect((await api.createEpisode({ character_id: id, partner_id: onSeason[0] }, creator)).status).toBe(200);
  });

  it("a blind date with nobody else around falls back to the season's cast", async () => {
    const creator = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter(), creator)).json()).id;
    // Blind draws can repeat a partner until they're a couple; more than one keeps them on blind dates (lib/partners.ts).
    await api.editCharacter(id, { partner_style: "open" }, creator);
    for (let i = 0; i < 3; i++) {
      scriptedModel([episodeJson()]);
      const ep = await (await api.createEpisode({ character_id: id, blind: true }, creator)).json();
      expect(onSeason).toContain(ep.characters[1].id);
    }
  });

  it("search, the cast list and profiles show only the season's house characters", async () => {
    const person = newUserCookie();
    await api.createCharacter(validCharacter({ name: "Open Owen", open_to_dates: true }), person);

    const found = await searchCharacters(t.db, { viewerId: null, limit: 30 });
    const house = found.filter((c) => c.made_by === "house").map((c) => c.id);
    expect(house.sort()).toEqual([...onSeason].sort());

    const cast = await listCast(t.db);
    expect(cast[0].name).toBe("Open Owen"); // people and agents first
    expect(cast.filter((c) => c.house).map((c) => c.id).sort()).toEqual([...onSeason].sort());

    expect((await getDatingProfile(t.db, offSeason[0]))?.can_ask_out).toBe(false);
    expect((await getDatingProfile(t.db, onSeason[0]))?.can_ask_out).toBe(true);
  });
});

describe("monthly seasons: who stays and who's new (stored)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
    setSeasonCastForTests(null);
  });
  afterAll(async () => {
    resetStoredSeasonCastForTests();
    setSeasonCastForTests(ROSTER);
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    resetStoredSeasonCastForTests();
  });

  const OCT = new Date("2026-10-20T12:00:00Z");
  const NOV = new Date("2026-11-01T00:00:01Z");
  const review = (who: string, id: string, stars: number, at: string) =>
    t.db.query(`insert into character_reviews (reviewer_id, character_id, stars, updated_at) values ($1, $2, $3, $4)`, [who, id, stars, at]);

  it("the first monthly season keeps the cast the shuffle dealt it", async () => {
    const dealt = seasonCastIds(OCT, {});
    expect((await ensureSeasonCast(t.db, OCT, {})).map((c) => [c.character_id, c.source])).toEqual(dealt.map((id) => [id, "dealt"]));
  });

  it("on the 1st, the last season's two best-reviewed stay on and newcomers fill the rest, once", async () => {
    const october = (await ensureSeasonCast(t.db, OCT, {})).map((c) => c.character_id);
    const [w, x, y, z] = october;
    // y is loved, z liked; w has one perfect review, which the prior keeps from beating a crowd; x has none.
    for (let i = 0; i < 6; i++) await review(`fan-${i}`, y, 5, "2026-10-25T00:00:00Z");
    for (let i = 0; i < 6; i++) await review(`fan-${i}`, z, 4, "2026-10-26T00:00:00Z");
    await review("one-fan", w, 5, "2026-10-27T00:00:00Z");
    // A review from before the season doesn't count for it.
    for (let i = 0; i < 20; i++) await review(`old-${i}`, x, 5, "2026-10-01T00:00:00Z");

    const november = await ensureSeasonCast(t.db, NOV, {});
    expect(november.slice(0, SURVIVORS).map((c) => [c.character_id, c.source])).toEqual([
      [y, "survivor"],
      [z, "survivor"],
    ]);
    const added = november.slice(SURVIVORS);
    expect(added).toHaveLength(DEFAULT_SEASON_CAST_SIZE - SURVIVORS);
    expect(added.every((c) => c.source === "new" && !october.includes(c.character_id) && ROSTER.includes(c.character_id))).toBe(true);
    // Decided once: a second read (another cold start) gets the same cast, even with new reviews.
    await review("late", w, 5, "2026-10-31T00:00:00Z");
    expect(await ensureSeasonCast(t.db, NOV, {})).toEqual(november);
  });

  it("once loaded, the stored cast is what the whole site books from", async () => {
    const stored = (await ensureSeasonCast(t.db, NOV, {})).map((c) => c.character_id);
    await t.db.query(`update season_casts set character_id = $1 where season_id = '2026-11-01' and slot = 0`, [ROSTER.find((id) => !stored.includes(id))]);
    await refreshSeasonCast(t.db, NOV);
    const ids = seasonCastIds(NOV, {});
    expect(ids).not.toEqual(stored);
    expect(ids.slice(1)).toEqual(stored.slice(1));
  });
});
