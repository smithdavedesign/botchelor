import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { castDateBanner, lastWeekOf, MIN_EVENTS, pickWeeklyCastDate } from "@/lib/cast-date";
import { episodeAllowance } from "@/lib/allowance";
import type { Db } from "@/lib/db";
import { startTestDb } from "./helpers";

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

  it("grants last week's most active viewer with a character one show-paid date, once, and tells them", async () => {
    await withCharacter(t.db, "fan-1");
    await pageEvents(t.db, "fan-1", MIN_EVENTS + 5);
    await pageEvents(t.db, "no-char", MIN_EVENTS + 20); // more active, but nothing to date with
    await withCharacter(t.db, "admin-1");
    await pageEvents(t.db, "admin-1", MIN_EVENTS + 30);
    await t.db.query(`insert into admins (user_id) values ('admin-1') on conflict do nothing`); // ours never win

    const picked = await pickWeeklyCastDate(t.db, NOW);
    expect(picked).toEqual({ picked: true, week_id: "2026-10-26", user_id: "fan-1", events: MIN_EVENTS + 5 });
    // The prize is a granted date, counted like a pack date (lib/allowance.ts), never revenue.
    const grant = (await t.db.query<{ episodes: number; granted_by: string }>(`select episodes, granted_by from token_grants where user_id = 'fan-1'`)).rows;
    expect(grant).toEqual([{ episodes: 1, granted_by: "cast_date_week" }]);
    expect((await episodeAllowance(t.db, "fan-1")).pack_left).toBe(1);
    const notes = (await t.db.query<{ user_id: string; link: string }>(`select user_id, link from notifications where kind = 'cast_date_won'`)).rows;
    expect(notes).toEqual([{ user_id: "fan-1", link: "/characters?tab=cast" }]);

    // Once a week, however often the daily job runs.
    expect(await pickWeeklyCastDate(t.db, NOW)).toEqual({ picked: false, reason: "already" });
    expect((await t.db.query(`select 1 from token_grants`)).rows).toHaveLength(1);
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

  it("shows the winner their banner for a week, and nobody else's", async () => {
    await withCharacter(t.db, "fan-1");
    await pageEvents(t.db, "fan-1", MIN_EVENTS);
    await pickWeeklyCastDate(t.db, NOW);
    expect(await castDateBanner(t.db, "fan-1", NOW)).not.toBeNull();
    expect(await castDateBanner(t.db, "fan-2", NOW)).toBeNull();
    expect(await castDateBanner(t.db, null, NOW)).toBeNull();
    expect(await castDateBanner(t.db, "fan-1", new Date(NOW.getTime() + 9 * 24 * 60 * 60 * 1000))).toBeNull();
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
