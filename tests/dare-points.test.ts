import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dareSettledNotice, settleDareForEpisode, settleDueDares } from "@/lib/dare-points";
import { dareChoices, voteDare } from "@/lib/dares";
import { getPoints, getPointsBreakdown } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { POINTS_PER_DARE } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { playVotedSituation, utcDay } from "@/lib/situations";
import { syncRoom } from "@/lib/watch";
import { episodeJson, scriptedModel, startTestDb } from "./helpers";

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
  await t.db.query("delete from notifications");
  setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
});
afterEach(() => setSeasonCastForTests(null));

const DAY = new Date("2026-11-01T15:00:00Z");
const NEXT = new Date("2026-11-02T00:20:00Z");
const day = utcDay(DAY);

/** Yesterday's dare night: fan-a and fan-b back the winner, fan-c a dare that lost. Its verdict is set to `verdict`. */
async function dareNight(verdict: "went_through" | "sort_of" | "chickened_out") {
  const [win, lose] = dareChoices(day);
  await voteDare(t.db, "fan-a", win.id, DAY);
  await voteDare(t.db, "fan-b", win.id, DAY);
  await voteDare(t.db, "fan-c", lose.id, DAY);
  scriptedModel([episodeJson()]);
  const played = await playVotedSituation(t.db, NEXT);
  if (!played.played) throw new Error(`not played: ${played.reason}`);
  await t.db.query(`update dare_nights set verdict = $1, verdict_source = 'model'`, [verdict]);
  const episodeId = (await t.db.query<{ episode_id: string }>(`select episode_id from dare_nights`)).rows[0].episode_id;
  return { win, episodeId, partyId: played.party_id! };
}

const notices = async () =>
  (await t.db.query<{ user_id: string; title: string; body: string; link: string }>(`select user_id, title, body, link from notifications where kind = 'dare_settled' order by user_id`)).rows;

describe("a winning dare pays its voters by the verdict", () => {
  it("pays 5 / 2 / 0, as the constants say", () => {
    expect(POINTS_PER_DARE).toEqual({ went_through: 5, sort_of: 2, chickened_out: 0 });
  });

  it("waits for the air, then settles each winning vote once: points, the breakdown's dares line, one notice", async () => {
    const { win, episodeId } = await dareNight("went_through");
    // Not aired yet: nothing settles, nobody scores.
    expect(await settleDareForEpisode(t.db, episodeId)).toBeNull();
    expect((await getPointsBreakdown(t.db, "fan-a")).dares).toBe(0);

    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episodeId]);
    expect(await settleDareForEpisode(t.db, episodeId)).toMatchObject({ day, verdict: "went_through", points: 5, voters: 2 });
    expect((await getPointsBreakdown(t.db, "fan-a")).dares).toBe(5);
    expect((await getPointsBreakdown(t.db, "fan-b")).dares).toBe(5);
    // A vote for a dare that lost never made the date: no points, no notice.
    expect((await getPointsBreakdown(t.db, "fan-c")).dares).toBe(0);
    expect(await getPoints(t.db, "fan-a")).toBe(5);
    const told = await notices();
    expect(told.map((n) => n.user_id)).toEqual(["fan-a", "fan-b"]);
    expect(told[0].title).toBe("Your dare paid off: +5 points");
    expect(told[0].body).toContain(win.text);
    expect(told[0].link).toBe(`/episodes/${episodeId}`);

    // Idempotent: again, and through the backstop, changes nothing and tells nobody twice.
    expect(await settleDareForEpisode(t.db, episodeId)).toBeNull();
    expect(await settleDueDares(t.db)).toEqual([]);
    expect((await getPointsBreakdown(t.db, "fan-a")).dares).toBe(5);
    expect(await notices()).toHaveLength(2);
  });

  it("sort of pays 2; chickening out pays nothing but still says how it went", async () => {
    const { episodeId } = await dareNight("sort_of");
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episodeId]);
    expect(await settleDueDares(t.db)).toMatchObject([{ verdict: "sort_of", points: 2, voters: 2 }]);
    expect((await getPointsBreakdown(t.db, "fan-b")).dares).toBe(2);
    expect((await notices())[0].title).toBe("Your dare, sort of: +2 points");

    await t.reset();
    await t.db.query("delete from watch_parties");
    await t.db.query("delete from notifications");
    const again = await dareNight("chickened_out");
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [again.episodeId]);
    expect(await settleDueDares(t.db)).toMatchObject([{ verdict: "chickened_out", points: 0, voters: 2 }]);
    expect((await getPointsBreakdown(t.db, "fan-a")).dares).toBe(0);
    const told = await notices();
    expect(told).toHaveLength(2);
    expect(told[0].body).toContain("No points");
  });

  it("a night with no verdict yet waits for one; a date that isn't public never pays", async () => {
    const { episodeId } = await dareNight("went_through");
    await t.db.query(`update dare_nights set verdict = null`);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episodeId]);
    expect(await settleDueDares(t.db)).toEqual([]);
    await t.db.query(`update dare_nights set verdict = 'went_through'`);
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [episodeId]);
    expect(await settleDueDares(t.db)).toEqual([]);
    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [episodeId]);
    expect(await settleDueDares(t.db)).toMatchObject([{ voters: 2 }]);
  });

  it("settles the moment the house date premieres in its room", async () => {
    const { episodeId, partyId } = await dareNight("went_through");
    // The room started an hour ago: the next viewer's sync passes the decision and airs it.
    await t.db.query(`update watch_parties set starts_at = now() - interval '1 hour' where id = $1`, [partyId]);
    await syncRoom(t.db, partyId, "viewer-x");
    expect((await t.db.query<{ aired: boolean }>(`select revealed_at is not null as aired from episodes where id = $1`, [episodeId])).rows[0].aired).toBe(true);
    expect((await getPointsBreakdown(t.db, "fan-a")).dares).toBe(5);
    expect(await notices()).toHaveLength(2);
  });

  it("says it in the show's voice, with no exclamation marks", () => {
    for (const v of ["went_through", "sort_of", "chickened_out"] as const) {
      const n = dareSettledNotice("Sable Quist", "Order for both of you without asking what they want.", v);
      expect(`${n.title} ${n.body}`).not.toContain("!");
      expect(n.body).toContain("Sable");
      expect(n.body).not.toContain("Quist");
    }
  });
});
