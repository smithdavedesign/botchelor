import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getBacking, POST as postBacking } from "@/app/api/backing/route";
import { backCastMember, backingBadges, backingBoard, backingLockAt, backingSince, settleDueBackings, settleSeasonBackings } from "@/lib/backing";
import { getPointsBreakdown } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { POINTS_PER_BACKING } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { jsonRequest, newUserCookie, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests(CAST);
});
afterEach(() => setSeasonCastForTests(null));

// November 2026 is a monthly season (2026-11-01 .. 2026-12-01); picks lock halfway, on the 16th.
const EARLY = new Date("2026-11-05T12:00:00Z");
const LATE = new Date("2026-11-20T12:00:00Z");
const AFTER = new Date("2026-12-02T12:00:00Z");

describe("backing a cast member", () => {
  it("locks halfway through the season", () => {
    expect(backingLockAt(EARLY).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("takes one pick a viewer, changeable before mid-month, and refuses anyone off the cast", async () => {
    expect(await backCastMember(t.db, "u1", CAST[0], EARLY)).toEqual({ ok: true, character_id: CAST[0] });
    expect(await backCastMember(t.db, "u1", CAST[1], EARLY)).toEqual({ ok: true, character_id: CAST[1] });
    expect(await backCastMember(t.db, "u1", "nobody", EARLY)).toMatchObject({ ok: false, status: 400, error: "not_on_the_cast" });
    const board = (await backingBoard(t.db, "u1", EARLY))!;
    expect(board.my_pick).toBe(CAST[1]);
    expect(board.locked).toBe(false);
    expect(board.total).toBe(1);
    expect(board.cast.find((c) => c.id === CAST[1])!.backers).toBe(1);
  });

  it("after mid-month a pick can't change, but a first pick still lands", async () => {
    await backCastMember(t.db, "u1", CAST[0], EARLY);
    expect(await backCastMember(t.db, "u1", CAST[1], LATE)).toMatchObject({ ok: false, status: 409, error: "pick_locked" });
    expect(await backCastMember(t.db, "u1", CAST[0], LATE)).toEqual({ ok: true, character_id: CAST[0] }); // the same pick is a no-op
    expect(await backCastMember(t.db, "u2", CAST[2], LATE)).toEqual({ ok: true, character_id: CAST[2] });
    const board = (await backingBoard(t.db, "u2", LATE))!;
    expect(board.locked).toBe(true);
    expect(board.my_pick).toBe(CAST[2]);
  });

  it("names the most backed cast member with counts, never who backed them", async () => {
    await backCastMember(t.db, "u1", CAST[0], EARLY);
    await backCastMember(t.db, "u2", CAST[0], EARLY);
    await backCastMember(t.db, "u3", CAST[1], EARLY);
    const board = (await backingBoard(t.db, null, EARLY))!;
    expect(board.most).toMatchObject({ id: CAST[0], backers: 2 });
    expect(board.total).toBe(3);
    expect(JSON.stringify(board)).not.toContain("u1");
  });

  it("votes over the API with the visitor's cookie, and shows the board back", async () => {
    const cookie = newUserCookie();
    const res = await postBacking(jsonRequest("/api/backing", { character_id: CAST[0] }, { cookie }));
    expect(res.status).toBe(201);
    const board = await (await getBacking(new Request("http://localhost:3000/api/backing", { headers: { cookie } }))).json();
    expect(board.my_pick).toBe(CAST[0]);
    expect((await postBacking(jsonRequest("/api/backing", { character_id: "nope" }, { cookie }))).status).toBe(400);
  });
});

describe("settling a season's backings", () => {
  const couple = async (id: string) => {
    const other = HOUSE_CHARACTERS[5].id;
    const [lo, hi] = [id, other].sort();
    await t.db.query(`insert into relationships (character_a, character_b, public_stage) values ($1, $2, 'dating') on conflict do nothing`, [lo, hi]);
  };

  it("settles once when the season closes: points, a badge and a notice for a pick that ended coupled", async () => {
    await backCastMember(t.db, "u1", CAST[0], EARLY);
    await backCastMember(t.db, "u2", CAST[1], EARLY);
    await couple(CAST[0]);
    const settled = await settleSeasonBackings(t.db, "2026-11-01");
    expect(settled).toEqual({ season_id: "2026-11-01", settled: 2, won: 1 });
    // Idempotent: nothing left to settle.
    expect(await settleSeasonBackings(t.db, "2026-11-01")).toEqual({ season_id: "2026-11-01", settled: 0, won: 0 });

    expect((await getPointsBreakdown(t.db, "u1")).backings).toBe(POINTS_PER_BACKING);
    expect((await getPointsBreakdown(t.db, "u2")).backings).toBe(0);
    expect(await backingBadges(t.db, "u1")).toMatchObject([{ season_id: "2026-11-01", character_id: CAST[0] }]);
    expect(await backingBadges(t.db, "u2")).toEqual([]);

    const notes = (await t.db.query<{ user_id: string; title: string }>(`select user_id, title from notifications where kind = 'backing_settled' order by user_id`)).rows;
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toMatch(/coupled up/);
    expect(notes[1].title).toMatch(/single/);
  });

  it("the daily backstop settles every closed season with unsettled picks, and leaves the open one alone", async () => {
    await backCastMember(t.db, "u1", CAST[0], EARLY);
    await couple(CAST[0]);
    expect(await settleDueBackings(t.db, EARLY)).toEqual([]); // November is still running on the 5th
    expect(await settleDueBackings(t.db, AFTER)).toEqual([{ season_id: "2026-11-01", settled: 1, won: 1 }]);
    expect(await settleDueBackings(t.db, AFTER)).toEqual([]);
  });
});

describe("the pick in Since you were here", () => {
  it("counts the pick's public dates aired since the last visit", async () => {
    await backCastMember(t.db, "u1", CAST[0], EARLY);
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at)
       values ('bk-ep-1', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', $3)`,
      [CAST[0], HOUSE_CHARACTERS[5].id, EARLY.toISOString()],
    );
    const since = await backingSince(t.db, "u1", "2026-11-01T00:00:00Z", EARLY);
    expect(since).toMatchObject({ character_id: CAST[0], aired: 1 });
    expect(await backingSince(t.db, "u1", EARLY.toISOString(), EARLY)).toBeNull(); // nothing aired since
    expect(await backingSince(t.db, "u2", "2026-11-01T00:00:00Z", EARLY)).toBeNull(); // no pick
  });
});

describe("forgetting", () => {
  it("deletes a viewer's backings with their account", async () => {
    const cookie = newUserCookie();
    await backCastMember(t.db, userIdOf(cookie), CAST[0], EARLY);
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, userIdOf(cookie));
    expect((await t.db.query("select 1 from cast_backings")).rows).toHaveLength(0);
  });
});
