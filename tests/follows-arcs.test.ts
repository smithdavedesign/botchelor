import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount, exportAccount } from "@/lib/account";
import { arcQuestion, arcTarget, predictArc, resolveExpiredArcs } from "@/lib/arcs";
import type { SideOutcome } from "@/lib/engine";
import { followCouple, followState, unfollowCouple } from "@/lib/follows";
import { getPoints } from "@/lib/game";
import { getLeague } from "@/lib/leagues";
import { listNotifications } from "@/lib/notifications";
import { relationshipMetrics } from "@/lib/relationship-metrics";
import { POINTS_PER_ARC } from "@/lib/rules";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });

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
});
afterEach(() => vi.restoreAllMocks());

/** One more date for an owner's character with the house partner, aired (or not). */
async function date(creator: string, characterId: string, ending: "second_date" | "friends" | "disaster", wants: [boolean, boolean], air = true) {
  scriptOutcome({ ending, sides: [side(wants[0]), side(wants[1])] });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator)).json();
  if (air) await api.reveal(ep.id, creator);
  return ep;
}
async function couple() {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), creator)).json();
  return { creator, owner: userIdOf(creator), character };
}

describe("following a couple", () => {
  it("only once a date has aired; followers hear about the next one", async () => {
    const { creator, character } = await couple();
    const fan = userIdOf(newUserCookie());
    await date(creator, character.id, "friends", [false, false], false);
    expect(await followCouple(t.db, fan, character.id, HOUSE_PARTNER_ID)).toBe(false); // nothing aired yet

    const unaired = await t.db.query<Any>(`select id from episodes where character_a = $1`, [character.id]);
    await api.reveal(unaired.rows[0].id, creator);
    expect(await followCouple(t.db, fan, character.id, HOUSE_PARTNER_ID)).toBe(true);
    expect(await followState(t.db, fan, HOUSE_PARTNER_ID, character.id)).toEqual({ following: true, followers: 1 });

    await date(creator, character.id, "second_date", [true, true]);
    const inbox = await listNotifications(t.db, fan);
    expect(inbox[0].kind).toBe("stage_up"); // a move up reaches followers too
    await date(creator, character.id, "friends", [true, false]);
    expect((await listNotifications(t.db, fan))[0]).toMatchObject({ kind: "couple_date", body: "It ended: Just friends." });

    await unfollowCouple(t.db, fan, character.id, HOUSE_PARTNER_ID);
    expect((await followState(t.db, fan, character.id, HOUSE_PARTNER_ID)).following).toBe(false);
  });
});

describe("arc predictions", () => {
  it("asks about date N (two past their public dates, at least 3); owners can't call their own couple; once each", async () => {
    expect([arcTarget(0), arcTarget(1), arcTarget(2), arcTarget(5)]).toEqual([3, 3, 4, 7]);
    const { creator, owner, character } = await couple();
    await date(creator, character.id, "second_date", [true, true]);
    expect((await arcQuestion(t.db, owner, character.id, HOUSE_PARTNER_ID))!).toMatchObject({ target: 3, can_predict: false, reason: "owner" });
    expect(await predictArc(t.db, owner, character.id, HOUSE_PARTNER_ID, true)).toMatchObject({ ok: false, error: "owner" });

    const fan = userIdOf(newUserCookie());
    expect(await predictArc(t.db, fan, character.id, HOUSE_PARTNER_ID, true)).toEqual({ ok: true, target: 3, pick: true });
    expect(await predictArc(t.db, fan, character.id, HOUSE_PARTNER_ID, false)).toMatchObject({ ok: false, status: 409 });
    expect((await arcQuestion(t.db, null, character.id, HOUSE_PARTNER_ID))!).toMatchObject({ yes: 1, no: 0, can_predict: false });
  });

  it("YES settles when they reach the date: points, a notification, and the league's week", async () => {
    const { creator, character } = await couple();
    await date(creator, character.id, "second_date", [true, true]);
    const fanCookie = newUserCookie();
    const fan = userIdOf(fanCookie);
    await api.setProfile({ name: "Arc Watcher", attest: true }, fanCookie);
    const league = await (await api.createLeague({ name: "Couple Watchers" }, fanCookie)).json();
    await predictArc(t.db, fan, character.id, HOUSE_PARTNER_ID, true);
    const doubter = userIdOf(newUserCookie());
    await predictArc(t.db, doubter, character.id, HOUSE_PARTNER_ID, false);

    await date(creator, character.id, "second_date", [true, true]); // date 2
    expect((await arcQuestion(t.db, fan, character.id, HOUSE_PARTNER_ID))!.settled).toEqual([]);
    await date(creator, character.id, "friends", [true, false]); // date 3: they made it
    const q = (await arcQuestion(t.db, fan, character.id, HOUSE_PARTNER_ID))!;
    expect(q.settled).toEqual([{ target: 3, pick: true, outcome: true, points: POINTS_PER_ARC }]);
    expect(q.target).toBe(5); // the next question
    expect(await getPoints(t.db, fan)).toBe(POINTS_PER_ARC);
    expect(await getPoints(t.db, doubter)).toBe(0);
    expect((await listNotifications(t.db, fan))[0]).toMatchObject({ kind: "arc_resolved", title: `🔮 You called it: +${POINTS_PER_ARC} points` });
    const board = (await getLeague(t.db, league.id, fan))!.leaderboard;
    expect(board.find((e) => e.me)?.points).toBe(POINTS_PER_ARC);
  });

  it("NO wins on a breakup, or when three weeks pass without getting there", async () => {
    const { creator, character } = await couple();
    await date(creator, character.id, "second_date", [true, true]);
    const believer = userIdOf(newUserCookie());
    await predictArc(t.db, believer, character.id, HOUSE_PARTNER_ID, true);
    await date(creator, character.id, "disaster", [false, false]); // exes, at 2 dates
    expect((await arcQuestion(t.db, believer, character.id, HOUSE_PARTNER_ID))!.settled).toEqual([{ target: 3, pick: true, outcome: false, points: 0 }]);

    const other = await couple();
    await date(other.creator, other.character.id, "friends", [true, true]);
    const skeptic = userIdOf(newUserCookie());
    await predictArc(t.db, skeptic, other.character.id, HOUSE_PARTNER_ID, false);
    expect(await resolveExpiredArcs(t.db, new Date())).toBe(0);
    expect(await resolveExpiredArcs(t.db, new Date(Date.now() + 22 * 86_400_000))).toBe(1);
    expect(await getPoints(t.db, skeptic)).toBe(POINTS_PER_ARC);
  });
});

describe("measuring it", () => {
  it("second-date conversion, couple depth and owners coming back", async () => {
    const { creator, character } = await couple();
    const first = await date(creator, character.id, "second_date", [true, true]);
    await date(creator, character.id, "friends", [false, false]); // not mutual
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, second_date_of: first.id }, creator);

    // Backdate the owner's first date two days, with a date the day after: a D1 and D7 return.
    const owner = userIdOf(creator);
    const eps = (await t.db.query<{ id: string }>(`select id from episodes where creator_id = $1 order by created_at`, [owner])).rows;
    await t.db.query(`update episodes set created_at = now() - interval '2 days' where id = $1`, [eps[0].id]);
    await t.db.query(`update episodes set created_at = now() - interval '1 day' where id = $1`, [eps[1].id]);

    const m = await relationshipMetrics(t.db);
    expect(m.second_dates.mutual).toBeGreaterThanOrEqual(1);
    expect(m.second_dates.booked).toBe(1);
    expect(m.couples.total).toBe(1);
    expect(m.couples.by_dates["3"]).toBe(1);
    expect(m.owners).toMatchObject({ cohort: 1, d1: 1, d7: 1, d1_rate: 1, d7_rate: 1 });
  });
});

describe("data rights", () => {
  it("export includes follows, arc calls and notifications; deleting the account removes them", async () => {
    const { creator, character } = await couple();
    await date(creator, character.id, "second_date", [true, true]);
    const fan = userIdOf(newUserCookie());
    await followCouple(t.db, fan, character.id, HOUSE_PARTNER_ID);
    await predictArc(t.db, fan, character.id, HOUSE_PARTNER_ID, true);
    const exported = await exportAccount(t.db, fan);
    expect(exported.couple_follows).toHaveLength(1);
    expect(exported.arc_predictions).toHaveLength(1);
    await deleteAccount(t.db, fan);
    for (const table of ["couple_follows", "arc_predictions", "notifications"]) {
      expect((await t.db.query(`select 1 from ${table} where user_id = $1`, [fan])).rows).toHaveLength(0);
    }
  });
});
