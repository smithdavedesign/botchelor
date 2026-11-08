// A reason to come back on a schedule (docs/audits/2026-11-07-audit-and-benchmark.md, group B, items 7–10): Sunday's
// reveal (one weekly vote with a consequence aired at a fixed time, and the secret it earns), the season pool (one
// season score, the board revealed when the season closes), and the share card for this week's calls.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WeeklyReveal from "@/app/WeeklyReveal";
import SeasonPoolPanel, { PoolBoardList } from "@/app/SeasonPool";
import TonightBand from "@/app/TonightBand";
import { Secrets } from "@/app/characters/[id]/Secrets";
import { shareOf } from "@/app/YourCalls";
import { castSecrets, hiddenCastSecrets, secretsForDate, SECRET_POOL } from "@/lib/cast-secrets";
import { countdown } from "@/lib/countdown";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { seasonStanding } from "@/lib/leagues";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { freezeSeasonPool, ordinal, placesOf, poolBoard, poolStanding, recentPoolBoard, type PoolBoard } from "@/lib/season-pool";
import { parseRecordShare, recordSharePath, recordShareKey, recordWords, type RecordShare } from "@/lib/share-record";
import { callRecord } from "@/lib/streaks";
import { ensureRevealVote, revealBoard, revealDayOf, revealNote, revealTimes, runDueReveal, voteReveal, type RevealBoard } from "@/lib/weekly-reveal";
import { seasonIdOf } from "@/lib/season-window";
import type { Ending } from "@/lib/rules";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, setupEpisode, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from watch_parties");
});
// Back to the pin startTestDb sets (the whole house cast), which the dates made through the API rely on.
afterEach(() => setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id)));

const CAST = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
const SEASON = "2026-11-01";
const SAT_EARLY = new Date("2026-11-14T18:00:00Z");
const SAT_OPEN = new Date("2026-11-14T19:20:00Z");
const SUN_MORNING = new Date("2026-11-15T10:00:00Z");
const SUN_CLOSED = new Date("2026-11-15T19:05:00Z");
const SUN_AIR = new Date("2026-11-15T19:20:00Z");
const MON = new Date("2026-11-16T10:00:00Z");

/** Three stored secrets for each of the cast this season (as the lobby job writes them), each distinct. */
async function storeSecrets() {
  setSeasonCastForTests(CAST);
  for (const [i, id] of CAST.entries()) {
    for (let idx = 0; idx < 3; idx++) {
      await t.db.query(`insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, $2, $3, $4, 'pool')`, [id, SEASON, idx, SECRET_POOL[i * 3 + idx]]);
    }
  }
}

describe("Sunday's reveal: the clock", () => {
  it("counts toward the coming Sunday, votes for 24 hours to its 19:00 UTC close, and airs at the job's pass after", () => {
    expect(revealDayOf(new Date("2026-11-11T10:00:00Z"))).toBe("2026-11-15");
    expect(revealDayOf(new Date("2026-11-15T23:00:00Z"))).toBe("2026-11-15");
    expect(revealDayOf(new Date("2026-11-16T00:30:00Z"))).toBe("2026-11-22");
    const times = revealTimes("2026-11-15");
    expect(times.opens_at.toISOString()).toBe("2026-11-14T19:00:00.000Z");
    expect(times.closes_at.toISOString()).toBe("2026-11-15T19:00:00.000Z");
    expect(times.airs_at.toISOString()).toBe("2026-11-15T19:20:00.000Z");
    const at = Date.parse("2026-11-15T10:00:00Z");
    expect(countdown("2026-11-15T15:12:00Z", at)).toBe("in 5h 12m");
    expect(countdown("2026-11-15T10:40:00Z", at)).toBe("in 40m");
    expect(countdown("2026-11-17T10:00:00Z", at)).toBe("in 2 days");
    expect(countdown("2026-11-15T09:00:00Z", at)).toBe("any minute");
  });

  it("slips the partner a note in the producers' voice that never says how they heard", () => {
    const note = revealNote("Nell", "Has never seen the sea.");
    expect(note).toContain(`"Has never seen the sea."`);
    expect(note).toMatch(/They don't know you know/);
    expect(note).toMatch(/Never say how you heard/);
  });
});

describe("Sunday's reveal: the vote and what it brings out", () => {
  it("opens Saturday with a frozen ballot of the cast who still keep a secret, takes one vote each, and refuses outside the window", async () => {
    await storeSecrets();
    // One of the cast has nothing left to hide: off the ballot.
    await t.db.query(`update cast_secrets set voted_at = $2, voted_week = '2026-11-08' where character_id = $1`, [CAST[3], "2026-11-08T19:20:00Z"]);
    expect(await ensureRevealVote(t.db, SAT_EARLY)).toBeNull();
    expect((await revealBoard(t.db, null, SAT_EARLY))?.state).toBe("soon");
    const row = (await ensureRevealVote(t.db, SAT_OPEN))!;
    expect(row.choices.map((c) => c.id).sort()).toEqual(CAST.slice(0, 3).sort());
    // Frozen: a second pass keeps the same ballot.
    expect((await ensureRevealVote(t.db, SUN_MORNING))!.choices).toEqual(row.choices);

    const [a, b, c] = row.choices.map((x) => x.id);
    expect(await voteReveal(t.db, "u1", b, SAT_OPEN)).toEqual({ ok: true, pick: b });
    expect(await voteReveal(t.db, "u1", c, SUN_MORNING)).toEqual({ ok: true, pick: c });
    await voteReveal(t.db, "u2", c, SUN_MORNING);
    await voteReveal(t.db, "u3", a, SUN_MORNING);
    expect(await voteReveal(t.db, "u4", CAST[3], SUN_MORNING)).toMatchObject({ ok: false, status: 400, error: "not_on_the_ballot" });
    expect(await voteReveal(t.db, "u4", a, SUN_CLOSED)).toMatchObject({ ok: false, status: 404, error: "no_vote_open" });
    expect(await voteReveal(t.db, "u4", a, SAT_EARLY)).toMatchObject({ ok: false, status: 404 });

    const board = (await revealBoard(t.db, "u1", SUN_MORNING))!;
    expect(board).toMatchObject({ state: "open", my_pick: c, total: 3 });
    expect(board.choices.find((x) => x.id === c)).toMatchObject({ votes: 2, out: 0, total: 3 });
    expect((await revealBoard(t.db, null, SUN_CLOSED))!.state).toBe("closed");
  });

  it("at the close, brings the winner's next secret out, makes their date with the partner told, and tells the voters once", async () => {
    await storeSecrets();
    const row = (await ensureRevealVote(t.db, SAT_OPEN))!;
    const [a, , c] = row.choices.map((x) => x.id);
    await voteReveal(t.db, "u1", c, SUN_MORNING);
    await voteReveal(t.db, "u2", c, SUN_MORNING);
    await voteReveal(t.db, "u3", a, SUN_MORNING);
    // Not before the close, and not on any other day.
    expect(await runDueReveal(t.db, SUN_MORNING)).toMatchObject({ ran: false, reason: "not_due" });

    scriptedModel([episodeJson()]);
    const run = await runDueReveal(t.db, SUN_AIR);
    if (!run.ran) throw new Error(`not run: ${run.reason}`);
    expect(run).toMatchObject({ winner: c, producers_pick: false });
    expect(run.room_path).toMatch(/^\/watch\//);

    // The secret is out from now on, marked as the audience's, and no longer rides their side of a date.
    const secret = SECRET_POOL[CAST.indexOf(c) * 3];
    const after = new Date(SUN_AIR.getTime() + 60_000);
    const status = (await castSecrets(t.db, c, after))!;
    expect(status.out).toEqual([{ secret, at: SUN_AIR.toISOString(), voted: true }]);
    expect(await hiddenCastSecrets(t.db, c, after)).not.toContain(secret);
    expect((await secretsForDate(t.db, c, after)).map((s) => s.secret)).not.toContain(secret);

    // Their date: the partner first (side A, the one carrying the note), the winner second.
    const ep = (
      await t.db.query<{ a: string; b: string; sides: { note_followed: boolean | null }[] }>(
        `select e.character_a as a, e.character_b as b, e.sides from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
        [run.room_path!.split("/").pop()],
      )
    ).rows[0];
    expect(ep.b).toBe(c);
    expect(CAST).toContain(ep.a);
    expect(ep.a).not.toBe(c);
    expect(typeof ep.sides[0].note_followed).toBe("boolean");
    expect(ep.sides[1].note_followed).toBeNull();

    const notes = (await t.db.query<{ user_id: string; title: string; body: string; link: string }>(`select user_id, title, body, link from notifications where kind = 'secret_revealed' order by user_id`)).rows;
    expect(notes.map((n) => n.user_id)).toEqual(["u1", "u2", "u3"]);
    expect(notes[0].title).toMatch(/^🔓 Your pick won/);
    expect(notes[2].title).toMatch(/^🔓 The audience voted out/);
    expect(notes[0].body).toContain(secret);
    expect(notes[0].body).toContain("2 of 3 votes");
    expect(notes.every((n) => n.link === run.room_path)).toBe(true);

    // Once: the next pass changes nothing.
    expect(await runDueReveal(t.db, new Date("2026-11-15T20:20:00Z"))).toMatchObject({ ran: true, room_path: run.room_path });
    expect((await t.db.query("select 1 from watch_parties")).rows).toHaveLength(1);
    expect((await t.db.query("select 1 from notifications where kind = 'secret_revealed'")).rows).toHaveLength(3);

    // The card says how it went the next day, beside the next countdown.
    const board = (await revealBoard(t.db, "u3", MON))!;
    expect(board.state).toBe("soon");
    expect(board.week_id).toBe("2026-11-22");
    expect(board.last).toMatchObject({ character_id: c, secret, votes: 2, total: 3, producers_pick: false, room_path: run.room_path });
  });

  it("lets the producers pick when nobody voted, and says so", async () => {
    await storeSecrets();
    const row = (await ensureRevealVote(t.db, SAT_OPEN))!;
    scriptedModel([episodeJson()]);
    const run = await runDueReveal(t.db, SUN_AIR);
    expect(run).toMatchObject({ ran: true, winner: row.choices[0].id, producers_pick: true });
    const board = (await revealBoard(t.db, null, MON))!;
    expect(board.last).toMatchObject({ producers_pick: true, votes: 0, total: 0 });
    const html = renderToStaticMarkup(createElement(WeeklyReveal, { board, now: MON.getTime() }));
    expect(html).toContain("Nobody voted, so the producers picked.");
  });

  it("forgets a viewer's reveal votes with their account", async () => {
    await storeSecrets();
    const row = (await ensureRevealVote(t.db, SAT_OPEN))!;
    await voteReveal(t.db, "gone", row.choices[0].id, SUN_MORNING);
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, "gone");
    expect((await t.db.query("select 1 from weekly_reveal_votes")).rows).toHaveLength(0);
  });
});

describe("Sunday's reveal: on the page", () => {
  const open: RevealBoard = {
    week_id: "2026-11-15",
    state: "open",
    opens_at: "2026-11-14T19:00:00.000Z",
    closes_at: "2026-11-15T19:00:00.000Z",
    airs_at: "2026-11-15T19:20:00.000Z",
    choices: [
      { id: "house-nell", name: "Nell Abiodun", hue: 1, portrait: null, out: 1, total: 3, votes: 2 },
      { id: "house-teo", name: "Teo Brandt", hue: 2, portrait: null, out: 0, total: 3, votes: 1 },
    ],
    my_pick: null,
    total: 3,
    last: null,
  };

  it("asks whose secret comes out, counts down to the close, and shows the counts only once you've voted", () => {
    const now = Date.parse("2026-11-15T13:48:00Z");
    const html = renderToStaticMarkup(createElement(WeeklyReveal, { board: open, now }));
    expect(html).toContain("Sunday&#x27;s reveal: whose secret comes out?");
    expect(html).toContain("Closes in 5h 12m");
    expect(html).toContain("1 of 3 secrets out");
    expect(html).toContain("Vote to see how it&#x27;s going.");
    expect(html).not.toContain("67%");
    const voted = renderToStaticMarkup(createElement(WeeklyReveal, { board: { ...open, my_pick: "house-nell" }, now }));
    expect(voted).toContain("67%");
    expect(voted).toContain("3 votes so far.");
  });

  it("puts the open vote in home's tonight band", () => {
    const html = renderToStaticMarkup(createElement(TonightBand, { rooms: [], airing: [], situation: null, reveal: open, latest: null, now: Date.parse("2026-11-15T13:48:00Z") }));
    expect(html).toContain("Sunday&#x27;s reveal");
    expect(html).toContain('href="/watch#sunday-reveal"');
    expect(html).toContain("closes in 5h 12m");
  });

  it("marks a secret the audience voted out on the cast member's page", () => {
    const html = renderToStaticMarkup(
      createElement(Secrets, { name: "Nell", secrets: { total: 3, out: [{ secret: "Has never seen the sea.", at: "2026-11-15T19:20:00.000Z", voted: true }], next_in: 2 } }),
    );
    expect(html).toContain("Voted out by the audience");
    expect(html).toContain("on Sundays the audience can vote one out");
  });
});

/** One public date with `ending` that aired now, called by each of `calls` (cookie → pick). */
async function airedDate(ending: Ending, calls: [string, Ending][]) {
  const { creator, episode } = await setupEpisode(ending);
  for (const [cookie, pick] of calls) expect((await api.predict({ episode_id: episode.id, pick }, cookie)).status).toBe(201);
  expect((await api.reveal(episode.id, creator)).status).toBe(200);
  return episode.id as string;
}

describe("the season pool", () => {
  it("places ties together and says places in words", () => {
    expect(placesOf([30, 20, 20, 10])).toEqual([1, 2, 2, 4]);
    expect(placesOf([5, 5, 5])).toEqual([1, 1, 1]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  it("adds up calls, backings and dares into one season score, ranks it without the show's own accounts, and reveals it once when the season closes", async () => {
    const season = seasonIdOf(new Date());
    const [ana, ben, cy, staff] = [newUserCookie(), newUserCookie(), newUserCookie(), newUserCookie()];
    await t.db.query(`insert into profiles (user_id, name) values ($1, 'Ana')`, [userIdOf(ana)]);
    await t.db.query(`insert into admins (user_id) values ($1)`, [userIdOf(staff)]);
    await airedDate("friends", [[ana, "friends"], [ben, "friends"], [staff, "friends"]]);
    await airedDate("disaster", [[ana, "disaster"], [staff, "disaster"]]);
    // Ben backed a cast member who ended the season coupled; Cy's dare vote earned 5.
    await t.db.query(`insert into cast_backings (season_id, user_id, character_id, won, settled_at) values ($1, $2, $3, true, now())`, [season, userIdOf(ben), CAST[0]]);
    await t.db.query(`insert into dare_votes (day, user_id, pick, points, settled_at) values ($1, $2, 'pet-name', 5, now())`, [new Date().toISOString().slice(0, 10), userIdOf(cy)]);

    const standing = await poolStanding(t.db, userIdOf(ana));
    expect(standing).toMatchObject({ season_id: season, points: 20, place: 2, players: 3, leader: 35 });
    // The show's own account scores, unranked.
    expect(await poolStanding(t.db, userIdOf(staff))).toMatchObject({ points: 20, place: null, players: 3 });
    // The MCP's get_leaderboard reads the same score.
    expect(await seasonStanding(t.db, userIdOf(ben))).toEqual({ points: 35, place: 1, players: 3 });

    // Running: the board stays hidden.
    expect(await poolBoard(t.db, season, userIdOf(ana))).toBeNull();
    const nextMonth = new Date(Date.parse(standing.reveals_at) + 20 * 60 * 1000);
    expect(await freezeSeasonPool(t.db, season, new Date())).toMatchObject({ frozen: false });
    expect(await freezeSeasonPool(t.db, season, nextMonth)).toMatchObject({ frozen: true, players: 3, notified: 3 });
    expect(await freezeSeasonPool(t.db, season, nextMonth)).toMatchObject({ frozen: false });

    const board = (await poolBoard(t.db, season, userIdOf(ana)))!;
    expect(board.top.map((e) => [e.place, e.name, e.points, e.mine])).toEqual([
      [1, null, 35, false],
      [2, "Ana", 20, true],
      [3, null, 5, false],
    ]);
    expect(board.me).toEqual({ place: 2, points: 20 });
    const notes = (await t.db.query<{ user_id: string; title: string; link: string }>(`select user_id, title, link from notifications where kind = 'season_pool'`)).rows;
    expect(notes).toHaveLength(3);
    expect(notes.find((n) => n.user_id === userIdOf(ben))!.title).toMatch(/^🏆 You won the .* pool$/);
    expect(notes.find((n) => n.user_id === userIdOf(ana))!.title).toMatch(/you finished 2nd$/);
    expect(notes.every((n) => n.link.endsWith("#pool"))).toBe(true);

    // /watch shows it for the next season's first week only.
    expect(await recentPoolBoard(t.db, userIdOf(ana), new Date(Date.parse(standing.reveals_at) + 2 * 86_400_000))).toMatchObject({ season_id: season });
    expect(await recentPoolBoard(t.db, userIdOf(ana), new Date(Date.parse(standing.reveals_at) + 9 * 86_400_000))).toBeNull();

    // A player who deletes their account leaves the board.
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, userIdOf(cy));
    expect((await poolBoard(t.db, season, null))!.top).toHaveLength(2);
  });

  it("shows your standing while the season runs, and the revealed board with names or who they are", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const html = renderToStaticMarkup(
      createElement(SeasonPoolPanel, {
        standing: { season_id: SEASON, points: 20, place: 2, players: 3, leader: 35, reveals_at: "2026-12-01T00:00:00.000Z" },
        revealed: null,
        now,
      }),
    );
    expect(html).toContain("You: 20 points, 2nd of 3 so far.");
    expect(html).toContain("The leader has 35.");
    expect(html).toContain("revealed when the season closes in 23 days");
    const board: PoolBoard = {
      season_id: "2026-10-19",
      label: "October 2026",
      path: "/seasons/october-2026",
      players: 3,
      top: [
        { place: 1, name: "Ana", agent: false, points: 40, calls_right: 4, mine: false },
        { place: 2, name: null, agent: true, points: 30, calls_right: 3, mine: false },
        { place: 2, name: null, agent: false, points: 30, calls_right: 2, mine: true },
      ],
      me: { place: 2, points: 30 },
      frozen_at: "2026-11-01T00:20:00.000Z",
    };
    const list = renderToStaticMarkup(createElement(PoolBoardList, { board }));
    expect(list).toContain("An AI agent");
    expect(list).toContain("A viewer");
    expect(list).toContain('href="/seasons/october-2026#pool"');
    const revealed = renderToStaticMarkup(createElement(SeasonPoolPanel, { standing: null, revealed: board, now }));
    expect(revealed).toContain("The October 2026 pool is out.");
  });
});

describe("the share card for this week's calls (item 10)", () => {
  const base: RecordShare = { recent: [true, true, false, true, true], right: 9, called: 12, streak: 3, best: 4, season: 2, night: 8 };

  it("leads with this week's tally, carries it on the link, and parses it back strictly", () => {
    const share: RecordShare = { ...base, week: { right: 4, called: 5 } };
    expect(recordWords(share)).toBe("4 of 5 this week · 3 in a row");
    const path = recordSharePath(share);
    expect(path).toContain("t=4-5");
    const q = Object.fromEntries(new URL(path, "https://botchelor.com").searchParams.entries());
    expect(parseRecordShare(q)).toMatchObject({ week: { right: 4, called: 5 }, recent: share.recent });
    // A grid with more squares, or more right ones, than the week holds: not a share.
    expect(parseRecordShare({ ...q, t: "4-4" })).toBeNull();
    expect(parseRecordShare({ ...q, t: "3-5" })).toBeNull();
    expect(parseRecordShare({ ...q, t: "6-5" })).toBeNull();
    expect(parseRecordShare({ ...q, t: "x" })).toBeNull();
    const { t: _t, ...old } = q;
    expect(parseRecordShare(old)?.week).toBeUndefined();
  });

  it("keeps a link signed before weeks existed valid: the week rides the signed key only when there is one", () => {
    expect(recordShareKey(base)).toBe("11011|9|12|3|4|2-8");
    expect(recordShareKey({ ...base, week: { right: 4, called: 5 } })).toBe("11011|9|12|3|4|2-8|t:4-5");
  });

  it("shares this week's grid when there were calls this week, else the latest calls", () => {
    const record = { called: 12, right: 9, streak: 3, best: 4, ended: 0, recent: [true, false, true], week: { right: 2, called: 2, recent: [true, true] } };
    expect(shareOf(record)).toMatchObject({ recent: [true, true], week: { right: 2, called: 2 } });
    expect(shareOf({ ...record, week: { right: 0, called: 0, recent: [] } })).toMatchObject({ recent: [true, false, true] });
    expect(shareOf({ ...record, week: { right: 0, called: 0, recent: [] } })?.week).toBeUndefined();
  });

  it("counts this week's calls from dates aired in the last seven days", async () => {
    const fan = newUserCookie();
    const old = await airedDate("friends", [[fan, "friends"]]);
    await airedDate("disaster", [[fan, "friends"]]);
    await airedDate("friends", [[fan, "friends"]]);
    await t.db.query(`update episodes set revealed_at = now() - interval '10 days' where id = $1`, [old]);
    const record = await callRecord(t.db, userIdOf(fan));
    expect(record).toMatchObject({ called: 3, right: 2 });
    expect(record.week).toEqual({ right: 1, called: 2, recent: [false, true] });
  });

  it("names the week on the shared page", async () => {
    const CallsPage = (await import("@/app/calls/page")).default;
    const share: RecordShare = { ...base, week: { right: 4, called: 5 } };
    const q = Object.fromEntries(new URL(recordSharePath(share), "https://botchelor.com").searchParams.entries());
    const html = renderToStaticMarkup(await CallsPage({ searchParams: Promise.resolve(q) }));
    expect(html).toContain("<h1>Someone&#x27;s calls this week</h1>");
    expect(html).toContain("4 of 5 this week · 3 in a row");
    expect(html).toContain("season pool");
  });
});
