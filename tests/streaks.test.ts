import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listNotifications } from "@/lib/notifications";
import { callersBoard, callRecord, recordLine, recordOf, runNote } from "@/lib/streaks";
import type { Ending } from "@/lib/rules";
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
});

describe("a caller's record", () => {
  it("counts right calls, the run up to the latest and the best run, and the run a miss ended", () => {
    expect(recordOf([])).toEqual({ called: 0, right: 0, streak: 0, best: 0, ended: 0 });
    expect(recordOf([true, true, false, true, true, true])).toEqual({ called: 6, right: 5, streak: 3, best: 3, ended: 0 });
    expect(recordOf([true, true, true, true, false])).toEqual({ called: 5, right: 4, streak: 0, best: 4, ended: 4 });
    expect(recordOf([true, false, false])).toMatchObject({ streak: 0, ended: 0 });
  });

  it("says it in a few words, and adds the run to a scored call's notice", () => {
    expect(recordLine(recordOf([true, false, true, true]))).toBe("3 of 4 right · 2 in a row");
    expect(recordLine(recordOf([true, true, true, false, true]))).toBe("4 of 5 right · best run 3");
    expect(runNote(recordOf([true, true, true]), true)).toBe(" That's 3 in a row.");
    expect(runNote(recordOf([true, true, false]), false)).toBe(" That ends a run of 2.");
    expect(runNote(recordOf([true]), true)).toBe("");
  });
});

/** One public date with `ending`, called by each of `calls` (cookie → pick), then aired. */
async function airedDate(ending: Ending, calls: [string, Ending][]) {
  const { creator, episode } = await setupEpisode(ending);
  for (const [cookie, pick] of calls) expect((await api.predict({ episode_id: episode.id, pick }, cookie)).status).toBe(201);
  expect((await api.reveal(episode.id, creator)).status).toBe(200);
  return episode.id as string;
}

describe("records from aired dates", () => {
  it("builds the record in airing order, from public dates only, and tells the caller their run when a call scores", async () => {
    const fan = newUserCookie();
    await airedDate("friends", [[fan, "friends"]]);
    await airedDate("disaster", [[fan, "disaster"]]);
    expect(await callRecord(t.db, userIdOf(fan))).toMatchObject({ called: 2, right: 2, streak: 2 });
    const notes = await listNotifications(t.db, userIdOf(fan));
    expect(notes.find((n) => n.kind === "prediction_scored" && /in a row/.test(n.body ?? ""))?.body).toMatch(/That's 2 in a row\./);

    await airedDate("friends", [[fan, "second_date"]]);
    expect(await callRecord(t.db, userIdOf(fan))).toMatchObject({ called: 3, right: 2, streak: 0, best: 2, ended: 2 });
    expect((await listNotifications(t.db, userIdOf(fan)))[0].body).toMatch(/That ends a run of 2\./);

    // A private date counts for nothing.
    const priv = await airedDate("friends", [[fan, "friends"]]);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [priv]);
    expect((await callRecord(t.db, userIdOf(fan))).called).toBe(3);
    expect(await callRecord(t.db, null)).toMatchObject({ called: 0 });
  });

  it("ranks this week's callers by right calls, names only those with a display name, and gives your place", async () => {
    const [ana, ben, cy] = [newUserCookie(), newUserCookie(), newUserCookie()];
    await t.db.query(`insert into profiles (user_id, name) values ($1, 'Ana'), ($2, 'Ben')`, [userIdOf(ana), userIdOf(ben)]);
    await airedDate("friends", [[ana, "friends"], [ben, "friends"], [cy, "friends"]]);
    await airedDate("disaster", [[ana, "disaster"], [ben, "friends"]]);
    const board = await callersBoard(t.db, userIdOf(cy));
    // cy has no display name: on the board as "A viewer" (null), never by id.
    expect(board.top.map((e) => [e.name, e.right, e.called, e.mine])).toEqual([
      ["Ana", 2, 2, false],
      [null, 1, 1, true],
      ["Ben", 1, 2, false],
    ]);
    expect(board.callers).toBe(3);
    expect(board.my_rank).toBe(2); // 1 of 1 ranks above Ben's 1 of 2: as many right, fewer misses
    expect((await callersBoard(t.db, userIdOf(ana))).top[0].mine).toBe(true);
    // Last week's calls have dropped off by next week.
    expect((await callersBoard(t.db, null, new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).top).toEqual([]);
  });
});
