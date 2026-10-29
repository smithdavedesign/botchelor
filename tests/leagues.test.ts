import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getLeague, LEAGUE_MEMBER_CAP, weekWindow } from "@/lib/leagues";
import { seasonAt, seasonWindow } from "@/lib/seasons";
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

type Entry = { rank: number; name: string; points: number; me: boolean };

async function newLeague(owner: string, name = "Tuesday Watch Club") {
  const res = await api.createLeague({ name }, owner);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string; invite_path: string };
}

async function board(leagueId: string, viewer?: string): Promise<Entry[]> {
  const res = await api.getLeague(leagueId, viewer);
  expect(res.status).toBe(200);
  return (await res.json()).leaderboard;
}

/** Two aired episodes; each pick list is [pick on the "friends" episode, pick on the "disaster" episode]. */
async function playTwoEpisodes(picks: [string, [string, string]][]) {
  const a = await setupEpisode("friends");
  const b = await setupEpisode("disaster");
  for (const [cookie, [pickA, pickB]] of picks) {
    expect((await api.predict({ episode_id: a.episode.id, pick: pickA }, cookie)).status).toBe(201);
    expect((await api.predict({ episode_id: b.episode.id, pick: pickB }, cookie)).status).toBe(201);
  }
  await api.reveal(a.episode.id, a.creator);
  await api.reveal(b.episode.id, b.creator);
  return { a, b };
}

describe("weekly league leaderboard (exit criterion)", () => {
  it("returns a league of three users with 20, 10 and 0 points in that order", async () => {
    // Join order (Kestrel, Alder, Wren) and alphabetical order (Alder, Kestrel, Wren) both differ
    // from the expected ranking, so only the points can produce it.
    const kestrel = await named(newUserCookie(), "Kestrel");
    const alder = await named(newUserCookie(), "Alder");
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(kestrel);
    expect((await api.joinLeague(league.id, alder)).status).toBe(201);
    expect((await api.joinLeague(league.id, wren)).status).toBe(201);

    await playTwoEpisodes([
      [wren, ["friends", "disaster"]], // 20
      [kestrel, ["friends", "second_date"]], // 10
      [alder, ["disaster", "friends"]], // 0
    ]);

    expect(await board(league.id, wren)).toEqual([
      { rank: 1, name: "Wren", points: 20, me: true },
      { rank: 2, name: "Kestrel", points: 10, me: false },
      { rank: 3, name: "Alder", points: 0, me: false },
    ]);
  });

  it("gives tied members the same rank and orders them by name", async () => {
    const [bo, ash, cy] = [await named(newUserCookie(), "Bo"), await named(newUserCookie(), "Ash"), await named(newUserCookie(), "Cy")];
    const league = await newLeague(bo);
    await api.joinLeague(league.id, ash);
    await api.joinLeague(league.id, cy);
    await playTwoEpisodes([
      [bo, ["friends", "friends"]], // 10
      [ash, ["friends", "friends"]], // 10
      [cy, ["disaster", "friends"]], // 0
    ]);
    expect((await board(league.id)).map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, "Ash", 10],
      [1, "Bo", 10],
      [3, "Cy", 0],
    ]);
  });

  it("counts only episodes aired this week: unaired picks and last week's episodes score 0 on the board", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(wren);
    const { a } = await playTwoEpisodes([[wren, ["friends", "disaster"]]]);
    expect((await board(league.id))[0].points).toBe(20);

    // Move one episode's air time to just before this season began: it leaves the board but stays in all-time points.
    // (The board counts the season, a month since 2026-10-19. "8 days ago" stopped being outside it on 2026-10-28.)
    const seasonStart = seasonWindow(new Date()).start;
    await t.db.query("update episodes set revealed_at = $2 where id = $1", [a.episode.id, new Date(seasonStart.getTime() - 60_000).toISOString()]);
    expect((await board(league.id))[0].points).toBe(10);
    expect((await (await api.me(wren)).json()).points).toBe(20);

    const unaired = await setupEpisode("friends");
    await api.predict({ episode_id: unaired.episode.id, pick: "friends" }, wren);
    expect((await board(league.id))[0].points).toBe(10);
  });

  it("adds drama-question points to the board", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(wren);
    const { creator, episode } = await setupEpisode("friends", { drama_question: "leaves_first", drama_answer: "a" });
    await api.predict({ episode_id: episode.id, pick: "friends", drama_pick: "a" }, wren);
    await api.reveal(episode.id, creator);
    expect((await board(league.id))[0].points).toBe(15);
  });

  it("lists only members, with no user ids, and tells a non-member viewer they are not in it", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const outsider = await named(newUserCookie(), "Outsider");
    const league = await newLeague(wren);
    await playTwoEpisodes([
      [wren, ["friends", "friends"]],
      [outsider, ["friends", "disaster"]],
    ]);
    const res = await api.getLeague(league.id, outsider);
    const body = await res.json();
    expect(body).toMatchObject({ id: league.id, name: "Tuesday Watch Club", is_member: false, members: 1 });
    expect(body.invite_path).toBe(`/leagues/${league.id}`);
    expect(body.leaderboard).toEqual([{ rank: 1, name: "Wren", points: 10, me: false }]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(userIdOf(wren));
    expect(text).not.toContain(userIdOf(outsider));
    expect(body.week.start < body.week.end).toBe(true);
  });
});

describe("POST /api/leagues", () => {
  it("creates a league with the creator as its first member (201)", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(wren, "  Rooftop Regulars ");
    expect(league).toMatchObject({ name: "Rooftop Regulars", invite_path: `/leagues/${league.id}` });
    expect(league.id).toMatch(/^[0-9a-f-]{36}$/);
    const body = await (await api.getLeague(league.id, wren)).json();
    expect(body).toMatchObject({ is_member: true, members: 1 });
    expect(body.leaderboard).toEqual([{ rank: 1, name: "Wren", points: 0, me: true }]);
  });

  it("requires a display name first (422 name_required) and stores nothing", async () => {
    const res = await api.createLeague({ name: "Nameless" }, newUserCookie());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("name_required");
    expect(await t.count("leagues")).toBe(0);
  });

  it.each([
    ["an empty name", { name: " " }, "invalid_league"],
    ["a 41-character name", { name: "L".repeat(41) }, "invalid_league"],
    ["a real person's name", { name: "Elon Musk Fan Club" }, "content_rejected"],
  ])("rejects %s with 422", async (_label, body, error) => {
    const wren = await named(newUserCookie(), "Wren");
    const res = await api.createLeague(body, wren);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(error);
    expect(await t.count("leagues")).toBe(0);
  });
});

describe("POST /api/leagues/:id/join", () => {
  it("joins with 201, and a repeat join is 200 with no duplicate member", async () => {
    const league = await newLeague(await named(newUserCookie(), "Wren"));
    const friend = await named(newUserCookie(), "Kestrel");
    expect((await api.joinLeague(league.id, friend)).status).toBe(201);
    expect((await api.joinLeague(league.id, friend)).status).toBe(200);
    expect(await t.count("league_members")).toBe(2);
  });

  it("requires a display name (422 name_required)", async () => {
    const league = await newLeague(await named(newUserCookie(), "Wren"));
    const res = await api.joinLeague(league.id, newUserCookie());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("name_required");
    expect(await t.count("league_members")).toBe(1);
  });

  it("returns 404 for an unknown league, on join and on the board", async () => {
    const friend = await named(newUserCookie(), "Kestrel");
    expect((await api.joinLeague("00000000-0000-4000-8000-000000000000", friend)).status).toBe(404);
    expect((await api.getLeague("00000000-0000-4000-8000-000000000000", friend)).status).toBe(404);
    expect((await api.getLeague("not-a-uuid", friend)).status).toBe(404);
  });

  it(`returns 409 once a league has ${LEAGUE_MEMBER_CAP} members`, async () => {
    const league = await newLeague(await named(newUserCookie(), "Wren"));
    for (let i = 1; i < LEAGUE_MEMBER_CAP - 1; i++) {
      await t.db.query("insert into league_members (league_id, user_id) values ($1, $2)", [league.id, `filler-${i}`]);
    }
    expect((await api.joinLeague(league.id, await named(newUserCookie(), "Last In"))).status).toBe(201);
    const late = await api.joinLeague(league.id, await named(newUserCookie(), "Too Late"));
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("league_full");
    expect(await t.count("league_members")).toBe(LEAGUE_MEMBER_CAP);
  });
});

describe("weekWindow", () => {
  it.each([
    ["a Tuesday afternoon", "2026-10-13T18:00:00.000Z", "2026-10-12T00:00:00.000Z"],
    ["Monday at midnight UTC", "2026-10-12T00:00:00.000Z", "2026-10-12T00:00:00.000Z"],
    ["the last second of Sunday UTC", "2026-10-18T23:59:59.999Z", "2026-10-12T00:00:00.000Z"],
    ["a Sunday across a month boundary", "2026-11-01T12:00:00.000Z", "2026-10-26T00:00:00.000Z"],
  ])("starts %s's week on Monday 00:00 UTC and ends it 7 days later", (_label, now, start) => {
    const window = weekWindow(new Date(now));
    expect(window.start.toISOString()).toBe(start);
    expect(window.end.getTime() - window.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("scores the board for the season of the given date", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(wren);
    await playTwoEpisodes([[wren, ["friends", "disaster"]]]);
    const nextSeason = new Date(seasonAt(new Date()).ends_at);
    const later = await getLeague(t.db, league.id, userIdOf(wren), nextSeason);
    expect(later?.leaderboard[0].points).toBe(0);
    const now = await getLeague(t.db, league.id, userIdOf(wren));
    expect(now?.leaderboard[0].points).toBe(20);
  });
});
