import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forgetTouchesForTests } from "@/lib/activity";
import { castSecrets, cleanSecret, dealtSecrets, ensureCastSecrets, newestSecretOut, parseSecrets, SECRET_EVERY, SECRET_POOL, SECRETS_PER_CAST } from "@/lib/cast-secrets";
import type { Model } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonIdOf } from "@/lib/season-window";
import { showSince } from "@/lib/show-since";
import { HOUSE_PARTNER_ID, setupEpisode, startTestDb } from "./helpers";

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
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
});
afterEach(() => {
  setSeasonCastForTests(null);
});

const MIN = 60 * 1000;

/** `n` public dates of the house partner's that aired this season, a minute apart, the newest `endMinsAgo` ago. */
async function aired(n: number, endMinsAgo = 1) {
  const { episode } = await setupEpisode("friends");
  for (let i = 0; i < n; i++) {
    const id = i === 0 ? episode.id : `${episode.id}-${i}`;
    if (i > 0) {
      await t.db.query(`create temp table copy_ep as select * from episodes where id = $1`, [episode.id]);
      await t.db.query(`update copy_ep set id = $1`, [id]);
      await t.db.query(`insert into episodes select * from copy_ep`);
      await t.db.query(`drop table copy_ep`);
    }
    const at = new Date(Date.now() - (endMinsAgo + n - 1 - i) * MIN).toISOString();
    await t.db.query(`update episodes set revealed_at = $2, visibility = 'public' where id = $1`, [id, at]);
  }
  return episode;
}

const writes = (reply: string) => {
  const calls: number[] = [];
  const model: Model = { complete: async () => (calls.push(1), reply) };
  return { model, calls };
};

const GOOD = JSON.stringify({ secrets: ["Has never once won at musical chairs", "Keeps a diary written entirely in emoji", "Still can't fold a fitted sheet"] });

describe("the cast's secrets", () => {
  it("deals three different pool secrets per cast member, the same all season", () => {
    const s = dealtSecrets(HOUSE_PARTNER_ID, "2026-11-01");
    expect(new Set(s).size).toBe(SECRETS_PER_CAST);
    expect(s.every((x) => SECRET_POOL.includes(x))).toBe(true);
    expect(dealtSecrets(HOUSE_PARTNER_ID, "2026-11-01")).toEqual(s);
  });

  it("keeps only short, PG lines about nobody real from the model", () => {
    expect(cleanSecret("Still can't fold a fitted sheet.")).toBe("Still can't fold a fitted sheet");
    expect(cleanSecret("Once had dinner with Barack Obama")).toBeNull();
    expect(cleanSecret("Loves a steamy night in bed together")).toBeNull();
    expect(cleanSecret("x".repeat(200))).toBeNull();
    expect(cleanSecret(42)).toBeNull();
    expect(parseSecrets(`Sure! ${GOOD}`)).toHaveLength(3);
    expect(parseSecrets(JSON.stringify({ secrets: ["Has never once won at musical chairs", "Once had dinner with Barack Obama"] }))).toBeNull();
    expect(parseSecrets("no json")).toBeNull();
  });

  it("is only for this season's cast, and one comes out for every few public dates", async () => {
    setSeasonCastForTests(["someone-else"]);
    expect(await castSecrets(t.db, HOUSE_PARTNER_ID)).toBeNull();
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    expect(await castSecrets(t.db, HOUSE_PARTNER_ID)).toMatchObject({ total: 3, out: [], next_in: SECRET_EVERY });

    const first = await aired(SECRET_EVERY + 1);
    const s = (await castSecrets(t.db, HOUSE_PARTNER_ID))!;
    expect(s.out).toHaveLength(1);
    expect(s.out[0].secret).toBe(dealtSecrets(HOUSE_PARTNER_ID, seasonIdOf(new Date()))[0]);
    expect(s.next_in).toBe(SECRET_EVERY - 1);
    // When it came out: the date that made it SECRET_EVERY.
    const fourth = (await t.db.query<{ revealed_at: Date }>(`select revealed_at from episodes where id = $1`, [`${first.id}-${SECRET_EVERY - 1}`])).rows[0];
    expect(new Date(s.out[0].at).getTime()).toBe(new Date(fourth.revealed_at).getTime());

    // A private date doesn't count.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [first.id]);
    expect((await castSecrets(t.db, HOUSE_PARTNER_ID))!.next_in).toBe(SECRET_EVERY);
  });

  it("all come out, and no more, after enough dates", async () => {
    await aired(SECRET_EVERY * SECRETS_PER_CAST + 2);
    const s = (await castSecrets(t.db, HOUSE_PARTNER_ID))!;
    expect(s.out).toHaveLength(SECRETS_PER_CAST);
    expect(s.next_in).toBeNull();
  });

  it("writes them once a season on the show's model, and falls back to the pool", async () => {
    const good = writes(GOOD);
    expect(await ensureCastSecrets(t.db, new Date(), good.model)).toEqual({ model: 1, pool: 0 });
    expect(await ensureCastSecrets(t.db, new Date(), good.model)).toEqual({ model: 0, pool: 0 });
    expect(good.calls).toHaveLength(1);
    await aired(SECRET_EVERY);
    expect((await castSecrets(t.db, HOUSE_PARTNER_ID))!.out[0].secret).toBe("Has never once won at musical chairs");

    await t.db.query(`delete from cast_secrets`);
    expect(await ensureCastSecrets(t.db, new Date(), writes("not json").model)).toEqual({ model: 0, pool: 1 });
    const stored = (await t.db.query<{ secret: string; source: string }>(`select secret, source from cast_secrets order by idx`)).rows;
    expect(stored.map((r) => r.secret)).toEqual(dealtSecrets(HOUSE_PARTNER_ID, seasonIdOf(new Date())));
    expect(stored.every((r) => r.source === "pool")).toBe(true);
  });

  it("keeps the pool's when one already came out before the model wrote any", async () => {
    await aired(SECRET_EVERY);
    const good = writes(GOOD);
    expect(await ensureCastSecrets(t.db, new Date(), good.model)).toEqual({ model: 0, pool: 1 });
    expect(good.calls).toHaveLength(0);
  });

  it("says in what happened on the show when one came out since your last visit", async () => {
    await t.db.query(`insert into owner_activity (user_id, last_seen) values ('fan', now() - interval '2 days')`);
    expect(await newestSecretOut(t.db, new Date(Date.now() - 60 * MIN))).toBeNull();
    await aired(SECRET_EVERY);
    const out = (await newestSecretOut(t.db, new Date(Date.now() - 60 * MIN)))!;
    expect(out).toMatchObject({ character_id: HOUSE_PARTNER_ID, index: 1, total: 3 });
    expect((await showSince(t.db, "fan"))!.secret).toMatchObject({ character_id: HOUSE_PARTNER_ID, index: 1 });
    // Not again once you've been since.
    expect(await newestSecretOut(t.db, new Date())).toBeNull();
  });
});
