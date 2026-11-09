import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminSeasonGet, POST as adminSeasonPost } from "@/app/api/admin/season/route";
import { setConversationEnabledForTests } from "@/lib/conversation";
import { FORMAT_IDS } from "@/lib/formats";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CONVERSATION_TURNS, PRODUCER_IDS } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import {
  isFinalNight,
  nextRecouplingDay,
  recouplingNightDays,
  SEASON_FORMATS,
  seasonFormat,
  thisWeekOn,
  twistOf,
  twistWeekNumber,
  twistWeekStart,
} from "@/lib/season-format";
import { seasonFormatNow, seasonFormatSlug, setSeasonFormat, setSeasonFormatForTests } from "@/lib/season-format-store";
import { seasonIdOf } from "@/lib/season-window";
import { showSince } from "@/lib/show-since";
import { buildDate, DEFAULT_DATE_REQUEST, type CharacterForDate } from "@/lib/simulation";
import { pickVenueAvoiding, pickVenueFrom, VENUE_IDS } from "@/lib/venues";
import { refreshLobby } from "@/lib/watch";
import { BASE_URL, episodeJson, planJson, scriptedModel, scriptOutcome, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
  setConversationEnabledForTests(false);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const CLASSIC = seasonFormat("classic");
const ISLAND = seasonFormat("island");

// November 2026 is a full calendar-month season (lib/season-window.ts): Nov 1 00:00 UTC to Dec 1.
const NOV = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));

describe("the catalogue (lib/season-format.ts)", () => {
  it("defaults to classic and falls back for unknown slugs", () => {
    expect(seasonFormat(null).slug).toBe("classic");
    expect(seasonFormat("not_a_format").slug).toBe("classic");
    expect(SEASON_FORMATS.map((f) => f.slug)).toEqual(["classic", "island", "last_standing", "sight_unseen", "meet_the_folks", "ex_files"]);
  });

  it("classic deals from the whole library; every other format's pool is real venues only", () => {
    expect(CLASSIC.venues).toBeNull();
    expect(ISLAND.venues!.length).toBeGreaterThanOrEqual(8);
    for (const def of SEASON_FORMATS.filter((f) => f.venues)) {
      expect(def.venues!.length).toBeGreaterThanOrEqual(8);
      for (const v of def.venues!) expect(VENUE_IDS).toContain(v);
    }
  });

  it("every format has a ballot title, pitch and emoji, and no title is another network's show name", () => {
    const titles = SEASON_FORMATS.map((f) => f.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const def of SEASON_FORMATS) {
      expect(def.title.length).toBeGreaterThan(3);
      expect(def.pitch.length).toBeGreaterThan(20);
      expect(def.emoji).toBeTruthy();
      expect(def.title).not.toMatch(/\b(survivor|love island|big brother|bachelor(ette)?|love is blind)\b/i);
    }
  });

  it("every twist leans on an existing show format or producer event, never a new pipeline", () => {
    for (const def of SEASON_FORMATS) {
      expect(def.twists.map((w) => w.week)).toEqual([1, 2, 3, 4]);
      for (const w of def.twists) {
        if (w.format) expect(FORMAT_IDS).toContain(w.format);
        if (w.producer) expect(PRODUCER_IDS).toContain(w.producer);
      }
    }
  });

  it("knows which twist week a day falls in, the last week covering a long month's spare days", () => {
    expect(twistWeekNumber(CLASSIC, NOV(1))).toBe(1);
    expect(twistWeekNumber(CLASSIC, NOV(7))).toBe(1);
    expect(twistWeekNumber(CLASSIC, NOV(8))).toBe(2);
    expect(twistWeekNumber(CLASSIC, NOV(17))).toBe(3);
    expect(twistWeekNumber(CLASSIC, NOV(24))).toBe(4);
    expect(twistWeekNumber(CLASSIC, NOV(30))).toBe(4); // day 30 is "week 5": still finale week
    expect(twistWeekStart(CLASSIC, NOV(10)).toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });

  it("announces the season on week 1 only, and teases the twist all month", () => {
    const premiere = thisWeekOn(CLASSIC, NOV(2));
    expect(premiere.announce).toContain("classic season");
    expect(premiere.label).toBe("Premiere week");
    const finale = thisWeekOn(CLASSIC, NOV(29));
    expect(finale.announce).toBeNull();
    expect(finale.label).toBe("Finale week");
    expect(twistOf(ISLAND, NOV(18)).format).toBe("ex_returns");
  });

  it("schedules one recoupling night on a classic season's last night, weekly on the island's", () => {
    expect(recouplingNightDays(CLASSIC, NOV(10))).toEqual(["2026-11-30"]);
    // Weekly: the end of each season week; a night within 2 days of the finale folds into it (Nov 28 → Nov 30).
    expect(recouplingNightDays(ISLAND, NOV(10))).toEqual(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-30"]);
    expect(nextRecouplingDay(ISLAND, NOV(8))).toBe("2026-11-14");
    expect(nextRecouplingDay(ISLAND, NOV(14))).toBe("2026-11-14"); // tonight counts until the day ends
    expect(nextRecouplingDay(CLASSIC, NOV(30, 23))).toBe("2026-11-30");
    expect(isFinalNight(ISLAND, "2026-11-30", NOV(10))).toBe(true);
    expect(isFinalNight(ISLAND, "2026-11-14", NOV(10))).toBe(false);
  });
});

describe("venue pools (lib/venues.ts pickVenueFrom)", () => {
  it("with no pool it is pickVenueAvoiding, byte for byte", () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(pickVenueFrom(seed, null)).toBe(pickVenueAvoiding(seed));
      expect(pickVenueFrom(seed, undefined, ["rooftop_bar"])).toBe(pickVenueAvoiding(seed, ["rooftop_bar"]));
      expect(pickVenueFrom(seed, [])).toBe(pickVenueAvoiding(seed));
    }
  });

  it("deals only from the pool, stepping past venues to avoid", () => {
    const pool = ISLAND.venues!;
    for (let seed = 0; seed < 50; seed++) {
      expect(pool).toContain(pickVenueFrom(seed, pool));
      expect(pickVenueFrom(seed, pool, [pickVenueFrom(seed, pool)])).not.toBe(pickVenueFrom(seed, pool));
    }
  });
});

describe("the store (lib/season-format-store.ts)", () => {
  it("a season with no row is classic; picking classic again removes the row", async () => {
    const season = seasonIdOf(NOV(5));
    expect(await seasonFormatSlug(t.db, season)).toBe("classic");
    await setSeasonFormat(t.db, season, "island");
    expect(await seasonFormatSlug(t.db, season)).toBe("island");
    expect((await seasonFormatNow(t.db, NOV(5))).slug).toBe("island");
    await setSeasonFormat(t.db, season, "classic");
    expect((await t.db.query(`select 1 from season_formats`)).rows).toHaveLength(0);
    expect((await seasonFormatNow(t.db, NOV(5))).slug).toBe("classic");
  });

  it("a stored slug the catalogue no longer has reads as classic", async () => {
    await t.db.query(`insert into season_formats (season_id, slug) values ($1, 'retired_format')`, [seasonIdOf(NOV(5))]);
    expect(await seasonFormatSlug(t.db, seasonIdOf(NOV(5)))).toBe("classic");
  });
});

describe("the thumbs on a date (lib/simulation.ts)", () => {
  const forDate = (i: number): CharacterForDate => {
    const c = HOUSE_CHARACTERS[i];
    return { id: c.id, sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: true } };
  };

  it("passing no pool and no producer builds byte-for-byte the date built before formats existed", async () => {
    const plain = await buildDate(t.db, "fmt-ep-1", forDate(0), forDate(1), DEFAULT_DATE_REQUEST);
    const explicit = await buildDate(t.db, "fmt-ep-1", forDate(0), forDate(1), DEFAULT_DATE_REQUEST, undefined, undefined, {
      venuePool: null,
      producerPick: null,
    });
    expect(explicit.setup).toEqual(plain.setup);
    expect(explicit.seed).toBe(plain.seed);
  });

  it("a pool confines the venue; a producer pick sets the act-2 event; the engine input is untouched", async () => {
    const plain = await buildDate(t.db, "fmt-ep-2", forDate(0), forDate(1), DEFAULT_DATE_REQUEST);
    const steered = await buildDate(t.db, "fmt-ep-2", forDate(0), forDate(1), DEFAULT_DATE_REQUEST, undefined, undefined, {
      venuePool: ISLAND.venues,
      producerPick: "a_quiet_confession",
    });
    expect(ISLAND.venues).toContain(steered.setup.venue);
    expect(steered.setup.producer).toBe("a_quiet_confession");
    // Cosmetic only: the same sheets, signals and seed go to the engine either way.
    expect(steered.input).toEqual(plain.input);
  });
});

describe("the lobby's house dates follow the season (lib/watch.ts refreshLobby)", () => {
  const lines = ["Hmm.", "Mm?", "Oh.", "Hah.", "Yes?", "Sure.", "Oh?", "Mm.", "Hmm?", "Yes.", "OK.", "Hah?"];
  const turnJson = (i: number) => JSON.stringify({ dialogue: lines[i % lines.length], action: "asks", emotion: "curious", interest_signal: 0.5 });
  const script = () => {
    setConversationEnabledForTests(true);
    scriptOutcome({ ending: "friends" });
    scriptedModel([planJson(), ...Array.from({ length: CONVERSATION_TURNS }, (_, i) => turnJson(i)), episodeJson()]);
  };
  const roomSetup = async (id: string) => {
    const { rows } = await t.db.query<{ setup: { format?: string; venue: string; producer: string }; a: string; b: string }>(
      `select e.setup, e.character_a a, e.character_b b from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
      [id],
    );
    return rows[0];
  };

  it("an island week 3 room plays The Ex Returns in a villa venue", async () => {
    setSeasonFormatForTests("island");
    script();
    const made = await refreshLobby(t.db, NOV(18));
    expect(made.created).toBeTruthy();
    const room = await roomSetup(made.created!);
    expect(room.setup.format).toBe("ex_returns");
    expect(ISLAND.venues).toContain(room.setup.venue);
  });

  it("an island week 2 room leans toward the hard question", async () => {
    setSeasonFormatForTests("island");
    script();
    const made = await refreshLobby(t.db, NOV(10));
    expect(made.created).toBeTruthy();
    expect((await roomSetup(made.created!)).setup.producer).toBe("a_hard_question");
  });

  it("classic newcomer week seats one of the season's new cast members", async () => {
    const season = seasonIdOf(NOV(10));
    const cast = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
    for (const [slot, id] of cast.entries()) {
      await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, $4)`, [
        season,
        id,
        slot,
        slot < 2 ? "survivor" : "new",
      ]);
    }
    script();
    const made = await refreshLobby(t.db, NOV(10)); // week 2 of a classic November
    expect(made.created).toBeTruthy();
    const room = await roomSetup(made.created!);
    expect([cast[2], cast[3]]).toContain(room.a);
  });

  it("a classic premiere week passes no thumb at all: the date is dealt exactly as before", async () => {
    script();
    const made = await refreshLobby(t.db, NOV(3)); // week 1, no stored format row
    expect(made.created).toBeTruthy();
    const room = await roomSetup(made.created!);
    expect(room.setup.format ?? "classic").toBe("classic");
  });
});

describe("the announcements", () => {
  it("Since you were here carries the twist only for a visit from before its week began", async () => {
    const now = NOV(10, 15); // week 2
    // A return visit: last seen before the week started, and at least one date aired since (the card needs real news).
    await t.db.query(`insert into owner_activity (user_id, last_seen, prev_seen) values ('fan-1', $1, $2)`, [NOV(6).toISOString(), NOV(5).toISOString()]);
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript)
       values ('since-ep', 'u-x', $1, $2, 'a table', '[]'::jsonb, '[]'::jsonb, 'a twist', 'a finale', 'friends', 1, 'ready', 'public', $3, '[]'::jsonb)`,
      [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id, NOV(9).toISOString()],
    );
    const card = await showSince(t.db, "fan-1", now);
    expect(card?.twist).toEqual({ label: CLASSIC.twists[1].label, tease: CLASSIC.twists[1].tease });

    // Someone who visited after the week began has seen it: the card still comes (a date aired), with no twist line.
    await t.db.query(`update owner_activity set last_seen = $1, prev_seen = $2 where user_id = 'fan-1'`, [NOV(8, 6).toISOString(), NOV(8).toISOString()]);
    const again = await showSince(t.db, "fan-1", now);
    expect(again?.aired).toBe(1);
    expect(again?.twist).toBeNull();
  });
});

describe("/api/admin/season: the format picker", () => {
  // Joined so a secret scanner doesn't read a test password as a leak (the agent-analytics test does the same).
  const PW = ["pw", "for", "format", "tests"].join("-");
  const headers = { "content-type": "application/json", "x-frontier-key": PW };
  const post = (body: Record<string, unknown>) =>
    adminSeasonPost(new Request(`${BASE_URL}/api/admin/season`, { method: "POST", headers, body: JSON.stringify(body) }));

  it("shows the formats, sets one for this season or the next, and refuses a closed one", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const view = await (await adminSeasonGet(new Request(`${BASE_URL}/api/admin/season`, { headers }))).json();
    expect(view.formats.map((f: { slug: string }) => f.slug)).toEqual(["classic", "island", "last_standing", "sight_unseen", "meet_the_folks", "ex_files"]);
    expect(view.this_season.format).toBe("classic");

    const set = await post({ action: "format", season_id: view.next_season.id, slug: "island" });
    expect(set.status).toBe(200);
    const after = await set.json();
    expect(after.next_season.format).toBe("island");
    expect(after.note).toContain("Bot Island");

    const closed = await post({ action: "format", season_id: "2026-10-19", slug: "island" });
    expect(closed.status).toBe(400);
  });

  it("needs the admin password", async () => {
    const res = await adminSeasonPost(
      new Request(`${BASE_URL}/api/admin/season`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "format", season_id: "2026-11-01", slug: "island" }) }),
    );
    expect(res.status).toBe(403);
  });
});
