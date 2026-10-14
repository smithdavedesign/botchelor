import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "./house";

/** The only database surface the app uses: parameterized queries, plus multi-statement DDL. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

export function pgPoolDb(pool: Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
  };
}

export function pgliteDb(pg: PGlite): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pg.query<T>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
  };
}

// Sent as one simple-protocol query, so it runs as a single implicit transaction and the advisory
// lock (an arbitrary app-wide key) stops concurrent cold starts racing on CREATE TABLE IF NOT EXISTS.
const SCHEMA_SQL = `
select pg_advisory_xact_lock(7262011);

create table if not exists characters (
  id text primary key,
  owner_id text,
  is_house boolean not null default false,
  name text not null,
  age integer not null check (age >= 18),
  bio text not null,
  traits jsonb not null,
  want text not null,
  dealbreaker text not null,
  created_at timestamptz not null default now(),
  check (is_house or owner_id is not null)
);
create index if not exists characters_owner_idx on characters (owner_id);

create table if not exists episodes (
  id text primary key,
  creator_id text not null,
  character_a text not null references characters (id),
  character_b text not null references characters (id),
  setting text not null,
  goals jsonb not null,
  scenes jsonb not null,
  twist text not null,
  finale text not null,
  ending text not null check (ending in ('second_date', 'friends', 'disaster')),
  revealed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists predictions (
  episode_id text not null references episodes (id) on delete cascade,
  user_id text not null,
  pick text not null check (pick in ('second_date', 'friends', 'disaster')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);
create index if not exists predictions_user_idx on predictions (user_id);

-- M2. Columns are added with IF NOT EXISTS so an M1 database upgrades in place; M1 episodes keep
-- a null drama question. The CHECK lists mirror lib/rules.ts (tests/db.test.ts catches drift).
alter table episodes add column if not exists drama_question text
  check (drama_question in ('leaves_first', 'rejected'));
alter table episodes add column if not exists drama_answer text
  check (drama_answer in ('a', 'b', 'neither'));
alter table predictions add column if not exists drama_pick text
  check (drama_pick in ('a', 'b', 'neither'));
create index if not exists episodes_created_idx on episodes (created_at desc);

create table if not exists profiles (
  user_id text primary key,
  name text not null,
  attested_adult_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity_consents (
  episode_id text not null references episodes (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);

create table if not exists reports (
  episode_id text not null references episodes (id) on delete cascade,
  reporter_id text not null,
  reason text not null default 'other'
    check (reason in ('sexual', 'minor', 'real_person', 'hateful', 'self_harm', 'other')),
  created_at timestamptz not null default now(),
  primary key (episode_id, reporter_id)
);

-- One row per (blocker, episode blocked from, creator of that episode). Blocks are per episode so
-- nothing a viewer can observe links a creator's other characters or episodes (see lib/game.ts).
create table if not exists blocks (
  blocker_id text not null,
  via_episode_id text not null references episodes (id) on delete cascade,
  blocked_id text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, via_episode_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_pair_idx on blocks (blocker_id, blocked_id);
create index if not exists blocks_blocked_idx on blocks (blocked_id);

create table if not exists leagues (
  id text primary key,
  name text not null,
  owner_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  league_id text not null references leagues (id) on delete cascade,
  user_id text not null,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists league_members_user_idx on league_members (user_id);

-- M3. A premium house character is a house character with the catalog SKU that unlocks it.
alter table characters add column if not exists premium_sku text;

-- Customization (next-level): an optional appearance line and an avatar hue (0/null = auto, derived from id).
-- No image is stored: the avatar is drawn from the character data (lib/avatar.ts), so there is no upload
-- to moderate and no real-person risk.
alter table characters add column if not exists appearance text;
alter table characters add column if not exists avatar_hue smallint
  check (avatar_hue is null or (avatar_hue >= 0 and avatar_hue <= 360));

-- One row per checkout. Our random id (never the session cookie) is what Stripe sees, as the Payment
-- Link's client_reference_id. Ownership is "a paid order"; each Stripe session is recorded on exactly one
-- order (stripe_session_id is unique), so duplicate deliveries are no-ops (lib/payments.ts grantOrder).
-- The CHECK lists mirror lib/catalog.ts and lib/payments.ts.
create table if not exists orders (
  id text primary key,
  user_id text not null,
  sku text not null,
  kind text not null check (kind in ('house_character', 'frame', 'episode_pack')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'usd'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists orders_user_idx on orders (user_id, status);

-- Landing-page waitlist for Season 1. Emails are stored lowercased; nothing is sent from the app.
create table if not exists waitlist (
  email text primary key,
  community text,
  ref text,
  attested_adult_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- M4. Episode packs: a third order kind, carrying the dates it adds (priced from the catalog, like
-- amount_cents). An M3 database has the two-kind CHECK, so it is replaced in place, once.
alter table orders add column if not exists episodes integer check (episodes > 0);
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'orders'::regclass and conname = 'orders_kind_check'
       and pg_get_constraintdef(oid) like '%episode_pack%'
  ) then
    alter table orders drop constraint if exists orders_kind_check;
    alter table orders add constraint orders_kind_check check (kind in ('house_character', 'frame', 'episode_pack'));
  end if;
end $$;

-- Closing a season looks for finales aired since the last closed season (lib/seasons.ts).
create index if not exists episodes_revealed_idx on episodes (revealed_at) where revealed_at is not null;

-- A closed season (the leaderboard week). Only closed seasons are stored; the open one is computed.
create table if not exists seasons (
  id text primary key check (id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  closed_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- The top 3 of each league when a season closes (Olympic places, so ties share). PODIUM_SIZE in lib/rules.ts.
create table if not exists badges (
  season_id text not null,
  league_id text not null references leagues (id) on delete cascade,
  user_id text not null,
  place smallint not null check (place between 1 and 3),
  points integer not null check (points > 0),
  primary key (season_id, league_id, user_id)
);
create index if not exists badges_user_idx on badges (user_id);

-- Dates used, as counters so a conditional upsert can reserve one atomically (lib/allowance.ts):
-- free dates per season, and pack dates for good (bought = Σ episodes of paid episode_pack orders).
create table if not exists free_episode_usage (
  user_id text not null,
  season_id text not null,
  used integer not null check (used >= 0),
  primary key (user_id, season_id)
);
create table if not exists pack_episode_usage (
  user_id text primary key,
  used integer not null check (used >= 0)
);

-- Full $0 vision (PRD "Soul vs. Persona"). All added with IF NOT EXISTS / IF NOT EXISTS tables so a
-- live M4 database upgrades in place with no migration step.

-- The private soul: owner-only personal data (PRD guardrail). Never returned to spectators. Deleted
-- with its character. The engine (lib/engine.ts) derives signals from it; the model is given it as
-- behaviour guidance but told never to reveal it.
create table if not exists souls (
  character_id text primary key references characters (id) on delete cascade,
  values text not null default '',
  insecurities text not null default '',
  humor text not null default '',
  boundaries text not null default '',
  romantic text not null default '',
  communication text not null default '',
  updated_at timestamptz not null default now()
);
-- Keep a soul off the model entirely (engine-only). Added later; defaults to false so existing souls behave as before.
alter table souls add column if not exists local_only boolean not null default false;

-- The engine's decided outcome and the date's settings, stored on the episode. ending / drama_question
-- / drama_answer already exist (now written by the engine, not the model). seed is bigint: it is a
-- uint32 and Sliding Doors replays from it.
alter table episodes add column if not exists seed bigint;
alter table episodes add column if not exists box_score jsonb;      -- the four VariableArcs
alter table episodes add column if not exists sides jsonb;          -- the two SideOutcomes (debrief data)
alter table episodes add column if not exists best_line text;
alter table episodes add column if not exists confessionals jsonb;  -- [character_a line, character_b line]
alter table episodes add column if not exists confessionals_shared boolean not null default false;
alter table episodes add column if not exists setup jsonb;          -- autonomy, strategy, agendas, budgets
alter table episodes add column if not exists note text;            -- owner-only: the note in the pocket
alter table episodes add column if not exists self_pick text
  check (self_pick in ('second_date', 'friends', 'disaster'));      -- owner's guess at their own AI's ending
-- Sliding Doors: a replay episode points back at the one it varies, and says what it changed.
alter table episodes add column if not exists varies_episode_id text references episodes (id) on delete set null;
alter table episodes add column if not exists variation text;

-- Guess the dealbreaker (PRD "Further ideas"): a spectator picks character_a's real dealbreaker from
-- four options. Correct = it equals the stored dealbreaker, scored at reveal like the drama pick.
create table if not exists dealbreaker_guesses (
  episode_id text not null references episodes (id) on delete cascade,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);

-- Matchmakers (PRD "Further ideas"): a spectator proposes a pairing of two characters and earns points
-- if a date between them ends in a second date. One proposal per spectator per unordered pair.
create table if not exists matchmaker_proposals (
  id text primary key,
  proposer_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (character_a <> character_b)
);
create unique index if not exists matchmaker_unique
  on matchmaker_proposals (proposer_id, least(character_a, character_b), greatest(character_a, character_b));

-- Persistent relationships (PRD "a persistent relationship universe"): one row per unordered pair,
-- character_a < character_b. Fed back into the engine and the narration so repeat dates remember.
create table if not exists relationships (
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  dates integer not null default 0,
  second_dates integer not null default 0,
  last_ending text,
  updated_at timestamptz not null default now(),
  primary key (character_a, character_b),
  check (character_a < character_b)
);
`;

/** Idempotent: creates the tables and upserts the house characters, free and premium. */
export async function ensureSchema(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
  const cast = [
    ...HOUSE_CHARACTERS.map((c) => ({ ...c, sku: null })),
    ...PREMIUM_HOUSE_CHARACTERS.map((c) => ({ ...c, sku: c.sku })),
  ];
  for (const c of cast) {
    await db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, premium_sku)
       values ($1, null, true, $2, $3, $4, $5::jsonb, $6, $7, $8)
       on conflict (id) do update set
         owner_id = null, is_house = true, name = excluded.name, age = excluded.age, bio = excluded.bio,
         traits = excluded.traits, want = excluded.want, dealbreaker = excluded.dealbreaker,
         premium_sku = excluded.premium_sku`,
      [c.id, c.name, c.age, c.bio, JSON.stringify(c.traits), c.want, c.dealbreaker, c.sku],
    );
  }
}

// PGLITE_DIR lets a throwaway run (scripts/screenshots.mjs) keep its sample data apart from yours.
const DEFAULT_LOCAL_DATA_DIR = ".data/pglite";
const POOL_SIZE = 3;

async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    return pgPoolDb(new Pool({ connectionString: url, max: POOL_SIZE }));
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL is not configured for this deployment");
  // Local runs without a database: a file-backed Postgres (PGlite) under .data/.
  const [{ PGlite }, { mkdirSync }] = await Promise.all([import("@electric-sql/pglite"), import("node:fs")]);
  const dir = process.env.PGLITE_DIR || DEFAULT_LOCAL_DATA_DIR;
  mkdirSync(dir, { recursive: true });
  return pgliteDb(new PGlite(dir));
}

let testDb: Db | null = null;

export function setDbForTests(db: Db | null): void {
  testDb = db;
}

// Cached on globalThis so dev-server hot reloads reuse one pool / one PGlite instance.
const cache = globalThis as typeof globalThis & { __botchelorDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (testDb) return Promise.resolve(testDb);
  if (!cache.__botchelorDb) {
    const opening = openDb().then(async (db) => {
      await ensureSchema(db);
      return db;
    });
    // A failed open (e.g. the database is briefly unreachable) must not poison every later request.
    opening.catch(() => {
      if (cache.__botchelorDb === opening) cache.__botchelorDb = undefined;
    });
    cache.__botchelorDb = opening;
  }
  return cache.__botchelorDb;
}
