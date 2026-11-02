import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chemistryShifts, runningChemistry } from "@/lib/chemistry-shifts";
import { setupEpisode, startTestDb } from "./helpers";

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

const DAY = 24 * 60 * 60 * 1000;

/** One couple (a fresh character and the house partner) with dates aired `daysAgo` with each final chemistry. */
async function couple(dates: [daysAgo: number, chemistry: number][]) {
  const { episode } = await setupEpisode("friends");
  for (const [i, [daysAgo, chemistry]] of dates.entries()) {
    const id = i === 0 ? episode.id : `${episode.id}-${i}`;
    if (i > 0) {
      await t.db.query(`create temp table copy_ep as select * from episodes where id = $1`, [episode.id]);
      await t.db.query(`update copy_ep set id = $1`, [id]);
      await t.db.query(`insert into episodes select * from copy_ep`);
      await t.db.query(`drop table copy_ep`);
    }
    const at = new Date(Date.now() - daysAgo * DAY).toISOString();
    await t.db.query(
      `update episodes set created_at = $2, revealed_at = $2, visibility = 'public',
              box_score = jsonb_build_object('chemistry', jsonb_build_object('start', 50, 'final', $3::int, 'delta', 0))
        where id = $1`,
      [id, at, chemistry],
    );
  }
  return episode;
}

describe("the week's chemistry shifts", () => {
  it("runs the meter like the couple page: each date pulls it halfway", () => {
    expect(runningChemistry([])).toBeNull();
    expect(runningChemistry([40, null, 80])).toBe(60);
  });

  it("lists couples whose meter moved with this week's public dates, both ways, biggest first", async () => {
    const warm = await couple([[20, 40], [2, 80]]); // 40 → 60
    const cold = await couple([[20, 70], [10, 70], [1, 30]]); // 70 → 50
    await couple([[2, 90]]); // first date this week: no meter before it
    await couple([[30, 20], [20, 90]]); // nothing this week
    const shifts = await chemistryShifts(t.db);
    expect(shifts.up.map((s) => [s.before, s.now, s.shift])).toEqual([[40, 60, 20]]);
    expect(shifts.down.map((s) => [s.before, s.now, s.shift])).toEqual([[70, 50, -20]]);
    expect(shifts.up[0].a).toBeTruthy();
    // A private date doesn't move the public meter.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [`${warm.id}-1`]);
    expect((await chemistryShifts(t.db)).up).toEqual([]);
    // Nor does a character made private.
    const side = (await t.db.query<{ id: string }>(`select character_a as id from episodes where id = $1`, [cold.id])).rows[0].id;
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [side]);
    expect((await chemistryShifts(t.db)).down).toEqual([]);
  });
});
