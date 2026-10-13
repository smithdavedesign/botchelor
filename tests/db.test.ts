import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureSchema, getDb, pgliteDb, pgPoolDb, setDbForTests } from "@/lib/db";
import { ENDINGS, getEpisodeView, getPoints } from "@/lib/game";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { CATALOG, ITEM_KINDS } from "@/lib/catalog";
import { ORDER_STATUSES } from "@/lib/payments";
import { DRAMA_ANSWERS, DRAMA_QUESTIONS, REPORT_REASONS } from "@/lib/rules";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const insertCharacter = (id: string, age: number) =>
  t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker)
     values ($1, 'owner', false, 'X', $2, 'b', '["a","b","c"]'::jsonb, 'w', 'd')`,
    [id, age],
  );

describe("schema", () => {
  it("is idempotent", async () => {
    await ensureSchema(t.db);
    await ensureSchema(t.db);
    expect(await t.count("characters", "is_house and premium_sku is null")).toBe(3);
    expect(await t.count("characters", "is_house")).toBe(3 + PREMIUM_HOUSE_CHARACTERS.length);
  });

  // M1 seeded exactly three house characters. M3 adds premium ones, so this counts the three free ones;
  // the premium ones are checked below.
  it("seeds exactly three free, labeled, adult house characters", async () => {
    expect(HOUSE_CHARACTERS).toHaveLength(3);
    const { rows } = await t.db.query<{ id: string; name: string; age: number; owner_id: string | null }>(
      "select id, name, age, owner_id from characters where is_house and premium_sku is null order by id",
    );
    expect(rows.map((r) => r.id).sort()).toEqual(HOUSE_CHARACTERS.map((c) => c.id).sort());
    for (const row of rows) {
      expect(row.owner_id).toBeNull();
      expect(row.age).toBeGreaterThanOrEqual(18);
    }
  });

  it("seeds every premium house character as a labeled, ownerless adult tagged with its catalog SKU", async () => {
    const { rows } = await t.db.query<{ id: string; age: number; owner_id: string | null; premium_sku: string }>(
      "select id, age, owner_id, premium_sku from characters where premium_sku is not null order by id",
    );
    const items = CATALOG.filter((i) => i.kind === "house_character");
    expect(rows.map((r) => [r.id, r.premium_sku]).sort()).toEqual(items.map((i) => [i.character_id, i.sku]).sort());
    for (const row of rows) {
      expect(row.owner_id).toBeNull();
      expect(row.age).toBeGreaterThanOrEqual(18);
    }
  });

  it("refuses an under-18 character even if the API check is bypassed", async () => {
    await expect(insertCharacter("minor", 17)).rejects.toThrow();
    await insertCharacter("adult", 18);
    expect(await t.count("characters", "id = 'adult'")).toBe(1);
  });

  it("accepts every ending in ENDINGS and refuses anything else", async () => {
    const house = HOUSE_CHARACTERS[0].id;
    const insertEpisode = (id: string, ending: string) =>
      t.db.query(
        `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending)
         values ($1, 'creator', $2, $2, 's', '["a","b"]'::jsonb, '["x","y"]'::jsonb, 't', 'f', $3)`,
        [id, house, ending],
      );
    for (const ending of ENDINGS) await insertEpisode(`ep-${ending}`, ending);
    await expect(insertEpisode("ep-bad", "married")).rejects.toThrow();

    for (const pick of ENDINGS) {
      await t.db.query("insert into predictions (episode_id, user_id, pick) values ($1, $2, $3)", [
        "ep-friends",
        `user-${pick}`,
        pick,
      ]);
    }
    await expect(
      t.db.query("insert into predictions (episode_id, user_id, pick) values ('ep-friends', 'u', 'married')"),
    ).rejects.toThrow();
  });
});

describe("schema (M2)", () => {
  const house = HOUSE_CHARACTERS[0].id;
  const insertEpisode = (id: string, question: string | null, answer: string | null) =>
    t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                             drama_question, drama_answer)
       values ($1, 'creator', $2, $2, 's', '["a","b"]'::jsonb, '["x","y"]'::jsonb, 't', 'f', 'friends', $3, $4)`,
      [id, house, question, answer],
    );

  it("accepts every drama question, drama answer and report reason in lib/rules, and refuses others", async () => {
    for (const question of DRAMA_QUESTIONS) {
      for (const answer of DRAMA_ANSWERS) await insertEpisode(`ep2-${question}-${answer}`, question, answer);
    }
    await insertEpisode("ep2-legacy", null, null);
    await expect(insertEpisode("ep2-bad-q", "who_cries", "a")).rejects.toThrow();
    await expect(insertEpisode("ep2-bad-a", "rejected", "c")).rejects.toThrow();

    const episode = `ep2-${DRAMA_QUESTIONS[0]}-${DRAMA_ANSWERS[0]}`;
    for (const pick of DRAMA_ANSWERS) {
      await t.db.query("insert into predictions (episode_id, user_id, pick, drama_pick) values ($1, $2, 'friends', $3)", [
        episode,
        `drama-${pick}`,
        pick,
      ]);
    }
    await expect(
      t.db.query("insert into predictions (episode_id, user_id, pick, drama_pick) values ($1, 'u2', 'friends', 'c')", [episode]),
    ).rejects.toThrow();

    for (const reason of REPORT_REASONS) {
      await t.db.query("insert into reports (episode_id, reporter_id, reason) values ($1, $2, $3)", [
        episode,
        `reporter-${reason}`,
        reason,
      ]);
    }
    await expect(
      t.db.query("insert into reports (episode_id, reporter_id, reason) values ($1, 'r', 'boring')", [episode]),
    ).rejects.toThrow();
  });

  it("refuses a second report or consent from the same user, and a self-block", async () => {
    await insertEpisode("ep2-dupes", "rejected", "a");
    const report = () =>
      t.db.query("insert into reports (episode_id, reporter_id, reason) values ('ep2-dupes', 'same', 'other')");
    await report();
    await expect(report()).rejects.toThrow();
    const consent = () => t.db.query("insert into identity_consents (episode_id, user_id) values ('ep2-dupes', 'same')");
    await consent();
    await expect(consent()).rejects.toThrow();
    await t.db.query("insert into blocks (blocker_id, via_episode_id, blocked_id) values ('me', 'ep2-dupes', 'them')");
    await expect(
      t.db.query("insert into blocks (blocker_id, via_episode_id, blocked_id) values ('me', 'ep2-dupes', 'me')"),
    ).rejects.toThrow();
  });

  it("upgrades an M1 database in place, keeping its episodes and predictions", async () => {
    const pg = new PGlite();
    const old = pgliteDb(pg);
    try {
      await old.exec(M1_SCHEMA);
      await old.exec(`
        insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker)
        values ('oc', 'u1', false, 'Mira', 30, 'b', '["a","b","c"]', 'w', 'd'),
               ('house-x', null, true, 'H', 40, 'b', '["a","b","c"]', 'w', 'd');
        insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at)
        values ('old-ep', 'u1', 'oc', 'house-x', 's', '["a","b"]', '["x","y"]', 't', 'f', 'friends', now());
        insert into predictions (episode_id, user_id, pick) values ('old-ep', 'u2', 'friends');
      `);
      await ensureSchema(old);
      await ensureSchema(old); // idempotent on an upgraded database too
      const { rows } = await old.query<{ drama_question: string | null; drama_pick: string | null }>(
        `select e.drama_question, p.drama_pick from episodes e join predictions p on p.episode_id = e.id where e.id = 'old-ep'`,
      );
      expect(rows).toEqual([{ drama_question: null, drama_pick: null }]);
      expect(await getPoints(old, "u2")).toBe(10);
      expect(await getEpisodeView(old, "old-ep", "u2")).toMatchObject({ drama_question: null, my_points: 10, hidden: false });
    } finally {
      await pg.close();
    }
  });
});

describe("schema (M3)", () => {
  const insertOrder = (id: string, fields: { kind?: string; status?: string; amount?: number; currency?: string } = {}) =>
    t.db.query(
      `insert into orders (id, user_id, sku, kind, amount_cents, currency, status)
       values ($1, 'buyer', 'frame_rose', $2, $3, $4, $5)`,
      [id, fields.kind ?? "frame", fields.amount ?? 200, fields.currency ?? "usd", fields.status ?? "pending"],
    );

  it("accepts every order status and item kind in lib, and refuses others, zero amounts and other currencies", async () => {
    for (const status of ORDER_STATUSES) {
      for (const kind of ITEM_KINDS) await insertOrder(`o-${status}-${kind}`, { status, kind });
    }
    await expect(insertOrder("o-bad-status", { status: "gifted" })).rejects.toThrow();
    await expect(insertOrder("o-bad-kind", { kind: "points" })).rejects.toThrow();
    await expect(insertOrder("o-zero", { amount: 0 })).rejects.toThrow();
    await expect(insertOrder("o-negative", { amount: -200 })).rejects.toThrow();
    await expect(insertOrder("o-eur", { currency: "eur" })).rejects.toThrow();
  });

  it("keeps one waitlist row per email and one order per Stripe session", async () => {
    await t.db.query("insert into waitlist (email) values ('a@example.com')");
    await expect(t.db.query("insert into waitlist (email) values ('a@example.com')")).rejects.toThrow();
    await insertOrder("o-session-1");
    await insertOrder("o-session-2");
    await t.db.query("update orders set stripe_session_id = 'cs_test_same' where id = 'o-session-1'");
    await expect(t.db.query("update orders set stripe_session_id = 'cs_test_same' where id = 'o-session-2'")).rejects.toThrow();
  });

  it("upgrades an M1 database in place with the premium characters, orders and waitlist", async () => {
    const pg = new PGlite();
    const old = pgliteDb(pg);
    try {
      await old.exec(M1_SCHEMA);
      await ensureSchema(old);
      await ensureSchema(old);
      const { rows } = await old.query<{ n: number }>("select count(*)::int as n from characters where premium_sku is not null");
      expect(rows[0].n).toBe(PREMIUM_HOUSE_CHARACTERS.length);
      await old.query(
        "insert into orders (id, user_id, sku, kind, amount_cents, currency) values ('o', 'u', 'frame_rose', 'frame', 200, 'usd')",
      );
      await old.query("insert into waitlist (email) values ('b@example.com')");
    } finally {
      await pg.close();
    }
  });
});

describe("schema (M4)", () => {
  it("accepts an episode_pack order with a positive episode count, and refuses zero or negative counts", async () => {
    const insertPack = (id: string, episodes: number) =>
      t.db.query(
        `insert into orders (id, user_id, sku, kind, amount_cents, currency, episodes)
         values ($1, 'buyer', 'pack_10', 'episode_pack', 500, 'usd', $2)`,
        [id, episodes],
      );
    await insertPack("o4-pack", 10);
    await expect(insertPack("o4-zero", 0)).rejects.toThrow();
    await expect(insertPack("o4-negative", -10)).rejects.toThrow();
  });

  it("keeps badge places between 1 and 3 with positive points, one badge per member per league per season", async () => {
    await t.db.query("insert into leagues (id, name, owner_id) values ('l4', 'L', 'owner')");
    const insertBadge = (user: string, place: number, points: number) =>
      t.db.query(
        "insert into badges (season_id, league_id, user_id, place, points) values ('2026-10-12', 'l4', $1, $2, $3)",
        [user, place, points],
      );
    for (const place of [1, 2, 3]) await insertBadge(`u${place}`, place, 10);
    await expect(insertBadge("u4", 4, 10)).rejects.toThrow();
    await expect(insertBadge("u0", 0, 10)).rejects.toThrow();
    await expect(insertBadge("u5", 1, 0)).rejects.toThrow();
    await expect(insertBadge("u1", 2, 5)).rejects.toThrow();
  });

  it("never lets a usage counter go negative", async () => {
    await expect(
      t.db.query("insert into free_episode_usage (user_id, season_id, used) values ('u', '2026-10-12', -1)"),
    ).rejects.toThrow();
    await expect(t.db.query("insert into pack_episode_usage (user_id, used) values ('u', -1)")).rejects.toThrow();
  });

  it("upgrades an M3 database in place: its orders table then accepts episode packs", async () => {
    const pg = new PGlite();
    const old = pgliteDb(pg);
    try {
      await old.exec(M1_SCHEMA);
      // The orders table exactly as M3 shipped it, with the two-kind CHECK.
      await old.exec(`
        create table orders (
          id text primary key, user_id text not null, sku text not null,
          kind text not null check (kind in ('house_character', 'frame')),
          amount_cents integer not null check (amount_cents > 0), currency text not null check (currency = 'usd'),
          status text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
          stripe_session_id text unique, created_at timestamptz not null default now(), paid_at timestamptz
        );
        insert into orders (id, user_id, sku, kind, amount_cents, currency, status)
        values ('m3-order', 'u', 'frame_rose', 'frame', 200, 'usd', 'paid');
      `);
      await ensureSchema(old);
      await ensureSchema(old);
      await old.query(
        `insert into orders (id, user_id, sku, kind, amount_cents, currency, episodes)
         values ('m4-pack', 'u', 'pack_10', 'episode_pack', 500, 'usd', 10)`,
      );
      await expect(
        old.query("insert into orders (id, user_id, sku, kind, amount_cents, currency) values ('bad', 'u', 'x', 'points', 1, 'usd')"),
      ).rejects.toThrow();
      const { rows } = await old.query<{ n: number }>("select count(*)::int as n from orders");
      expect(rows[0].n).toBe(2);
    } finally {
      await pg.close();
    }
  });
});

// The M1 schema exactly as it shipped, to prove ensureSchema upgrades it in place.
const M1_SCHEMA = `
create table characters (
  id text primary key, owner_id text, is_house boolean not null default false, name text not null,
  age integer not null check (age >= 18), bio text not null, traits jsonb not null, want text not null,
  dealbreaker text not null, created_at timestamptz not null default now(), check (is_house or owner_id is not null)
);
create index characters_owner_idx on characters (owner_id);
create table episodes (
  id text primary key, creator_id text not null, character_a text not null references characters (id),
  character_b text not null references characters (id), setting text not null, goals jsonb not null,
  scenes jsonb not null, twist text not null, finale text not null,
  ending text not null check (ending in ('second_date', 'friends', 'disaster')), revealed_at timestamptz,
  created_at timestamptz not null default now()
);
create table predictions (
  episode_id text not null references episodes (id) on delete cascade, user_id text not null,
  pick text not null check (pick in ('second_date', 'friends', 'disaster')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);
create index predictions_user_idx on predictions (user_id);
`;

describe("getDb", () => {
  it("never falls back to a throwaway local database on Vercel, and retries after a failed open", async () => {
    setDbForTests(null);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL", "1");
    try {
      const first = getDb();
      await expect(first).rejects.toThrow(/DATABASE_URL is not configured/);
      const second = getDb();
      expect(second).not.toBe(first); // the failed attempt was not cached
      await expect(second).rejects.toThrow(/DATABASE_URL is not configured/);
    } finally {
      vi.unstubAllEnvs();
      setDbForTests(t.db);
    }
  });
});

describe("pgPoolDb", () => {
  it("passes parameterized queries and multi-statement DDL straight to the pool", async () => {
    const query = vi.fn(async () => ({ rows: [{ n: 1 }] }));
    const db = pgPoolDb({ query } as unknown as Pool);
    expect(await db.query("select $1::int as n", [1])).toEqual({ rows: [{ n: 1 }] });
    await db.exec("select 1; select 2;");
    expect(query).toHaveBeenNthCalledWith(1, "select $1::int as n", [1]);
    expect(query).toHaveBeenNthCalledWith(2, "select 1; select 2;");
  });
});
