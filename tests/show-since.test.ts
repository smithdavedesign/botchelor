import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forgetTouchesForTests, touchOwner } from "@/lib/activity";
import { lastVisit, showSince } from "@/lib/show-since";
import { api, newUserCookie, setupEpisode, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetTouchesForTests();
});

const HOUR = 60 * 60 * 1000;
/** Puts a viewer's visits in the past: their last page view `hoursAgo`, and the one before it, if any. */
const visited = (userId: string, hoursAgo: number, prevHoursAgo: number | null = null) =>
  t.db.query(
    `insert into owner_activity (user_id, last_seen, prev_seen) values ($1, now() - $2 * interval '1 hour', case when $3::int is null then null else now() - $3::int * interval '1 hour' end)
     on conflict (user_id) do update set last_seen = excluded.last_seen, prev_seen = excluded.prev_seen`,
    [userId, hoursAgo, prevHoursAgo],
  );

describe("your last visit", () => {
  it("is nothing on a first visit, and the visit before this one once you come back after a while", async () => {
    expect(await lastVisit(t.db, "new")).toBeNull();
    await touchOwner(t.db, "fan");
    expect(await lastVisit(t.db, "fan")).toBeNull(); // here now, never away
    await visited("fan", 30);
    // The first page of a return: the touch hasn't landed yet, so last_seen is the last visit.
    expect(Date.now() - (await lastVisit(t.db, "fan"))!.getTime()).toBeGreaterThan(29 * HOUR);
    forgetTouchesForTests();
    await touchOwner(t.db, "fan");
    // Once it has, prev_seen keeps it, and it holds still for the rest of this visit.
    const kept = (await lastVisit(t.db, "fan"))!;
    expect(Date.now() - kept.getTime()).toBeGreaterThan(29 * HOUR);
    forgetTouchesForTests();
    await touchOwner(t.db, "fan");
    expect((await lastVisit(t.db, "fan"))!.getTime()).toBe(kept.getTime());
  });
});

describe("the show since your last visit", () => {
  it("shows nothing to a first-timer, or when nothing happened", async () => {
    expect(await showSince(t.db, null)).toBeNull();
    expect(await showSince(t.db, "nobody")).toBeNull();
    await visited("quiet", 30);
    // A season closing since is news of its own (tests/season-recap.test.ts): in a month's first 30 hours it's all there is.
    const quiet = await showSince(t.db, "quiet");
    expect(quiet === null || (quiet.season !== null && !quiet.aired && !quiet.moves.length && !quiet.calls && !quiet.followed && !quiet.situation)).toBe(true);
  });

  it("counts the public dates that aired and your calls on them", async () => {
    const fan = newUserCookie();
    await visited(userIdOf(fan), 48, null);
    const { creator, episode } = await setupEpisode("friends");
    expect((await api.predict({ episode_id: episode.id, pick: "friends" }, fan)).status).toBe(201);
    expect((await api.reveal(episode.id, creator)).status).toBe(200);

    const card = (await showSince(t.db, userIdOf(fan)))!;
    expect(card.aired).toBe(1);
    expect(card.calls).toEqual({ called: 1, right: 1, streak: 1 });

    // A date made private stops counting: the show's news is public only.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [episode.id]);
    const after = await showSince(t.db, userIdOf(fan));
    expect(after?.aired ?? 0).toBe(0);
    expect(after?.calls ?? null).toBeNull();
  });

  it("counts dates by couples you follow", async () => {
    const fan = newUserCookie();
    await visited(userIdOf(fan), 48, null);
    const { creator, episode } = await setupEpisode("friends");
    const [lo, hi] = [episode.characters[0].id, episode.characters[1].id].sort();
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ($1, $2, $3)`, [userIdOf(fan), lo, hi]);
    expect((await api.reveal(episode.id, creator)).status).toBe(200);
    expect((await showSince(t.db, userIdOf(fan)))!.followed).toBe(1);
  });

  it("names the couples who moved, the ones you follow first, and leaves out a private character's", async () => {
    const chars = (await t.db.query<{ id: string; name: string }>(`select id, name from characters where is_house order by id limit 6`)).rows;
    const pair = (i: number) => [chars[i].id, chars[i + 1].id].sort() as [string, string];
    const [p1, p2, p3] = [pair(0), pair(2), pair(4)];
    for (const p of [p1, p2, p3]) {
      await t.db.query(`insert into relationship_events (character_a, character_b, layer, from_stage, to_stage) values ($1, $2, 'public', 'just_met', 'sparks')`, p);
    }
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ('fan', $1, $2)`, p1);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [p3[0]]);
    await visited("fan", 48);
    const card = (await showSince(t.db, "fan"))!;
    expect(card.moves.map((m) => [m.lo, m.following])).toEqual([
      [p1[0], true],
      [p2[0], false],
    ]);
    expect(card.moves[0].label).toBe("✨ Sparks");
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [p3[0]]);
  });

  it("points at the date the viewers picked the situation for", async () => {
    await visited("fan", 48);
    await t.db.query(
      `insert into situation_nights (day, a_id, b_id, pick, votes, total, party_id) values ('2026-11-01', 'x', 'y', 'rival-spies', 2, 3, 'room-1')`,
    );
    expect((await showSince(t.db, "fan"))!.situation).toEqual({ title: "Rival spies", icon: "🕵️", room_path: "/watch/room-1" });
  });
});
