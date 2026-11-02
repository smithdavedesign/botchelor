import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getCastDate, POST as postCastDate } from "@/app/api/cast-date/route";
import { CAST_DATE_PATH, castDatePrize, claimPrize, lastWeekOf, MIN_EVENTS, pickWeeklyCastDate, PRIZE_DAYS } from "@/lib/cast-date";
import { episodeAllowance } from "@/lib/allowance";
import type { Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, episodeJson, jsonRequest, newUserCookie, scriptedModel, startTestDb, userIdOf, validCharacter } from "./helpers";

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

// A Wednesday: the completed week before it is Mon 2026-10-26 .. Mon 2026-11-02.
const NOW = new Date("2026-11-04T12:00:00Z");
const LAST_WEEK = new Date("2026-10-28T12:00:00Z");

async function withCharacter(db: Db, userId: string) {
  await db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker)
     values ($1, $2, false, $3, 30, 'bio', '[]'::jsonb, 'love', 'rudeness') on conflict (id) do nothing`,
    [`oc-${userId}`, userId, `OC of ${userId}`],
  );
}

async function pageEvents(db: Db, userId: string, n: number, at: Date = LAST_WEEK) {
  for (let i = 0; i < n; i++) {
    await db.query(`insert into web_events (at, visitor, session, user_id, event, path) values ($1, $2, $3, $4, 'page', '/watch')`, [
      new Date(at.getTime() + i * 60_000).toISOString(),
      `v-${userId}`,
      `s-${userId}`,
      userId,
    ]);
  }
}

describe("the weekly earned slot", () => {
  it("knows which week it's earning for", () => {
    const week = lastWeekOf(NOW);
    expect(week.id).toBe("2026-10-26");
    expect(week.end.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("gives last week's most active viewer with a character a cast date to book within two weeks, once, and tells them", async () => {
    await withCharacter(t.db, "fan-1");
    await pageEvents(t.db, "fan-1", MIN_EVENTS + 5);
    await pageEvents(t.db, "no-char", MIN_EVENTS + 20); // more active, but nothing to date with
    await withCharacter(t.db, "admin-1");
    await pageEvents(t.db, "admin-1", MIN_EVENTS + 30);
    await t.db.query(`insert into admins (user_id) values ('admin-1') on conflict do nothing`); // ours never win

    const picked = await pickWeeklyCastDate(t.db, NOW);
    expect(picked).toEqual({ picked: true, week_id: "2026-10-26", user_id: "fan-1", events: MIN_EVENTS + 5 });
    // The prize is a date with the cast, not a generic date: no grant, the allowance untouched.
    expect((await t.db.query(`select 1 from token_grants`)).rows).toHaveLength(0);
    expect((await episodeAllowance(t.db, "fan-1")).pack_left).toBe(0);
    const row = (await t.db.query<{ expires_at: Date }>(`select expires_at from cast_date_weeks where user_id = 'fan-1'`)).rows[0];
    expect(new Date(row.expires_at).getTime() - NOW.getTime()).toBe(PRIZE_DAYS * 24 * 60 * 60 * 1000);
    const notes = (await t.db.query<{ user_id: string; link: string; body: string }>(`select user_id, link, body from notifications where kind = 'cast_date_won'`)).rows;
    expect(notes).toMatchObject([{ user_id: "fan-1", link: CAST_DATE_PATH }]);
    expect(notes[0].body).toMatch(/within 14 days/);

    // Once a week, however often the daily job runs.
    expect(await pickWeeklyCastDate(t.db, NOW)).toEqual({ picked: false, reason: "already" });
    expect((await t.db.query(`select 1 from cast_date_weeks`)).rows).toHaveLength(1);
  });

  it("grants nothing on a quiet week, and a winner sits the next weeks out", async () => {
    await withCharacter(t.db, "fan-1");
    await pageEvents(t.db, "fan-1", MIN_EVENTS - 1);
    expect(await pickWeeklyCastDate(t.db, NOW)).toEqual({ picked: false, reason: "nobody" });

    await pageEvents(t.db, "fan-1", MIN_EVENTS);
    expect((await pickWeeklyCastDate(t.db, NOW)).picked).toBe(true);

    // The next week: fan-1 is the only one active again, but just won, so the slot waits for someone new.
    const NEXT = new Date("2026-11-11T12:00:00Z");
    await withCharacter(t.db, "fan-2");
    await pageEvents(t.db, "fan-1", MIN_EVENTS + 10, new Date("2026-11-04T08:00:00Z"));
    await pageEvents(t.db, "fan-2", MIN_EVENTS, new Date("2026-11-04T08:00:00Z"));
    expect(await pickWeeklyCastDate(t.db, NEXT)).toMatchObject({ picked: true, user_id: "fan-2" });
  });

  it("shows the winner their prize until it lapses, with their characters and this season's cast, and nobody else's", async () => {
    await withCharacter(t.db, "fan-1");
    await pageEvents(t.db, "fan-1", MIN_EVENTS);
    await pickWeeklyCastDate(t.db, NOW);
    const prize = (await castDatePrize(t.db, "fan-1", NOW))!;
    expect(prize.characters.map((c) => c.id)).toEqual(["oc-fan-1"]);
    expect(prize.cast.map((c) => c.id)).toEqual(CAST);
    expect(prize.booked).toBeNull();
    expect(await castDatePrize(t.db, "fan-2", NOW)).toBeNull();
    expect(await castDatePrize(t.db, null, NOW)).toBeNull();
    expect(await castDatePrize(t.db, "fan-1", new Date(NOW.getTime() + (PRIZE_DAYS + 1) * 24 * 60 * 60 * 1000))).toBeNull();
    // Lapsed: nothing to claim.
    expect(await claimPrize(t.db, "fan-1", CAST[0], new Date(NOW.getTime() + (PRIZE_DAYS + 1) * 24 * 60 * 60 * 1000))).toMatchObject({ ok: false, error: "no_prize" });
  });

  it("a week won before the prize was a cast date (it got a grant) shows no prize card", async () => {
    await t.db.query(`insert into cast_date_weeks (week_id, user_id) values ('2026-10-19', 'old-fan')`);
    expect(await castDatePrize(t.db, "old-fan", NOW)).toBeNull();
    expect(await claimPrize(t.db, "old-fan", CAST[0], NOW)).toMatchObject({ ok: false, error: "no_prize" });
  });

  it("books the prize through the normal route, show-paid, only with a season cast member, and only once", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    const mine = await (await api.createCharacter(validCharacter(), cookie)).json();
    const now = new Date();
    await t.db.query(`insert into cast_date_weeks (week_id, user_id, granted_at, expires_at) values ('w1', $1, $2, $3)`, [
      user,
      now.toISOString(),
      new Date(now.getTime() + PRIZE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    ]);
    expect((await getCastDate(new Request("http://localhost:3000/api/cast-date", { headers: { cookie } }))).status).toBe(200);
    const before = await episodeAllowance(t.db, user);

    // Off the cast: refused, and the prize is still there.
    const off = await postCastDate(jsonRequest("/api/cast-date", { character_id: mine.id, cast_id: HOUSE_CHARACTERS[6].id }, { cookie }));
    expect(off.status).toBe(400);
    // A booking that fails (not their character) gives the prize back.
    const notMine = await postCastDate(jsonRequest("/api/cast-date", { character_id: "someone-else", cast_id: CAST[1] }, { cookie }));
    expect(notMine.status).toBe(404);
    expect((await castDatePrize(t.db, user))!.booked).toBeNull();

    scriptedModel([episodeJson()]);
    const res = await postCastDate(jsonRequest("/api/cast-date", { character_id: mine.id, cast_id: CAST[1] }, { cookie }));
    expect(res.status).toBe(201);
    const { episode_id } = await res.json();
    const ep = (await t.db.query<{ character_a: string; character_b: string; visibility: string }>(`select character_a, character_b, visibility from episodes where id = $1`, [episode_id])).rows[0];
    expect([ep.character_a, ep.character_b].sort()).toEqual([mine.id, CAST[1]].sort());
    expect(ep.visibility).toBe("public");
    // Show-paid: none of their own dates went.
    expect(await episodeAllowance(t.db, user)).toEqual(before);
    expect((await castDatePrize(t.db, user))!.booked).toMatchObject({ episode_id });
    // Spent: a second booking finds no prize.
    expect((await postCastDate(jsonRequest("/api/cast-date", { character_id: mine.id, cast_id: CAST[2] }, { cookie }))).status).toBe(404);
  });

  it("a plain booking request can't claim to be the prize", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    const mine = await (await api.createCharacter(validCharacter(), cookie)).json();
    const before = await episodeAllowance(t.db, user);
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: mine.id, partner_id: CAST[1], cast_date: true }, cookie);
    expect(res.status).toBe(200);
    expect((await episodeAllowance(t.db, user)).left).toBe(before.left - 1);
  });

  it("forgets the weeks someone won with their account", async () => {
    await withCharacter(t.db, "fan-1");
    await pageEvents(t.db, "fan-1", MIN_EVENTS);
    await pickWeeklyCastDate(t.db, NOW);
    const { deleteAccount } = await import("@/lib/account");
    await deleteAccount(t.db, "fan-1");
    expect((await t.db.query(`select 1 from cast_date_weeks`)).rows).toHaveLength(0);
  });
});
