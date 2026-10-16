import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDatingProfile, searchCharacters } from "@/lib/dating";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { listCast } from "@/lib/mechanics";
import { DEFAULT_SEASON_CAST_SIZE, seasonCast, seasonCastIds, seasonIdAt, setSeasonCastForTests } from "@/lib/season-cast";
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

  it("rotates from season to season, and over the year everyone gets a turn", () => {
    const start = new Date("2026-10-12T00:00:00Z").getTime();
    const seasons = Array.from({ length: 12 }, (_, i) => seasonCastIds(new Date(start + i * WEEK), {}).join(","));
    expect(new Set(seasons).size).toBeGreaterThan(6);
    const yearOfCasts = Array.from({ length: 52 }, (_, i) => seasonCastIds(new Date(start + i * WEEK), {})).flat();
    expect(new Set(yearOfCasts).size).toBe(ROSTER.length);
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
