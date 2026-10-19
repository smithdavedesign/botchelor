import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BadgeList, Podium } from "@/app/Badges";
import type { Db } from "@/lib/db";
import { getLeague } from "@/lib/leagues";
import { BADGE_LABELS, PODIUM_SIZE } from "@/lib/rules";
import { closeDueSeasons, listMyBadges, seasonAt, seasonLabel, tryCloseDueSeasons, type Season } from "@/lib/seasons";
import { api, named, newUserCookie, setupEpisode, startTestDb, userIdOf } from "./helpers";

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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

async function players(...names: string[]): Promise<string[]> {
  const cookies: string[] = [];
  for (const name of names) cookies.push(await named(newUserCookie(), name));
  return cookies;
}

async function newLeague(name: string, owner: string, members: string[]): Promise<string> {
  const res = await api.createLeague({ name }, owner);
  expect(res.status).toBe(201);
  const { id } = await res.json();
  for (const member of members) expect((await api.joinLeague(id, member)).status).toBe(201);
  return id;
}

type Pick = [ending: string, drama: string];

/**
 * Two aired episodes, each with a drama question. Episode one ends "friends" (drama answer "b"),
 * episode two ends "disaster" (drama answer "a"): a right ending is 10 points, a right drama pick 5.
 */
async function airTwoEpisodes(picks: [cookie: string, one: Pick, two: Pick][]): Promise<[string, string]> {
  const one = await setupEpisode("friends", { drama_question: "leaves_first", drama_answer: "b" });
  const two = await setupEpisode("disaster", { drama_question: "rejected", drama_answer: "a" });
  for (const [cookie, [p1, d1], [p2, d2]] of picks) {
    expect((await api.predict({ episode_id: one.episode.id, pick: p1, drama_pick: d1 }, cookie)).status).toBe(201);
    expect((await api.predict({ episode_id: two.episode.id, pick: p2, drama_pick: d2 }, cookie)).status).toBe(201);
  }
  expect((await api.reveal(one.episode.id, one.creator)).status).toBe(200);
  expect((await api.reveal(two.episode.id, two.creator)).status).toBe(200);
  return [one.episode.id, two.episode.id];
}

// Picks that score exactly these points over the two episodes above.
const SCORE: Record<number, [Pick, Pick]> = {
  25: [["friends", "b"], ["disaster", "neither"]],
  20: [["friends", "a"], ["disaster", "b"]],
  15: [["friends", "b"], ["friends", "b"]],
  10: [["friends", "a"], ["second_date", "b"]],
  5: [["disaster", "b"], ["friends", "neither"]],
  0: [["disaster", "a"], ["friends", "b"]],
};
const scoring = (cookie: string, points: number): [string, Pick, Pick] => [cookie, ...SCORE[points]];

async function podiumOf(leagueId: string, viewer: string | null = null, now = new Date()) {
  const league = await getLeague(t.db, leagueId, viewer, now);
  return league!.past_seasons;
}

/** The season `n` before this one (a week before 2026-10-19, a month after). */
function seasonBack(n: number): Season {
  let at = new Date();
  for (let i = 0; i < n; i++) at = new Date(new Date(seasonAt(at).starts_at).getTime() - 1);
  return seasonAt(at);
}

/** How far to move back something that happened just now so it lands an hour into the season `n` before this one. */
const backBy = (n: number) => `${Date.now() - new Date(seasonBack(n).starts_at).getTime() - 3_600_000} milliseconds`;

/** Moves every aired episode and every league membership back `seasons` seasons. */
async function shiftBack(seasons: number) {
  const interval = backBy(seasons);
  await t.db.query("update episodes set revealed_at = revealed_at - $1::interval, created_at = created_at - $1::interval", [
    interval,
  ]);
  await t.db.query("update league_members set joined_at = joined_at - $1::interval", [interval]);
}

describe("seasons close at their deadline (exit criterion)", () => {
  it("closes a season at its deadline and awards badges to the top 3 in each league", async () => {
    const [wren, kestrel, cedar, alder, birch, dune] = await players("Wren", "Kestrel", "Cedar", "Alder", "Birch", "Dune");
    const rooftop = await newLeague("Rooftop Regulars", wren, [kestrel, alder, birch]);
    const ferry = await newLeague("Ferry Fans", cedar, [alder, birch, dune]);
    await airTwoEpisodes([
      scoring(wren, 25),
      scoring(kestrel, 20),
      scoring(cedar, 15),
      scoring(alder, 10),
      scoring(birch, 5),
      scoring(dune, 0),
    ]);
    // The live board agrees with the scores, so the podium below can only come from them.
    expect((await getLeague(t.db, rooftop, null))!.leaderboard.map((e) => [e.name, e.points])).toEqual([
      ["Wren", 25],
      ["Kestrel", 20],
      ["Alder", 10],
      ["Birch", 5],
    ]);

    const season = seasonAt(new Date());
    const deadline = new Date(season.ends_at);

    // A millisecond before the deadline the season is still open: nothing closes, nobody has a badge.
    expect(await closeDueSeasons(t.db, new Date(deadline.getTime() - 1))).toEqual([]);
    expect(await t.count("seasons")).toBe(0);
    expect(await t.count("badges")).toBe(0);
    expect(await podiumOf(rooftop, null, new Date(deadline.getTime() - 1))).toEqual([]);

    // At the deadline it closes, exactly once.
    expect(await closeDueSeasons(t.db, deadline)).toEqual([season.id]);
    expect(await closeDueSeasons(t.db, deadline)).toEqual([]);
    expect(await t.count("seasons")).toBe(1);

    const closed = { id: season.id, starts_at: season.starts_at, ends_at: season.ends_at };
    expect(await podiumOf(rooftop, null, deadline)).toEqual([
      {
        ...closed,
        podium: [
          { place: 1, name: "Wren", points: 25, me: false },
          { place: 2, name: "Kestrel", points: 20, me: false },
          { place: 3, name: "Alder", points: 10, me: false },
        ],
      },
    ]);
    // Same players, another league, another podium: Birch was 4th above and is 3rd here; Dune scored 0.
    expect(await podiumOf(ferry, null, deadline)).toEqual([
      {
        ...closed,
        podium: [
          { place: 1, name: "Cedar", points: 15, me: false },
          { place: 2, name: "Alder", points: 10, me: false },
          { place: 3, name: "Birch", points: 5, me: false },
        ],
      },
    ]);
    expect(await t.count("badges")).toBe(2 * PODIUM_SIZE);

    // Alder placed in both leagues and holds both badges; Dune holds none.
    expect(await listMyBadges(t.db, userIdOf(alder))).toEqual([
      { season_id: season.id, league_id: ferry, league_name: "Ferry Fans", place: 2, points: 10 },
      { season_id: season.id, league_id: rooftop, league_name: "Rooftop Regulars", place: 3, points: 10 },
    ]);
    expect(await listMyBadges(t.db, userIdOf(birch))).toEqual([
      { season_id: season.id, league_id: ferry, league_name: "Ferry Fans", place: 3, points: 5 },
    ]);
    expect(await listMyBadges(t.db, userIdOf(dune))).toEqual([]);
  });

  it("closes last week's season on the first league read after the deadline (GET /api/leagues/:id), idempotently", async () => {
    const [wren, kestrel, alder] = await players("Wren", "Kestrel", "Alder");
    const league = await newLeague("Rooftop Regulars", kestrel, [wren, alder]);
    await airTwoEpisodes([scoring(wren, 25), scoring(kestrel, 20), scoring(alder, 0)]);
    await shiftBack(1); // as if all of it happened last season

    const last = seasonBack(1);
    const current = seasonAt(new Date());
    const res = await api.getLeague(league, wren);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.season).toEqual({ id: current.id, closes_at: current.ends_at });
    expect(body.past_seasons).toEqual([
      {
        id: last.id,
        starts_at: last.starts_at,
        ends_at: last.ends_at,
        podium: [
          { place: 1, name: "Wren", points: 25, me: true },
          { place: 2, name: "Kestrel", points: 20, me: false },
        ],
      },
    ]);
    // The new season's board starts from zero.
    expect(body.leaderboard.map((e: { points: number }) => e.points)).toEqual([0, 0, 0]);
    // No user ids anywhere in the response.
    for (const cookie of [wren, kestrel, alder]) expect(JSON.stringify(body)).not.toContain(userIdOf(cookie));

    await api.getLeague(league);
    await api.getLeague(league, alder);
    expect(await t.count("seasons")).toBe(1);
    expect(await t.count("badges")).toBe(2);
  });
});

describe("who earns a badge", () => {
  it("gives tied members the same place (Olympic ranking) and stops at 3rd place", async () => {
    const [wren, cedar, kestrel, alder, birch] = await players("Wren", "Cedar", "Kestrel", "Alder", "Birch");
    const split = await newLeague("Split Second", wren, [kestrel, alder, birch]); // 25, 10, 10, 5
    const shared = await newLeague("Shared Gold", cedar, [wren, alder, birch]); // 25, 25, 10, 5
    await airTwoEpisodes([
      scoring(wren, 25),
      [cedar, ["friends", "b"], ["disaster", "neither"]], // 25 too
      [kestrel, ["friends", "a"], ["friends", "b"]], // 10
      scoring(alder, 10),
      scoring(birch, 5),
    ]);
    const deadline = new Date(seasonAt(new Date()).ends_at);
    await closeDueSeasons(t.db, deadline);

    const places = async (leagueId: string) =>
      (await podiumOf(leagueId, null, deadline))[0].podium.map((p) => [p.place, p.name, p.points]);
    expect(await places(split)).toEqual([
      [1, "Wren", 25],
      [2, "Alder", 10],
      [2, "Kestrel", 10],
    ]);
    expect(await places(shared)).toEqual([
      [1, "Cedar", 25],
      [1, "Wren", 25],
      [3, "Alder", 10],
    ]);
    // Birch is 4th in both: no badge.
    expect(await listMyBadges(t.db, userIdOf(birch))).toEqual([]);
  });

  it("gives no badge for zero points, and still closes a season where nobody in a league scored", async () => {
    const [wren, dune, ember, fox, gale] = await players("Wren", "Dune", "Ember", "Fox", "Gale");
    const oneScorer = await newLeague("One Scorer", wren, [dune, ember]);
    const nobody = await newLeague("Nobody Played", fox, [gale]);
    await airTwoEpisodes([scoring(wren, 10), scoring(dune, 0), scoring(ember, 0), scoring(fox, 0)]);
    const season = seasonAt(new Date());
    expect(await closeDueSeasons(t.db, new Date(season.ends_at))).toEqual([season.id]);

    expect((await podiumOf(oneScorer))[0].podium).toEqual([{ place: 1, name: "Wren", points: 10, me: false }]);
    expect(await podiumOf(nobody)).toEqual([]);
    expect(await t.count("badges")).toBe(1);
  });

  it("leaves off anyone who joined the league after the deadline, however many points they had", async () => {
    const [wren, kestrel] = await players("Wren", "Kestrel");
    const league = await newLeague("Rooftop Regulars", kestrel, []);
    await airTwoEpisodes([scoring(wren, 25), scoring(kestrel, 10)]);
    await shiftBack(1);
    // Wren joins this week, after last week's season ended.
    expect((await api.joinLeague(league, wren)).status).toBe(201);

    expect(await closeDueSeasons(t.db)).toEqual([seasonBack(1).id]);
    expect((await podiumOf(league))[0].podium).toEqual([{ place: 1, name: "Kestrel", points: 10, me: false }]);
    expect(await listMyBadges(t.db, userIdOf(wren))).toEqual([]);
  });

  it("counts only episodes whose finale aired inside the season", async () => {
    const [wren, kestrel] = await players("Wren", "Kestrel");
    const league = await newLeague("Rooftop Regulars", wren, [kestrel]);
    const [one] = await airTwoEpisodes([scoring(wren, 25), scoring(kestrel, 20)]);
    await t.db.query("update league_members set joined_at = joined_at - $1::interval", [backBy(1)]);
    // Only episode one aired last season; episode two aired in this one and belongs to the open season.
    await t.db.query("update episodes set revealed_at = revealed_at - $2::interval where id = $1", [one, backBy(1)]);
    // A pick on an episode that never airs counts for nothing either.
    const unaired = await setupEpisode("friends");
    await api.predict({ episode_id: unaired.episode.id, pick: "friends" }, kestrel);

    expect(await closeDueSeasons(t.db)).toHaveLength(1);
    // Episode one alone: Wren 15 (friends + b), Kestrel 10 (friends + a).
    expect((await podiumOf(league))[0].podium.map((p) => [p.name, p.points])).toEqual([
      ["Wren", 15],
      ["Kestrel", 10],
    ]);
  });

  it("closes every season it missed, oldest first, each with its own podium", async () => {
    const [wren, kestrel] = await players("Wren", "Kestrel");
    const league = await newLeague("Rooftop Regulars", wren, [kestrel]);
    const [one, two] = await airTwoEpisodes([scoring(wren, 25), scoring(kestrel, 20)]);
    await t.db.query("update league_members set joined_at = joined_at - $1::interval", [backBy(3)]);
    await t.db.query("update episodes set revealed_at = revealed_at - $2::interval where id = $1", [one, backBy(2)]);
    await t.db.query("update episodes set revealed_at = revealed_at - $2::interval where id = $1", [two, backBy(1)]);

    const twoWeeksAgo = seasonBack(2);
    const lastWeek = seasonBack(1);
    expect(await closeDueSeasons(t.db)).toEqual([twoWeeksAgo.id, lastWeek.id]);
    expect(await closeDueSeasons(t.db)).toEqual([]);

    const history = await podiumOf(league);
    expect(history.map((s) => s.id)).toEqual([lastWeek.id, twoWeeksAgo.id]); // newest first
    // Episode two (disaster, drama a): Kestrel 10 (disaster + b), Wren 10 (disaster + neither).
    expect(history[0].podium.map((p) => [p.place, p.name, p.points])).toEqual([
      [1, "Kestrel", 10],
      [1, "Wren", 10],
    ]);
    // Episode one (friends, drama b): Wren 15, Kestrel 10.
    expect(history[1].podium.map((p) => [p.place, p.name, p.points])).toEqual([
      [1, "Wren", 15],
      [2, "Kestrel", 10],
    ]);
  });

  it("never fails a page read because closing failed (tryCloseDueSeasons logs and moves on)", async () => {
    const broken: Db = {
      query: async () => {
        throw new Error("connection reset");
      },
      exec: async () => {},
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(tryCloseDueSeasons(broken)).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith("[seasons] could not close due seasons:", "connection reset");
    } finally {
      log.mockRestore();
    }
  });

  it("closes nothing while no finale has aired before this week", async () => {
    const [wren] = await players("Wren");
    await newLeague("Rooftop Regulars", wren, []);
    await airTwoEpisodes([scoring(wren, 25)]);
    expect(await closeDueSeasons(t.db)).toEqual([]);
    expect(await t.count("seasons")).toBe(0);
  });
});

describe("seasonAt", () => {
  it.each([
    ["a Tuesday afternoon", "2026-10-13T18:00:00.000Z", "2026-10-12"],
    ["Monday at midnight UTC", "2026-10-12T00:00:00.000Z", "2026-10-12"],
    ["the last millisecond of Sunday UTC", "2026-10-18T23:59:59.999Z", "2026-10-12"],
  ])("puts %s in the weekly season that started Monday %s (before seasons went monthly)", (_label, now, id) => {
    const season = seasonAt(new Date(now));
    expect(season.id).toBe(id);
    expect(season.starts_at).toBe(`${id}T00:00:00.000Z`);
    expect(new Date(season.ends_at).getTime() - new Date(season.starts_at).getTime()).toBe(WEEK_MS);
  });

  it.each([
    ["the first monthly season's first moment", "2026-10-19T00:00:00.000Z", "2026-10-19", "2026-11-01"],
    ["the last millisecond of October", "2026-10-31T23:59:59.999Z", "2026-10-19", "2026-11-01"],
    ["November's first moment", "2026-11-01T00:00:00.000Z", "2026-11-01", "2026-12-01"],
    ["a day in December", "2026-12-17T08:00:00.000Z", "2026-12-01", "2027-01-01"],
    ["February in a leap year", "2028-02-29T12:00:00.000Z", "2028-02-01", "2028-03-01"],
  ])("from 2026-10-19 a season is a month: %s is in %s", (_label, now, id, ends) => {
    const season = seasonAt(new Date(now));
    expect(season).toEqual({ id, starts_at: `${id}T00:00:00.000Z`, ends_at: `${ends}T00:00:00.000Z` });
  });

  it("labels weekly seasons by their week and monthly ones by their month", () => {
    expect(seasonLabel("2026-10-12")).toBe("week of Oct 12");
    expect(seasonLabel("2026-10-19")).toBe("October 2026");
    expect(seasonLabel("2026-11-01")).toBe("November 2026");
  });

  it("closes the last weekly season and the first monthly one apart, so no week's points count twice", async () => {
    const [one, two] = await airTwoEpisodes([]);
    await t.db.query(`insert into seasons (id, starts_at, ends_at) values ('2026-10-05', '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z')`);
    const airAt = (id: string, iso: string) => t.db.query(`update episodes set revealed_at = $2 where id = $1`, [id, iso]);
    await airAt(one, "2026-10-14T10:00:00Z");
    await airAt(two, "2026-10-25T10:00:00Z");
    expect(await closeDueSeasons(t.db, new Date("2026-10-20T00:00:00Z"))).toEqual(["2026-10-12"]);
    expect(await closeDueSeasons(t.db, new Date("2026-10-30T00:00:00Z"))).toEqual([]);
    expect(await closeDueSeasons(t.db, new Date("2026-11-02T00:00:00Z"))).toEqual(["2026-10-19"]);
    const closed = (await t.db.query<{ starts_at: Date; ends_at: Date }>(`select starts_at, ends_at from seasons where id = '2026-10-19'`)).rows[0];
    expect([new Date(closed.starts_at).toISOString(), new Date(closed.ends_at).toISOString()]).toEqual(["2026-10-19T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  });

  it("is what the league view reports as the open season", async () => {
    const [wren] = await players("Wren");
    const league = await newLeague("Rooftop Regulars", wren, []);
    const now = new Date("2026-10-14T09:30:00.000Z");
    expect((await getLeague(t.db, league, null, now))!.season).toEqual({
      id: "2026-10-12",
      closes_at: "2026-10-19T00:00:00.000Z",
    });
  });
});

describe("badge components", () => {
  it("Podium shows each place's medal, name and points", () => {
    const html = renderToStaticMarkup(
      createElement(Podium, {
        entries: [
          { place: 1, name: "Wren", points: 25, me: true },
          { place: 2, name: "Kestrel", points: 20, me: false },
          { place: 3, name: "Alder", points: 10, me: false },
        ],
      }),
    );
    for (const text of [BADGE_LABELS[1], BADGE_LABELS[2], BADGE_LABELS[3], "Wren", "Kestrel", "Alder", "25", "(you)"]) {
      expect(html).toContain(text);
    }
  });

  it("BadgeList shows the league, the place and the season week, linking to the league", () => {
    const html = renderToStaticMarkup(
      createElement(BadgeList, {
        badges: [
          {
            season_id: "2026-10-12",
            league_id: "11111111-1111-4111-8111-111111111111",
            league_name: "Rooftop Regulars",
            place: 2,
            points: 20,
          },
        ],
      }),
    );
    expect(html).toContain("Rooftop Regulars");
    expect(html).toContain(BADGE_LABELS[2]);
    expect(html).toContain("Oct 12");
    expect(html).toContain('href="/leagues/11111111-1111-4111-8111-111111111111"');
  });
});
