import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getSituation, POST as postSituation } from "@/app/api/situation/route";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { playVotedSituation, situationBoard, situationChoices, situationPair, utcDay, voteSituation, winnerOf } from "@/lib/situations";
import { episodeJson, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from watch_parties");
  setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
});
afterEach(() => setSeasonCastForTests(null));

const DAY = new Date("2026-11-01T15:00:00Z");
const NEXT = new Date("2026-11-02T00:20:00Z");

describe("tonight's situation: the ballot", () => {
  it("deals three different show roleplays and a pair of the season's cast from the day, the same every time", () => {
    const day = utcDay(DAY);
    const choices = situationChoices(day);
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map((c) => c.id)).size).toBe(3);
    expect(choices.every((c) => c.tag !== "couples")).toBe(true);
    expect(situationChoices(day).map((c) => c.id)).toEqual(choices.map((c) => c.id));
    const pair = situationPair(day)!;
    expect(pair[0]).not.toBe(pair[1]);
    expect(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id)).toEqual(expect.arrayContaining(pair));
  });

  it("takes one vote a viewer a day, lets them change it, and refuses a situation that isn't on today's ballot", async () => {
    const [one, two] = situationChoices(utcDay(DAY));
    expect(await voteSituation(t.db, "u1", one.id, DAY)).toEqual({ ok: true, pick: one.id });
    expect(await voteSituation(t.db, "u1", two.id, DAY)).toEqual({ ok: true, pick: two.id });
    const off = (await import("@/lib/roleplays")).DATE_ROLEPLAYS.find((r) => !situationChoices(utcDay(DAY)).some((c) => c.id === r.id))!;
    expect(await voteSituation(t.db, "u1", off.id, DAY)).toMatchObject({ ok: false, status: 400, error: "not_on_the_ballot" });
    const board = (await situationBoard(t.db, "u1", DAY))!;
    expect(board.my_pick).toBe(two.id);
    expect(board.total).toBe(1);
    expect(board.choices.find((c) => c.id === two.id)!.votes).toBe(1);
    // The premise names the two of them, never {a}/{b}.
    expect(board.choices.every((c) => !c.premise.includes("{"))).toBe(true);
  });

  it("picks the most votes, a tie going to the choice listed first", () => {
    const choices = situationChoices(utcDay(DAY));
    expect(winnerOf(choices, new Map())).toBeNull();
    expect(winnerOf(choices, new Map([[choices[2].id, 2], [choices[0].id, 1]]))!.id).toBe(choices[2].id);
    expect(winnerOf(choices, new Map([[choices[2].id, 1], [choices[1].id, 1]]))!.id).toBe(choices[1].id);
  });

  it("votes over the API with the visitor's cookie, and shows the board back", async () => {
    const cookie = newUserCookie();
    const pick = situationChoices(utcDay(new Date()))[0].id;
    const res = await postSituation(jsonRequest("/api/situation", { pick }, { cookie }));
    expect(res.status).toBe(201);
    const board = await (await getSituation(new Request("http://localhost:3000/api/situation", { headers: { cookie } }))).json();
    expect(board.my_pick).toBe(pick);
    expect((await postSituation(jsonRequest("/api/situation", { pick: "nope" }, { cookie }))).status).toBe(400);
  });
});

describe("tonight's situation: the date it makes", () => {
  it("makes no date on a day nobody voted", async () => {
    expect(await playVotedSituation(t.db, NEXT)).toEqual({ played: false, day: "2026-11-01", reason: "no_votes" });
    expect((await t.db.query("select 1 from watch_parties")).rows).toHaveLength(0);
  });

  it("after the vote closes, plays the winner once as a lobby room, and tells every voter", async () => {
    const choices = situationChoices("2026-11-01");
    await voteSituation(t.db, "fan-a", choices[1].id, DAY);
    await voteSituation(t.db, "fan-b", choices[1].id, DAY);
    await voteSituation(t.db, "fan-c", choices[0].id, DAY);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const played = await playVotedSituation(t.db, NEXT);
    if (!played.played) throw new Error(`not played: ${played.reason}`);
    expect(played.pick).toBe(choices[1].id);

    // The room's date plays the roleplay, the first of the pair taking its first role.
    const ep = (
      await t.db.query<{ setup: { roleplay?: { id: string; first: string; agreed: string } }; a: string }>(
        `select e.setup, e.character_a as a from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
        [played.party_id],
      )
    ).rows[0];
    expect(ep.setup.roleplay).toMatchObject({ id: choices[1].id, first: situationPair("2026-11-01")![0], agreed: "auto" });

    // Everyone who voted hears it's on: the winners that their pick won.
    const notes = (await t.db.query<{ user_id: string; title: string; link: string }>(`select user_id, title, link from notifications where kind = 'situation_on' order by user_id`)).rows;
    expect(notes.map((n) => n.user_id)).toEqual(["fan-a", "fan-b", "fan-c"]);
    expect(notes[0].title).toMatch(/^Your pick won/);
    expect(notes[2].title).toMatch(/^The viewers picked/);
    expect(notes.every((n) => n.link === played.room_path)).toBe(true);

    // Once only: the next hourly run doesn't make another.
    expect(await playVotedSituation(t.db, new Date("2026-11-02T01:20:00Z"))).toMatchObject({ played: false, reason: "already" });

    // The next day's card says how it went, with the room to watch it in, from the voter's side.
    const board = (await situationBoard(t.db, "fan-c", new Date("2026-11-02T09:00:00Z")))!;
    expect(board.last).toMatchObject({ title: choices[1].title, votes: 2, total: 3, room_path: played.room_path, my_pick: choices[0].id, won: false });
    expect(board.day).toBe("2026-11-02");
  });

  it("drops its claim when the date can't be made, so the next hour tries again", async () => {
    await voteSituation(t.db, "fan-a", situationChoices("2026-11-01")[0].id, DAY);
    scriptOutcome({ ending: "friends" });
    scriptedModel([new Error("down"), new Error("down"), new Error("down"), new Error("down")]);
    expect(await playVotedSituation(t.db, NEXT)).toMatchObject({ played: false, reason: "failed" });
    expect((await t.db.query("select 1 from situation_nights")).rows).toHaveLength(0);
  });

  it("forgets a viewer's votes with their account", async () => {
    const cookie = newUserCookie();
    await voteSituation(t.db, userIdOf(cookie), situationChoices(utcDay(new Date()))[0].id);
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, userIdOf(cookie));
    expect((await t.db.query("select 1 from situation_votes")).rows).toHaveLength(0);
  });
});
