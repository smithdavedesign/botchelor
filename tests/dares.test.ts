import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getDare, POST as postDare } from "@/app/api/dare/route";
import { DARES, dareBoard, dareChoices, daredOf, dareFollowed, dareReveal, dareWinnerOf, producerDareNote, voteDare } from "@/lib/dares";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { checkShowText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { playVotedSituation, situationChoices, situationPair, utcDay, voteSituation } from "@/lib/situations";
import { episodeJson, jsonRequest, newUserCookie, scriptedModel, startTestDb, userIdOf } from "./helpers";

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

describe("the dare pool", () => {
  it("is a real pool of distinct, PG, producer-voiced dares that pass the show's content checks", () => {
    expect(DARES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(DARES.map((d) => d.id)).size).toBe(DARES.length);
    for (const d of DARES) {
      expect(checkShowText({ dare: d.text }).ok).toBe(true);
      expect(checkShowText({ note: producerDareNote(d.text) }).ok).toBe(true);
    }
  });

  it("deals three different dares and a dared side from the day, the same every time", () => {
    const day = utcDay(DAY);
    const dealt = dareChoices(day);
    expect(dealt).toHaveLength(3);
    expect(new Set(dealt.map((d) => d.id)).size).toBe(3);
    expect(dareChoices(day).map((d) => d.id)).toEqual(dealt.map((d) => d.id));
    const pair = situationPair(day)!;
    expect(pair).toContain(daredOf(day, pair));
    expect(daredOf(day, pair)).toBe(daredOf(day, pair));
  });
});

describe("the dare ballot", () => {
  it("takes one vote a viewer a day, lets them change it, and refuses a dare that isn't on tonight's ballot", async () => {
    const [one, two] = dareChoices(utcDay(DAY));
    expect(await voteDare(t.db, "u1", one.id, DAY)).toEqual({ ok: true, pick: one.id });
    expect(await voteDare(t.db, "u1", two.id, DAY)).toEqual({ ok: true, pick: two.id });
    const off = DARES.find((d) => !dareChoices(utcDay(DAY)).some((c) => c.id === d.id))!;
    expect(await voteDare(t.db, "u1", off.id, DAY)).toMatchObject({ ok: false, status: 400, error: "not_on_the_ballot" });
    const board = (await dareBoard(t.db, "u1", DAY))!;
    expect(board.my_pick).toBe(two.id);
    expect(board.total).toBe(1);
    expect(board.choices.find((c) => c.id === two.id)!.votes).toBe(1);
    expect(board.target.id).toBe(daredOf(utcDay(DAY), situationPair(utcDay(DAY))!));
  });

  it("picks the most votes, a tie going to the dare listed first", () => {
    const dealt = dareChoices(utcDay(DAY));
    expect(dareWinnerOf(dealt, new Map())).toBeNull();
    expect(dareWinnerOf(dealt, new Map([[dealt[2].id, 2], [dealt[0].id, 1]]))!.id).toBe(dealt[2].id);
    expect(dareWinnerOf(dealt, new Map([[dealt[2].id, 1], [dealt[1].id, 1]]))!.id).toBe(dealt[1].id);
  });

  it("votes over the API with the visitor's cookie, and shows the board back", async () => {
    const cookie = newUserCookie();
    const pick = dareChoices(utcDay(new Date()))[0].id;
    expect((await postDare(jsonRequest("/api/dare", { pick }, { cookie }))).status).toBe(201);
    const board = await (await getDare(new Request("http://localhost:3000/api/dare", { headers: { cookie } }))).json();
    expect(board.my_pick).toBe(pick);
    expect((await postDare(jsonRequest("/api/dare", { pick: "nope" }, { cookie }))).status).toBe(400);
  });
});

describe("the night it rides", () => {
  const day = "2026-11-01";

  it("a dare alone makes the night's date, slips the note to the dared side only, and tells the voters", async () => {
    const dare = dareChoices(day)[1];
    await voteDare(t.db, "fan-a", dare.id, DAY);
    await voteDare(t.db, "fan-b", dareChoices(day)[0].id, DAY);
    await voteDare(t.db, "fan-c", dare.id, DAY);
    scriptedModel([episodeJson()]);
    const played = await playVotedSituation(t.db, NEXT);
    if (!played.played) throw new Error(`not played: ${played.reason}`);
    expect(played.dare).toBe(dare.id);
    expect(played.pick).toBeNull();

    const pair = situationPair(day)!;
    const dared = daredOf(day, pair);
    const ep = (
      await t.db.query<{ id: string; a: string; sides: { note_followed: boolean | null }[]; setup: { roleplay?: unknown } }>(
        `select e.id, e.character_a as a, e.sides, e.setup from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
        [played.party_id],
      )
    ).rows[0];
    // The dared one plays side A: the engine answered its note; the other side had none to answer (it never saw it).
    expect(ep.a).toBe(dared);
    expect(typeof ep.sides[0].note_followed).toBe("boolean");
    expect(ep.sides[1].note_followed).toBeNull();
    expect(ep.setup.roleplay).toBeUndefined();

    // The record the reveal reads, and the engine's own verdict.
    const night = (await t.db.query<{ character_id: string; dare_id: string; episode_id: string }>(`select character_id, dare_id, episode_id from dare_nights`)).rows;
    expect(night).toEqual([{ character_id: dared, dare_id: dare.id, episode_id: ep.id }]);
    expect(await dareFollowed(t.db, ep.id, dared)).toBe(ep.sides[0].note_followed);

    const notes = (await t.db.query<{ user_id: string; title: string }>(`select user_id, title from notifications where kind = 'dare_on' order by user_id`)).rows;
    expect(notes.map((n) => n.user_id)).toEqual(["fan-a", "fan-b", "fan-c"]);
    expect(notes[0].title).toMatch(/^The producers took your dare/);
    expect(notes[1].title).toMatch(/^The viewers dared/);
    expect(notes[2].title).toMatch(/^The producers took your dare/);

    // Once only: the next hourly run doesn't make another.
    expect(await playVotedSituation(t.db, new Date("2026-11-02T01:20:00Z"))).toMatchObject({ played: false, reason: "already" });
  });

  it("rides the situation's date when both lanes have votes, and the episode page's reveal says how it went", async () => {
    const situation = situationChoices(day)[0];
    const dare = dareChoices(day)[0];
    await voteSituation(t.db, "fan-a", situation.id, DAY);
    await voteDare(t.db, "fan-a", dare.id, DAY);
    scriptedModel([episodeJson()]);
    const played = await playVotedSituation(t.db, NEXT);
    if (!played.played) throw new Error(`not played: ${played.reason}`);
    expect(played.pick).toBe(situation.id);
    expect(played.dare).toBe(dare.id);

    const pair = situationPair(day)!;
    const dared = daredOf(day, pair);
    const ep = (
      await t.db.query<{ id: string; a: string; setup: { roleplay?: { id: string } } }>(
        `select e.id, e.character_a as a, e.setup from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
        [played.party_id],
      )
    ).rows[0];
    expect(ep.a).toBe(dared);
    expect(ep.setup.roleplay).toMatchObject({ id: situation.id });

    // The reveal, once the date airs: who was dared, to do what, and the verdict.
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [ep.id]);
    const reveal = (await dareReveal(t.db, ep.id))!;
    expect(reveal.character_id).toBe(dared);
    expect(reveal.text).toBe(dare.text);
    expect(typeof reveal.followed).toBe("boolean");

    // The next day's card tells the verdict too.
    const board = (await dareBoard(t.db, "fan-a", new Date("2026-11-02T09:00:00Z")))!;
    expect(board.last).toMatchObject({ name: reveal.name, text: dare.text, aired: true, followed: reveal.followed, my_pick: dare.id, won: true });
  });

  it("makes no date on a day with no votes in either lane", async () => {
    expect(await playVotedSituation(t.db, NEXT)).toEqual({ played: false, day, reason: "no_votes" });
    expect((await t.db.query("select 1 from dare_nights")).rows).toHaveLength(0);
  });
});

describe("forgetting", () => {
  it("deletes a viewer's dare votes with their account", async () => {
    const cookie = newUserCookie();
    await voteDare(t.db, userIdOf(cookie), dareChoices(utcDay(new Date()))[0].id);
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, userIdOf(cookie));
    expect((await t.db.query("select 1 from dare_votes")).rows).toHaveLength(0);
  });
});
