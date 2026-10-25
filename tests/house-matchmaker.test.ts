import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dailyMatchmakerPicks } from "@/lib/house-matchmaker";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

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

/** A character that's in the dating pool: created through the real route, then opened to dates. */
async function open(name: string, cookie: string): Promise<string> {
  const c = await (await api.createCharacter(validCharacter({ name }), cookie)).json();
  await t.db.query(`update characters set open_to_dates = true where id = $1`, [c.id]);
  return c.id as string;
}

describe("the house matchmaker (lib/house-matchmaker)", () => {
  it("proposes a mutual pair once, tells both owners why, and never repeats it", async () => {
    const [ann, bob] = [newUserCookie(), newUserCookie()];
    const ada = await open("Ada Lumen", ann);
    const bo = await open("Bo Quill", bob); // validCharacter shares traits, so the pair scores both ways

    const now = new Date("2026-10-25T18:00:00Z");
    expect(await dailyMatchmakerPicks(t.db, now)).toBe(1);
    const pick = (await t.db.query<{ character_lo: string; character_hi: string; mutual: number }>(`select * from matchmaker_picks`)).rows;
    expect(pick).toHaveLength(1);
    expect([pick[0].character_lo, pick[0].character_hi].sort()).toEqual([ada, bo].sort());
    expect(pick[0].mutual).toBeGreaterThanOrEqual(4);

    // Both owners hear why, with the other character linked.
    const notes = (
      await t.db.query<{ user_id: string; title: string; body: string; link: string }>(`select user_id, title, body, link from notifications where kind = 'matchmaker_pick' order by user_id`)
    ).rows;
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.user_id))).toEqual(new Set([userIdOf(ann), userIdOf(bob)]));
    for (const n of notes) {
      expect(n.title).toContain("matchmaker");
      expect(n.body).toMatch(/Why: .+swipe/s);
      expect(n.link).toMatch(/^\/characters\//);
    }

    // The same day: the job already ran. A later day: this pair is never proposed again.
    expect(await dailyMatchmakerPicks(t.db, now)).toBe(0);
    expect(await dailyMatchmakerPicks(t.db, new Date("2026-10-26T18:00:00Z"))).toBe(0);
    expect((await t.db.query(`select 1 from matchmaker_picks`)).rows).toHaveLength(1);
  });

  it("never proposes across a block, and never pairs one owner's own characters", async () => {
    const [ann, bob] = [newUserCookie(), newUserCookie()];
    await open("Ada Lumen", ann);
    await open("Avery Moss", ann); // same owner as Ada: never paired together
    await open("Bo Quill", bob);
    await t.db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [userIdOf(ann), userIdOf(bob)]);
    expect(await dailyMatchmakerPicks(t.db, new Date("2026-10-25T18:00:00Z"))).toBe(0);
    expect((await t.db.query(`select 1 from notifications where kind = 'matchmaker_pick'`)).rows).toHaveLength(0);
  });

  it("skips a pair the deck already matched", async () => {
    const [ann, bob] = [newUserCookie(), newUserCookie()];
    const ada = await open("Ada Lumen", ann);
    const bo = await open("Bo Quill", bob);
    const [lo, hi] = ada < bo ? [ada, bo] : [bo, ada];
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    expect(await dailyMatchmakerPicks(t.db, new Date("2026-10-25T18:00:00Z"))).toBe(0);
  });
});
