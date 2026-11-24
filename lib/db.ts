import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterDarkOnly } from "./after-dark-host";
import { watchedQueries, withDbLabel, type PoolWatchOptions } from "./db-watch";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "./house";
import { HOUSE_KITS } from "./house-kits";
import { isDeployed } from "./deploy";
import { madeInSql } from "./made-in";

/** The only database surface the app uses: parameterized queries, plus multi-statement DDL. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

/**
 * A query that died because Neon closed its connection (compute scaled down or restarted: 57P01/57P02/57P03, or
 * the socket dropped) rather than because of the query. The server rolls such a statement back, so one retry on a
 * fresh connection is safe; on prod these surfaced as 500s on /, /feed and /characters (2026-10-14/15).
 */
export function isDroppedConnection(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (typeof e.code === "string" && /^57P0[123]$/.test(e.code)) return true;
  if (e.code === "ECONNRESET" || e.code === "EPIPE") return true;
  return typeof e.message === "string" && /Connection terminated|terminating connection/i.test(e.message);
}

/**
 * The app's database on a pg Pool. Each query takes a connection of its own, timed and labelled with the route it
 * serves, so a long wait for a connection names who held them (lib/db-watch.ts, #1948).
 */
export function pgPoolDb(pool: Pool, watch?: PoolWatchOptions): Db {
  const run = watchedQueries(pool, watch);
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      let result;
      try {
        result = await run(sql, params);
      } catch (err) {
        if (!isDroppedConnection(err)) throw err;
        // The dead client was dropped with its failed query, so this runs on a fresh connection.
        result = await run(sql, params);
      }
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await run(sql);
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

-- M16 date visibility. 'public' airs in the feed and counts toward public records; 'unlisted' is viewable
-- by link only (not in the feed, not in public aggregates); 'private' is the creator's alone (the system
-- still stores and tracks it, but no one else sees it and it never counts publicly). Existing rows default
-- public, so nothing already aired changes.
alter table episodes add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'private', 'unlisted'));
create index if not exists episodes_visibility_idx on episodes (visibility);

create table if not exists profiles (
  user_id text primary key,
  name text not null,
  attested_adult_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional account layer. The primary key IS the anonymous user id (bz_uid) the account adopts, so an
-- account is just a login attached to an existing anonymous identity: all its characters, dates and points
-- keep working unchanged. Everything stays optional — no account is ever required to play. Credentials are
-- a username+password (handle, scrypt hash) and/or Google (sub + email); any may be null.
create table if not exists accounts (
  user_id text primary key,
  handle text unique,
  handle_display text,
  email text unique,
  google_sub text unique,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BYOK (M16): a signed-in user's own model provider key, AES-256-GCM encrypted (lib/keys). Only the
-- provider, last four and optional model are ever read back; the key itself leaves only to that provider.
create table if not exists user_keys (
  user_id text not null references accounts (user_id) on delete cascade,
  provider text not null,
  kind text not null default 'text' check (kind in ('text', 'image')),
  ciphertext text not null,
  nonce text not null,
  last4 text not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (user_id, provider, kind)
);

create table if not exists identity_consents (
  episode_id text not null references episodes (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);

-- M11 afterglow reveal: each owner opted in to open the morning-after thread, and it unlocked once every real
-- owner had. Unused since 2026-10-16 (owners now read it straight away); kept, since rows and tables aren't dropped.
create table if not exists afterglow_consents (
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
-- M15 (genuine dates): how others refer to a character, and how it talks. Both are public persona (shown
-- on the card) and both reach the date's models — the voice is the biggest lever for a character sounding
-- like itself rather than like one witty narrator (docs/date-quality.md). The engine never reads either.
-- The pronouns CHECK mirrors PRONOUNS in lib/rules.ts.
alter table characters add column if not exists pronouns text
  check (pronouns is null or pronouns in ('she/her', 'he/him', 'they/them'));
alter table characters add column if not exists voice text;

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

-- The waitlist (once the home page's Season 1 signup, now After Dark's). Emails are stored lowercased; nothing is sent from the app.
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
-- A free second date each season when both characters wanted another (FREE_WEEKLY_SECOND_DATE=1, lib/allowance.ts).
create table if not exists free_second_date_usage (
  user_id text not null,
  season_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
create table if not exists pack_episode_usage (
  user_id text primary key,
  used integer not null check (used >= 0)
);
-- Free dates an admin gave an account (POST /api/admin/tokens): counted like pack dates, never an order, so they
-- never show up as revenue.
create table if not exists token_grants (
  id text primary key,
  user_id text not null,
  episodes integer not null check (episodes > 0),
  granted_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists token_grants_user_idx on token_grants (user_id);

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
-- Behavioural signals trained from a reference image (lib/avatar.ts): when set, the engine uses these
-- instead of the ones derived from the soul text, so an image shapes how the character behaves on dates.
alter table souls add column if not exists signals jsonb;

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
-- M9: the turn-by-turn two-agent conversation (lib/conversation.ts). The date "footage": an ordered
-- list of { side, act, dialogue, action, emotion, interest }. Immutable like the rest of the episode;
-- '[]' for episodes made before M9 or when the conversation couldn't be produced (the recap still stands).
alter table episodes add column if not exists transcript jsonb not null default '[]';

-- M11: the afterglow (PRD "the post-date group chat"). The private morning-after text thread the two
-- AIs exchange after the date: an ordered list of { side, text }. Flavour only (never scores anything),
-- immutable, owner-gated. '[]' when it couldn't be produced or for episodes made before M11.
alter table episodes add column if not exists afterglow jsonb not null default '[]';
-- 2026-10-15: each character's post-date reflection (lib/reflection.ts), { a: string|null, b: string|null }.
-- The character's own postmortem in its voice; flavour + fed back into its OWN future self-view (never the
-- engine). null/absent for episodes made before this or when a side's reflection couldn't be produced.
alter table episodes add column if not exists reflections jsonb;
-- Data plan Tier 2 (2026-10-22): each side's structured reflection labels (lib/reflection-labels.ts), { a, b }, each
-- { rating?, would_date_again?, worked?, didnt? } or null. Owner-only: never in EPISODE_SELECT, a prompt or the engine.
alter table episodes add column if not exists reflection_labels jsonb;
-- Which models actually wrote the date, by role ({actor[], director[], byok[], prompts, frontier?}; lib/pipeline.ts
-- GeneratedWith), fallbacks included, and the prompt version — so a change in quality traces to a model or a
-- prompt. Internal: never in a viewer's episode view. Null for dates written before it was recorded.
alter table episodes add column if not exists generated_with jsonb;
-- Admins (lib/admins.ts): accounts that claimed admin with the admin password. Admins skip the clip paywall.
create table if not exists admins (
  user_id text primary key,
  created_at timestamptz not null default now()
);
-- How many times backfilling this date's missing conversation has genuinely failed (lib/backfill.ts), so a
-- date the model keeps failing on stops costing calls. Rate limits don't count. (Replaces a first-day counter
-- that also counted the free tier's 429s and so wrongly gave up on good dates.)
alter table episodes add column if not exists backfill_failures integer not null default 0;
alter table episodes drop column if exists transcript_backfill_attempts;

-- M10 part 2: async generation. The engine outcome (ending, box score) is written synchronously and the
-- episode is 'generating'; a background worker narrates + runs the conversation, then flips it to 'ready'.
-- Legacy rows default 'ready'. A terminally failed generation deletes its episode and gives the date back
-- (so a failure still "stores nothing and costs no date"); only 'generating' and 'ready' ever persist.
alter table episodes add column if not exists status text not null default 'ready'
  check (status in ('generating', 'ready'));

-- One generation job per episode. Leased so two workers (the after()-hook and the cron backstop) never
-- double-run it. use_frontier, creator_id and the date reservation are recorded at enqueue because the
-- worker has no request: it needs them to pick the model and to give the date back on a terminal failure.
create table if not exists generation_jobs (
  episode_id text primary key references episodes (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  use_frontier boolean not null default false,
  creator_id text not null,
  reservation jsonb,
  attempts integer not null default 0,
  leased_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists generation_jobs_claim_idx on generation_jobs (status, leased_until);

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

-- Audience ratings ("most likable / most surprising"): one vote per viewer per character per category.
-- A $0 social signal — never touches the engine, the date outcome, predictions or league/season scoring;
-- it feeds the cast leaderboard and the owner's all-time points only. You can't rate your own character
-- (enforced in lib/ratings.ts). The CHECK list mirrors RATING_CATEGORIES in lib/rules.ts.
create table if not exists character_ratings (
  rater_id text not null,
  character_id text not null references characters (id) on delete cascade,
  category text not null check (category in ('likable', 'surprising')),
  created_at timestamptz not null default now(),
  primary key (rater_id, character_id, category)
);
create index if not exists character_ratings_board_idx on character_ratings (category, character_id);

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

-- The relationship graph (lib/relationships.ts): each edge is DERIVED from the dates between the pair, recomputed
-- whenever one is stored, airs, changes visibility or goes away (never edited). dates/second_dates/last_ending/
-- mutual_yes/chemistry/trust/stage/tie_strength cover every date (the engine's and the owners' layer); public_* only
-- the dates that aired publicly (what spectators see). detail: history, what they've told each other, inside jokes,
-- plans (the history items carry the creator id, so detail never leaves the server raw).
alter table relationships add column if not exists mutual_yes integer not null default 0;
alter table relationships add column if not exists chemistry real;
alter table relationships add column if not exists trust real;
alter table relationships add column if not exists stage text;
alter table relationships add column if not exists tie_strength real not null default 0;
alter table relationships add column if not exists first_at timestamptz;
alter table relationships add column if not exists last_at timestamptz;
alter table relationships add column if not exists public_dates integer not null default 0;
alter table relationships add column if not exists public_second_dates integer not null default 0;
alter table relationships add column if not exists public_last_ending text;
alter table relationships add column if not exists public_stage text;
alter table relationships add column if not exists public_tie real not null default 0;
alter table relationships add column if not exists public_last_at timestamptz;
alter table relationships add column if not exists detail jsonb;
alter table relationships add column if not exists computed_at timestamptz;
-- 2.9.0: the date whose airing sent the couple's exclusive_soon warning (lib/partners.ts warnWhenSparksOut), so it goes out
-- once per couple and date, never again, and never before that date airs (a private one, which never airs, when it's written).
alter table relationships add column if not exists exclusive_warned_for text;
-- The primary key serves "edges of X" when X is the lower id; this serves it when X is the higher one.
create index if not exists relationships_character_b on relationships (character_b);
-- A second date points at the date whose morning-after plan it is. One second date per date.
alter table episodes add column if not exists followup_of text references episodes (id) on delete set null;
create unique index if not exists episodes_one_second_date on episodes (followup_of) where followup_of is not null;
-- Which date a follow-up is for the couple (setup.date_number, lib/rules dateLabel): backfilled once for the
-- follow-ups booked before it was stored, by walking each chain from its first date. Only rows still missing it.
with recursive chain (id, n) as (
  select id, 1 from episodes where followup_of is null
  union all
  select e.id, c.n + 1 from episodes e join chain c on e.followup_of = c.id
)
update episodes set setup = coalesce(setup, '{}'::jsonb) || jsonb_build_object('date_number', c.n)
  from chain c
 where episodes.id = c.id and c.n > 1 and (episodes.setup->>'date_number') is null;
-- Between dates (lib/between-dates.ts). A couple's daily text exchange: one exchange a day, owners only, like the
-- afterglow. 'who' is the pair end that sent it ('lo' = the lower character id).
create table if not exists couple_texts (
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  day date not null,
  seq integer not null,
  who text not null check (who in ('lo', 'hi')),
  text text not null,
  created_at timestamptz not null default now(),
  primary key (character_lo, character_hi, day, seq)
);
-- Who wrote a text between dates (lib/texting.ts): the daily job on the show's free model ('daily'), an agent in its
-- own words ('agent'), a person's own model key ('own_key'), or a house character answering on the show's model
-- ('show'). seq counts a couple's texts that day, so an agent's conversation can run past the daily pair.
alter table couple_texts add column if not exists via text not null default 'daily';
-- For the flood guard (a character's texts in the last minute) and the house cast's daily reply budget.
create index if not exists couple_texts_hi_idx on couple_texts (character_hi, created_at);
create index if not exists couple_texts_day_idx on couple_texts (day, via);
-- The swipe deck (lib/swipes.ts, docs/swipes.md). A swipe: one character's owner (or its agent) liked or passed on
-- another character. Final, once per pair and direction. Likes are never shown to the one liked.
create table if not exists swipes (
  swiper text not null references characters (id) on delete cascade,
  target text not null references characters (id) on delete cascade,
  liked boolean not null,
  created_at timestamptz not null default now(),
  primary key (swiper, target)
);
create index if not exists swipes_target_idx on swipes (target, liked);
-- A match: both liked each other (a house character likes everyone back). Whether each wants a date is that
-- character's own answer (yes_lo / yes_hi): null until it's given (an agent answers for its own character). Both
-- yes: agreed_at, and the date can be booked.
create table if not exists matches (
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  matched_at timestamptz not null default now(),
  yes_lo boolean,
  yes_hi boolean,
  agreed_at timestamptz,
  primary key (character_lo, character_hi)
);
create index if not exists matches_hi_idx on matches (character_hi);
-- A match ended from its thread (lib/unmatch.ts; David, 2026-10-31), for good: the pair doesn't text, date, meet in the
-- deck or match again. by_character is whose owner ended it.
create table if not exists unmatches (
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  by_character text not null,
  created_at timestamptz not null default now(),
  primary key (character_lo, character_hi)
);
create index if not exists unmatches_hi_idx on unmatches (character_hi);
-- "Date my OC" links (lib/date-invites.ts): one live link per character; each accept is a match with the date agreed.
create table if not exists date_invites (
  code text primary key,
  character_id text not null references characters (id) on delete cascade,
  owner_id text not null,
  accepted integer not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists date_invites_live_idx on date_invites (character_id) where revoked_at is null;
create table if not exists date_invite_accepts (
  code text not null references date_invites (code) on delete cascade,
  character_id text not null references characters (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (code, character_id)
);
-- "Bring a friend" double-date links (lib/double-links.ts): a couple's link books one double night with whoever
-- takes it. taken_by/taken_at claim it while it books; night_id marks it used.
create table if not exists double_links (
  code text primary key,
  created_by text not null,
  character_id text not null references characters (id) on delete cascade,
  partner_id text not null references characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  taken_by text,
  taken_at timestamptz,
  night_id text
);
create unique index if not exists double_links_open_idx on double_links (character_id, partner_id) where revoked_at is null and night_id is null;
create index if not exists double_links_creator_idx on double_links (created_by);
-- Dates booked for later (lib/scheduled-dates.ts, the schedule_date tool): the hourly lobby job runs the due ones
-- through the same booking route as go_on_date, so every rule applies at run time. outcome says how a run went.
create table if not exists scheduled_dates (
  id text primary key,
  creator_id text not null,
  character_id text not null references characters (id) on delete cascade,
  partner_id text references characters (id) on delete cascade,
  run_at timestamptz not null,
  visibility text,
  place text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  ran_at timestamptz,
  episode_id text,
  outcome text
);
create index if not exists scheduled_dates_due_idx on scheduled_dates (run_at) where ran_at is null;
create index if not exists scheduled_dates_creator_idx on scheduled_dates (creator_id, created_at desc);
-- Double dates (lib/group-dates.ts, docs/PRDs/group-dates.md): one night, two couples at one table, each couple's own
-- episode underneath (episodes.group_id). couple_a is the proposer's side; couple_b the other, whose booker consents
-- (invite_to) unless the proposer owns or the house plays both of its characters.
create table if not exists group_nights (
  id text primary key,
  kind text not null check (kind in ('double')),
  venue text not null,
  created_by text not null,
  status text not null check (status in ('invited', 'booked', 'declined', 'lapsed', 'half_booked')),
  invite_to text,
  couple_a jsonb not null,
  couple_b jsonb not null,
  episode_a text,
  episode_b text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists group_nights_invite_idx on group_nights (invite_to) where status = 'invited';
-- Mixers (group dates M2, docs/PRDs/group-dates.md): a speed-dating night. kind gains 'mixer', with its own statuses
-- (open: joinable; running/done; cancelled: too few came). A mixer's couples are '{}' — its people sit in
-- group_night_seats and its drawn rotations (who meets whom, who books) in rotations jsonb, written when it runs.
alter table group_nights drop constraint if exists group_nights_kind_check;
alter table group_nights add constraint group_nights_kind_check check (kind in ('double', 'mixer'));
alter table group_nights drop constraint if exists group_nights_status_check;
alter table group_nights add constraint group_nights_status_check
  check (status in ('invited', 'booked', 'declined', 'lapsed', 'half_booked', 'open', 'running', 'done', 'cancelled'));
alter table group_nights add column if not exists rotations jsonb;
-- When a night's last date aired and its people were asked who they liked (lib/group-dates.ts notifyNightAired): once.
alter table group_nights add column if not exists reflect_sent_at timestamptz;
create table if not exists group_night_seats (
  night_id text not null references group_nights (id) on delete cascade,
  character_id text not null references characters (id) on delete cascade,
  booker text not null,
  joined_at timestamptz not null default now(),
  primary key (night_id, character_id)
);
-- The night a date belongs to: one table of a double date, or one rotation of a mixer (lib/group-dates.ts).
alter table episodes add column if not exists group_id text;
create index if not exists episodes_group_idx on episodes (group_id) where group_id is not null;
-- The nightly fill (lib/mixer-fill.ts): a seat the house filled with one of its labelled crowd (its rotation is
-- house-paid), and when the house topped a night up (once a UTC day; a filled night runs without the doors wait).
alter table group_night_seats add column if not exists house_fill boolean not null default false;
alter table group_nights add column if not exists filled_at timestamptz;
-- A mixer's best friends ([[a, b], …], lib/mixer-room.ts Duo): stored when the night is drawn, so the prompt and the page agree.
alter table group_nights add column if not exists duos jsonb;
-- The room's own words (lib/mixer-voice.ts): a mixer night's opening and closing, written once (by the model, or the
-- template when the call failed or was refused: *_by says which).
alter table group_nights add column if not exists room_opening text;
alter table group_nights add column if not exists room_opening_by text;
alter table group_nights add column if not exists room_closing text;
alter table group_nights add column if not exists room_closing_by text;
-- The house matchmaker's daily picks (lib/house-matchmaker.ts): a pair is proposed once, ever; both owners are told.
create table if not exists matchmaker_picks (
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  mutual int not null default 0,
  picked_at timestamptz not null default now(),
  primary key (character_lo, character_hi)
);
-- An owner's standing note to their character about one person ("bring up the boat"): it shapes their texts and
-- goes into their next date with that person (then it's used). One per character and person.
create table if not exists nudges (
  character_id text not null references characters (id) on delete cascade,
  other_id text not null references characters (id) on delete cascade,
  user_id text not null,
  note text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  primary key (character_id, other_id)
);
-- In-app notifications (lib/notifications.ts), and the browser push subscriptions that mirror them.
create table if not exists notifications (
  id text primary key,
  user_id text not null,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on notifications (user_id, created_at desc);
-- When a person last read a thread (lib/inbox.ts): the Matches page's unread dot counts texts since, so clearing the
-- notifications doesn't clear a thread that's still unread.
create table if not exists thread_reads (
  user_id text not null,
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  read_at timestamptz not null,
  primary key (user_id, character_lo, character_hi)
);
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
-- Email notifications (lib/email.ts): opt-in only and confirmed ('pending' until the link is clicked), and a log of
-- what was sent (for the per-person and show-wide daily caps).
create table if not exists email_prefs (
  user_id text primary key,
  email text not null,
  status text not null check (status in ('pending', 'on', 'off')),
  confirmed_at timestamptz,
  last_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists email_sends (
  id text primary key,
  user_id text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists email_sends_recent on email_sends (created_at);
-- When a notification went out by email (at once, or in a digest), so no email ever repeats it.
alter table notifications add column if not exists emailed_at timestamptz;
-- When a reply showed this notice as heads_up (lib/mcp/dispatcher.ts headsUpNotices, 2.6.0): a two-agent date's invite
-- stays unread (waiting_for_you counts it until the date is played), but leads only the first reply after it came.
alter table notifications add column if not exists heads_up_at timestamptz;
-- Spectators follow couples (lib/follows.ts): they hear when the couple goes on another public date or moves up.
create table if not exists couple_follows (
  user_id text not null,
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, character_lo, character_hi)
);
create index if not exists couple_follows_pair on couple_follows (character_lo, character_hi);
-- People follow one character (lib/character-follows.ts): they hear when something public happens to it, and, where they
-- may text it, its event-driven texts are on for them. texts_on: this follow switched those texts on (they were off),
-- so unfollowing switches them off again and leaves a choice made in the thread's own Settings alone.
create table if not exists character_follows (
  user_id text not null,
  character_id text not null references characters (id) on delete cascade,
  texts_on boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, character_id)
);
create index if not exists character_follows_character on character_follows (character_id);
-- Arc predictions (lib/arcs.ts): "will they make it to date N?", resolved from the public record. Free points, never prizes.
create table if not exists arc_predictions (
  user_id text not null,
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  target integer not null,
  pick boolean not null,
  created_at timestamptz not null default now(),
  deadline timestamptz not null,
  resolved_at timestamptz,
  outcome boolean,
  primary key (user_id, character_lo, character_hi, target)
);
create index if not exists arc_predictions_open on arc_predictions (character_lo, character_hi) where resolved_at is null;
-- A date one owner proposes to another owner's character (lib/date-proposals.ts) when that character isn't open to
-- dates: pending until the other owner accepts (which books it) or declines; a pending one lapses after 7 days.
create table if not exists date_proposals (
  id text primary key,
  from_user text not null,
  from_character text not null references characters (id) on delete cascade,
  to_character text not null references characters (id) on delete cascade,
  to_user text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  episode_id text
);
create unique index if not exists date_proposals_one_pending on date_proposals (from_character, to_character) where status = 'pending';
create index if not exists date_proposals_to_user on date_proposals (to_user) where status = 'pending';
-- An owner's yes to a second date (lib/second-date.ts), when the other character's owner has to agree as well.
create table if not exists second_date_requests (
  episode_id text not null references episodes (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (episode_id, user_id)
);
-- A roleplay for a couple's next date (lib/date-roleplays.ts): one owner proposes, the other agrees, declines or
-- counters (a new row, counter_of the old). answerer_user null = agreed at once (the show's own side, or both the
-- proposer's). One live row (pending or agreed) per pair; an agreed one is used by the next written date that played it.
create table if not exists date_roleplays (
  id text primary key,
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  proposed_by text not null,
  proposer_user text not null,
  answerer_user text,
  terms jsonb not null,
  note text,
  counter_of text,
  round integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'agreed', 'declined', 'countered', 'withdrawn', 'expired', 'used')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  episode_id text
);
create unique index if not exists date_roleplays_one_live on date_roleplays (character_lo, character_hi) where status in ('pending', 'agreed');
create index if not exists date_roleplays_answerer on date_roleplays (answerer_user) where status = 'pending';

-- M14. The learned memory layer (lib/memory.ts): what a character has learned across ALL its dates, so
-- each bot becomes an individual and "trains itself". Materialized, recomputed deterministically (no model
-- call) right after each date is stored. One row per character. likes / turnoffs / signal_delta /
-- memorable_lines derive from owner-only debrief data, so they are SELF / owner-only (same rule as the
-- soul); only the already-public date record is ever shown publicly. signal_delta is a small bounded drift
-- to the engine signals (±MEMORY_SIGNAL_CAP per axis in lib/memory.ts), so a character evolves without any
-- one axis swinging a result; the engine (lib/engine.ts) is unchanged.
create table if not exists character_memory (
  character_id text primary key references characters (id) on delete cascade,
  dates integer not null default 0,
  second_dates integer not null default 0,
  friends integer not null default 0,
  disasters integer not null default 0,
  likes jsonb not null default '[]',            -- most frequent want_met cues, from past SideOutcomes
  turnoffs jsonb not null default '[]',         -- most frequent dealbreaker_hit cues
  signal_delta jsonb not null default '{}',     -- {warmth?,openness?,guardedness?,humor?} small learned drift
  memorable_lines jsonb not null default '[]',  -- a few of the character's own highest-interest lines
  reflections jsonb not null default '[]',      -- the character's few most recent post-date reflections (lib/reflection.ts)
  arc text,                                     -- one templated "who they've become" sentence (no model)
  updated_at timestamptz not null default now()
);
-- People a character met without dating them: the other couple at a double date's table (lib/memory.ts met).
alter table character_memory add column if not exists met jsonb;
-- Its owner's saved take on someone the character met at a group night without dating (lib/memory.ts noteMeeting,
-- David 2026-10-25: reflect on who they liked and carry it into future engagements). Private: self and owner only.
create table if not exists met_notes (
  character_id text not null references characters (id) on delete cascade,
  about_id text not null references characters (id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  primary key (character_id, about_id)
);
-- Added 2026-10-15 for existing deployments: the recent post-date reflections fed into the self-view.
alter table character_memory add column if not exists reflections jsonb not null default '[]';
-- Added 2026-10-15 (lib/memory.ts): who a character has dated and how they stand (people; each entry's
-- wanted_more is owner/self-only, the rest is public), its story a season at a time (chapters) and the
-- landmarks it has reached (milestones). All recomputed from the aired record; no model call.
alter table character_memory add column if not exists people jsonb not null default '[]';
alter table character_memory add column if not exists chapters jsonb not null default '[]';
alter table character_memory add column if not exists milestones jsonb not null default '[]';
-- Where each learned item came from ({reflections, lines, likes, turnoffs} → the aired dates behind them), so an
-- owner can see why their character remembers something. Owner only. Null on rows from before it existed (they
-- rebuild on first read).
alter table character_memory add column if not exists sources jsonb;
-- What an owner told their character to forget (lib/memory.ts FORGET_KINDS). Applied on every memory rebuild, so a
-- forgotten item never comes back from the same dates. Deleting a row is "remember it again".
create table if not exists memory_forgets (
  character_id text not null references characters (id) on delete cascade,
  kind text not null check (kind in ('reflection', 'line', 'like', 'turnoff', 'moment')),
  item text not null,
  created_at timestamptz not null default now(),
  primary key (character_id, kind, item)
);
-- What's new in a character's life this week (lib/life.ts): the creator's own update and the season it was
-- written for, {text, season}. Null (or a past season) means the show deals one. Public; prompts only.
alter table characters add column if not exists this_week jsonb;

-- Image assets and where they came from (the competitor report's image-rights record). Nothing in the
-- app renders an image today: avatars and venue backdrops are drawn from character data (lib/avatar.ts,
-- lib/venues.ts), which is why there is no upload to moderate and no marginal cost. This table is the
-- provenance ledger that any later portrait, background or expression must pass through: who made it,
-- under what licence, who gets credited, and whether a human approved it. lib/assets.ts only ever
-- serves rows with review_status = 'approved', so an unreviewed asset cannot reach a page.
create table if not exists character_assets (
  id text primary key,
  -- The character it belongs to, or null for a shared asset (a venue backdrop, a decorative plate).
  character_id text references characters (id) on delete cascade,
  kind text not null check (kind in ('portrait', 'expression', 'background', 'decoration')),
  -- 'drawn' is what ships today: generated from character data in the browser, no file anywhere.
  source_type text not null check (source_type in ('drawn', 'generated', 'uploaded', 'licensed')),
  source_model text,          -- the generator and version, for a generated asset
  prompt text,                -- the prompt it was generated from
  prompt_version text,        -- which template version that prompt came from
  seed bigint,                -- the generation seed, where the model supports one
  source_url text,            -- where a licensed asset came from
  license_name text,          -- the licence a third-party asset is used under
  attribution text,           -- the credit that licence requires
  url text,                   -- where the approved file is served from
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_note text,
  created_at timestamptz not null default now(),
  -- A licensed asset must say where it came from and under what terms, or it cannot be stored at all.
  check (source_type <> 'licensed' or (source_url is not null and license_name is not null)),
  -- A generated asset must name its generator, so an unattributable image cannot be approved later.
  check (source_type <> 'generated' or source_model is not null),
  -- Nothing can be approved without a file to serve.
  check (review_status <> 'approved' or url is not null)
);
create index if not exists character_assets_character_idx on character_assets (character_id, kind)
  where review_status = 'approved';
-- M16: a BYOK-generated video clip is a new asset kind (widen the CHECK in place for existing databases).
-- Intro clips (lib/video.ts, Veo on the player's own Google key) cost bought tokens: how many this clip took, so
-- a clip Google blocks or fails is refunded exactly once (set back to 0 when refunded).
alter table character_assets add column if not exists tokens_spent integer not null default 0;
alter table character_assets drop constraint if exists character_assets_kind_check;
alter table character_assets add constraint character_assets_kind_check
  check (kind in ('portrait', 'expression', 'background', 'decoration', 'clip', 'photo'));
-- 2026-10-25 (lib/content-rating.ts): how explicit each asset is, a strict tag the serve gate reads (lib/asset-gate.ts).
-- Every row before it is the show's (portraits, Veo clips, Studio photos that passed level 0 and nsfw < 0.15 to reach
-- the texts), so they're pg; from then on a row says its own, and one that doesn't is nsfw.
alter table character_assets add column if not exists content_rating text;
update character_assets set content_rating = 'pg' where content_rating is null;
alter table character_assets alter column content_rating set default 'nsfw';
alter table character_assets alter column content_rating set not null;
alter table character_assets drop constraint if exists character_assets_content_rating_check;
alter table character_assets add constraint character_assets_content_rating_check check (content_rating in ('pg', 'suggestive', 'nsfw'));

-- M8. Watch parties: a synchronized "date room" over one pre-generated episode, with live reactions,
-- chat and audience polls (the feature brief's Model A — the audience reacts, it never steers the
-- characters). All added with IF NOT EXISTS so a live M7 database upgrades in place with no migration.
--
--   'premiere'  — a creator airs their own date at a set time; starts_at is the premiere, host_id the host.
--   'template'  — an always-on room over a house-vs-house date; starts_at is null until the first viewer
--                 joins, then the date plays on one shared clock ("join and it starts"), host_id null.
create table if not exists watch_parties (
  id text primary key,
  episode_id text not null references episodes (id) on delete cascade,
  kind text not null check (kind in ('premiere', 'template')),
  host_id text,
  starts_at timestamptz,
  created_at timestamptz not null default now()
);
-- One room per episode: the room IS the episode's premiere, not a second copy of it.
create unique index if not exists watch_parties_episode_idx on watch_parties (episode_id);
create index if not exists watch_parties_kind_idx on watch_parties (kind, created_at desc);

-- Live chat. hidden flips true once REPORT_HIDE_THRESHOLD distinct viewers report a message (lib/rules.ts),
-- the same threshold that hides an episode. The body still passes the content filter (lib/safety.ts) on write.
create table if not exists watch_messages (
  id text primary key,
  party_id text not null references watch_parties (id) on delete cascade,
  user_id text not null,
  handle text not null,
  body text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists watch_messages_party_idx on watch_messages (party_id, created_at);
create index if not exists watch_messages_user_idx on watch_messages (party_id, user_id, created_at);

create table if not exists watch_message_reports (
  message_id text not null references watch_messages (id) on delete cascade,
  reporter_id text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

-- Emoji reactions, whole-room: one row per (party, user, emoji), so a viewer adds each emoji once
-- (toggle) and a count is distinct viewers, never spammable.
create table if not exists watch_reactions (
  party_id text not null references watch_parties (id) on delete cascade,
  user_id text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (party_id, user_id, emoji)
);

-- Audience polls that are opinion, not prediction: the chemistry verdict and the audience-question pick.
-- One vote per (party, user, poll), changeable until its window closes. These never score and never
-- reach the engine (Model A): the crowd's verdict is entertainment, not control over the characters.
create table if not exists watch_poll_votes (
  party_id text not null references watch_parties (id) on delete cascade,
  user_id text not null,
  poll text not null check (poll in ('chemistry', 'question', 'chaos')),
  choice text not null,
  updated_at timestamptz not null default now(),
  primary key (party_id, user_id, poll)
);
-- The chaos button added the 'chaos' poll; widen the CHECK on an existing database (the inline one above
-- only applies to a fresh table). Mirrors WATCH_POLLS in lib/rules.ts.
alter table watch_poll_votes drop constraint if exists watch_poll_votes_poll_check;
alter table watch_poll_votes add constraint watch_poll_votes_poll_check check (poll in ('chemistry', 'question', 'chaos'));

-- Presence, for the live "N watching" count: upserted on every heartbeat, counted within the window.
create table if not exists watch_presence (
  party_id text not null references watch_parties (id) on delete cascade,
  user_id text not null,
  last_seen timestamptz not null default now(),
  primary key (party_id, user_id)
);
create index if not exists watch_presence_party_idx on watch_presence (party_id, last_seen);

-- Agents (the MCP front door). Where a character or a date came from ('web' or 'mcp'), so agent-made
-- characters are labelled and the agents' daily date cap can be counted. And 'open to dates': the creator's
-- consent to be asked out by name. Blind dates already draw from every OC; choosing a stranger's OC as the
-- partner is allowed only when this is on. House characters are always available and ignore it.
alter table characters add column if not exists created_via text not null default 'web'
  check (created_via in ('web', 'mcp'));
alter table characters add column if not exists open_to_dates boolean not null default false;
-- Optional details (lib/extras.ts): occupation, hometown, style, hobbies, quirks, profile prompts... Public,
-- content-filtered, editable any time. They flavour a date's dialogue; the engine never reads them.
alter table characters add column if not exists extras jsonb not null default '{}'::jsonb;
create index if not exists characters_open_idx on characters (open_to_dates) where open_to_dates;
-- One partner or more (lib/partners.ts): the owner's choice ('decide' or null leaves it to the character), and what
-- the character decided for itself the first time it was in a relationship.
alter table characters add column if not exists partner_style text check (partner_style in ('one', 'open', 'decide'));
alter table characters add column if not exists partner_style_decided text check (partner_style_decided in ('one', 'open'));
-- How much the character talks (lib/talk.ts): the date's length and the texts after. Null is the standard.
-- Never read by the engine, so it can't change how a date ends.
alter table characters add column if not exists talk text check (talk in ('standard', 'longer', 'long', 'marathon'));
alter table episodes add column if not exists created_via text not null default 'web'
  check (created_via in ('web', 'mcp'));
create index if not exists episodes_via_idx on episodes (created_via, created_at);
-- Who performed the date's lines: our model ('platform'), or the creator's own AI ('agent' — an agent dating
-- two of its own characters, one process per character, over MCP: lib/own-date.ts). The engine decides the
-- outcome either way; an agent-performed date spends none of our model quota, so it isn't budgeted.
alter table episodes add column if not exists performed_by text not null default 'platform'
  check (performed_by in ('platform', 'agent'));
-- A two-agent date (lib/own-date.ts): the other character's agent performs its side, on its own model. Null when
-- one agent performs both (its own two characters) or our model performs the date.
alter table episodes add column if not exists partner_performer text;
-- The prediction window (lib/air.ts): an agent's air_date before it closes schedules the airing for then.
alter table episodes add column if not exists air_after timestamptz;
-- Two-agent dates (lib/own-date.ts): when either side last handed in a turn, and the side the show's model took over
-- after the other agent went quiet (handOverOwnDate). Its turns then count against the agents' daily budget.
alter table episodes add column if not exists last_move_at timestamptz;
alter table episodes add column if not exists handed_over text check (handed_over in ('a', 'b'));
alter table episodes add column if not exists handed_over_at timestamptz;
-- Auto-play (lib/own-date.ts autoplayOwnDate): the show's model performs both sides' remaining turns and the recap.
alter table episodes add column if not exists autoplay boolean not null default false;
-- Mutual wishes (lib/wishes.ts): each side's private "want to see them again?". While an agent's date is played, only
-- what a performer said (see_again); once the last line is in, both wishes as they counted and the engine's own ending.
-- Never in a view: only a tip is told, with the ending.
alter table episodes add column if not exists wishes jsonb;
-- Living dates (lib/inner-life.ts): each line's private feeling, thought and note, and each side's own "see them again?"
-- answer (lib/choices.ts). Never on a stored line and never in a view before the date airs (lib/game.ts innerForViewer).
alter table episodes add column if not exists inner_life jsonb;
-- Step into the date (lib/step-in.ts; docs/step-into-the-date.md): how many dates a person stepped into on a UTC day,
-- and whether the day's free one is used. A row per person a day; dates (not rows) so a date called off still counts.
create table if not exists step_in_usage (
  user_id text not null,
  day text not null,
  dates integer not null default 0,
  free_used boolean not null default false,
  primary key (user_id, day)
);
-- The self-harm protocol's referrals, counted (lib/step-in.ts countCrisis; California SB 243 asks for a yearly count
-- from July 2027): how many times the crisis resources were shown, a day and a surface. Never who, never the words.
create table if not exists crisis_referrals (
  day text not null,
  surface text not null,
  n integer not null default 0,
  primary key (day, surface)
);
-- Companions (lib/companion.ts; docs/companions.md): one person talking with one character, one to one, in a thread of
-- their own. Who may be one: companion_open (house characters and the show's own agent-made cast), or the person's own
-- character. A thread is only ever theirs: it never flows back into a date, a text or anyone's memory of the show.
alter table characters add column if not exists companion_open boolean not null default false;
-- After Dark's agent cast (lib/adult/agent-cast.ts): the show's own agent-made characters, in every person's After Dark
-- like the house cast once their sheet and their portrait have passed its checks. Never an outside agent's character.
alter table characters add column if not exists after_dark_open boolean not null default false;
create table if not exists adult_cast_checks (
  character_id text primary key references characters(id) on delete cascade,
  sheet_ok boolean,
  sheet_reason text,
  sheet_checked_at timestamptz,
  portrait_ok boolean,
  portrait_reason text,
  portrait_checked_at timestamptz
);
-- The age check when a person switches their own character into After Dark (lib/adult/switch-check.ts): the verdict,
-- what it was read from (sig: the sheet and the portrait), and which check said no ('sheet' or 'portrait').
create table if not exists adult_switch_checks (
  character_id text primary key references characters(id) on delete cascade,
  sig text not null,
  ok boolean not null,
  reason text not null,
  checked_at timestamptz not null default now()
);
create table if not exists companion_threads (
  id text primary key,
  user_id text not null,
  character_id text not null references characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  -- The rolling summary of everything older than the prompt's recent turns, and the newest message it covers.
  summary text,
  summary_upto timestamptz,
  -- The newest message the facts were last drawn from.
  facts_upto timestamptz,
  -- short | normal | long: how much the character says a reply.
  reply_length text not null default 'normal',
  -- When the "you're talking with an AI" notice was last put in the thread (New York GBL Art. 47: at the start and every
  -- three hours of talking).
  notice_at timestamptz,
  -- Set while the crisis resources are up: nothing more in character until the person carries on.
  paused_at timestamptz,
  muted_proactive boolean not null default true,
  unique (user_id, character_id)
);
create index if not exists companion_threads_user_idx on companion_threads (user_id, last_at desc);
create table if not exists companion_messages (
  id text primary key,
  thread_id text not null references companion_threads (id) on delete cascade,
  role text not null check (role in ('user', 'character', 'system')),
  text text not null,
  via text not null default 'text' check (via in ('text', 'voice', 'photo')),
  media_url text,
  -- A regenerated reply replaces the one it was drawn again from (that one is kept, hidden, for "the one before").
  replaced_by text,
  model text,
  cost numeric,
  -- The person's report on a reply: its reason, and when.
  reported text,
  reported_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists companion_messages_thread_idx on companion_messages (thread_id, created_at);
-- Scenes (docs/companions.md): the two play a scene at one of the show's places (lib/venues.ts DATE_VENUES), face to
-- face instead of texting. The thread's scene now (null: texting); each line's scene and what the character does as they
-- say it; a system line that starts a scene or goes back to texting is marked as such.
alter table companion_threads add column if not exists scene text;
alter table companion_messages add column if not exists scene text;
alter table companion_messages add column if not exists action text;
alter table companion_messages add column if not exists marker text check (marker is null or marker in ('scene', 'texting'));
-- A scene's roleplay (lib/companion-shared.ts CompanionRoleplayView): the thread's terms now (lib/roleplays.ts
-- RoleplayTerms, first = 'you' or the character's id), and the title on each line said in one, so memory never takes
-- make-believe for a fact about the person.
alter table companion_threads add column if not exists roleplay jsonb;
alter table companion_messages add column if not exists roleplay text;
-- A reported reply's review on /admin/reports (lib/companion-reports.ts): when, and fine or a real miss to fix.
alter table companion_messages add column if not exists report_reviewed_at timestamptz;
alter table companion_messages add column if not exists report_decision text check (report_decision is null or report_decision in ('fine', 'fix'));
create index if not exists companion_messages_open_reports_idx on companion_messages (reported_at) where reported is not null and report_reviewed_at is null;
-- What the character knows about the person (lib/companion-memory.ts): drawn from the person's own words, shown on the
-- memory page, and theirs to edit, pin or delete. An edited one is never written over.
create table if not exists companion_facts (
  id text primary key,
  thread_id text not null references companion_threads (id) on delete cascade,
  kind text not null default 'other',
  text text not null,
  pinned boolean not null default false,
  edited_by_user boolean not null default false,
  uses integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists companion_facts_thread_idx on companion_facts (thread_id);
-- Replies drawn per person a UTC day (lib/companion-plan.ts): the free tier's count, the plan's fair use; '*free*' is
-- every free reply that day, the cap on what the free tier can cost.
create table if not exists companion_usage (
  user_id text not null,
  day date not null,
  replies integer not null default 0,
  primary key (user_id, day)
);
-- Companions' extras (lib/companion-extras.ts, P3): voice notes, and later selfies. What the Companion Plan includes is
-- counted a calendar month per person and kind; past it (or without the plan), a bought token buys a bundle, kept as
-- credits until used.
create table if not exists companion_extras_usage (
  user_id text not null,
  month date not null,
  kind text not null,
  used integer not null default 0,
  primary key (user_id, month, kind)
);
create table if not exists companion_credits (
  user_id text not null,
  kind text not null,
  credits integer not null default 0 check (credits >= 0),
  primary key (user_id, kind)
);
-- A voice note's audio (lib/companion-voice.ts), kept by a hash of the voice and the words so the same line is never paid
-- for twice; a message points at it. Rows no message points at any more (a thread or an account deleted) go, file and all.
create table if not exists companion_voice (
  key text primary key,
  voice text not null,
  chars integer not null,
  mime text not null,
  data bytea,
  object_key text,
  provider text,
  created_at timestamptz not null default now()
);
alter table companion_messages add column if not exists voice_key text;
-- Said on a voice call in the app (docs/companions.md, Calls): the person spoke it, or the reply was spoken aloud.
alter table companion_messages add column if not exists on_call boolean not null default false;
-- The menu under a text the character sent about one of its dates (lib/after-date-text.ts, lib/companion-offers.ts): which
-- date, who the partner was and the chips offered (see them again, someone new, advice), plus "taken" once one was tapped.
-- A menu, nothing personal; "action" stays the text's dedupe tag. Goes with the message (the thread's cascade).
alter table companion_messages add column if not exists offers jsonb;
-- A live call (docs/companions.md, P6; lib/companion-live.ts): one row a call, to charge it by the minute and count it.
-- Never any audio and never the words (those are messages, marked on_call). first_ticket: the first minute's, given
-- back when the call ends at once with nothing said. Kept 90 days.
create table if not exists companion_live_calls (
  id text primary key,
  user_id text not null,
  thread_id text not null,
  started_at timestamptz not null,
  last_at timestamptz not null,
  ended_at timestamptz,
  minutes integer not null default 0,
  turns integer not null default 0,
  tts_chars integer not null default 0,
  first_ticket jsonb
);
create index if not exists companion_live_calls_user_idx on companion_live_calls (user_id, started_at desc);
create index if not exists companion_messages_voice_idx on companion_messages (voice_key) where voice_key is not null;
-- A character's face kit (lib/face-kit.ts; docs/PRDs/digital-human.md Tier 0): the stills and the loop a companion call's
-- face is played from, one row a part, made from one approved safe portrait (source_id: the asset, or a house file's path).
-- PG-checked before it's kept; bytes in the companion area of the object store (data stays null there).
create table if not exists face_kits (
  id text primary key,
  character_id text not null references characters (id) on delete cascade,
  source_id text not null,
  part text not null check (part in ('portrait', 'mouth_small', 'mouth_open', 'mouth_round', 'blink', 'smile', 'surprised', 'talk', 'loop')),
  status text not null check (status in ('making', 'ready', 'failed')),
  model text,
  queue_id text,
  mime text,
  data bytea,
  object_key text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists face_kits_one on face_kits (character_id, source_id, part);
-- 2026-11-15: the talking still (lib/face-kit-shared.ts TALK_STILL, the mouth at rest that Ditto animates), widened in place.
alter table face_kits drop constraint if exists face_kits_part_check;
alter table face_kits add constraint face_kits_part_check
  check (part in ('portrait', 'mouth_small', 'mouth_open', 'mouth_round', 'blink', 'smile', 'surprised', 'talk', 'loop'));
-- The show kit's shots (lib/show-shots.ts; docs/PRDs/styles-and-storylines.md phase 3): six expressions and three moments
-- per contestant, drawn free on Workers AI from the portrait they have now (portrait_key: the asset's id, or "static:" and
-- a house file's path) in their art style. PG-checked, explicit question and all, before it's kept; bytes in the looks
-- area of the object store (data stays null there). Pages read only the current portrait's and style's.
create table if not exists show_shots (
  id text primary key,
  character_id text not null references characters (id) on delete cascade,
  portrait_key text not null,
  style text not null,
  shot text not null check (shot in ('smitten', 'laughing', 'flustered', 'smug', 'unimpressed', 'heartbroken', 'reveal', 'rose', 'confessional')),
  status text not null check (status in ('making', 'ready', 'refused', 'failed')),
  model text,
  mime text,
  data bytea,
  object_key text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists show_shots_one on show_shots (character_id, portrait_key, style, shot);
create index if not exists show_shots_ready_idx on show_shots (character_id) where status = 'ready';
-- An admin's redo of one shot is a new take, drawn from a new seed (lib/show-shots.ts shotSeed); 0 is the first.
alter table show_shots add column if not exists take integer not null default 0;
-- A character's live face at a renderer (lib/live-face/index.ts; docs/PRDs/digital-human.md Tier 1): one per character per
-- kit portrait per provider, built by an admin (hours), the renderer's face id once it exists. Sessions aren't rows:
-- a call's face time is on companion_live_calls (face_provider, face_seconds) for the spend view.
create table if not exists live_faces (
  id text primary key,
  character_id text not null references characters (id) on delete cascade,
  source_id text not null,
  provider text not null,
  provider_face_id text,
  status text not null check (status in ('making', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists live_faces_one on live_faces (character_id, source_id, provider);
-- The renderer compare (lib/live-face/compare.ts): an admin's line voiced once and rendered by several renderers side by
-- side, with a 1–5 rating per render that accumulates per renderer. The audio and the clips live in the object store
-- (or the row, without one), like face_kits.
create table if not exists live_face_compares (
  id text primary key,
  user_id text not null,
  character_id text not null references characters (id) on delete cascade,
  line text not null,
  voice text not null,
  audio_seconds real,
  audio_key text,
  audio_data bytea,
  created_at timestamptz not null default now()
);
create table if not exists live_face_renders (
  id text primary key,
  compare_id text not null references live_face_compares (id) on delete cascade,
  renderer text not null,
  provider text not null,
  model text not null,
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  ms integer,
  cost_usd real,
  error text,
  rating smallint check (rating between 1 and 5),
  note text,
  mp4_key text,
  mp4_data bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists live_face_renders_compare on live_face_renders (compare_id);
-- A person's renderer for their own calls (auto = the server's setting): musetalk clips or the Simli stream.
create table if not exists user_live_face (
  user_id text primary key,
  renderer text not null,
  updated_at timestamptz not null default now()
);
alter table companion_live_calls add column if not exists face_provider text;
alter table companion_live_calls add column if not exists face_seconds integer not null default 0;
-- Ditto's clip library per character (lib/live-face/ditto-clips.ts): the idle and the reactions a call shows between and
-- around replies, rendered once from the kit's portrait; bytes in the object store (or the row, without one).
create table if not exists live_face_clips (
  id text primary key,
  character_id text not null references characters (id) on delete cascade,
  source_id text not null,
  kind text not null,
  status text not null check (status in ('making', 'ready', 'failed')),
  mime text,
  object_key text,
  data bytea,
  frames integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists live_face_clips_one on live_face_clips (character_id, source_id, kind);
-- Cast video intros (lib/cast-intros.ts): a short OmniHuman clip of a show character saying hello in their own voice,
-- rendered once from their portrait (David, 2026-11-14: the show's cast only, as a demo); the voice and the clip in
-- the object store (or the row, without one).
create table if not exists character_intros (
  id text primary key,
  character_id text not null references characters (id) on delete cascade,
  line text not null,
  voice text not null,
  renderer text not null,
  status text not null check (status in ('making', 'ready', 'failed')),
  audio_key text,
  audio_data bytea,
  seconds real,
  mime text,
  object_key text,
  data bytea,
  cost_usd real,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists character_intros_one on character_intros (character_id);
-- Subscription plans sold on a Stripe Payment Link (lib/paid-plans.ts): one row per person and plan.
create table if not exists plan_entitlements (
  user_id text not null,
  plan text not null,
  status text not null,
  period_end timestamptz,
  provider text not null default 'stripe',
  stripe_subscription_id text,
  -- The address they paid with (Stripe's checkout): the receipt and the yearly reminder go there.
  email text,
  subscribed_at timestamptz,
  renewal_reminded_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, plan)
);
create index if not exists plan_entitlements_sub_idx on plan_entitlements (stripe_subscription_id);
-- A Subscribe click: its random id goes to Stripe as client_reference_id, never the person's id.
create table if not exists plan_checkouts (
  id text primary key,
  user_id text not null,
  plan text not null,
  created_at timestamptz not null default now()
);
-- Each Stripe event, applied once.
create table if not exists plan_events (
  event_id text primary key,
  type text not null,
  plan text,
  user_id text,
  stripe_subscription_id text,
  outcome text not null,
  received_at timestamptz not null default now()
);
-- Hot takes the show derived once for a character with none of its own (lib/hot-takes.ts ensureHotTakes): {takes, source, at}.
alter table characters add column if not exists hot_takes jsonb;
-- More endings (lib/ending-detail.ts): which kind of its ending a date had (one_sided, slow_burn, walked_out, ghosted,
-- rivals), beside episodes.ending, which stays the family everything keys on. No check constraint: an unknown value
-- reads as none (lib/rules.ts endingDetailOf), so a kind added later needs no migration.
alter table episodes add column if not exists ending_detail text;
create index if not exists episodes_air_after_idx on episodes (air_after) where air_after is not null and revealed_at is null;
create index if not exists episodes_partner_performer_idx on episodes (partner_performer) where partner_performer is not null and status = 'generating';
-- Who may ask a character out by name when it's open to dates (lib/audience.ts): every character, only characters made
-- by people, or only characters made by agents. Checked against the asking character's created_via.
alter table characters add column if not exists open_audience text not null default 'everyone'
  check (open_audience in ('everyone', 'people', 'agents'));

-- Who the agents are: one row per MCP session (the Mcp-Session-Id we issue at initialize), or per agent
-- identity for a client that never initializes. agent_id is the anonymous identity it plays as (the same
-- UUID a browser keeps in bz_uid). Only what the client says about itself: its declared name and version
-- and a truncated user agent. No IP, no account, nothing personal.
create table if not exists mcp_sessions (
  id text primary key,
  agent_id text not null,
  client_name text,
  client_version text,
  user_agent text,
  calls integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists mcp_sessions_agent_idx on mcp_sessions (agent_id);
create index if not exists mcp_sessions_seen_idx on mcp_sessions (last_seen desc);
-- How far my_status has shown an agent its notifications (#540): the newest one it returned, or when it last looked.
-- my_status with wait_seconds and no since waits for something newer than this, so unread items the agent has already
-- been shown don't end the wait at once.
create table if not exists agent_status_cursors (
  agent_id text primary key,
  seen_at timestamptz not null
);
-- An agent linked to the account of the person it plays for (lib/agent-links.ts, the MCP tool link_account): the account
-- sees the agent's characters and dates and can give the agent back its id. Nothing moves, and the agent gets no access
-- to the account. One account per agent; a new link moves it.
create table if not exists agent_links (
  agent_id text primary key,
  user_id text not null,
  linked_at timestamptz not null default now()
);
create index if not exists agent_links_user_idx on agent_links (user_id);
-- The one-time links an agent hands its person: an hour each, used once, a new one replaces the agent's last. Only a
-- hash of the code is stored.
create table if not exists agent_link_codes (
  code_hash text primary key,
  agent_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists agent_link_codes_agent_idx on agent_link_codes (agent_id);
-- Every MCP call (lib/mcp.ts logCall), for the owner's analytics page (lib/agent-analytics.ts, /admin/analytics):
-- the method or tool and whether it worked, never its arguments. Pruned after 400 days (13 months) by the daily job.
create table if not exists mcp_calls (
  id bigserial primary key,
  session_id text,
  agent_id text,
  method text not null,
  tool text,
  ok boolean not null,
  error text,
  client_name text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_calls_created_idx on mcp_calls (created_at desc);
-- No index on (session_id, created_at) any more: no query looks calls up by session (lib/agent-analytics.ts groups a
-- time range, which mcp_calls_created_idx serves), and on 2026-11-22 it was 68 MB, scanned 6 times, last on 11-02.
-- Where it still exists it is dropped by hand (concurrently), not here.
-- What agents think of the show (lib/feedback.ts, send_feedback), read by the owner on /admin/feedback.
create table if not exists agent_feedback (
  id text primary key,
  agent_id text not null,
  session_id text,
  client_name text,
  rating integer check (rating between 1 and 10),
  liked text,
  wants text,
  problems text,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists agent_feedback_created_idx on agent_feedback (created_at desc);
create index if not exists agent_feedback_agent_idx on agent_feedback (agent_id, created_at desc);
-- The feedback board (lib/feedback.ts, 2026-10-18): what agents send goes on a board other agents read and vote on,
-- unless they keep it private. Feedback sent before the board was sent as private, so it stays off it (default false).
-- hidden_at: the owner took an item off the board.
alter table agent_feedback add column if not exists shared boolean not null default false;
alter table agent_feedback add column if not exists hidden_at timestamptz;
-- The model the agent says it runs on (send_feedback's model, 2026-10-20), so the owner sees how models differ.
alter table agent_feedback add column if not exists model text;
create table if not exists feedback_votes (
  feedback_id text not null references agent_feedback (id) on delete cascade,
  kind text not null check (kind in ('liked', 'wants', 'problems', 'message')),
  agent_id text not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (feedback_id, kind, agent_id)
);
create index if not exists feedback_votes_agent_idx on feedback_votes (agent_id, created_at desc);
-- What people think (lib/user-feedback.ts, the site's "Give us feedback", 2026-10-22), read by the owner on
-- /admin/feedback?tab=people. Apart from agent_feedback on purpose: agents' board and the home page's bot reviews never
-- read it. user_id is the session's id (anonymous or an account's); email only when they typed one, to reply. flagged:
-- the words failed the content filter (lib/safety.ts), kept anyway and only ever shown to the owner. ours: our own
-- checks (lib/our-traffic.ts), left out of the numbers by default. status and note are the owner's triage.
create table if not exists user_feedback (
  id text primary key,
  created_at timestamptz not null default now(),
  user_id text not null,
  account boolean not null default false,
  rating smallint check (rating between 0 and 10),
  category text not null default 'other' check (category in ('bug', 'idea', 'love', 'confusing', 'other')),
  message text check (char_length(message) <= 2000),
  email text check (char_length(email) <= 254),
  page text,
  viewport text,
  version text,
  user_agent text,
  flagged boolean not null default false,
  flag_reason text,
  ours boolean not null default false,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  note text check (char_length(note) <= 2000)
);
create index if not exists user_feedback_created_idx on user_feedback (created_at desc);
create index if not exists user_feedback_user_idx on user_feedback (user_id);
create index if not exists user_feedback_new_idx on user_feedback (created_at) where status = 'new';
-- When an account was shown the one-time beta prompt (lib/user-feedback-shared.ts), so another device doesn't ask again.
alter table accounts add column if not exists beta_prompt_at timestamptz;
-- The locked picture in a character's texts (lib/locked-picture.ts): what After Dark's regional rules said the last time
-- this account opened one of its threads having said it is 18+ ('open', 'text_only' or 'blocked': the mode alone, never
-- a country, a state or an address), and when. A job writes those texts with no request to read a place from, and sends
-- one only to an account seen 'open' lately (lib/adult/locked-picture.ts whoMayBeSent). Gone with the account.
alter table accounts add column if not exists after_dark_seen_mode text;
alter table accounts add column if not exists after_dark_seen_at timestamptz;
-- The beta prompt asks "has this person had a date of theirs air?" on page loads, until it has been shown.
create index if not exists episodes_creator_idx on episodes (creator_id);

-- Launch guards (lib/limits.ts). One row per counted action; key is an HMAC of the client IP, never the IP.
-- Pruned after two days by the daily job.
create table if not exists rate_hits (
  bucket text not null,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_idx on rate_hits (bucket, key, at);
-- Dates run on the paid default model, per UTC day, so a flood can't spend past FRONTIER_DAILY_DATE_CAP.
create table if not exists paid_usage (
  day date primary key,
  dates integer not null default 0
);

-- Reports the owner has reviewed (lib/moderation.ts). Moved out of reports so they stop counting toward
-- REPORT_HIDE_THRESHOLD: 'cleared' puts the episode back, 'removed' made it private to its creator.
create table if not exists reports_reviewed (
  episode_id text not null references episodes (id) on delete cascade,
  reporter_id text not null,
  reason text not null,
  created_at timestamptz not null,
  reviewed_at timestamptz not null default now(),
  decision text not null check (decision in ('cleared', 'removed')),
  primary key (episode_id, reporter_id)
);
create index if not exists reports_reviewed_reporter_idx on reports_reviewed (reporter_id);

-- Refunds (lib/payments.ts refundForPayment): the Stripe PaymentIntent a paid session settled, so a charge.refunded
-- event can find its order (the event carries the payment, not the session).
alter table orders add column if not exists stripe_payment_intent text;
create index if not exists orders_payment_intent_idx on orders (stripe_payment_intent);
-- 2026-11-14: the Payment Link (plink_…) that paid an order, now that each pack has its own link. Once a link has paid
-- for one sku, a session on that link can't pay for another (lib/payments.ts grantOrder): a $4 link never buys the $10 pack.
alter table orders add column if not exists stripe_payment_link text;
create index if not exists orders_payment_link_idx on orders (stripe_payment_link) where stripe_payment_link is not null;

-- Server errors (lib/errors.ts): a short row per unexpected error, reported by GET /api/health so the owner hears about
-- them. Route patterns and cleaned messages only, never a request body. Pruned after a week by the daily job.
create table if not exists server_errors (
  at timestamptz not null default now(),
  kind text not null,
  route text not null,
  message text not null
);
create index if not exists server_errors_at_idx on server_errors (at);

-- How each part of a background job went (lib/job-meter.ts): time, memory and event-loop stalls per step, numbers only.
-- The daily job's 504s on 2026-11-11 left no trace once the instance restarted. Kept 30 days.
create table if not exists job_runs (
  id bigserial primary key,
  job text not null,
  part text not null,
  at timestamptz not null default now(),
  ms integer not null,
  report jsonb not null
);
create index if not exists job_runs_job_at_idx on job_runs (job, at desc);

-- The servers' own log (lib/ops-log.ts; 2026-11-22 audit): what used to live only in the container's output, which every
-- deploy wipes. A row when a server starts (its commit and memory limit), when a date failed or was written (the model,
-- calls, time, tokens and cost) and when a part of the daily job failed or was cut off. Ids, counts and short reasons
-- only, never a word of a date or who anyone is. /admin shows it; the daily job keeps 30 days.
create table if not exists ops_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  host text not null,
  event text not null,
  props jsonb not null default '{}'::jsonb
);
create index if not exists ops_log_at_idx on ops_log (at);

-- Places a date went that the library has no set for yet (lib/scenes.ts): a plan two characters agreed to by text, or a
-- move on the date. The date shows a generic background with the place's name; this tells the owner which sets to make
-- next. One row per date and place, logged when the date is finished.
create table if not exists scene_requests (
  episode_id text not null references episodes (id) on delete cascade,
  normalized text not null,
  label text not null,
  kind text not null check (kind in ('plan', 'move')),
  created_at timestamptz not null default now(),
  primary key (episode_id, normalized)
);
create index if not exists scene_requests_normalized_idx on scene_requests (normalized);
-- Set the scene on a filming date (lib/scene-suggestions.ts): a paid place the producer suggests; kept if they go.
create table if not exists scene_suggestions (
  id text primary key,
  episode_id text not null references episodes (id) on delete cascade,
  user_id text not null,
  place text not null,
  label text not null,
  tokens integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'proposed', 'moved', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scene_suggestions_episode_idx on scene_suggestions (episode_id);
-- Drawn sets for places of their own (lib/sets.ts): one per place, drawn once on fal and screened by Hive.
create table if not exists place_sets (
  normalized text primary key,
  label text not null,
  status text not null check (status in ('drawing', 'ready', 'refused', 'failed')),
  reason text,
  mime text,
  data bytea,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A set whose check couldn't run (a Hive 429, an outage) is tried again with a growing delay (lib/sets.ts), its
-- picture kept and never shown until it passes.
alter table place_sets add column if not exists attempts integer not null default 0;
alter table place_sets add column if not exists retry_at timestamptz;
-- The looks builder's picture tiles (lib/looks.ts, lib/looks-draw.ts): one per option, drawn once and screened by Hive.
-- 'nsfw' tiles are After Dark's: served only to an account that can open it.
create table if not exists look_tiles (
  id text primary key,
  variant text not null check (variant in ('pg', 'nsfw')),
  status text not null check (status in ('drawing', 'ready', 'refused', 'failed')),
  prompt text not null,
  reason text,
  mime text,
  data bytea,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table look_tiles add column if not exists remote_url text;

-- After dark (lib/adult, admin only, local only): the adult season's private scenes, between two of this season's house
-- characters. Kept out of every other table, so nothing explicit can reach the feed, the cast, the swipe deck, texts,
-- memory or any public page.
create table if not exists adult_scenes (
  id text primary key,
  owner_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  lines jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, character_a, character_b)
);
-- Where the scene is now and how far it's gone (David, 2026-10-18: "we were at a cafe"), and the last picture problem.
alter table adult_scenes add column if not exists place text;
alter table adult_scenes add column if not exists stage integer not null default 0;
alter table adult_scenes add column if not exists stage_from integer not null default 0;
alter table adult_scenes add column if not exists picture_note text;
-- The set they're on (a short place name, drawn once by lib/sets.ts), and a paid "Set the scene" the next lines react to.
alter table adult_scenes add column if not exists set_place text;
alter table adult_scenes add column if not exists cut_to text;
-- Chapters (lib/adult/scenes.ts): a long night is filed a chapter at a time, with a running recap the next chapter
-- remembers, and the last few lines carried over so the talk runs on.
alter table adult_scenes add column if not exists chapter integer not null default 1;
alter table adult_scenes add column if not exists recap text;
alter table adult_scenes add column if not exists prev_tail jsonb not null default '[]';
-- Finished scenes, kept like dates (David, 2026-10-19: "save them and be able to play them back"): Start over files the
-- running scene here instead of wiping it. Owner-only, like everything after dark.
create table if not exists adult_nights (
  id text primary key,
  owner_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  lines jsonb not null,
  place text,
  stage integer not null default 0,
  date_setting text,
  date_venue text,
  created_at timestamptz not null default now()
);
alter table adult_nights add column if not exists set_place text;
alter table adult_nights add column if not exists chapter integer;
alter table adult_nights add column if not exists recap text;
-- Continuity (lib/adult/continuity.ts): where the night has been (each stop's place, set, whose home), and the moves the
-- model reported this chapter, taken or not (the observer reads the ones that weren't, scripts/eval/after-dark-observer.mjs).
alter table adult_scenes add column if not exists place_history jsonb not null default '[]';
alter table adult_scenes add column if not exists moves jsonb not null default '[]';
alter table adult_nights add column if not exists moves jsonb;
alter table adult_nights add column if not exists place_history jsonb;
-- What After Dark left behind, in the show's terms (lib/adult/memory.ts): one PG note per character about the other,
-- carried into their next date and texts. Never a scene line.
create table if not exists adult_memories (
  character_id text not null references characters (id) on delete cascade,
  other_id text not null references characters (id) on delete cascade,
  owner_id text not null,
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (character_id, other_id)
);
create index if not exists adult_nights_pair on adult_nights (owner_id, character_a, character_b, created_at desc);

-- After dark on the cloud (lib/adult/settings.ts): one row, set by an admin. The provider keys are sealed like BYOK
-- keys and never shown again (only their last four).
create table if not exists adult_settings (
  id integer primary key check (id = 1),
  enabled boolean not null default false,
  text_model text,
  image_model text,
  video_model text,
  openrouter_ciphertext text,
  openrouter_nonce text,
  openrouter_last4 text,
  fal_ciphertext text,
  fal_nonce text,
  fal_last4 text,
  updated_at timestamptz not null default now()
);
-- The output check's keys (Hive: visual moderation and demographics are separate projects with their own keys).
alter table adult_settings add column if not exists hive_mod_ciphertext text;
alter table adult_settings add column if not exists hive_mod_nonce text;
alter table adult_settings add column if not exists hive_mod_last4 text;
alter table adult_settings add column if not exists hive_demo_ciphertext text;
alter table adult_settings add column if not exists hive_demo_nonce text;
alter table adult_settings add column if not exists hive_demo_last4 text;
-- Hive's V3 portal: one secret key for both models (visual moderation + the VLM age check). The two columns sets above
-- are from the V2 design and unused.
alter table adult_settings add column if not exists hive_ciphertext text;
alter table adult_settings add column if not exists hive_nonce text;
alter table adult_settings add column if not exists hive_last4 text;
-- Pictures on Venice (fal bans explicit output): the provider switch, its model, and its key.
alter table adult_settings add column if not exists image_provider text;
alter table adult_settings add column if not exists venice_image_model text;
alter table adult_settings add column if not exists venice_ciphertext text;
alter table adult_settings add column if not exists venice_nonce text;
alter table adult_settings add column if not exists venice_last4 text;
-- The full-night video (lib/adult/reels.ts): its model, shots and price, and each reel made.
alter table adult_settings add column if not exists reel_model text;
alter table adult_settings add column if not exists reel_shots integer;
alter table adult_settings add column if not exists reel_tokens integer;
create table if not exists adult_reels (
  id text primary key,
  owner_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  status text not null check (status in ('making', 'ready', 'failed')),
  tokens integer not null default 0,
  shots jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adult_reels_pair on adult_reels (owner_id, character_a, character_b, created_at desc);
-- Clips on demand (lib/adult/clips.ts, 2026-10-22): a clip is a reel of one shot, from the act menu or the scene's
-- latest moment, that can be kept going. kind: 'night' (every reel before) or 'clip'; clip: its act, who leads, the clip
-- it keeps going from, its stage and place, and what the list calls it. Its price in bought tokens: clip_tokens.
alter table adult_reels add column if not exists kind text not null default 'night';
alter table adult_reels add column if not exists clip jsonb;
alter table adult_settings add column if not exists clip_tokens integer;
-- A picture from the shot menu (lib/adult/pictures-menu.ts, 2026-10-22): its price in bought tokens.
alter table adult_settings add column if not exists menu_picture_tokens integer;
-- A chapter's price in bought tokens, and the pictures drawn for it without being asked (David, 2026-10-25: "allowing
-- 1-3 generated images for each chapter as long as each chapter cost 1 token"). Null: the defaults in lib/adult/settings.ts.
alter table adult_settings add column if not exists chapter_tokens integer;
alter table adult_settings add column if not exists pictures_per_chapter integer;
-- Every image the output check refused: never the image itself, only why (for the admin to see it's working).
create table if not exists adult_rejections (
  id text primary key,
  owner_id text not null,
  kind text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
-- An admin's own characters switched on for after dark (the season cast always is). Never anyone else's.
create table if not exists adult_characters (
  character_id text primary key references characters (id) on delete cascade,
  owner_id text not null,
  enabled_at timestamptz not null default now()
);
-- Pictures and clips from after dark: private bytes, served only to an admin (app/api/admin/after-dark/media).
create table if not exists adult_images (
  id text primary key,
  owner_id text not null,
  character_id text references characters (id) on delete cascade,
  character_b text references characters (id) on delete cascade,
  kind text not null check (kind in ('baseline', 'scene', 'video', 'frame')),
  prompt text not null,
  mime text not null,
  data bytea,
  remote_url text,
  status text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  request_id text,
  source_image text,
  created_at timestamptz not null default now()
);
create index if not exists adult_images_character_idx on adult_images (character_id, created_at desc);
-- Where a file's bytes are when they're in the private bucket (lib/object-store.ts), not in data: a new file has
-- only this; one moved by scripts/media-to-object-store.mjs has both until its data is freed. Same for look_tiles.
alter table adult_images add column if not exists object_key text;
-- When a clip already in the bucket was brought up to a new clip's bytes (faststart + mark; lib/adult/faststart-backfill.ts).
alter table adult_images add column if not exists faststart_at timestamptz;
-- When a clip was rewritten under a fresh content-hash key so the CDN serves it (lib/adult/faststart-backfill.ts rekeyClips).
alter table adult_images add column if not exists rekeyed_at timestamptz;
-- Every step of an After Dark scene, for the admin's /why view (lib/adult/steps.ts, 2026-10-22): the steer or place
-- asked for, what came of it (the lines added, the ones dropped and why) or the error. night_id once its chapter is filed.
create table if not exists adult_steps (
  id text primary key,
  owner_id text not null,
  character_a text not null,
  character_b text not null,
  scene_id text,
  night_id text,
  chapter integer not null default 1,
  kind text not null,
  direction text,
  steer_mode text,
  status text not null,
  http integer,
  message text,
  line_from integer,
  line_to integer,
  added integer not null default 0,
  dropped jsonb not null default '[]',
  flags jsonb,
  created_at timestamptz not null default now()
);
create index if not exists adult_steps_pair on adult_steps (owner_id, character_a, character_b, created_at);
alter table look_tiles add column if not exists object_key text;
-- A reel shot's keyframe ('frame', lib/adult/reels.ts: the two of them, the picture its video starts from; before
-- 2026-10-22, a shot's last frame): widen the CHECK on an existing database (the inline one above only applies to a
-- fresh table), once.
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'adult_images_kind_check'
       and pg_get_constraintdef(oid) not like '%frame%'
  ) then
    alter table adult_images drop constraint if exists adult_images_kind_check;
    alter table adult_images add constraint adult_images_kind_check check (kind in ('baseline', 'scene', 'video', 'frame'));
  end if;
end $$;
-- Replicate as the backup for After Dark's media (lib/adult/replicate.ts, David 2026-10-22): which provider makes it,
-- the Replicate models, an optional LoRA for its videos, and its key, sealed like the others. Its video model is
-- silent, so a shot's line is said by a stock voice beside it ('audio', lib/adult/reels.ts): widen the CHECK once
-- more, as for 'frame'.
alter table adult_settings add column if not exists media_provider text;
alter table adult_settings add column if not exists replicate_picture_model text;
alter table adult_settings add column if not exists replicate_keyframe_model text;
alter table adult_settings add column if not exists replicate_video_model text;
alter table adult_settings add column if not exists replicate_voice_model text;
alter table adult_settings add column if not exists replicate_video_lora text;
alter table adult_settings add column if not exists replicate_ciphertext text;
alter table adult_settings add column if not exists replicate_nonce text;
alter table adult_settings add column if not exists replicate_last4 text;
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'adult_images_kind_check'
       and pg_get_constraintdef(oid) not like '%audio%'
  ) then
    alter table adult_images drop constraint if exists adult_images_kind_check;
    alter table adult_images add constraint adult_images_kind_check check (kind in ('baseline', 'scene', 'video', 'frame', 'audio'));
  end if;
end $$;
-- A baseline of an old face (2026-11-04: Carson Vallis's from before the recast) can be 'retired': its file is kept, and
-- nothing that picks a ready picture picks it, so the next baseline is drawn from the face they have now.
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'adult_images_status_check'
       and pg_get_constraintdef(oid) not like '%retired%'
  ) then
    alter table adult_images drop constraint if exists adult_images_status_check;
    alter table adult_images add constraint adult_images_status_check check (status in ('pending', 'ready', 'failed', 'retired'));
  end if;
end $$;
-- Agents (not the admin's) asking for after dark: the admins see them on the settings page.
create table if not exists adult_access_requests (
  id text primary key,
  agent_id text not null,
  client_name text,
  reason text not null,
  created_at timestamptz not null default now()
);
-- 2026-10-23: a request has a status the agent can read (my_status), and asking again within 30 days is the same request.
alter table adult_access_requests add column if not exists status text not null default 'pending';
alter table adult_access_requests add column if not exists decided_at timestamptz;

-- Who may use after dark besides an admin (docs/after-dark.md #2): an active subscription (from the adult payment
-- processor's webhook) AND a passed age check (from the age-verification provider). 2026-10-24: the processors'
-- postbacks write the subscription (lib/adult/billing.ts; 'cancelled' keeps access until period_end) and subscribing
-- records the 18+ self-declaration; until a processor is configured, after dark stays admin-only.
create table if not exists adult_entitlements (
  user_id text primary key,
  subscription_status text not null default 'none' check (subscription_status in ('none', 'active', 'lapsed', 'cancelled')),
  period_end timestamptz,
  age_verified_at timestamptz,
  provider text,
  updated_at timestamptz not null default now()
);
-- 2026-10-24 (docs/after-dark-legal-review.md): how the age was checked and where. Outside the places that want a real
-- check (lib/jurisdiction.ts) it's the person's own 18+ declaration ('self_declared'); a provider's check names itself.
alter table adult_entitlements add column if not exists age_method text;
alter table adult_entitlements add column if not exists age_country text;
-- The invite-only beta (lib/adult/invites.ts; David, 2026-10-31: "invite only, email me and I approve"): one request a
-- person, answered from the approval email. Approving writes a 'beta' pass to adult_entitlements.
create table if not exists adult_invites (
  user_id text primary key,
  email text not null,
  note text,
  country text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
-- Where the request came from (lib/adult/bridge.ts inviteSource): a short label from the link's ?source= ("verdict":
-- the show's verdict card; "refugees": an outreach post), null for the subscribe page opened any other way.
alter table adult_invites add column if not exists source text;
-- A free taste of After Dark (lib/adult/taste.ts): one per person ever, scenes only for 48 hours; writes counts its steps.
create table if not exists adult_tastes (
  user_id text primary key,
  country text,
  started_at timestamptz not null default now(),
  writes integer not null default 0
);
create index if not exists adult_tastes_started on adult_tastes (started_at);
-- A real age check through Didit (lib/adult/age-check.ts, 2026-11-09): opens After Dark in the UK, Australia and Brazil
-- for a year. Only whether it passed, how, when and the country: never a selfie, an ID, a birth date or Didit's payload.
create table if not exists adult_age_checks (
  user_id text primary key,
  passed boolean not null,
  method text not null default 'didit',
  checked_at timestamptz not null default now(),
  country text
);
-- The mode After Dark last had for someone, from where they last connected (lib/adult/place.ts): background work that
-- has no request (a chapter's picture, a video of the night) asks here, so text-only or blocked places get no media.
-- A country and a US state, never an address or an IP; kept only while the account is.
create table if not exists adult_viewer_places (
  user_id text primary key,
  mode text not null check (mode in ('open', 'text_only', 'blocked')),
  country text,
  region text,
  seen_at timestamptz not null default now()
);
-- After Dark's subscription billing (lib/adult/billing.ts, 2026-10-24): Segpay first, Verotel as backup, both off until
-- their settings exist. One order per checkout started; its id is the reference the processor hands back (Verotel
-- referenceID, Segpay REF1), and sale_id the processor's subscription once paid (Verotel saleID, Segpay purchaseid).
-- user_id is cleared when the account is deleted: the order stays, unlinked, for a chargeback dispute.
create table if not exists adult_billing_orders (
  id text primary key,
  user_id text,
  processor text not null check (processor in ('segpay', 'verotel')),
  price_usd numeric(8, 2) not null,
  sale_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
-- CCBill joined Segpay and Verotel (2026-10-30, lib/adult/billing-ccbill.ts).
alter table adult_billing_orders drop constraint if exists adult_billing_orders_processor_check;
alter table adult_billing_orders add constraint adult_billing_orders_processor_check check (processor in ('ccbill', 'segpay', 'verotel'));
create index if not exists adult_billing_orders_user_idx on adult_billing_orders (user_id, created_at desc);
create index if not exists adult_billing_orders_sale_idx on adult_billing_orders (processor, sale_id);
-- Every postback received, verified or not applied. event_key is the processor's transaction id when it sends one (the
-- same transaction twice is applied once), else a fingerprint of the postback. params keeps identifiers, amounts and
-- dates only: never card digits, names, emails, addresses or IPs. user_id is cleared when the account is deleted.
create table if not exists adult_billing_events (
  id text primary key,
  processor text not null,
  event_key text not null,
  fingerprint text not null,
  kind text not null,
  raw_event text not null,
  order_id text,
  user_id text,
  sale_id text,
  amount text,
  currency text,
  params jsonb not null default '{}'::jsonb,
  outcome text not null,
  received_at timestamptz not null default now(),
  unique (processor, event_key)
);
create index if not exists adult_billing_events_received_idx on adult_billing_events (received_at desc);
create index if not exists adult_billing_events_sale_idx on adult_billing_events (processor, sale_id, received_at desc);
-- An account a chargeback or a refund ended: subscribing again waits for an admin to look (reviewed_at). Deleted with
-- the account.
create table if not exists adult_billing_flags (
  user_id text primary key,
  reason text not null,
  processor text not null,
  flagged_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
-- After Dark's own token packs (lib/adult/tokens.ts, David 2026-11-04: "I agree with your price analysis, lets do it"):
-- one-time orders on the same processors, about $1 a token. kind says which an order is; tokens, how many it buys.
alter table adult_billing_orders add column if not exists kind text not null default 'subscription';
alter table adult_billing_orders add column if not exists tokens integer;
-- After Dark's token balance, apart from the show's (Stripe never pays for adult extras): a grant per paid pack (order_id,
-- once) or admin top-up, minus what's been spent (adult_token_usage, one row a person, like pack_episode_usage). A
-- refund or chargeback revokes its pack's grant. Deleted with the account.
create table if not exists adult_token_grants (
  id text primary key,
  user_id text not null,
  tokens integer not null check (tokens > 0),
  order_id text unique,
  granted_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists adult_token_grants_user_idx on adult_token_grants (user_id);
create table if not exists adult_token_usage (
  user_id text primary key,
  used integer not null default 0 check (used >= 0)
);
-- When the current run of a subscription began (for California's yearly reminder, on each anniversary) and when that
-- reminder last went.
alter table adult_entitlements add column if not exists subscribed_at timestamptz;
alter table adult_entitlements add column if not exists renewal_reminded_at timestamptz;
-- The operator pass (docs/PRDs/agent-world.md Phase 0, lib/operator-pass.ts) — a NON-adult agent-operator subscription,
-- kept apart from After Dark's tables above. Keyed on agent_id (= user_id). Built complete and off: nothing reads these
-- unless OPERATOR_PASS_ENABLED=1 or OPERATOR_PASS_LINK is set, so empty tables change nothing live.
create table if not exists operator_entitlements (
  user_id text primary key,
  subscription_status text not null default 'none' check (subscription_status in ('none', 'active', 'lapsed', 'cancelled')),
  period_end timestamptz,
  provider text,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);
create index if not exists operator_entitlements_sub_idx on operator_entitlements (stripe_subscription_id);
-- A date spent from an operator pass's reserved pool (lib/operator-pass): it's left out of the shared agent cap
-- (lib/dating agentDatesToday). Default false, so until a pass is active it's false on every row and changes nothing.
alter table episodes add column if not exists operator_reserved boolean not null default false;
-- A public handle per AI agent (docs/PRDs/agent-world.md Phase 1, lib/agent-handle.ts): a safe, published alias for an
-- agent in URLs and on its profile page. NEVER the agent_id, which is a bearer token. Assigned the first time it's needed.
create table if not exists agent_handles (
  agent_id text primary key,
  handle text not null unique,
  created_at timestamptz not null default now()
);
-- An agent's public display name and bio for its profile (lib/agent-handle setAgentProfile), content-filtered and link-free.
alter table agent_handles add column if not exists display_name text;
alter table agent_handles add column if not exists bio text;
-- Reserved show-model dates used this UTC month per pass-holder (resets monthly). Mirrors free_episode_usage's counter.
create table if not exists operator_date_usage (
  user_id text not null,
  period_month text not null,
  used int not null default 0,
  primary key (user_id, period_month)
);
-- Every Stripe webhook event for the pass, applied once (event_id unique). Mirrors adult_billing_events.
create table if not exists operator_pass_events (
  id text primary key,
  event_id text not null unique,
  type text not null,
  user_id text,
  stripe_subscription_id text,
  outcome text not null,
  received_at timestamptz not null default now()
);
-- Each person's own character switches (their characters, and the house characters they bring along).
create table if not exists adult_switches (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  enabled_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
insert into adult_switches (owner_id, character_id, enabled_at)
  select owner_id, character_id, enabled_at from adult_characters on conflict do nothing;
-- The margin guard (docs/after-dark.md #5): each person's generations this month. Admins aren't capped.
create table if not exists adult_usage (
  owner_id text not null,
  month text not null,
  writes integer not null default 0,
  pictures integer not null default 0,
  clips integer not null default 0,
  primary key (owner_id, month)
);
alter table adult_settings add column if not exists cap_writes integer not null default 300;
-- The base model for fal's custom-model endpoint (fal-ai/lora): a Hugging Face id.
alter table adult_settings add column if not exists image_base text;
alter table adult_settings add column if not exists cap_pictures integer not null default 30;
alter table adult_settings add column if not exists cap_clips integer not null default 5;
-- Voiced nights (lib/adult/voice-lines.ts, 2026-10-22): each line's audio made once, in its character's stock voice, and
-- found again by a key of the owner, the voice and the words (an adult_images 'audio'); a monthly cap per subscriber.
create table if not exists adult_voice_lines (
  owner_id text not null,
  key text not null,
  image_id text not null,
  voice text not null,
  chars integer not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, key)
);
alter table adult_usage add column if not exists voice_lines integer not null default 0;
alter table adult_settings add column if not exists cap_voice_lines integer not null default 2000;
-- The theater, more alive (docs/PRDs/theater-immersion.md): who voices the lines, and the living portrait's model.
alter table adult_settings add column if not exists voice_model text;
alter table adult_settings add column if not exists presence_loop_model text;
alter table adult_settings add column if not exists place_sounds boolean;
alter table adult_settings add column if not exists place_sound_model text;
alter table adult_settings add column if not exists talk_model text;
alter table adult_settings add column if not exists draw_ahead boolean;
alter table adult_settings add column if not exists draw_ahead_tokens integer;
alter table adult_settings add column if not exists draw_ahead_pictures integer;
-- Draw ahead, the viewer's choice for a pair's nights (lib/adult/draw-ahead.ts): on or off, the chapter it was last paid
-- for, what that took and when, and how many of its moments were drawn ahead (none: the tokens go back).
alter table adult_scenes add column if not exists draw_ahead boolean not null default false;
alter table adult_scenes add column if not exists draw_ahead_chapter integer;
alter table adult_scenes add column if not exists draw_ahead_paid integer not null default 0;
alter table adult_scenes add column if not exists draw_ahead_at timestamptz;
alter table adult_scenes add column if not exists draw_ahead_used integer not null default 0;
-- Talking moments (lib/adult/talks.ts; docs/PRDs/theater-immersion.md #4): a few seconds of one of them saying a line,
-- lip-synced to its voice from their portrait. One per viewer, speaker and words (key); refunded when it can't be made.
create table if not exists adult_talks (
  id text primary key,
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  key text not null,
  who text not null check (who in ('a', 'b')),
  text text not null,
  status text not null default 'making' check (status in ('making', 'ready', 'failed')),
  model text,
  queue_id text,
  tokens integer not null default 0,
  mime text,
  data bytea,
  object_key text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, key)
);
-- Which direction made it (lib/adult/talks.ts TALK_VERSION): version 1's had subtitles burned in.
alter table adult_talks add column if not exists version integer not null default 1;
-- A character's profile photos (lib/studio/profile-photos.ts): up to nine of their owner's PG Studio pictures, pinned,
-- each served from its approved pg copy in character_assets.
create table if not exists profile_photos (
  character_id text not null references characters (id) on delete cascade,
  picture_id text not null,
  asset_id text not null,
  owner_id text not null,
  created_at timestamptz not null default now(),
  primary key (character_id, picture_id)
);
create index if not exists profile_photos_owner on profile_photos (owner_id, picture_id);
-- Date photos (lib/studio/date-photos.ts): a PG picture of the two of them from a finished date, kept with the date (never
-- in a Studio gallery), each served from its approved pg copy in character_assets.
create table if not exists date_photos (
  asset_id text primary key,
  episode_id text not null references episodes (id) on delete cascade,
  owner_id text not null,
  style text not null,
  created_at timestamptz not null default now()
);
create index if not exists date_photos_episode on date_photos (episode_id, created_at);
-- A small gift from one character to the other (lib/character-gifts.ts, 2026-11-16): fiction between the two, written by
-- rules after one of their dates aired publicly. One a date; it goes when its date does. giver: which end gave it; item:
-- the catalogue id (lib/gift-catalog.ts); reaction and reply: how the other took it. Never read by the engine.
create table if not exists character_gifts (
  id text primary key,
  episode_id text not null unique references episodes (id) on delete cascade,
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  giver text not null check (giver in ('lo', 'hi')),
  item text not null,
  name text not null,
  note text not null,
  reaction text not null check (reaction in ('touched', 'amused', 'unimpressed')),
  reply text not null,
  created_at timestamptz not null default now()
);
create index if not exists character_gifts_pair on character_gifts (character_lo, character_hi, created_at);
-- A scene picture's brief (lib/adult/picture-brief.ts): what the chapter says at the picture's moment (where they are,
-- what each has on, what's happening, the mood), read once by the fast writer and kept by what it read.
create table if not exists adult_picture_briefs (
  key text primary key,
  owner_id text not null,
  brief jsonb not null,
  cost double precision,
  created_at timestamptz not null default now()
);
create index if not exists adult_picture_briefs_owner on adult_picture_briefs (owner_id, created_at);
-- The sound of a place (lib/adult/place-sounds.ts; docs/PRDs/theater-immersion.md #6): one quiet looping bed per place,
-- made once and shared by every night there, like a drawn set. Nobody's in it, so it's nobody's.
create table if not exists place_sounds (
  id text primary key,
  key text not null unique,
  label text not null,
  status text not null default 'making' check (status in ('making', 'ready', 'failed')),
  model text,
  queue_id text,
  mime text,
  data bytea,
  object_key text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A character's presence for one viewer (lib/adult/presence.ts): their expressions and their living portrait, made once
-- from the face they keep for them. Its own table, so no gallery, library or export ever lists it.
create table if not exists adult_presence (
  id text primary key,
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  face_id text not null,
  part text not null check (part in ('portrait', 'expression', 'loop')),
  expression text,
  status text not null default 'making' check (status in ('making', 'ready', 'failed')),
  model text,
  queue_id text,
  mime text,
  data bytea,
  object_key text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Their portrait (2026-10-29): the base of the rest, added after the table was made.
alter table adult_presence drop constraint if exists adult_presence_part_check;
alter table adult_presence add constraint adult_presence_part_check check (part in ('portrait', 'expression', 'loop'));
create unique index if not exists adult_presence_one on adult_presence (owner_id, character_id, face_id, part, coalesce(expression, ''));
create index if not exists adult_presence_owner on adult_presence (owner_id, character_id);

-- Monthly seasons (David, 2026-10-19; lib/season-cast.ts): who's on each season's show, decided once on its first
-- read. 'dealt' from the old shuffle, 'survivor' the previous season's two most-loved, 'new' a newcomer.
-- season_cast_rotations is the one row a rotation claims first, so two cold starts can't both pick a cast.
create table if not exists season_casts (
  season_id text not null,
  character_id text not null references characters (id) on delete cascade,
  slot smallint not null,
  source text not null check (source in ('dealt', 'survivor', 'new')),
  created_at timestamptz not null default now(),
  primary key (season_id, character_id)
);
create table if not exists season_cast_rotations (
  season_id text primary key,
  rotated_at timestamptz not null default now()
);
-- Reviews of a character (lib/reviews.ts): one per reviewer per character, from a person or an agent, 1 to 5 stars
-- and an optional line. A season's reviews decide which two of its house cast stay on.
create table if not exists character_reviews (
  reviewer_id text not null,
  character_id text not null references characters (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  body text,
  via text not null default 'web' check (via in ('web', 'mcp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reviewer_id, character_id)
);
create index if not exists character_reviews_character_idx on character_reviews (character_id, updated_at desc);
-- A generated house character's physical look, for pictures only (lib/season-gen.ts); never shown, never read by the
-- engine. The code-defined cast keeps theirs in lib/house.ts.
alter table characters add column if not exists look text;
-- Next month's generated newcomers waiting for review (lib/season-gen.ts). portrait_asset is their PG portrait in the
-- asset ledger (pending until approved); check_note is 'passed' once Hive kept it, else why not.
create table if not exists season_candidates (
  character_id text primary key references characters (id) on delete cascade,
  season_id text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  archetype text,
  portrait_asset text,
  check_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists season_candidates_season_idx on season_candidates (season_id, status);
-- Who already knew whom before the show (lib/character-links.ts): a season's newcomers arrive as a linked pair, and one
-- knows someone returning. Lower id first, one link a pair; kind is a roleplay setup tag (rivals, second_chance,
-- fake_dating, friends_to_more). The date-derived graph (relationships) drops a pair with no dates; this never lapses.
create table if not exists character_links (
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  kind text not null,
  story text not null,
  source text not null default 'season_gen',
  created_at timestamptz not null default now(),
  primary key (character_a, character_b),
  check (character_a < character_b)
);
create index if not exists character_links_b_idx on character_links (character_b);
-- Private characters (David, 2026-10-19): listed in the /characters directory but not linked, and their card shows
-- only their name to anyone but the owner. House characters are always public.
alter table characters add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'private'));
-- 2.4.3: the originality check compares a new sheet with every character made in the last 48 hours (lib/originality.ts).
create index if not exists characters_created_idx on characters (created_at desc);
-- 2.4.3: when my_status last sent this session its static blocks (the house cast): compact: true leaves them out after.
alter table mcp_sessions add column if not exists status_static_at timestamptz;
-- 2.13.0 (#751): when this session's replies first named its agent_id (agent_id_note), so the note isn't on every reply.
alter table mcp_sessions add column if not exists id_noted_at timestamptz;
-- #437: a keyed hash of the address a session's initialize came from (lib/limits.ts visitorKey, never the address), so a
-- probe initialize and the real one from the same client can share one agent_id (lib/mcp.ts reusableAgent).
alter table mcp_sessions add column if not exists visitor text;
-- Simulated-visitor ratings (lib/real-metrics.ts), next to the real numbers on /admin/analytics. The loop runs on the
-- developer's Mac, so scripts/loop/post-ratings.mjs posts each run's averages here (POST /api/admin/sim-ratings).
create table if not exists sim_ratings (
  run text primary key,
  sha text,
  at timestamptz not null,
  overall_avg real,
  mcp_avg real,
  visitors integer not null default 0,
  posted_at timestamptz not null default now()
);
create index if not exists sim_ratings_at_idx on sim_ratings (at desc);
-- Quality runs (lib/quality-runs.ts): the golden set's side-by-side verdicts (scripts/eval/golden.mjs) and the nightly
-- After Dark observer's counts (scripts/eval/observer-nightly.mjs), posted from the developer's Mac to
-- POST /api/admin/quality and shown on /admin/analytics next to Real use. The same kind and label again replaces it.
create table if not exists quality_runs (
  id text primary key,
  kind text not null check (kind in ('after_dark_observer', 'golden')),
  at timestamptz not null,
  sha text,
  label text not null,
  metrics jsonb not null default '{}',
  posted_at timestamptz not null default now(),
  unique (kind, label)
);
create index if not exists quality_runs_at_idx on quality_runs (at desc);
-- A thumbs up or down on one line (lib/line-feedback.ts, app/ChatThread.tsx): a date's transcript line ('episode', the
-- ref is the episode) or an After Dark line ('after_dark', the ref is the running scene or a saved night; a scene's votes
-- move to the night it's filed as). One vote per person per line, and a 0 vote removes it. Real use counts them
-- (lib/real-metrics.ts), and scripts/eval/export-preferences.mjs turns them into a dataset for fine-tuning.
create table if not exists line_feedback (
  id text primary key,
  user_id text not null,
  kind text not null check (kind in ('episode', 'after_dark')),
  ref_id text not null,
  line_index integer not null check (line_index >= 0),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, ref_id, line_index)
);
create index if not exists line_feedback_ref_idx on line_feedback (kind, ref_id);
create index if not exists line_feedback_updated_idx on line_feedback (updated_at desc);
-- After Dark's scene writer (lib/adult/settings.ts, David 2026-10-21): its temperature and penalties, null keeping the
-- default (0.8, 0.3, 0.3, no repetition penalty), and which scene prompt runs (v2 unless set; v1 is the one before it).
alter table adult_settings add column if not exists text_temperature double precision;
alter table adult_settings add column if not exists frequency_penalty double precision;
alter table adult_settings add column if not exists presence_penalty double precision;
alter table adult_settings add column if not exists repetition_penalty double precision;
alter table adult_settings add column if not exists prompt_version text;
-- After Dark's structured memory (lib/adult/facts.ts): concrete things one character keeps about the other from their
-- nights (who said what, running jokes, pet names, promises, likes, boundaries), extracted when a chapter closes or a
-- night is saved and brought back a few at a time into the scene prompt. After Dark only: no date, text or page reads it.
create table if not exists adult_facts (
  id text primary key,
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  other_id text not null references characters (id) on delete cascade,
  kind text not null check (kind in ('said', 'joke', 'pet_name', 'promise', 'like', 'boundary', 'event')),
  fact text not null check (char_length(fact) <= 200),
  quote text check (char_length(quote) <= 160),
  source text not null default 'after_dark' check (source in ('after_dark', 'date')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  uses integer not null default 0
);
create index if not exists adult_facts_pair on adult_facts (owner_id, character_id, other_id);
-- After Dark's A/B (lib/adult/eval.ts): what the eval route spent each day (UTC), so its runs can't drain the OpenRouter
-- balance live scenes need. A run holds its share of the day before it starts and books what it really cost after.
create table if not exists adult_eval_spend (
  day text primary key,
  usd double precision not null default 0,
  runs integer not null default 0
);
-- After Dark's director (lib/adult/director.ts, lib/adult/scenes.ts; 2026-10-22): the last step's three suggested next
-- moves, the whispers still running (one each at most), and what a rewind needs to take steps back (a short stack,
-- newest last). A rewound step stays in the log, marked, with the lines it wrote; a whisper is kept on its step.
alter table adult_scenes add column if not exists suggestions jsonb not null default '[]';
alter table adult_scenes add column if not exists whispers jsonb not null default '{}';
alter table adult_scenes add column if not exists undo jsonb not null default '[]';
alter table adult_steps add column if not exists whisper jsonb;
alter table adult_steps add column if not exists rewound jsonb;
-- The viewer's limits for a pair (lib/adult/limits.ts; 2026-10-22), per owner and pair, kept through Start over: the
-- intensity (null is explicit, After Dark as it was) and the hard nos ({chips: [...], own: [...]}).
alter table adult_scenes add column if not exists intensity text;
alter table adult_scenes add column if not exists hard_nos jsonb not null default '{}';
-- Scenarios, turn-ons and framing (lib/adult/scenarios.ts, lib/adult/profile.ts; 2026-10-22): how the viewer frames the
-- pair (kept through Start over), the scenario tonight started from (cleared by Start over), and each character's private
-- turn-ons. Never in characters.extras: the show reads extras, and the house cast's upsert rewrites it.
alter table adult_scenes add column if not exists framing text;
alter table adult_scenes add column if not exists scenario text;
-- This chapter's roleplay (lib/adult/roleplays.ts): { id, swap, chapter }, read only while that chapter runs.
alter table adult_scenes add column if not exists roleplay jsonb;
create table if not exists adult_profiles (
  character_id text primary key references characters (id) on delete cascade,
  turn_ons jsonb not null default '[]',
  updated_by text,
  updated_at timestamptz not null default now()
);
-- After Dark v2.3 (lib/adult/auto-pictures.ts; 2026-10-23): the automatic pictures a scene has claimed (one per chapter
-- and place, so a retry or a rewind never draws twice), the chapter and place a picture was drawn for, and the switch
-- for them (null is on). Filthy, v2.3's intensity above explicit, is one more value of adult_scenes.intensity.
alter table adult_scenes add column if not exists auto_pictures jsonb not null default '[]';
alter table adult_images add column if not exists scene_chapter integer;
alter table adult_images add column if not exists scene_place text;
alter table adult_settings add column if not exists auto_scene_pictures boolean;
-- Marketing + agent funnel analytics (lib/agent-funnel.ts). user_id is an agent_id or an anon id; event is a
-- small enum. The partial unique index makes agent_first_* events idempotent per user, so a tool that
-- re-fires on retry never inflates the count.
create table if not exists analytics_events (
  id bigserial primary key,
  user_id text not null,
  event text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists analytics_events_firsts_idx on analytics_events (user_id, event)
  where event in ('agent_initialize', 'agent_first_character', 'agent_first_date', 'agent_day_7_return');
create index if not exists analytics_events_event_idx on analytics_events (event, created_at desc);
-- The cross-species booking log (lib/agent-funnel.ts recordCrossSpecies), once per pair: 'pair:<lo>:<hi>'. The rows from
-- before it are keyed by episode id and fall outside this index.
--
-- The north-star COUNT doesn't read these rows: it's derived from the dates themselves at query time
-- (lib/agent-funnel.ts crossSpeciesPairs), so private, unfinished, our own and self-linked pairs never count, whatever
-- was logged. That matters because #666 (2026-10-22) ran two one-way statements here on prod: it stripped the owner ids
-- from the old episode-keyed rows (they can't be restored, so those rows can't be told apart as ours or real), and it
-- backfilled a 'pair:' row for every past web × MCP pair, private and test pairs included. Both are gone from this
-- schema (a backfill doesn't belong in ensureSchema); the count reads correctly without either. docs/data-plan.md.
create unique index if not exists analytics_events_cross_species_pair_idx on analytics_events (user_id, event)
  where event = 'cross_species_match' and user_id like 'pair:%';

-- Opt-in consent to use a person's data for machine learning (lib/ml-consent.ts; David, 2026-10-22). Recording never
-- depends on it: only what goes into a training or evaluation dataset does. No row means no. An agent linked to an
-- account (agent_links) follows its person's choice.
create table if not exists ml_consents (
  user_id text primary key,
  granted boolean not null,
  version text not null,
  decided_at timestamptz not null default now()
);

-- Concept embeddings for the originality-by-concept check (lib/originality-concept.ts). One row per
-- character; absence means "not yet embedded" and the word-based check still runs.
create table if not exists character_embeddings (
  character_id text primary key references characters (id) on delete cascade,
  embedding jsonb not null,
  created_at timestamptz not null default now()
);
-- Data plan Tier 2 (2026-10-22): which model made it and a hash of the exact text, so an unchanged character never
-- re-embeds and a model change re-embeds everyone (vectors from two models don't compare).
alter table character_embeddings add column if not exists model text;
alter table character_embeddings add column if not exists text_hash text;
-- Concept-embedding calls per UTC day, every caller together (lib/originality-concept.ts claimEmbedCall), so a flood of
-- drafts can't spend past EMBED_DAILY_CAP. Counts only.
create table if not exists embed_usage (
  day date primary key,
  calls integer not null default 0
);

-- Data plan Tier 1 (David, 2026-10-22): stop losing the data that shows what people and agents actually chose. All
-- append-only, written best effort (a failed write never breaks the action), never After Dark. Consent (ml_consents)
-- gates what goes into a dataset, not what's recorded; every dataset builder filters through it.
--
-- A pair's timeline: one row per layer whose stage changed (lib/relationships.ts refreshRelationship), so first met,
-- became exes and rekindled are events, not overwritten values. 'all' can reflect private dates: owners and engine only.
create table if not exists relationship_events (
  id bigserial primary key,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  layer text not null check (layer in ('public', 'all')),
  from_stage text,
  to_stage text,
  episode_id text references episodes (id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists relationship_events_pair on relationship_events (character_a, character_b, at);
-- What a deck actually showed (lib/swipes.ts logImpressions): rank, score, surface. With swipes, the shown-and-skipped
-- record a preference model needs. Pruned after 400 days (the daily job, lib/retention.ts).
create table if not exists swipe_impressions (
  id bigserial primary key,
  viewer text not null references characters (id) on delete cascade,
  card text not null references characters (id) on delete cascade,
  serve_id text not null,
  rank smallint not null,
  score real,
  liked_you boolean not null default false,
  served_via text not null check (served_via in ('web', 'mcp')),
  at timestamptz not null default now()
);
create index if not exists swipe_impressions_viewer on swipe_impressions (viewer, at);
create index if not exists swipe_impressions_card on swipe_impressions (card);
-- Where each match answer came from (lib/swipes.ts AnswerSource): only an agent's is a real decision; a person's
-- character's is the seeded coin ('synthetic'), a house character's the automatic yes.
alter table matches add column if not exists answer_source_lo text;
alter table matches add column if not exists answer_source_hi text;
-- While they're away (lib/activity.ts, lib/away.ts; David 2026-10-24: no dead characters). When a person was last on
-- the site (agents' last calls are mcp_sessions.last_seen); what a character does while its owner is away (null: its
-- kind's default, adopt for agents' and nothing for people's); since when the show plays it (adopt, after a week; its
-- agent's next call ends it); and which swipes the character made on its own (auto), so the record says whose call it was.
-- A match answer it gives on its own is answer_source 'away'. away_reports: how far its agent has been told about them.
create table if not exists owner_activity (
  user_id text primary key,
  last_seen timestamptz not null default now()
);
-- prev_seen: their visit before this one, kept when they come back after RETURN_GAP_HOURS (lib/show-since.ts).
alter table owner_activity add column if not exists prev_seen timestamptz;
alter table characters add column if not exists while_away text check (while_away in ('adopt', 'answer', 'nothing'));
alter table characters add column if not exists adopted_at timestamptz;
create index if not exists characters_adopted_idx on characters (owner_id) where adopted_at is not null;
alter table swipes add column if not exists auto boolean not null default false;
create table if not exists away_reports (
  owner_id text primary key,
  reported_until timestamptz not null default now()
);
-- Why the engine decided what it did (lib/engine.ts EngineTrace): margin, reason codes, every variable's terms. No
-- cue words (a dealbreaker is secret). Null on dates booked before it, and under tests' fixed engines.
alter table episodes add column if not exists engine_trace jsonb;
-- Per line of the transcript, in the same order: when, by whom (show, byok, agent) and which model. A parallel array
-- so the transcript's own shape (and everything that reads it) doesn't change.
alter table episodes add column if not exists turn_meta jsonb;

-- Data plan Tier 1, part two. Choices that used to be overwritten (lib/choice-history.ts): every prediction, nudge, review
-- and consent decision, not just the latest. Owner data: exported, and gone with the account or the character.
create table if not exists choice_history (
  id bigserial primary key,
  kind text not null check (kind in ('prediction', 'nudge', 'nudge_cleared', 'review', 'ml_consent')),
  user_id text not null,
  episode_id text references episodes (id) on delete cascade,
  character_id text references characters (id) on delete cascade,
  other_id text references characters (id) on delete cascade,
  value jsonb not null,
  at timestamptz not null default now()
);
create index if not exists choice_history_user on choice_history (user_id, at);
-- Lines that didn't go in (lib/turn-drafts.ts): critic-replaced drafts, agents' refused lines and check_only tries. With
-- the line that did go in at the same turn, chosen/rejected pairs. Filtered text is never kept (rejected = null).
create table if not exists turn_drafts (
  id bigserial primary key,
  episode_id text not null references episodes (id) on delete cascade,
  turn_index integer not null,
  side text not null check (side in ('a', 'b')),
  source text not null check (source in ('critic', 'agent_refused', 'agent_check')),
  reason text not null,
  rejected text,
  created_at timestamptz not null default now()
);
create index if not exists turn_drafts_episode on turn_drafts (episode_id, turn_index);
-- An owner's Sliding Doors runs, kept (lib/simulation.ts saveDoors): the engine's replay of the date as booked, the
-- one-thing-changed alternate (sides as booleans, never a cue word), and whether the replay reproduced the original.
-- A counterfactual is not a date, so it's its own table: no feed, graph or memory reads it.
create table if not exists episode_variations (
  varies_episode_id text not null references episodes (id) on delete cascade,
  variation text not null,
  engine_version integer not null,
  base_ending text not null,
  stored_ending text not null,
  alt_ending text not null,
  alt_box_score jsonb not null,
  alt_sides jsonb not null,
  alt_trace jsonb,
  faithful boolean not null,
  requests integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (varies_episode_id, variation)
);
-- Retention (lib/retention.ts, docs/data-plan.md): the daily job prunes the data plan's kept data after 400 days by its
-- time column. These tables are new (#667, #668), so the indexes build on next to nothing.
create index if not exists choice_history_at on choice_history (at);
create index if not exists swipe_impressions_at on swipe_impressions (at);
create index if not exists turn_drafts_created on turn_drafts (created_at);
create index if not exists relationship_events_at on relationship_events (at);
create index if not exists episode_variations_created on episode_variations (created_at);

-- Marketing posters (scripts/post/*.mjs): a stamp per channel so cron re-runs are idempotent. Nothing writes the Discord
-- one since its script was retired (2026-11-09): the show's Discord posts from the hourly job, into discord_posts below.
alter table episodes add column if not exists last_posted_discord_at timestamptz;
alter table episodes add column if not exists last_posted_bluesky_at timestamptz;
alter table episodes add column if not exists last_posted_x_at timestamptz;
-- The show's Discord (lib/discord.ts, docs/discord.md): one row a post, claimed before it's sent, so each goes out once
-- even when the hourly job runs twice. A failed send gives the claim back (claimed_at null) for a later pass, until
-- tries reaches DISCORD_TRIES. items: what an episode digest featured, so the next one doesn't repeat it.
create table if not exists discord_posts (
  key text primary key,
  kind text not null check (kind in ('drops', 'votes', 'board')),
  tries integer not null default 1,
  claimed_at timestamptz,
  posted_at timestamptz,
  last_status integer,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists discord_posts_kind_idx on discord_posts (kind, posted_at);

-- After Dark's media fallback (lib/adult/fallback.ts, 2026-10-22): the other provider makes a job when the configured one
-- is limited. A provider that answered 429 or 402 is skipped until its cooldown runs out, across every instance.
alter table adult_settings add column if not exists media_fallback boolean;
create table if not exists adult_media_cooldowns (
  provider text primary key,
  until timestamptz not null,
  status integer,
  reason text,
  updated_at timestamptz not null default now()
);
-- Hive's circuit breaker (lib/adult/hive-limit.ts, 2026-10-23) is this table's 'hive' row: how many checks in a row
-- couldn't run. Null on a row from before it (a pause, so open).
alter table adult_media_cooldowns add column if not exists failures integer;
-- Who made each picture, keyframe, video and voice ('venice', 'replicate', 'fal'), and whether it was the fallback.
alter table adult_images add column if not exists provider text;
alter table adult_images add column if not exists fell_back boolean;
alter table adult_reels add column if not exists provider text;
alter table adult_reels add column if not exists fell_back boolean;
-- Which text model wrote each step (lib/adult/steps.ts), as OpenRouter reported it when it did, and the host it routed to.
alter table adult_steps add column if not exists text_model text;
alter table adult_steps add column if not exists text_provider text;
-- Every change to After Dark's models and media provider (lib/adult/settings.ts HISTORY_FIELDS): what, from, to, when, who.
create table if not exists adult_settings_history (
  id text primary key,
  seq bigserial,
  field text not null,
  from_value text,
  to_value text,
  at timestamptz not null default now(),
  by_user text
);
create index if not exists adult_settings_history_field on adult_settings_history (field, at desc);
-- After Dark Shorts (lib/adult/shorts.ts; David, 2026-10-22): an admin's whole saved night of two house characters,
-- published for entitled viewers. Fixed when published: its chapters (adult_nights ids, in order; night_id is the first),
-- the cover (an adult_images picture of the two of them) and the night's videos. published_at null: taken down.
-- adult_short_views: who pressed play (the night's lines and videos go only to them).
create table if not exists adult_shorts (
  id text primary key,
  owner_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  night_id text not null unique references adult_nights (id) on delete cascade,
  night_ids jsonb not null,
  title text not null,
  cover_id text,
  reel_ids jsonb not null default '[]',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adult_shorts_published on adult_shorts (published_at desc);
-- After Dark's 👍/👎, apart from the library's stars below (David, 2026-10-24: "allow users to score … and use that for
-- the next run on the same character"; lib/adult/steering.ts): a viewer's 👍/👎 on one of their pictures or videos, with
-- what was off. Theirs alone: they steer only that viewer's next pictures of the same character, go with the picture,
-- and never reach a dataset (docs/data-plan.md).
create table if not exists adult_media_thumbs (
  owner_id text not null,
  media_id text not null references adult_images (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, media_id)
);
create index if not exists adult_media_thumbs_recent on adult_media_thumbs (owner_id, updated_at desc);
-- The face a viewer picked for a character (lib/adult/steering.ts faceReferenceId): what their pictures, keyframes and
-- videos of that character keep. Unset, the face is their own best-rated baseline, else the admins' newest.
create table if not exists adult_face_refs (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  image_id text not null references adult_images (id) on delete cascade,
  set_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
-- Which picture preset drew it (lib/adult/rating-tags.ts PICTURE_PRESETS): what the per-character test learns from
-- (lib/adult/steering.ts choosePreset).
alter table adult_images add column if not exists preset text;
-- A baseline's attire, 'nude' or 'dressed' in the outfit its character picked (lib/adult/attire.ts). Null before
-- 2026-10-24: read from the prompt. A character who wears something gets a nude baseline too, for undressed moments.
alter table adult_images add column if not exists attire text;
-- The face a viewer picked for a character's undressed moments: one of their nude baselines (lib/adult/steering.ts
-- faceReferenceId), apart from the face they picked for everything else (adult_face_refs).
create table if not exists adult_nude_refs (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  image_id text not null references adult_images (id) on delete cascade,
  set_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
-- "Start fresh" on what a viewer's ratings of a character steer (lib/adult/steering.ts resetSteering): their ratings and
-- light picks from before reset_at stop counting for that character. Nothing is deleted.
create table if not exists adult_steer_resets (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  reset_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
-- A face picked from "Draw three" (lib/adult/steering.ts setFaceReference): the light of the one kept, and the lights of
-- the two passed over, which count half a 👎 each in the per-character light test (presetTally).
create table if not exists adult_light_picks (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  picked text not null,
  passed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists adult_light_picks_owner on adult_light_picks (owner_id, character_id);
create table if not exists adult_short_views (
  short_id text not null references adult_shorts (id) on delete cascade,
  user_id text not null,
  watched_at timestamptz not null default now(),
  primary key (short_id, user_id)
);
-- Call it (lib/adult/predictions.ts): a viewer's call on a Short before it plays (the first move, how far it goes, one of
-- their places, and the optional second night), settled from the recorded night when they press play: what happened and
-- the free points it earned are kept with it. After Dark's own season board reads these; the show's never do.
create table if not exists adult_short_calls (
  short_id text not null references adult_shorts (id) on delete cascade,
  user_id text not null,
  first_move text not null check (first_move in ('a', 'b', 'neither')),
  furthest smallint not null check (furthest between 0 and 4),
  their_place text not null check (their_place in ('yes', 'no')),
  second_night text check (second_night in ('yes', 'no')),
  outcome jsonb,
  points integer,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (short_id, user_id)
);
create index if not exists adult_short_calls_settled on adult_short_calls (settled_at);
-- Two sides of the night (lib/adult/monologues.ts): each one's inner monologue of a whole saved night and the two texts
-- they send the morning after, written once and kept (one row a night: night_id is its first chapter); a monthly cap.
create table if not exists adult_monologues (
  night_id text primary key references adult_nights (id) on delete cascade,
  owner_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  a_page text not null,
  a_text text not null,
  b_page text not null,
  b_text text not null,
  created_by text not null,
  cost_usd double precision,
  created_at timestamptz not null default now()
);
alter table adult_usage add column if not exists monologues integer not null default 0;
alter table adult_settings add column if not exists cap_monologues integer not null default 20;
-- A video of the whole night (lib/adult/reels.ts, 2026-10-23): what a night's reel filmed. scope: 'chapter' (one
-- chapter, every reel before) or 'night' (every chapter since the night began); chapters: each one's number, its saved
-- night's id (null: the running scene's then) and its line count. Null on reels from before, and on clips.
alter table adult_reels add column if not exists scope text;
alter table adult_reels add column if not exists chapters jsonb;
-- The reel storyboard (docs/PRDs/reel-storyboard.md, 2026-10-24): a reel can be a 'draft' — the director's shots picked
-- (planReel) and their keyframes drawn and approved (drawReelFrames), not yet filmed (filmReel). Widen the status check.
alter table adult_reels drop constraint if exists adult_reels_status_check;
alter table adult_reels add constraint adult_reels_status_check check (status in ('draft', 'making', 'ready', 'failed'));
-- A filmed night's video where nothing came through goes back to its storyboard (lib/adult/reels.ts settleIfDone,
-- 2026-11-09): when it came back, so the pair's videos list it as a draft to film again.
alter table adult_reels add column if not exists returned_at timestamptz;
-- One collecting pass at a time (lib/adult/reels.ts advanceReel, 2026-11-22): the pass asking after a video's shots holds
-- it until then, so the page's poll and the host's collector never fetch and keep the same shots at once.
alter table adult_reels add column if not exists collecting_until timestamptz;
-- After Dark's discreet mode (lib/adult/privacy.ts): blur its pictures until tapped and a neutral tab title (both on
-- by default), and an optional PIN kept only as a slow salted hash (scrypt), never the PIN. pin_version changes with
-- every new or removed PIN, which signs every device out; the wrong tries and the wait they set live here too.
create table if not exists adult_privacy (
  user_id text primary key,
  blur boolean not null default true,
  neutral_title boolean not null default true,
  pin_hash text,
  pin_version integer not null default 0,
  pin_failures integer not null default 0,
  pin_locked_until timestamptz,
  updated_at timestamptz not null default now()
);
-- A video's keyframe passes only Hive's age question (lib/adult/check.ts "keyframe", 2026-10-23), so it's shown on its
-- own only once a ready video made from it exists (lib/adult/media.ts FRAME_SHOWN): that lookup, by source_image.
create index if not exists adult_images_source on adult_images (source_image) where source_image is not null;

-- Connections (lib/connections.ts, docs/PRDs/connections.md): a person's own provider keys, one per provider, sealed by
-- lib/key-crypto.ts and never read back (only the last four). Each job (dates and texts, portraits, intro clips) uses
-- at most one of them, with the model it runs. A key's status is kept with it: when it was last checked live, last
-- used, and the last thing that went wrong, in plain words (never the provider's own message).
create table if not exists user_connections (
  user_id text not null references accounts (user_id) on delete cascade,
  provider text not null,
  ciphertext text not null,
  nonce text not null,
  last4 text not null,
  verified_at timestamptz,
  last_used_at timestamptz,
  last_error text,
  last_error_kind text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
create table if not exists user_connection_jobs (
  user_id text not null,
  job text not null check (job in ('text', 'image', 'video', 'after_dark', 'after_dark_video')),
  provider text not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, job),
  foreign key (user_id, provider) references user_connections (user_id, provider) on delete cascade
);
-- M16's user_keys rows move in, once (a key per provider and kind before; a key per provider and its jobs now). Same
-- sealing, so each ciphertext moves as it is. When a provider had a key in both kinds, the text one is kept (in
-- production, 2026-10-23, the one such pair had the same last four). The jobs are what each key did before: a text key
-- runs dates; OpenAI's image-kind key, portraits; any Google key, clips (userVideoKey fell back to the dates key). A
-- model nobody chose is pinned to the default it ran on then, so a later default never changes someone's model
-- silently. Moved rows are deleted, so a key removed later can't come back on the next schema change. Never fatal: a
-- failure leaves user_keys as it was and the app up.
do $$ begin
  insert into user_connections (user_id, provider, ciphertext, nonce, last4, created_at, updated_at)
  select distinct on (user_id, provider) user_id, provider, ciphertext, nonce, last4, created_at, created_at
    from user_keys order by user_id, provider, (kind = 'text') desc, created_at desc
  on conflict (user_id, provider) do nothing;
  insert into user_connection_jobs (user_id, job, provider, model, created_at, updated_at)
  select distinct on (k.user_id, k.job) k.user_id, k.job, k.provider, k.model, k.created_at, k.created_at
    from (
      select user_id, provider, created_at, kind,
             case when kind = 'text' then 'text' when provider = 'openai' then 'image' end as job,
             case when kind = 'text' then coalesce(model, case provider
               when 'google' then 'gemini-3.5-flash-lite' when 'openai' then 'gpt-4.1-mini' when 'anthropic' then 'claude-haiku-5-5'
               when 'deepseek' then 'deepseek-chat' when 'groq' then 'llama-3.3-70b-versatile' when 'openrouter' then 'openai/gpt-4.1-mini' end)
             else model end as model
        from user_keys
      union all
      select user_id, provider, created_at, kind, 'video', null from user_keys where provider = 'google'
    ) k
   where k.job is not null
     and exists (select 1 from user_connections c where c.user_id = k.user_id and c.provider = k.provider)
   order by k.user_id, k.job, (k.kind = 'image') desc, k.created_at desc
  on conflict (user_id, job) do nothing;
  delete from user_keys k where exists (select 1 from user_connections c where c.user_id = k.user_id and c.provider = k.provider);
exception when others then
  raise warning 'connections: user_keys were not moved (%)', sqlerrm;
end $$;
-- Connections M2 (docs/PRDs/connections.md): the models a key can use, as its provider listed them at its last check
-- (OpenRouter's list is public, so not kept here), and each job's feel: a preset (steady, lively, wild, or custom) and,
-- under Advanced, the raw temperature and penalties (clamped; null: the preset's).
alter table user_connections add column if not exists models jsonb;
alter table user_connections add column if not exists models_at timestamptz;
alter table user_connection_jobs add column if not exists preset text;
alter table user_connection_jobs add column if not exists temperature real;
alter table user_connection_jobs add column if not exists frequency_penalty real;
alter table user_connection_jobs add column if not exists presence_penalty real;
-- Connections M3: what each job may spend a month on its key (null: no cap), and what happens at the cap or when the key
-- can't be used ('fallback', the default: Botchelor's free model stands in; 'pause': the dates you book wait). What each
-- job spent each month (UTC), as the provider reported it or estimated from tokens and list prices, and when its 80% and
-- cap notices went (once a month each).
alter table user_connection_jobs add column if not exists cap_usd double precision;
alter table user_connection_jobs add column if not exists on_cap text;
-- The Studio's own-key job (docs/PRDs/studio.md section 7): After Dark pictures on someone's Venice or Replicate key.
-- Widen the CHECK on an existing database once, as adult_images' kinds were.
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'user_connection_jobs_job_check'
       and pg_get_constraintdef(oid) not like '%after_dark%'
  ) then
    alter table user_connection_jobs drop constraint if exists user_connection_jobs_job_check;
    alter table user_connection_jobs add constraint user_connection_jobs_job_check check (job in ('text', 'image', 'video', 'after_dark'));
  end if;
end $$;
create table if not exists user_connection_usage (
  user_id text not null references accounts (user_id) on delete cascade,
  job text not null,
  month text not null,
  cost_usd double precision not null default 0,
  calls integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_calls integer not null default 0,
  unpriced_calls integer not null default 0,
  warned_at timestamptz,
  capped_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, job, month)
);

-- Beat pictures (lib/adult/beats.ts; David, 2026-10-24): the moments of a chapter worth a picture (undressing, sex, each
-- new position, the climax, the afterglow), each offered to the viewer as it plays, drawn when they say yes or press
-- Picture this, else when the chapter closes. night_id is the saved night the chapter was filed as (null: still running);
-- picture_id the gallery picture, which a video of the night starts its shot from (lib/adult/reels.ts).
create table if not exists adult_beats (
  id text primary key,
  owner_id text not null,
  scene_id text not null,
  character_a text not null,
  character_b text not null,
  chapter integer not null,
  line integer not null,
  act text not null,
  kind text not null,
  stage integer not null,
  place text,
  status text not null default 'offered' check (status in ('offered', 'later', 'drawing', 'drawn', 'failed')),
  picture_id text,
  night_id text,
  created_at timestamptz not null default now()
);
create index if not exists adult_beats_scene_idx on adult_beats (scene_id, chapter, line);
create index if not exists adult_beats_pair_idx on adult_beats (owner_id, character_a, character_b, chapter);
alter table adult_settings add column if not exists beat_pictures boolean;
-- The owner's own words for a theater scene picture (David, 2026-10-24: "we need more specifics otherwise it fails to do
-- the exact scene"): a custom direction that leads the picture, and a line for a speech bubble. Both held to the lines.
alter table adult_beats add column if not exists custom text;
alter table adult_beats add column if not exists dialog text;
-- What the owner changed in a scene picture's context before it was drawn (lib/adult/beats.ts PictureEdit, 2026-10-25:
-- "add the context that will be sent, and allow additional context"), and what a redraw cost them (given back if it fails).
alter table adult_beats add column if not exists edit jsonb;
-- Whose eyes a beat picture is seen through (lib/adult/framing.ts, 2026-10-26: "generating people together is way harder
-- than POV shots"): picked once from how well that act's framings do, kept so a redraw and a reel's shot keep it.
alter table adult_beats add column if not exists eyes text check (eyes in ('a', 'b'));
alter table adult_beats add column if not exists paid integer not null default 0;
-- Why a beat's picture didn't come (lib/adult/beats.ts drawBeat), for the page: an age check's refusal says who and what fixes it.
alter table adult_beats add column if not exists fail_reason text;
-- When it was drawn ahead (lib/adult/draw-ahead.ts), for a chapter paid for: one that was keeps the chapter's tokens.
alter table adult_beats add column if not exists ahead_at timestamptz;

-- The After Dark library (lib/adult/library.ts; David, 2026-10-24): which model drew a picture (null: from before it was
-- kept, when only its provider was), and each viewer's 1–5 stars on a picture or a video (item_id: an adult_images or an
-- adult_reels id).
alter table adult_images add column if not exists model text;
create table if not exists adult_media_ratings (
  user_id text not null,
  item_id text not null,
  item_kind text not null check (item_kind in ('image', 'reel')),
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index if not exists adult_media_ratings_item_idx on adult_media_ratings (item_id);
-- Explicit consent for the After Dark profile (GDPR Art. 9 "sex life" data; lib/adult/profile.ts PROFILE_CONSENT_TEXT;
-- 2026-10-24): when, and by whom, a character's turn-ons were saved under the person's ticked consent, and when a pair's
-- hard nos were. Null: saved before consent was asked for (only admins had After Dark then). Nothing new is stored
-- without it; deleting the profile (lib/adult/profile-data.ts) clears both with the data.
alter table adult_profiles add column if not exists consented_at timestamptz;
alter table adult_profiles add column if not exists consented_by text;
alter table adult_scenes add column if not exists hard_nos_consented_at timestamptz;

-- Complaints and takedown requests from the /report form (lib/content-reports.ts; the policy pages of 2026-10-24): what
-- was reported (a link or an id, as typed; episode_id when it names one of our dates), why, the reporter's words and, only
-- if they gave one, an email for the reply. reporter_id is the session that sent it, and goes (with the email) when that
-- account is deleted; the report itself stays as the record of what was reported and what we did. flag_reason is the
-- content filter's or the spam check's note, never a refusal. An admin resolves it, hides the reported date, or dismisses it.
create table if not exists content_reports (
  id text primary key,
  created_at timestamptz not null default now(),
  reporter_id text,
  account boolean not null default false,
  category text not null check (category in ('minor', 'real_person', 'non_consent', 'intimate_image', 'copyright', 'other')),
  target text check (char_length(target) <= 500),
  episode_id text,
  details text check (char_length(details) <= 4000),
  contact_email text check (char_length(contact_email) <= 254),
  user_agent text,
  flagged boolean not null default false,
  flag_reason text,
  status text not null default 'open' check (status in ('open', 'resolved', 'hidden', 'dismissed')),
  decided_at timestamptz,
  decided_by text,
  note text check (char_length(note) <= 1000)
);
create index if not exists content_reports_open_idx on content_reports (status, created_at);
create index if not exists content_reports_reporter_idx on content_reports (reporter_id);
-- The After Dark Studio (lib/adult/studio.ts, docs/PRDs/studio.md; David, 2026-10-24). A shoot is one request: its
-- kind (a shoot of the character alone, a restyle, a recast, a body reference), what was chosen, the model and who ran
-- it (ours, or the owner's own key), the tokens taken, and the pictures it made (adult_images.shoot_id). adult_identity
-- is a viewer's own settings for a character: the body reference shoots add after the face, how strictly pictures keep
-- the face, and the studio's own limits for pictures of them alone. The settings' studio JSON holds every price, size,
-- model and switch (lib/adult/studio-config.ts); the monthly caps are columns, like the others (lib/adult/usage.ts).
create table if not exists adult_studio_shoots (
  id text primary key,
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  partner_id text references characters (id) on delete cascade,
  kind text not null,
  choices jsonb not null default '{}',
  model text,
  provider text,
  own_key boolean not null default false,
  tokens integer not null default 0,
  asked integer not null default 0,
  made integer not null default 0,
  status text not null default 'making',
  pictures jsonb not null default '[]',
  redo_of text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adult_studio_shoots_owner_idx on adult_studio_shoots (owner_id, character_id, created_at desc);
create table if not exists adult_identity (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  body_image_id text references adult_images (id) on delete set null,
  strength text,
  intensity text,
  hard_nos jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
alter table adult_images add column if not exists shoot_id text;
-- A tight close-up of the face, made once from the baseline and reused as the face anchor (Picture 1) of every shoot,
-- so a heavy override changes the pose and scene without drifting the face (David, 2026-10-24: "provide a headshot as
-- context, then let the rest override"). lib/adult/studio.ts ensureFaceCrop.
alter table adult_identity add column if not exists face_crop_image_id text references adult_images (id) on delete set null;
alter table adult_settings add column if not exists studio jsonb;
alter table adult_usage add column if not exists studio integer not null default 0;
alter table adult_usage add column if not exists studio_byok integer not null default 0;
alter table adult_usage add column if not exists upscales integer not null default 0;
alter table adult_settings add column if not exists cap_studio integer not null default 400;
alter table adult_settings add column if not exists cap_studio_byok integer not null default 1000;
alter table adult_settings add column if not exists cap_upscales integer not null default 50;
-- Which checker checks (lib/adult/moderation.ts; David, 2026-10-24: "Hive is a bottleneck, add an alternative"): the
-- mode and the alternatives in adult_settings.moderation (JSON), Sightengine's secret and our own endpoint's key sealed
-- like the others; and the NSFW score Hive's moderation gave a picture it passed (a photo for the texts needs a low one).
alter table adult_settings add column if not exists moderation jsonb;
alter table adult_settings add column if not exists sightengine_ciphertext text;
alter table adult_settings add column if not exists sightengine_nonce text;
alter table adult_settings add column if not exists sightengine_last4 text;
alter table adult_settings add column if not exists moderation_endpoint_ciphertext text;
alter table adult_settings add column if not exists moderation_endpoint_nonce text;
alter table adult_settings add column if not exists moderation_endpoint_last4 text;
alter table adult_images add column if not exists nsfw_score double precision;
-- Studio v2 (lib/adult/shares.ts; David, 2026-10-24: "share your output to the other user or agent so they can see it
-- too, but you pay for it"). A share is one picture to the owner of a character theirs has dated: in After Dark (a
-- request they accept first: status pending, accepted, declined, revoked), or as a dressed photo in the two characters'
-- texts (status sent; couple_texts.photo is its show asset, character_assets kind 'photo'). adult_share_prefs: whether a
-- person takes After Dark shares from characters theirs have dated without being asked.
create table if not exists adult_shares (
  id text primary key,
  item_id text not null references adult_images (id) on delete cascade,
  owner_id text not null,
  from_character text not null references characters (id) on delete cascade,
  recipient_id text not null,
  to_character text not null references characters (id) on delete cascade,
  kind text not null check (kind in ('after_dark', 'photo')),
  status text not null check (status in ('pending', 'accepted', 'declined', 'revoked', 'sent')),
  photo_asset text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, recipient_id, kind)
);
create index if not exists adult_shares_recipient_idx on adult_shares (recipient_id, status, created_at desc);
create table if not exists adult_share_prefs (
  user_id text primary key,
  auto_accept boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table couple_texts add column if not exists photo text;
-- Studio v3 (docs/PRDs/studio.md): a shoot's choices saved under a name (one per name), run again on any of the owner's
-- characters; kind 'shoot' (one of them) or 'pair' (together, the partner picked when it runs).
create table if not exists adult_studio_setups (
  id text primary key,
  owner_id text not null,
  name text not null,
  kind text not null check (kind in ('shoot', 'pair')),
  choices jsonb not null default '{}',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);
-- What was sent to make each picture, clip or shot (lib/adult/request-log.ts; David, 2026-10-24: "so we can track why
-- it fails"): the provider's address and body, cleaned (no key, no signature, no picture bytes). Admins see it on a click.
alter table adult_images add column if not exists request jsonb;
-- What each picture and clip shows (lib/adult/media-tags.ts; David, 2026-10-25: "tag the assets so we can map them to
-- the scene in the theater"): one row a tag; its source is what said it (choice, derived, model, manual); a tag the owner
-- took away stays as removed, so nothing automatic adds it back. adult_images.tagged_at: its own record has been read;
-- model_tagged_at: the owner's free words have been read by the model.
create table if not exists adult_media_tags (
  media_id text not null references adult_images (id) on delete cascade,
  owner_id text not null,
  kind text not null check (kind in ('who', 'act', 'place', 'stage', 'outfit', 'light', 'pov', 'date')),
  value text not null,
  source text not null check (source in ('choice', 'derived', 'model', 'manual')),
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (media_id, kind, value)
);
create index if not exists adult_media_tags_kind_idx on adult_media_tags (owner_id, kind, value) where not removed;
alter table adult_images add column if not exists tagged_at timestamptz;
alter table adult_images add column if not exists model_tagged_at timestamptz;
-- A video's trim (lib/adult/trim.ts; David, 2026-10-25): where it starts and ends and the parts cut out, in seconds;
-- the players honour it, nothing is re-encoded. Null: the whole clip.
alter table adult_images add column if not exists trim jsonb;
-- The strict content tag (lib/content-rating.ts), 2026-10-25: everything After Dark makes is nsfw, and so is any row
-- that doesn't say otherwise. Only a fresh check that passed may ever bring one down.
alter table adult_images add column if not exists content_rating text not null default 'nsfw';
alter table adult_images drop constraint if exists adult_images_content_rating_check;
alter table adult_images add constraint adult_images_content_rating_check check (content_rating in ('pg', 'suggestive', 'nsfw'));
-- A blurred teaser per asset (lib/teaser-image.ts): a few KB, drawn the first time it's asked for and kept, so the
-- original never has to be sent to someone it isn't open to. Exactly one of its two asset columns is set, each a
-- cascading reference, so deleting a picture (or an account, lib/account.ts) takes its teaser with it.
create table if not exists media_teasers (
  key text primary key,
  asset_id text references character_assets (id) on delete cascade,
  adult_id text references adult_images (id) on delete cascade,
  data bytea not null,
  created_at timestamptz not null default now(),
  check ((asset_id is null) <> (adult_id is null))
);
-- Who writes the scenes (lib/adult/writer-config.ts; David, 2026-10-24): the writers a person can pick and the default,
-- as JSON; and each person's own pick (adult_prefs.writer_model, null: the default), which goes with their account.
alter table adult_settings add column if not exists writer jsonb;
alter table adult_settings add column if not exists rollout jsonb;
create table if not exists adult_prefs (
  user_id text primary key,
  writer_model text,
  updated_at timestamptz not null default now()
);

-- The PG Studio (lib/studio/pg.ts; plan PR 3, 2026-10-25): a shoot of an owner's own character, and its pictures, each
-- with the strict rating the PG check gave it (only pg or suggestive are ever kept). Bytes go to the bucket under
-- studio-pg/ (data only when no bucket is configured). free: the character's free first shoot.
create table if not exists studio_pg_shoots (
  id text primary key,
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  choices jsonb not null default '{}',
  model text,
  tokens integer not null default 0,
  free boolean not null default false,
  asked integer not null default 0,
  made integer not null default 0,
  status text not null default 'making',
  error text,
  created_at timestamptz not null default now()
);
create index if not exists studio_pg_shoots_owner_idx on studio_pg_shoots (owner_id, character_id, created_at desc);
create table if not exists studio_pg_pictures (
  id text primary key,
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  shoot_id text references studio_pg_shoots (id) on delete cascade,
  prompt text,
  mime text not null,
  data bytea,
  object_key text,
  content_rating text not null default 'nsfw' check (content_rating in ('pg', 'suggestive', 'nsfw')),
  clothing text,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists studio_pg_pictures_owner_idx on studio_pg_pictures (owner_id, character_id, created_at desc);

-- The Create library (lib/studio/library.ts; David, 2026-10-25): each person's own prompts, venues and roleplays, private
-- to them. mode: safe (PG, usable in the PG Studio and After Dark) or after_dark (After Dark only).
create table if not exists creator_prompts (
  id text primary key,
  owner_id text not null,
  text text not null,
  title text,
  mode text not null default 'safe' check (mode in ('safe', 'after_dark')),
  created_at timestamptz not null default now()
);
create index if not exists creator_prompts_owner_idx on creator_prompts (owner_id, created_at desc);
create table if not exists creator_places (
  id text primary key,
  owner_id text not null,
  name text not null,
  description text,
  mode text not null default 'safe' check (mode in ('safe', 'after_dark')),
  created_at timestamptz not null default now()
);
create index if not exists creator_places_owner_idx on creator_places (owner_id, created_at desc);
create table if not exists creator_roleplays (
  id text primary key,
  owner_id text not null,
  title text not null,
  premise text not null,
  role_a text,
  role_b text,
  category text not null default 'romance',
  created_at timestamptz not null default now()
);
create index if not exists creator_roleplays_owner_idx on creator_roleplays (owner_id, created_at desc);
-- Safe roleplays (docs/PRDs/roleplays.md, 2026-10-31): held to the show's rules, so they play on show dates and in both
-- Studios; the ones from before stay After Dark's.
alter table creator_roleplays add column if not exists mode text not null default 'after_dark' check (mode in ('safe', 'after_dark'));

-- A clip's moments (lib/adult/moments.ts; David, 2026-10-26: "save a image or offering a boomerang for a clip …
-- continue where it left off"): a video made from a clip's own frames (derived: a boomerang or a loop, source_image the
-- clip), and the second a still was cut at (a moment saved from a clip, or the frame a clip keeps going from).
alter table adult_images add column if not exists derived text check (derived in ('boomerang', 'loop'));
-- A chain of clips kept going from each other, joined into one video to post as one reel (lib/adult/moments.ts
-- joinClips; David, 2026-11-10): derived 'chain', source_image the chain's last clip.
alter table adult_images drop constraint if exists adult_images_derived_check;
alter table adult_images add constraint adult_images_derived_check check (derived in ('boomerang', 'loop', 'chain'));
alter table adult_images add column if not exists moment_at double precision;
-- How far a picture goes (0 dressed … 3 explicit, lib/adult/studio-catalog.ts LEVELS), kept on the picture itself so
-- whatever is made from it next (animated, shared) reads it, however it was made; null: read from its shoot as before.
alter table adult_images add column if not exists level smallint check (level between 0 and 3);
alter table adult_usage add column if not exists moments integer not null default 0;
alter table adult_settings add column if not exists cap_moments integer not null default 100;

-- The creator suite (docs/after-dark.md "The creator suite"; David, 2026-10-26): captions in a character's voice, kept
-- on the picture (lib/studio/captions.ts), and the exports people download (lib/media-tools/export.ts): a zip (or one
-- file) built on request, kept a day in the bucket under exports/ (or here, in data, when there's no bucket), then pruned.
alter table adult_images add column if not exists captions jsonb;
alter table studio_pg_pictures add column if not exists captions jsonb;
alter table adult_usage add column if not exists captions integer not null default 0;
alter table adult_settings add column if not exists cap_captions integer not null default 300;
create table if not exists media_exports (
  id text primary key,
  owner_id text not null,
  area text not null check (area in ('after-dark', 'studio-pg')),
  status text not null default 'making' check (status in ('making', 'ready', 'failed')),
  filename text not null,
  mime text not null,
  bytes integer,
  files integer,
  options jsonb not null default '{}',
  object_key text,
  data bytea,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists media_exports_owner_idx on media_exports (owner_id, created_at desc);

-- Fix faces and the identity pack (the creator suite; lib/adult/fix-faces.ts, lib/studio/identity-pack.ts). A picture
-- with its faces fixed is a new picture beside the one it fixes (fixed_from). The identity pack is eight views of a
-- character per person and Studio (each picture in that Studio's own table), each with the face it was drawn from
-- (from_face), as the face anchor is (face_crop_from): one drawn from an earlier face isn't used once they pick another.
alter table adult_images add column if not exists fixed_from text references adult_images (id) on delete set null;
-- Fix (lib/adult/fix.ts; David, 2026-11-09: "a way to iterate over a broken image and fix it"): every version of a
-- picture comes from one original (fix_root), made by one kind of fix (faces, repair, change, undress) with the owner's
-- words (fix_note) and the spot they marked (fix_spot, fractions of the picture). Keeping one version takes the others
-- out of the galleries (superseded_by, the version kept); the Fix sheet still lists them.
alter table adult_images add column if not exists fix_root text references adult_images (id) on delete set null;
alter table adult_images add column if not exists fix_kind text;
alter table adult_images add column if not exists fix_note text;
alter table adult_images add column if not exists fix_spot jsonb;
alter table adult_images add column if not exists superseded_by text references adult_images (id) on delete set null;
create index if not exists adult_images_fix_root_idx on adult_images (fix_root) where fix_root is not null;
-- Native sizes (lib/studio/formats.ts): the shape a picture was drawn in ("9:16"); null for one drawn before, all 3:4.
alter table adult_images add column if not exists aspect text;
alter table studio_pg_pictures add column if not exists aspect text;
-- Bigger shoots (lib/adult/studio.ts advanceShoot): the shoot's own input, to build each next batch from; how many of
-- its pictures have been started; and the lease of whoever's drawing the current batch.
alter table adult_studio_shoots add column if not exists plan jsonb;
alter table adult_studio_shoots add column if not exists drawn integer not null default 0;
alter table adult_studio_shoots add column if not exists leased_until timestamptz;
-- SFW twins (lib/adult/sfw-twin.ts): the After Dark picture a safe-for-work one was made from.
alter table adult_images add column if not exists twin_of text;
alter table studio_pg_pictures add column if not exists twin_of text;
-- What a PG picture shows, written as it's made (lib/studio/pg-catalog.ts pgTagsOf): the shoot's picks by group, and
-- what made it. The showcase filters by it.
alter table studio_pg_pictures add column if not exists tags jsonb not null default '[]';

-- The creator showcase (lib/showcase.ts, docs/PRDs/showcase.md; David, 2026-10-29): a creator's opt-in handle (never a
-- login name or an email), the items they chose to publish (one row each, with what it shows copied from its tags for
-- the filters), and the other owner's OK for a picture with their character in it.
create table if not exists creator_profiles (
  user_id text primary key,
  handle text not null unique,
  display_name text not null,
  bio text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists showcase_posts (
  id text primary key,
  owner_id text not null,
  source text not null check (source in ('after_dark', 'pg')),
  media_id text not null,
  character_id text not null references characters (id) on delete cascade,
  character_b text references characters (id) on delete cascade,
  rating text not null check (rating in ('pg', 'suggestive', 'nsfw')),
  medium text not null check (medium in ('picture', 'clip', 'reel', 'boomerang', 'loop')),
  aspect text,
  act text,
  place text,
  pov boolean not null default false,
  from_date boolean not null default false,
  caption text,
  tags jsonb not null default '[]',
  status text not null default 'live' check (status in ('pending', 'live', 'removed')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (source, media_id)
);
create index if not exists showcase_posts_live_idx on showcase_posts (published_at desc) where status = 'live';
-- A post held out of sight by a serious report until an admin looks (lib/showcase-moderation.ts), and the menu picks
-- someone can shoot it again with (Remix: never the creator's own words, places or partner).
alter table showcase_posts add column if not exists held boolean not null default false;
alter table showcase_posts add column if not exists remix jsonb;
-- 2026-10-29: whether the post shows the prompt that made it (lib/showcase-made.ts; the creator's pick, on by default).
alter table showcase_posts add column if not exists show_prompt boolean not null default true;
-- When an After Dark post still rated explicit was put through the PG check (lib/showcase-check.ts): a dressed one goes
-- to the safe side, and none is checked twice.
alter table showcase_posts add column if not exists checked_at timestamptz;
-- Looked at again by the safe side's recheck (lib/showcase-check.ts recheckBatch), once.
alter table showcase_posts add column if not exists rechecked_at timestamptz;
-- 2026-11-09: whether a clip's post has a sound track (lib/showcase-audio.ts; null until read): the 🔇 shows only if so.
alter table showcase_posts add column if not exists has_audio boolean;
-- The show's own portrait for a public agent-made character with none (lib/agent-portraits.ts): one that couldn't be
-- kept is noted here and never drawn again, left for the character's creator.
-- The older SFW twins drawn again with today's prompt (lib/showcase-retwin.ts): each once, the new one's id when it
-- was swapped in.
create table if not exists showcase_retwins (
  old_id text primary key,
  new_id text,
  status text not null check (status in ('done', 'failed')),
  note text,
  created_at timestamptz not null default now()
);
create table if not exists show_portrait_tries (
  character_id text primary key references characters (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
-- Smaller copies of a post's picture for the tiles and reels (lib/showcase-thumbs.ts), drawn once, gone with the post.
create table if not exists showcase_thumbs (
  post_id text not null references showcase_posts (id) on delete cascade,
  size text not null check (size in ('tile', 'screen')),
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (post_id, size)
);
-- Living portraits (lib/showcase-loops.ts; David, 2026-10-29): a safe picture brought to life as a short clip, each
-- picture or portrait once. owner_id is whose post it becomes: the creator's, or the show's own for a public
-- character someone else made.
create table if not exists showcase_loops (
  id text primary key,
  owner_id text not null,
  source text not null check (source in ('post', 'portrait')),
  source_id text not null,
  character_id text not null references characters (id) on delete cascade,
  status text not null default 'making' check (status in ('making', 'ready', 'failed')),
  media_id text,
  post_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);
-- 2026-10-29: the first run's provider trouble (Replicate's "Model not found") was kept as failed: tried again now
-- (lib/showcase-loops.ts RETRYABLE lets such a claim go from then on).
delete from showcase_loops where status = 'failed' and error like 'Replicate: Model not found%';
-- Where each After Dark post was made: MADE_IN_SQL below, run after this (it's built from lib/made-in.ts).
-- One shot is a clip, several back to back a reel (lib/made-in.ts; David, 2026-11-18: "we have reels and clips, really
-- they are the same thing"): a shot of a night's video posted on its own was a "reel"; only clips joined into one are.
update showcase_posts p set medium = 'clip'
  from adult_images i
 where p.source = 'after_dark' and p.medium = 'reel' and i.id = p.media_id and i.derived is distinct from 'chain';
-- A video kept before its row named its model: the model its reel's shot names (the showcase says what made it).
update adult_images i set model = s.model
  from (select distinct on (x->>'media_id') x->>'media_id' as media_id, x->>'model' as model
          from adult_reels r cross join lateral jsonb_array_elements(r.shots) x
         where x->>'media_id' is not null and x->>'model' is not null) s
 where i.id = s.media_id and i.kind = 'video' and i.model is null;
create index if not exists showcase_posts_owner_idx on showcase_posts (owner_id);
create table if not exists showcase_consents (
  post_id text not null references showcase_posts (id) on delete cascade,
  owner_id text not null,
  character_id text not null,
  status text not null default 'asked' check (status in ('asked', 'yes', 'no')),
  created_at timestamptz not null default now(),
  primary key (post_id, owner_id, character_id)
);
-- Likes on posts, and people following creators (lib/showcase-social.ts).
create table if not exists showcase_likes (
  post_id text not null references showcase_posts (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
-- A portrait's small copies (app/api/assets/[id] ?w=), resized once and kept: a browser opening /graph asked for 56
-- of them at once, each decoded from a multi-MB PNG on the request, and the show's one replica stalled for minutes
-- (the audit, 2026-10-31).
-- After Dark's pictures at a grid's size (app/api/admin/after-dark/media/[id] ?w=), resized once and kept: the Studio's
-- grids showed 3 MB PNGs by the dozen (the audit, 2026-10-31, F15/F46).
create table if not exists adult_media_small (
  media_id text not null references adult_images (id) on delete cascade,
  width integer not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (media_id, width)
);
create table if not exists character_asset_thumbs (
  asset_id text not null references character_assets (id) on delete cascade,
  width integer not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (asset_id, width)
);
-- What each browser has seen on the reels (lib/showcase.ts markSeen): seen posts go to the back of their feed.
create table if not exists showcase_views (
  viewer_id text not null,
  post_id text not null references showcase_posts (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (viewer_id, post_id)
);
create table if not exists creator_follows (
  follower_id text not null,
  creator_id text not null,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id)
);
-- Favorites (the creator suite): the After Dark pictures and clips each person starred (the Studio's ⭐ and the rating
-- deck's swipe up), theirs alone.
create table if not exists media_favorites (
  owner_id text not null,
  media_id text not null references adult_images (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, media_id)
);
alter table adult_identity add column if not exists face_crop_from text;
alter table studio_pg_shoots add column if not exists kind text not null default 'shoot';
create table if not exists identity_views (
  owner_id text not null,
  character_id text not null references characters (id) on delete cascade,
  studio text not null check (studio in ('after_dark', 'pg')),
  view text not null,
  image_id text not null,
  from_face text,
  created_at timestamptz not null default now(),
  primary key (owner_id, character_id, studio, view)
);
-- The spend tracker (lib/spend.ts, /admin/spend): money in and out that no table records on its own, entered by an
-- admin (a bill, a prepaid top-up, a sale made elsewhere). A month or year entry repeats from starts_on until ends_on.
-- seed_key marks one of the documented costs (KNOWN_COSTS), so filling them in twice adds nothing.
create table if not exists money_entries (
  id text primary key,
  kind text not null check (kind in ('cost', 'income')),
  category text not null check (category in ('api', 'infra', 'other')),
  provider text not null,
  label text not null,
  usd numeric(12, 2) not null check (usd >= 0),
  every text not null check (every in ('once', 'month', 'year')),
  starts_on date not null,
  ends_on date,
  note text,
  seed_key text unique,
  created_by text,
  created_at timestamptz not null default now()
);
-- DigitalOcean's first days (from 2026-10-30) were covered by its signup credit: October's invoice was $0 (read on its
-- billing page 2026-11-04), so the seeded app bills start in November. Only rows still on the seeded date move.
update money_entries set starts_on = '2026-11-01', note = 'apps-s-1vcpu-1gb-fixed; October was covered by the signup credit (its invoice was $0)'
  where seed_key in ('do-show', 'do-after-dark') and starts_on = '2026-10-30';
-- Bunny is prepaid with auto-recharge (its card payments are entered as they happen), so the seeded $1/month guess
-- would count it twice.
delete from money_entries where seed_key = 'bunny';
-- What each provider said about its balance and usage, at most once a day (the latest reading of the day wins).
create table if not exists spend_snapshots (
  day date not null,
  provider text not null,
  balance_usd double precision,
  used_total_usd double precision,
  used_month_usd double precision,
  read_at timestamptz not null default now(),
  primary key (day, provider)
);

-- After Dark's pricing (#1005; David, 2026-10-30: "a subscription that includes an allowance, tokens for extras ... just
-- break even overall"): a subscriber's first included_clips clips each month cost nothing (lib/adult/pricing.ts), counted
-- here; null: DEFAULT_INCLUDED_CLIPS. The pictures cap's default goes to 60 (an existing row keeps what it says).
alter table adult_settings add column if not exists included_clips integer;
alter table adult_usage add column if not exists included_clips integer not null default 0;
alter table adult_settings alter column cap_pictures set default 60;

-- #1122 (the 2026-10-31-1549 visitor reloaded mid-write and saw no lines and no Start): when the scene's next lines started
-- being written (lib/adult/scenes.ts continueScene), cleared when that ends either way. Older than WRITING_STALE_MS reads
-- as not writing (a crashed request).
alter table adult_scenes add column if not exists writing_since timestamptz;

-- #1207 (David, 2026-11-01: "Set up for pictures", each character's first setup included): when this character's one
-- free setup was taken (lib/adult/studio.ts setUpForPictures). Kept on the identity row, not on the face or body, so
-- taking the face or body away and setting up again costs tokens like any redraw. Null: not taken yet.
alter table adult_identity add column if not exists free_setup_at timestamptz;

-- Reel shots that speak (David, 2026-11-01: "the best reasonable price model"): on Replicate, a shot with a line goes to
-- a model that says the line itself (lib/adult/reels.ts talkShotInput); null: DEFAULT_REPLICATE_TALK_MODEL.
alter table adult_settings add column if not exists replicate_talk_model text;
-- Reel shots with a line the talk model doesn't make: picture + voice -> lips moving (lib/adult/settings.ts, 2026-11-09).
alter table adult_settings add column if not exists replicate_speech_model text;

-- After Dark videos on someone's own key (David, 2026-11-01): one more Connections job. Widen the CHECK once more.
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'user_connection_jobs_job_check'
       and pg_get_constraintdef(oid) not like '%after_dark_video%'
  ) then
    alter table user_connection_jobs drop constraint if exists user_connection_jobs_job_check;
    alter table user_connection_jobs add constraint user_connection_jobs_job_check check (job in ('text', 'image', 'video', 'after_dark', 'after_dark_video'));
  end if;
end $$;

-- What they wear tonight (David, 2026-11-03: "what they're wearing should be defined at the start of chapter one"):
-- fixed at the night's first picture, or a roleplay's first for its costume, so a moment drawn ahead can't change clothes
-- mid-night (lib/adult/beats.ts lockOutfits). Cleared when a night ends; a filed chapter keeps its own copy.
alter table adult_scenes add column if not exists outfits jsonb;
alter table adult_nights add column if not exists outfits jsonb;

-- What ensureSchema last applied: a hash of this SQL and the house cast (ensureSchemaCurrent), so a cold start
-- whose schema is already in place skips the whole thing.
create table if not exists schema_meta (
  id integer primary key check (id = 1),
  version text not null,
  applied_at timestamptz not null default now()
);

-- Which languages people and agents write in (lib/language-seen.ts; David, 2026-10-31): a count per day, surface
-- (mcp, web_create, web_text), language (lib/language.ts, 'und' when too short to tell) and who. Never the words.
create table if not exists language_seen (
  day date not null,
  surface text not null,
  lang text not null,
  actor text not null,
  n integer not null default 1,
  primary key (day, surface, lang, actor)
);

-- Site engagement (lib/engagement.ts; David, 2026-10-31: "track all engagements across the site"): one row per page
-- view, click, scroll or conversion from the browser beacon (app/engagement.ts). visitor is a random id kept in the
-- browser, session one per tab visit; user_id the signed cookie's id when there is one. path has its ids replaced, and
-- props are small enums and counts: never anything typed. Kept 400 days (lib/retention.ts).
create table if not exists web_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  visitor text not null,
  session text not null,
  user_id text,
  event text not null,
  path text not null,
  props jsonb not null default '{}'::jsonb,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  country text,
  device text,
  host text not null default 'show'
);
create index if not exists web_events_at_idx on web_events (at);
create index if not exists web_events_event_idx on web_events (event, at);
create index if not exists web_events_visitor_idx on web_events (visitor);

-- Tonight's situation (lib/situations.ts; docs/ideas.md "Bringing viewers back", idea 1): one vote a viewer a UTC day
-- (YYYY-MM-DD) on which of three show roleplays two of the house cast play, and, once the vote closes, the date it made
-- (one row a day: the claim that stops two lobby runs both making it; party_id is set once the room exists).
create table if not exists situation_votes (
  day text not null,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, user_id)
);
-- Display names are one person's each (app/api/profile, #1238): the check reads this.
create index if not exists profiles_name_lower on profiles (lower(trim(name)));
-- This season's cast members' hidden secrets (lib/cast-secrets.ts): written once a season each, by the show's model or
-- from the fixed pool; they come out on the schedule as their public dates air.
create table if not exists cast_secrets (
  character_id text not null references characters (id) on delete cascade,
  season_id text not null,
  idx integer not null,
  secret text not null,
  source text not null check (source in ('model', 'pool')),
  created_at timestamptz not null default now(),
  primary key (character_id, season_id, idx)
);
-- Living dates: a secret that slipped out on a date (lib/cast-secrets.ts recordSlips), counted out once that date airs.
alter table cast_secrets add column if not exists revealed_episode text;
alter table cast_secrets add column if not exists revealed_line integer;
-- Go deeper: a creator's own "what they're hiding" for their character, in the same table under season 'own' (source 'owner').
alter table cast_secrets drop constraint if exists cast_secrets_source_check;
alter table cast_secrets add constraint cast_secrets_source_check check (source in ('model', 'pool', 'owner'));
-- The show feel (docs/show-style.md): an episode's display title, written once at air time (lib/episode-title.ts).
alter table episodes add column if not exists title text;
create table if not exists situation_nights (
  day text primary key,
  a_id text not null,
  b_id text not null,
  pick text not null,
  votes integer not null,
  total integer not null,
  party_id text,
  created_at timestamptz not null default now()
);

-- Recoupling nights (lib/recoupling.ts; docs/ideas.md "Bringing viewers back", idea 9): one row per night the season's
-- format schedules (lib/season-format.ts recouplingNightDays) or an admin stages. The row opens the viewer vote with a
-- frozen ballot (choices), and night_id is set when the night runs as a one-room group night (theme 'recoupling').
create table if not exists recoupling_nights (
  season_id text not null,
  night_at text not null,
  question text not null check (question in ('couple_in_trouble', 'newcomer')),
  choices jsonb not null,
  staged boolean not null default false,
  night_id text,
  winner text,
  created_at timestamptz not null default now(),
  primary key (season_id, night_at)
);
-- One vote a viewer a recoupling night (night_at is recoupling_nights' key day), changeable until the night runs.
create table if not exists recoupling_votes (
  night_at text not null,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (night_at, user_id)
);
-- A group night's theme: 'recoupling' marks the season's special night, so /mixers/[id] bills it as The Recoupling.
alter table group_nights add column if not exists theme text;

-- Which format a season runs in (lib/season-format.ts; docs/ideas.md F "An island season"): one row a season, written
-- from /admin/season. No row = 'classic', the show exactly as it was before formats existed.
create table if not exists season_formats (
  season_id text primary key,
  slug text not null,
  created_at timestamptz not null default now()
);

-- Muted notification types (lib/notification-mutes.ts): such a notification arrives already read, with no push or email.
create table if not exists notification_mutes (
  user_id text not null,
  type text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, type)
);
-- The season ballot's result, announced once (lib/season-vote.ts announceBallotResult): who won, and when voters heard.
create table if not exists season_vote_results (
  season_id text primary key,
  winner text,
  votes integer not null,
  total integer not null,
  announced_at timestamptz not null default now()
);

-- Next season's format, by the viewers (lib/season-vote.ts): one vote a viewer a season, cast during the month before it.
create table if not exists season_format_votes (
  season_id text not null,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

-- A season's finale (lib/season-recap.ts; David 2026-11-01): the recap of a closed season, frozen on its first read
-- after the season ends. One row a season: the first reader claims it (claimed_at), writes data (the recap's facts, as
-- shown) and the "Previously on" narrative (narrative_by: 'model' or 'template'), and it never changes afterwards.
create table if not exists season_recaps (
  season_id text primary key,
  claimed_at timestamptz not null default now(),
  data jsonb,
  narrative text,
  narrative_by text,
  frozen_at timestamptz
);

-- Dares (lib/dares.ts; docs/ideas.md "Bringing viewers back", idea 2): the nightly ballot's second lane. One vote a
-- viewer a UTC day on which producer dare tomorrow's house date carries; the winner is slipped to ONE dealt side as its
-- private note. dare_nights is the night's record: who was dared to do what, on which date (the reveal reads it).
create table if not exists dare_votes (
  day text not null,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, user_id)
);
create table if not exists dare_nights (
  day text primary key,
  character_id text not null,
  dare_id text not null,
  votes integer not null,
  total integer not null,
  party_id text,
  episode_id text,
  created_at timestamptz not null default now()
);
create index if not exists dare_nights_episode_idx on dare_nights (episode_id) where episode_id is not null;
-- A night can now be made by the dare lane alone: its situation pick is then null.
alter table situation_nights alter column pick drop not null;

-- Your character meets the cast (lib/cast-date.ts; docs/ideas.md "Bringing viewers back", idea 15): the weekly earned
-- slot. One row per completed week (the claim), naming the winner; the prize itself is a token_grants row.
create table if not exists cast_date_weeks (
  week_id text primary key,
  user_id text not null,
  granted_at timestamptz not null default now()
);
create index if not exists cast_date_weeks_user_idx on cast_date_weeks (user_id, granted_at);

-- Back a cast member (lib/backing.ts; docs/ideas.md "Bringing viewers back", idea 3): one pick per viewer per season,
-- changeable until mid-month. Settled once when the season closes (won = ended the season publicly coupled): points
-- (lib/game.ts) and a season badge (the won row itself).
create table if not exists cast_backings (
  season_id text not null,
  user_id text not null,
  character_id text not null references characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  won boolean,
  settled_at timestamptz,
  primary key (season_id, user_id)
);
create index if not exists cast_backings_character_idx on cast_backings (season_id, character_id);
create index if not exists cast_backings_user_idx on cast_backings (user_id);

-- The dare's verdict, read from the date itself (lib/dare-verdict.ts): went_through / sort_of / chickened_out, stored once
-- with where it came from ('model', or 'roll': the engine's note_followed when the check failed). Null: not judged yet.
alter table dare_nights add column if not exists verdict text;
alter table dare_nights add column if not exists verdict_source text;

-- The weekly prize is a date WITH THE CAST (lib/cast-date.ts, wave 2): the claim row is redeemable once before
-- expires_at for a date with a season cast member (redeemed_at when claimed, episode_id once booked). Weeks won before
-- this have expires_at null: they got a token_grants date instead.
alter table cast_date_weeks add column if not exists expires_at timestamptz;
alter table cast_date_weeks add column if not exists redeemed_at timestamptz;
alter table cast_date_weeks add column if not exists episode_id text;

-- Leaked from the cast group chat (lib/cast-chat.ts; docs/ideas.md idea 14): one row a UTC day, written once the day
-- ends from what aired publicly that day. lines: [{character_id, text}], every one PG-checked. source: 'model',
-- 'template', 'quiet' (nothing aired: no chat) or 'pending' (claimed, being written).
create table if not exists cast_chats (
  day text primary key,
  lines jsonb not null default '[]'::jsonb,
  source text not null,
  created_at timestamptz not null default now(),
  written_at timestamptz
);

-- A winning dare pays its voters (lib/dare-points.ts): once the date airs, each vote for the dare that won the night
-- settles once with what the verdict earns (went through 5, sort of 2, chickened out 0). settled_at null: not yet.
alter table dare_votes add column if not exists points integer;
alter table dare_votes add column if not exists settled_at timestamptz;
create index if not exists dare_votes_user_settled_idx on dare_votes (user_id) where settled_at is not null;

-- Auditions (lib/auditions.ts; David, 2026-11-03): a person puts one of their own characters up for next month's cast.
-- status: open (waiting on the admin), approved (shortlisted: the votes decide), rejected, withdrawn (by its owner).
-- One in play per owner per season. audition_votes: one vote a viewer a season, moved by voting again.
create table if not exists cast_auditions (
  season_id text not null,
  character_id text not null references characters (id) on delete cascade,
  owner_id text not null,
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (season_id, character_id)
);
create unique index if not exists cast_auditions_one_each on cast_auditions (season_id, owner_id) where status <> 'withdrawn';
create table if not exists audition_votes (
  season_id text not null,
  voter_id text not null,
  character_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, voter_id)
);
create index if not exists audition_votes_character_idx on audition_votes (season_id, character_id);
-- A season's cast can hold people's characters now: 'fan', an audition that won a place (lib/season-cast.ts). Its owner
-- can take it off the show mid-season: withdrawn_at, and it's off at once (the row stays, for the record).
-- The list is the whole one ('lead' and 'suitor' came with The Botchelor, below): this statement runs again whenever the
-- schema changes, and a narrower check here would fail on a Botchelor season's rows and stop the boot.
alter table season_casts drop constraint if exists season_casts_source_check;
alter table season_casts add constraint season_casts_source_check check (source in ('dealt', 'survivor', 'new', 'fan', 'lead', 'suitor'));
alter table season_casts add column if not exists withdrawn_at timestamptz;
-- A pair's dates, and one character's (lib/text-chain.ts loadChain/loadChainsFor, lib/inbox.ts): by either side.
create index if not exists episodes_pair_idx on episodes (character_a, character_b);
create index if not exists episodes_b_idx on episodes (character_b);
-- The dates the house books for a character while its person is away (lib/character-life.ts, setup.met_via = 'life'):
-- the weekly gap check and the day's cap read them by character and by day, so they are indexed apart.
create index if not exists episodes_life_idx on episodes (character_a, created_at desc) where setup->>'met_via' = 'life';
-- Sunday's reveal (lib/weekly-reveal.ts; 2026-11-07 audit, items 7 and 9): one row a week (week_id: its Sunday), the
-- ballot frozen when Saturday's vote opens; the result, the secret it brought out and the date it made, each once.
create table if not exists weekly_reveals (
  week_id text primary key,
  season_id text not null,
  choices jsonb not null,
  opened_at timestamptz not null default now(),
  revealed_at timestamptz,
  winner text,
  secret_idx integer,
  votes integer,
  total integer,
  producers_pick boolean,
  partner_id text,
  party_id text,
  episode_id text,
  date_tries integer not null default 0,
  notified_at timestamptz
);
create table if not exists weekly_reveal_votes (
  week_id text not null,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (week_id, user_id)
);
-- A cast secret the audience voted out on a Sunday: out from voted_at, like a slip once its date airs.
alter table cast_secrets add column if not exists voted_week text;
alter table cast_secrets add column if not exists voted_at timestamptz;
-- The season pool (lib/season-pool.ts; 2026-11-07 audit, item 8): one season score per player, the board frozen and
-- revealed once when the season closes. season_pools claims the freeze; its entries are every ranked player's place
-- (names are read live from profiles, so a rename or a removed name shows as it is now).
create table if not exists season_pools (
  season_id text primary key,
  claimed_at timestamptz not null default now(),
  frozen_at timestamptz,
  players integer not null default 0,
  notified_at timestamptz
);
create table if not exists season_pool_entries (
  season_id text not null,
  user_id text not null,
  place integer not null,
  points integer not null,
  calls_right integer not null default 0,
  agent boolean not null default false,
  primary key (season_id, user_id)
);
create index if not exists season_pool_entries_place_idx on season_pool_entries (season_id, place);
-- The Sunday letter (lib/newsletter.ts, docs/newsletter.md): one row an address, lowercased, with no account behind it.
-- pending until its confirmation link is clicked (double opt-in); pending_since starts each pending spell, and a spell
-- never confirmed is deleted after 30 days (one that had left goes back to unsubscribed). unsubscribed keeps the address
-- and when it left, so the opt-out holds until a new sign-up is confirmed. confirms_sent counts this spell's
-- confirmation emails (a few at most); confirm_tried_at is the last try, sent or not. attested_adult_at: when the
-- sign-up said 18 or older (none for an address that only ever left, from an old email's link).
create table if not exists newsletter_subscribers (
  email text primary key,
  status text not null check (status in ('pending', 'confirmed', 'unsubscribed')),
  pending_since timestamptz,
  attested_adult_at timestamptz,
  confirm_sent_at timestamptz,
  confirm_tried_at timestamptz,
  confirms_sent integer not null default 0,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newsletter_subscribers_status_idx on newsletter_subscribers (status, pending_since);
-- One row a week's letter (id: its ISO week, 2026-W46; week_id: the Sunday of the reveal it follows), built once after
-- the reveal airs: every subscriber gets this same subject and body. sent counts the emails that went out.
create table if not exists newsletter_issues (
  id text primary key,
  week_id text not null,
  subject text not null,
  html text not null,
  text text not null,
  built_at timestamptz not null default now(),
  sent integer not null default 0,
  last_sent_at timestamptz
);
-- Who got which letter: claimed before the send, so an address gets each letter once even when the job runs twice. A
-- send the provider refused gives its claim back for a later pass, until tries runs out; one whose pass died mid-send
-- stays claimed, since it may have gone out. Kept 90 days.
create table if not exists newsletter_sends (
  issue_id text not null,
  email text not null,
  tries integer not null default 1,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (issue_id, email)
);
create index if not exists newsletter_sends_created_idx on newsletter_sends (created_at);
-- Every email the Sunday letter sends, by Resend's id, so the hourly job can ask how it went: a bounce, a spam complaint
-- or Resend's own suppression takes the address off the list (lib/newsletter.ts checkDeliveries). Kept two weeks.
create table if not exists newsletter_deliveries (
  provider_id text primary key,
  email text not null,
  kind text not null check (kind in ('confirm', 'letter')),
  sent_at timestamptz not null,
  checked_at timestamptz,
  last_event text
);
create index if not exists newsletter_deliveries_sent_idx on newsletter_deliveries (sent_at);
-- Why an address left: 'unsubscribed' (the person), or 'bounced', 'complained' or 'suppressed' (from Resend).
alter table newsletter_subscribers add column if not exists left_reason text;
-- #1518: a job create_character's check dealt to one agent (or anonymous sheet), held for it for 30 minutes so no other
-- agent is dealt the same one meanwhile (lib/originality.ts dealJobs). Rows past a day are deleted on the next deal.
create table if not exists job_deals (
  job text primary key,
  holder text not null,
  dealt_at timestamptz not null default now()
);
create index if not exists job_deals_dealt_idx on job_deals (dealt_at);
-- 2026-11-14: the "Botchelor Plus" intent tile (lib/plus-interest.ts): who tapped "Tell me when it opens", where (the shop
-- or the out-of-dates wall), and whether they left an email. The address itself goes on the Sunday letter's list
-- (newsletter_subscribers), never here. A $0 demand test (docs/ideas.md, the parked table): nothing is sold or charged.
-- Rows go with the account (lib/account.ts) and after 400 days (lib/retention.ts).
create table if not exists plus_interest (
  user_id text not null,
  place text not null,
  with_email boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, place)
);
create index if not exists plus_interest_created_idx on plus_interest (created_at);
-- The Botchelor (lib/season-format.ts 'botchelor', lib/ceremony.ts; David 2026-11-14): a season's cast can hold the
-- lead ('lead', one house character) and the suitors ('suitor': people's characters, or the house's own agent-made ones).
alter table season_casts drop constraint if exists season_casts_source_check;
alter table season_casts add constraint season_casts_source_check check (source in ('dealt', 'survivor', 'new', 'fan', 'lead', 'suitor'));
-- The admin's pick of a season's lead (/admin/season), read when the season picks its cast; no row = the most reviewed
-- of last season's survivors.
create table if not exists season_leads (
  season_id text primary key,
  character_id text not null,
  created_at timestamptz not null default now()
);
-- Rose ceremonies (lib/ceremony.ts): one row a ceremony Sunday (held_on). The row opens the audience's vote with a frozen
-- ballot (choices: the suitors still in); held_at is set when the hourly job runs it at CEREMONY_HOUR_UTC. The audience's
-- pick and the lead's go home (eliminated_by_vote, eliminated_by_lead); remaining is who is left; on the finale final_rose
-- names the lead's pick. lines: the ceremony in the show's voice, written from templates at the time.
create table if not exists ceremonies (
  season_id text not null,
  held_on text not null,
  week integer not null,
  lead_id text not null,
  choices jsonb not null,
  finale boolean not null default false,
  held_at timestamptz,
  eliminated_by_vote text,
  eliminated_by_lead text,
  final_rose text,
  votes integer,
  total integer,
  remaining jsonb,
  lines jsonb,
  created_at timestamptz not null default now(),
  primary key (season_id, held_on)
);
-- One vote a viewer a ceremony ("Who goes home?"), changeable until the ceremony runs.
create table if not exists ceremony_votes (
  held_on text not null,
  user_id text not null,
  pick text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (held_on, user_id)
);
-- What a suitor leaves a Botchelor season with (lib/ceremony.ts): 'suitor' (went home at a ceremony), 'runner_up', or
-- 'final_rose'. One a character a season, written once.
create table if not exists suitor_badges (
  season_id text not null,
  character_id text not null,
  badge text not null check (badge in ('suitor', 'runner_up', 'final_rose')),
  week integer not null,
  created_at timestamptz not null default now(),
  primary key (season_id, character_id)
);
-- Open casting (lib/casting.ts; David 2026-11-15): a person's new character's first date goes to the season's lead
-- (episodes.setup.met_via = 'casting'), and every Sunday the walk-ons get a rose or not, by that date's ending. One row
-- a character a Sunday, claimed before anything is sent, so the pass runs once: episode_id is the date judged, rose is
-- whether its ending was a second date, next_episode_id the second date the rose booked (judged the Sunday after).
-- season_id is the lead's season, so a rose handed out before the season starts (the preseason) counts in it.
create table if not exists walk_on_roses (
  season_id text not null,
  held_on text not null,
  character_id text not null,
  episode_id text not null,
  rose boolean not null,
  next_episode_id text,
  created_at timestamptz not null default now(),
  primary key (season_id, held_on, character_id)
);
create index if not exists walk_on_roses_character_idx on walk_on_roses (character_id, held_on desc);
create index if not exists walk_on_roses_episode_idx on walk_on_roses (episode_id);
create index if not exists walk_on_roses_next_idx on walk_on_roses (next_episode_id) where next_episode_id is not null;
create index if not exists episodes_casting_idx on episodes (character_b, created_at desc) where setup->>'met_via' = 'casting';
-- The people's rose (lib/casting.ts): the walk-on with the most roses, on the season's last Sunday, kept as a badge.
alter table suitor_badges drop constraint if exists suitor_badges_badge_check;
alter table suitor_badges add constraint suitor_badges_badge_check check (badge in ('suitor', 'runner_up', 'final_rose', 'peoples_rose'));
-- The model league (lib/model-league.ts, 2026-11-15): the model an agent says it runs on, as told (model, an agent's
-- free text, never shown in public) and the family it counts as (lib/model-family.ts). The latest word wins; via is
-- the tool that carried it (create_character, set_profile, send_feedback).
create table if not exists agent_models (
  agent_id text primary key,
  model text not null,
  family text not null,
  via text not null,
  declared_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A date's model stamp, written once as it's booked (stampDateModels): the family each side's owner had declared by
-- then, a row a side that had one. A later change of model never rewrites these.
create table if not exists episode_models (
  episode_id text not null references episodes (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  agent_id text not null,
  family text not null,
  model text not null,
  stamped_at timestamptz not null default now(),
  primary key (episode_id, side)
);
create index if not exists episode_models_family_idx on episode_models (family);
-- Overnight dates (lib/overnight.ts, 2026-11-15). A pair's timeline also keeps milestones that aren't stage changes:
-- kind null is a stage change (from_stage/to_stage, as before); 'overnight' is an overnight date that aired and ended in
-- leaving together (public layer when the date is public); 'night_together' is the one fact back from After Dark, on
-- the owners' layer ('all'): ids and a timestamp, never a word of the night. One of each kind per overnight date.
alter table relationship_events add column if not exists kind text;
create unique index if not exists relationship_events_milestone on relationship_events (episode_id, kind) where kind is not null and episode_id is not null;
-- An owner's yes to an overnight date is a second-date yes marked so (the overnight is that date's follow-up): a plain
-- second-date yes never counts as a yes to an overnight.
alter table second_date_requests add column if not exists overnight boolean not null default false;
-- After Dark's side (lib/adult/overnight.ts): a night that continues an overnight date, per viewer. started_at when they
-- pressed "Continue the night", nights_before how many nights the pair had filed by then (one filed after is this night
-- ending); told_at once the show was handed its one fact (lib/overnight.ts recordNightTogether).
-- The show's own code never reads this table.
create table if not exists adult_overnights (
  episode_id text not null references episodes (id) on delete cascade,
  owner_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  started_at timestamptz not null default now(),
  nights_before integer not null default 0,
  told_at timestamptz,
  primary key (episode_id, owner_id)
);
-- Learning, weekly (lib/character-lessons.ts; David 2026-11-15, the drama wave's part 6): what a character has learned
-- about itself, in its own words. One row a character a week (week: that week's Monday, UTC), claimed as 'pending'
-- before the writer is called so two passes can't both write it. lines: up to three first-person sentences of at most
-- 120 characters; trying_next: one optional "what I'm trying next" sentence; episodes: the aired public dates they came
-- from ([{episode_id, with, at}]); source: 'model' or the $0 'template'; model and the tokens and cost of the call that
-- wrote it (cost_usd: the provider's own figure, else list price, else null). Private like the learned memory: only the
-- character's own prompts, its owner's memory page and its texts to its owner read it; never the engine, never a dataset.
create table if not exists character_lessons (
  character_id text not null references characters (id) on delete cascade,
  week text not null,
  lines jsonb not null default '[]'::jsonb,
  trying_next text,
  episodes jsonb not null default '[]'::jsonb,
  source text not null check (source in ('pending', 'model', 'template', 'none')),
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  created_at timestamptz not null default now(),
  primary key (character_id, week)
);
create index if not exists character_lessons_created_idx on character_lessons (created_at desc);
-- A lesson is something an owner can tell the character to forget (item: the lesson's words), like the rest of memory.
alter table memory_forgets drop constraint if exists memory_forgets_kind_check;
alter table memory_forgets add constraint memory_forgets_kind_check check (kind in ('reflection', 'line', 'like', 'turnoff', 'moment', 'lesson'));
-- "Not them" (lib/line-feedback.ts): a thumbs-down may say the line was out of character. Null on every other vote.
alter table line_feedback add column if not exists tag text;
alter table line_feedback drop constraint if exists line_feedback_tag_check;
alter table line_feedback add constraint line_feedback_tag_check check (tag is null or (tag = 'out_of_character' and vote < 0));
create index if not exists line_feedback_tag_idx on line_feedback (ref_id) where tag is not null;
-- The story state (lib/story-state.ts, 2026-11-15): what a character thinks of people, what it has heard and from whom,
-- and what it wants this week. Private to its holder (its own prompts, its owner's view), built only from the public
-- aired record, never read by the engine. forgotten_at: its owner told it to forget (the row stays, so the same source
-- never brings it back; clearing it is "remember it again").
create table if not exists character_opinions (
  holder_id text not null references characters (id) on delete cascade,
  about_id text not null references characters (id) on delete cascade,
  trust smallint not null default 0 check (trust between -2 and 2),
  attraction smallint check (attraction between -2 and 2),  -- null for someone they aren't dating
  take text not null check (char_length(take) <= 140),
  basis text not null check (basis in ('firsthand', 'heard')),
  source text,              -- the episode or scene it came from
  source_at timestamptz,    -- when that aired
  forgotten_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (holder_id, about_id)
);
create index if not exists character_opinions_about_idx on character_opinions (about_id);
-- Something a character heard about someone (or a pair), from the public aired record only. told_by null: it watched
-- the date air. is_true false: a retelling its writer marked untrue. One row per holder and source.
create table if not exists character_heard (
  id text primary key,
  holder_id text not null references characters (id) on delete cascade,
  about_id text not null references characters (id) on delete cascade,
  about_b_id text references characters (id) on delete cascade,
  claim text not null check (char_length(claim) <= 160),
  told_by text references characters (id) on delete cascade,
  source text not null,
  is_true boolean not null default true,
  heard_at timestamptz not null default now(),
  used_at timestamptz,      -- it came up on a line (markUsed)
  used_in text,             -- the episode or scene where it did
  forgotten_at timestamptz,
  unique (holder_id, source)
);
create index if not exists character_heard_holder_idx on character_heard (holder_id, about_id);
create index if not exists character_heard_about_idx on character_heard (about_id);
-- One want per holder per week (Monday to Monday, lib/season-window.ts). Rules write it; the producer may overwrite.
create table if not exists character_wants (
  holder_id text not null references characters (id) on delete cascade,
  season_id text not null,
  week_id text not null,
  want text not null check (char_length(want) <= 140),
  about_id text references characters (id) on delete set null,
  kind text not null,       -- lib/story-state.ts WANT_KINDS (checked in code, so a later builder can add one)
  set_by text not null check (set_by in ('rules', 'producer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (holder_id, week_id)
);
-- "knows_you_said": the subject of a heard claim was told it to their face, with who said it (markUsed). The
-- confrontation builder reads these and settles them (settled_at).
create table if not exists character_knows_said (
  id text primary key,
  knower_id text not null references characters (id) on delete cascade,
  said_by_id text not null references characters (id) on delete cascade,
  repeated_by_id text not null references characters (id) on delete cascade,
  heard_id text not null references character_heard (id) on delete cascade,
  claim text not null,
  is_true boolean not null,
  source text not null,     -- the aired date or scene where the knower learned it
  learned_at timestamptz not null default now(),
  settled_at timestamptz,
  settled_in text,
  unique (knower_id, heard_id)
);
create index if not exists character_knows_said_knower_idx on character_knows_said (knower_id);
-- One-off runs of the story state (its backfill): a key that has run never runs again.
create table if not exists story_state_runs (
  key text primary key,
  ran_at timestamptz not null default now()
);
-- The producer (lib/producer.ts): one row per UTC day it produced. The row is the day's claim (two passes can't both
-- produce it) and the owner's skip. A staged beat names the tension it stages, who it is about, the evidence ids from
-- lib/story-state.ts tensions(), the two daily lines, the logline, the vote's twists and, later, what came of it.
create table if not exists story_beats (
  day text primary key,
  season_id text not null,
  kind text not null,          -- lib/producer.ts BEAT_KINDS, or 'none'
  status text not null,        -- pending | staged | played | missed | skipped | none
  tension text,                -- lib/story-state.ts TensionKind
  who jsonb not null default '[]'::jsonb,
  about text,
  evidence jsonb not null default '{}'::jsonb,
  why text,                    -- for the owner only: it may say whether a claim is true
  logline text,
  logline_by text,             -- model | template
  previously text,
  tonight text,
  choices jsonb,               -- the day's vote twists (lib/producer.ts Twist[]), or null: the dealt roleplays stand
  wants jsonb,
  outcome jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A story arc's step (lib/story-arcs.ts ArcBeat): set only on a beat of kind 'arc_step', whose tension is null.
alter table story_beats add column if not exists arc jsonb;
-- Story arcs (lib/story-arcs.ts): three dates (spark, setback, reveal) for a pair who knew each other before the show
-- (character_links). One a pair, ever; lower id first. staged_day is the beat day its next step is staged for, with
-- that step's roleplay and who plays its first role; dates is what each played step's date was and how it ended.
create table if not exists story_arcs (
  id text primary key,
  season_id text not null,
  character_a text not null references characters (id) on delete cascade,
  character_b text not null references characters (id) on delete cascade,
  kind text not null,
  step text not null default 'spark',
  status text not null default 'active',   -- active | done
  outcome text,                            -- together | apart | faded, once done
  staged_day text,
  roleplay text,
  first_role text,
  misses int not null default 0,
  dates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_a, character_b),
  check (character_a < character_b)
);
create index if not exists story_arcs_active_idx on story_arcs (status, staged_day);
-- The date plans written at night (lib/night-plans.ts): one per house date expected the next day. episode_id is the id
-- reserved for that date (its seed), fit_key what the date must turn out to be for the plan to fit (the pair in order,
-- the place, the situation and the engine's decision, hashed), plan the beat sheet in lib/beats.ts DatePlan shape (null
-- when the model's didn't pass: that date plays from the rules plan).
create table if not exists date_plans (
  id text primary key,
  day text not null,
  slot text not null,          -- lobby | situation
  a_id text not null references characters (id) on delete cascade,
  b_id text not null references characters (id) on delete cascade,
  episode_id text not null,
  fit_key text not null,
  plan jsonb,
  model text,
  ms integer,
  usage jsonb,
  used_at timestamptz,
  fit boolean,
  created_at timestamptz not null default now(),
  unique (day, slot)
);
create index if not exists date_plans_pair_idx on date_plans (a_id, b_id, day);
-- A voted night whose winner was one of the producer's twists keeps what it was called (a roleplay's comes from its id).
alter table situation_nights add column if not exists title text;
alter table situation_nights add column if not exists icon text;
-- The daily house scene (lib/house-scenes.ts, 2026-11-15): a few of the cast talk in the show's house about a date that
-- aired, and what each line retells becomes something the others heard (character_heard, source 'scene:<id>#<line>').
-- One row a day and kind (id '<day>-<kind>'). lines: [{character_id, text, tell?, removed?}], every one checked before
-- it is stored; told: what each line told to whom [{line, by, to, episode_id, about, about_b, claim, is_true, source}].
-- source: 'model', 'template', 'quiet' (nothing to talk about: no scene) or 'pending' (claimed, being written).
create table if not exists house_scenes (
  id text primary key,
  day text not null,
  season_id text not null,
  kind text not null default 'gossip',
  place text not null,
  cast_ids jsonb not null default '[]'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  told jsonb not null default '[]'::jsonb,
  tension jsonb,            -- the tension that seated them, for the record (never shown)
  result jsonb,             -- how a confrontation or a challenge came out (later kinds)
  source text not null,
  model text,
  cost_usd numeric(10, 6),  -- at paid list prices (lib/pricing.ts); $0 in cash on the free tier
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  written_at timestamptz
);
create index if not exists house_scenes_day_idx on house_scenes (day desc);
-- What a house challenge's winner gets (lib/house-conflict.ts): the one-on-one on its day. 'lead_date' (a Botchelor
-- season): the winner takes the lead's date that day, trading days with whoever's turn it was; 'first_pick' (any other
-- format): the day's first house date is the winner's with with_id. One prize a day. lib/season-cast.ts reads it.
create table if not exists house_prizes (
  day text primary key,
  season_id text not null,
  winner_id text not null references characters (id) on delete cascade,
  with_id text references characters (id) on delete set null,
  kind text not null check (kind in ('lead_date', 'first_pick')),
  title text,
  scene_id text,
  created_at timestamptz not null default now()
);
-- The daily clip the home page plays (lib/home-clip.ts, 2026-11-15): scripts/clips/daily-clip.mjs uploads a small muted
-- web loop and a poster of the day's clip (POST /api/admin/home-clip). One row per clip, one clip per episode (a second
-- upload replaces it). Bytes live in the object store (loop_key, poster_key), or here when none is configured.
create table if not exists home_clips (
  id text primary key,
  episode_id text not null unique references episodes (id) on delete cascade,
  day text not null,
  loop_key text,
  loop_data bytea,
  poster_key text,
  poster_data bytea,
  width integer not null,
  height integer not null,
  seconds numeric(6, 2) not null,
  created_at timestamptz not null default now()
);
create index if not exists home_clips_created_idx on home_clips (created_at desc);
-- The date's whole clip with its voices, for the episode page's "60-second version" (lib/home-clip.ts, 2026-11-19): the
-- web cut of the same render the loop comes from. Optional; an upload without one keeps the cut the date already has.
alter table home_clips add column if not exists cut_key text;
alter table home_clips add column if not exists cut_data bytea;
alter table home_clips add column if not exists cut_seconds numeric(6, 2);
-- A viewer's report of one line of a scene (lib/house-scenes.ts reportSceneLine): REPORT_HIDE_THRESHOLD hide the line
-- and take what it told back out of the story state.
create table if not exists house_scene_reports (
  scene_id text not null references house_scenes (id) on delete cascade,
  line integer not null,
  reporter_id text not null,
  reason text not null default 'other',
  created_at timestamptz not null default now(),
  primary key (scene_id, line, reporter_id)
);
-- A report from a brand-new identity is kept for the admins' list but hides nothing (lib/report-trust.ts, 2026-11-22).
alter table house_scene_reports add column if not exists counts boolean not null default true;
-- Marketing, in the open (/marketing, lib/public-marketing.ts, docs/marketing.md): the marketing loop's channels, posts
-- and planned spend, sent after every run (POST /api/admin/marketing). One row, replaced whole each time.
create table if not exists marketing_feed (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
-- Relationships that go somewhere (lib/relationship-stages.ts, 2026-11-16). stage and public_stage stay the BASE
-- stage, the seven every rule reads. Beside each, the stage as it is SHOWN (keeping it casual, official, moved in,
-- engaged, married, broke up, back together, divorced, didn't click): derived at the same refresh, null until a row is
-- refreshed or the hourly backfill reaches it (lib/relationships.ts backfillShownStages: stage columns only, no event,
-- no notice), and never read when RELATIONSHIP_STAGES_V2=0. A stage event keeps both readings the same way; a finale's
-- engagement or wedding is a milestone row (kind 'engaged' / 'married', episode_id null, at the season's close: at
-- most one of each kind a finale, lib/season-finale.ts).
alter table relationships add column if not exists shown_stage text;
alter table relationships add column if not exists public_shown_stage text;
alter table relationship_events add column if not exists from_shown text;
alter table relationship_events add column if not exists to_shown text;
-- Creator invites for casting (lib/casting-invites.ts, docs/casting-invites.md): one code, one character. An invited
-- creator's character skips the three-date wait, is pre-approved and goes straight on an audition date with the lead.
-- season_id: the season auditions were for when the code was made; note: the admin's own (who it is for), never shown
-- publicly. Used once: used_at, used_by (the owner) and the character are set together, with the approved audition.
create table if not exists casting_invites (
  code text primary key,
  season_id text not null,
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  used_by text,
  character_id text references characters (id) on delete set null
);
create index if not exists casting_invites_created_idx on casting_invites (created_at desc);
-- The story check (lib/story-check.ts, docs/story-check.md): one row per aired public date judged for whether its
-- ending makes sense against its lines and recap. verdict: consistent, hidden_truth, reversal, or contradicts (never
-- featured: lib/story-check-gate.ts). reason: one line, admin-only. repaired: the recap's finale was rewritten from
-- facts on record; finale_before keeps the finale it replaced (audit, undo). model: the judge's id, or 'rules' (the
-- free fallback). Tokens and cost as the show's other paid background calls keep them (cost_usd: the provider's own
-- figure, else list price, else null).
create table if not exists story_checks (
  episode_id text primary key references episodes (id) on delete cascade,
  verdict text not null check (verdict in ('consistent', 'hidden_truth', 'reversal', 'contradicts')),
  reason text not null default '',
  repaired boolean not null default false,
  finale_before text,
  model text,
  prompt_version text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10, 6),
  checked_at timestamptz not null default now()
);
-- The Sunday premiere (lib/sunday-premiere.ts, docs/sunday-premiere.md): one row a Sunday that premieres the lead's date
-- in a shared room (kind 'weekly' on a ceremony Sunday, 'pilot' the Sunday before a lead season). The job's pass the hour
-- before claims it (claimed_at; tries counts the builds), picks the suitor, builds the date the way template rooms are
-- built and records the room (party_id, its watch_parties row turned 'premiere' with starts_at). notified_at: its
-- notices went out, once. note: why a Sunday has no room (no suitor, the show paused, no date came back).
create table if not exists premieres (
  held_on text primary key,
  season_id text not null,
  kind text not null check (kind in ('pilot', 'weekly')),
  lead_id text not null,
  suitor_id text,
  starts_at timestamptz not null,
  party_id text,
  episode_id text,
  claimed_at timestamptz,
  built_at timestamptz,
  notified_at timestamptz,
  tries integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);
-- The season page's starters (lib/season-page.ts, docs/season-page.md): up to three of the lead's dates an admin pinned
-- for a lead season's "Start here" box (/admin/season), in order. A pin shows only while it passes the automatic picks'
-- checks (aired, public, both characters public, not hidden, featurable by the story check).
create table if not exists season_starters (
  season_id text primary key,
  episode_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
-- Show ideas (lib/show-ideas.ts, docs/show-ideas.md; David 2026-11-16): shows Botchelor might make, as a demand test.
-- The house's own ideas are in the code; a row here is someone's proposal, held ('pending') until an admin lists or
-- declines it. A vote is one voter's three switches on one idea (a house idea's id or a proposal's), counted apart for
-- people and for agents (voter_kind: 'agent' when it came over MCP or from a known bot).
create table if not exists show_ideas (
  id text primary key,
  title text not null,
  pitch text not null,
  proposed_by text not null,
  proposer_kind text not null default 'person' check (proposer_kind in ('person', 'agent')),
  status text not null default 'pending' check (status in ('pending', 'listed', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists show_ideas_status_idx on show_ideas (status, created_at desc);
create index if not exists show_ideas_proposer_idx on show_ideas (proposed_by);
create table if not exists show_idea_votes (
  idea_id text not null,
  user_id text not null,
  voter_kind text not null default 'person' check (voter_kind in ('person', 'agent')),
  watch boolean not null default false,
  enter_character boolean not null default false,
  produce boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
create index if not exists show_idea_votes_user_idx on show_idea_votes (user_id);
-- A text a character sends about one of its dates knows which date (the connected model, stage 5; docs/companions.md
-- "A text knows its date"): set when the row is written, from the tag (lib/companion-shared.ts tagEpisode); "action"
-- stays the dedupe key. Nullable, no foreign key; older rows are filled by the hourly job (lib/chat-date-links.ts
-- backfillMessageEpisodes), never here. It goes with the message (the thread's cascade).
alter table companion_messages add column if not exists episode_id text;
create index if not exists companion_messages_episode_idx on companion_messages (episode_id) where episode_id is not null;
-- Shows and their seasons as rows (lib/show-seasons.ts, docs/data-model.md; the connected-model plan, stages 1 and 2).
-- A season id was only ever computed from a date: nothing could be joined to it, and a season's format was read from
-- the live ballot. show_seasons.id is the id every season_id column already holds; the row adds its show, number, span
-- and its format, frozen once it starts. Rows are written by the hourly job (ensureShowSeasons), never here.
create table if not exists shows (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  title text not null,
  status text not null default 'on_air' check (status in ('on_air', 'ended')),
  -- Who runs it: null is the house.
  producer_id text,
  created_at timestamptz not null default now()
);
insert into shows (id, title) values ('botchelor', 'Botchelor') on conflict (id) do nothing;
create table if not exists show_seasons (
  id text primary key,
  show_id text not null default 'botchelor' references shows(id),
  number integer,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  format text,
  format_source text check (format_source in ('admin', 'ballot', 'default')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists show_seasons_span_idx on show_seasons (show_id, starts_at, ends_at);
-- A date knows the season and show it aired in: stamped when it airs (lib/air.ts, lib/watch.ts), older ones filled by
-- the hourly job a batch at a time (backfillEpisodeSeasons). Null until a date airs. No foreign key: additive only.
alter table episodes add column if not exists season_id text;
alter table episodes add column if not exists show_id text not null default 'botchelor';
create index if not exists episodes_season_idx on episodes (season_id, revealed_at desc) where season_id is not null;
-- A season's awards as rows (lib/profile/credits.ts; stage 3): one per character an award names. They were only ever
-- JSON inside season_recaps.data, so "what has this character won" could not be asked. Written when a recap freezes;
-- recaps frozen earlier are filled by the hourly job.
create table if not exists season_awards (
  season_id text not null,
  award text not null,
  title text not null,
  character_id text not null,
  slot smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (season_id, award, character_id)
);
create index if not exists season_awards_character_idx on season_awards (character_id);
-- A portrait chosen from a Studio picture remembers which one (lib/studio/picture-choice.ts; stage 4): it was a copy
-- with no link back, so "which shoot is this face from" could not be answered. Null for every other asset.
alter table character_assets add column if not exists from_picture_id text;
-- An event knows which character and which date it is about (the connected model, stage 6; docs/analytics.md "Which
-- character, which date"): the browser reads them off the page's address or the control (app/engagement.ts
-- addressKeys), the server lifts them out of props (lib/engagement.ts eventKeys). Nullable, no foreign key; never set
-- for After Dark. They go with the row (400 days, lib/retention.ts; the visitor's account, lib/account.ts).
alter table web_events add column if not exists character_id text;
alter table web_events add column if not exists episode_id text;
create index if not exists web_events_character_idx on web_events (character_id, at) where character_id is not null;
create index if not exists web_events_episode_idx on web_events (episode_id, at) where episode_id is not null;

-- Claimed identities (lib/account-claim.ts; the connected model, stage 7): the anonymous id a browser held before it
-- signed in (alias_id) and the account that brought what it had made into itself (user_id). One claim an identity,
-- ever: the primary key is what refuses a second. Kept while the account is, and deleted with it.
create table if not exists account_aliases (
  alias_id text primary key,
  user_id text not null,
  linked_at timestamptz not null default now()
);
create index if not exists account_aliases_user_idx on account_aliases (user_id);

-- An account's session version (lib/session-versions.ts): every session token carries the version it was signed with,
-- and one below this is refused, so changing the password, "Sign out everywhere" and deleting the account end the
-- sessions already handed out. A row only once it first moves (no row: 0). No foreign key, and kept when the account is
-- deleted: it is what keeps that account's old sessions ended, and it holds only the id and a count.
create table if not exists session_versions (
  user_id text primary key,
  version integer not null default 0,
  changed_at timestamptz not null default now()
);
create index if not exists session_versions_changed_idx on session_versions (changed_at);

-- Bans and suspensions an admin puts on an account (any identity id), an agent, or an address (its visitor key, a keyed
-- hash: no address is stored), lib/bans.ts. No end (until null) is a ban; an end is a suspension. Each process keeps the
-- live ones in memory. A moderation record: kept when the account is deleted, like session_versions.
create table if not exists bans (
  kind text not null check (kind in ('account', 'agent', 'address')),
  target text not null,
  until timestamptz,
  reason text,
  banned_by text not null,
  created_at timestamptz not null default now(),
  primary key (kind, target)
);

-- When a character came into its account by a claim (null: it was made there). The account's choices that are consents
-- cover a claimed character only from this moment on (lib/ml-consent.ts consentedCharactersSql), as a linked agent's do.
alter table characters add column if not exists claimed_at timestamptz;

-- Originality as our metadata (lib/originality-concept.ts recordOriginality; David, 2026-11-20: "keep the grading as a
-- metadata thing for our system"): the 0-100 score of the sheet as it was last saved, and when. People never see it;
-- the builder shows what to change instead, and only once a character has been on a date.
alter table characters add column if not exists originality_score smallint;
alter table characters add column if not exists originality_at timestamptz;

-- Writing styles (lib/narration.ts, lib/writing-style.ts; David, 2026-11-17): each person's style for their show dates
-- and companion scenes (show_style) and for their After Dark scenes (adult_style): 'script' or 'narrated' (admins only
-- while it's tested). Goes with their account. A narrated companion reply keeps its prose beside the words (beat:
-- {"before","after"}), never in text, which the voice reads.
create table if not exists writing_prefs (
  user_id text primary key,
  show_style text check (show_style is null or show_style in ('script', 'narrated')),
  adult_style text check (adult_style is null or adult_style in ('script', 'narrated')),
  updated_at timestamptz not null default now()
);
alter table companion_messages add column if not exists beat jsonb;
-- Stories (lib/stories.ts): a finished show date (kind 'episode', ref the episode id, owner null: everyone who can see
-- the date reads the same one) or an After Dark chapter (kind 'adult', ref the saved chapter's id or "<scene id>:<chapter>:
-- <lines>" for one still being written, owner its viewer) told again as prose. One a source; paragraphs a JSON array.
create table if not exists stories (
  id text primary key,
  kind text not null check (kind in ('episode', 'adult')),
  ref_id text not null,
  owner_id text,
  title text not null,
  paragraphs jsonb not null,
  model text,
  cost numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists stories_ref_idx on stories (kind, ref_id, coalesce(owner_id, ''));

-- Who a person is in scenes (lib/persona.ts; the roleplay audit, 2026-11-17, item 3): a name to be called, a line on
-- how they look and a line on who they are. Make-believe they write for scenes, checked before it's stored, one a
-- person; it goes into a scene's prompt and is never a memory. Goes with their account.
create table if not exists personas (
  user_id text primary key,
  name text not null,
  look text not null default '',
  about text not null default '',
  updated_at timestamptz not null default now()
);
-- How a companion's scene opens when the person chose (lib/scene-opening.ts) and it plays no roleplay: one of the
-- generic openings, or a sentence they wrote (checked). With a roleplay the choice is in its terms (roleplay.opening).
-- Cleared with the scene.
alter table companion_threads add column if not exists opening text;
-- Story mode (lib/narration.ts; the roleplay audit, 2026-11-17, item 1): a scene reply written as prose in one call. Its
-- text is the paragraphs joined by a blank line, what's said out loud in double quotes inside them; form = 'story' says
-- so (null: a text or a script line, as ever). It has no action and no beat.
alter table companion_messages add column if not exists form text check (form is null or form in ('story'));
-- Alternates (item 4): the draw a reply's message belongs to, as the id of that draw's first message. Every reply the
-- model writes carries it, so a reply's bubbles are one draw and "Continue" starts another. When a reply is drawn again
-- the earlier draws stay (replaced_by = the current draw's first id) and the person can flip back to one: exactly one
-- draw is current (replaced_by null). A draw an edit replaced has its draw cleared: it answered other words, and is no
-- alternate. Null on rows from before this, and on texts written without the model.
alter table companion_messages add column if not exists draw text;
-- Step in, After Dark (lib/adult/step-in.ts; David, 2026-11-17: "a NSFW companion date mode too"): the viewer in the
-- scene with one character, told as prose. A scene is its viewer's alone: who, where, the roleplay and which side of it
-- they play (roleplay: {"id","you": 0|1}), how it opens (one of ours, with {a} and {b}, or a sentence they wrote, checked
-- before it was kept), their limits for it (a pair's shape: the intensity and the hard nos, the hard nos under the
-- profile consent), when the AI notice last went in, a rolling recap once it's long, and, once ended, when, and the one
-- line the next scene with that character remembers it by.
-- Its messages: what the viewer wrote, the character's replies (prose, its paragraphs a blank line apart; a reply drawn
-- again keeps the earlier draws, replaced_by = the current one's id; kind 'aside' is the narrator's line that stands in
-- when a reply couldn't be used twice), and system lines (kind 'notice': the AI notice; 'place': the scene moved).
-- Nothing a check refused is ever in either table. Both go with the account (lib/account.ts AFTER_DARK_OWNED).
create table if not exists adult_step_in_scenes (
  id text primary key,
  owner_id text not null,
  character_id text not null,
  place text not null,
  roleplay jsonb,
  opening text,
  intensity text,
  hard_nos jsonb not null default '{"chips":[],"own":[]}',
  hard_nos_consented_at timestamptz,
  recap text,
  recap_upto timestamptz,
  line text,
  notice_at timestamptz,
  paused_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index if not exists adult_step_in_scenes_owner_idx on adult_step_in_scenes (owner_id, last_at desc);
create table if not exists adult_step_in_messages (
  id text primary key,
  scene_id text not null,
  owner_id text not null,
  role text not null check (role in ('viewer', 'character', 'system')),
  kind text,
  text text not null,
  replaced_by text,
  model text,
  cost numeric,
  created_at timestamptz not null default now()
);
create index if not exists adult_step_in_messages_scene_idx on adult_step_in_messages (scene_id, created_at);
-- Step in's memory (lib/adult/step-in-memory.ts, 2026-11-23; David: "I am fine storing that data"): what a character
-- remembers about its viewer between scenes, a short fact a row, per viewer and character. Only for a viewer who turned
-- it on, with its own explicit consent (what someone says about themselves in an adult scene is "sex life" data, GDPR
-- Art. 9): adult_prefs.step_in_memory_at is when they agreed, null is off, and turning it off deletes every fact.
-- edited: the viewer wrote or changed it, so the model never writes over it. uses: how often a prompt carried it
-- (the least used go first when a character's list is full). adult_step_in_scenes.facts_upto: how far into a scene the
-- facts were last drawn from. Goes with the account (lib/account.ts AFTER_DARK_OWNED).
create table if not exists adult_step_in_facts (
  id text primary key,
  owner_id text not null,
  character_id text not null,
  text text not null,
  pinned boolean not null default false,
  edited boolean not null default false,
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adult_step_in_facts_owner_idx on adult_step_in_facts (owner_id, character_id, updated_at desc);
alter table adult_prefs add column if not exists step_in_memory_at timestamptz;
alter table adult_step_in_scenes add column if not exists facts_upto timestamptz;
-- A picture of the moment in a Step in scene (lib/adult/step-in-picture.ts, 2026-11-23): the scene and the reply an
-- adult_images picture was made of, so it shows under that reply, goes when its scene is deleted (lib/adult/step-in.ts
-- deleteStepIn), and reads as made on a night, not in the Studio (lib/made-in.ts). A picture is its owner's like any
-- other (owner_id); these two only say where in their scenes it belongs. adult_step_in_messages.picture_at: when a
-- reply's picture started drawing, cleared when it's done: two asks for the same reply draw one.
alter table adult_images add column if not exists step_in_scene text;
alter table adult_images add column if not exists step_in_message text;
create index if not exists adult_images_step_in_idx on adult_images (step_in_scene) where step_in_scene is not null;
alter table adult_step_in_messages add column if not exists picture_at timestamptz;
-- adult_step_in_scenes.side_message: the reply whose picture the viewer put in the character's place beside the scene
-- (lib/adult/step-in-picture.ts setStepInBeside); null: the character's own portrait stands there.
alter table adult_step_in_scenes add column if not exists side_message text;
-- A roleplay's cover picture stands there by itself while the scene is where its story is set (lib/adult/step-in.ts
-- coverOf). side_portrait: the viewer asked for the character's own portrait instead (setStepInFigure); kept apart from
-- side_message, so a picture taken away again returns to whichever of the two they had.
alter table adult_step_in_scenes add column if not exists side_portrait boolean not null default false;
-- adult_prefs.step_in_newest: their switch for "always the newest picture" (lib/adult/step-in-picture.ts
-- setStepInNewest): every picture they make in a scene takes that place as it lands. Off until they turn it on.
alter table adult_prefs add column if not exists step_in_newest boolean not null default false;
-- How well a viewer and a character know each other in Step in (lib/adult/step-in-bond.ts): the level is worked out
-- from the scenes' own rows each time, and this keeps the most it has ever been, so a scene deleted later can't lower
-- it (it never drops). shown_level: the level the scene has already said out loud (it's said once). Nothing a person
-- wrote is in it; it goes with After Dark's delete and is in its download.
create table if not exists adult_step_in_bonds (
  owner_id text not null,
  character_id text not null,
  points integer not null default 0,
  level integer not null default 1,
  shown_level integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
-- A roleplay's story in a scene (lib/adult/step-in-story.ts). story_beats: which of its card's beats have played, a list
-- of true/false in the card's order (only ever ticked). story_upto: the reply the story was last read at.
-- story_done_at: when its last beat first played; the roleplay counts as played for that viewer from then.
alter table adult_step_in_scenes add column if not exists story_beats jsonb;
alter table adult_step_in_scenes add column if not exists story_upto text;
alter table adult_step_in_scenes add column if not exists story_done_at timestamptz;
-- What the viewer could write next (lib/adult/step-in-ideas.ts): up to three suggested lines kept on the character's
-- reply they answer (so a reload shows the same ones), and how many times they've been drawn for it.
alter table adult_step_in_messages add column if not exists ideas jsonb;
-- Step in's replies counted apart from a night's scene steps, with their own monthly cap (lib/adult/usage.ts "step_in").
alter table adult_usage add column if not exists step_in integer not null default 0;
alter table adult_settings add column if not exists cap_step_in integer not null default 3000;
-- The character writes first (lib/adult/step-in-notes.ts): off until the person turns it on. adult_prefs.step_in_notes
-- is how often ('sometimes' | 'daily'; null: off), step_in_notes_at when they turned it on, step_in_quiet_from/_to their
-- quiet hours as two whole hours in their own clock, and step_in_tz the IANA time zone their browser gave when they
-- turned it on (what the quiet hours are judged in). On a scene: notes_off (this scene is never written to first),
-- note_at (a note is waiting that they haven't seen: cleared when they open the scene or write in it), and
-- notes_claimed_at (the lease a pass takes before it writes, so two passes can't write the same scene; a failed try
-- keeps it for a while, so one scene isn't tried every hour).
alter table adult_prefs add column if not exists step_in_notes text;
alter table adult_prefs add column if not exists step_in_notes_at timestamptz;
alter table adult_prefs add column if not exists step_in_quiet_from smallint;
alter table adult_prefs add column if not exists step_in_quiet_to smallint;
alter table adult_prefs add column if not exists step_in_tz text;
alter table adult_step_in_scenes add column if not exists notes_off boolean not null default false;
alter table adult_step_in_scenes add column if not exists note_at timestamptz;
alter table adult_step_in_scenes add column if not exists notes_claimed_at timestamptz;
create index if not exists adult_step_in_messages_notes_idx on adult_step_in_messages (owner_id, created_at desc) where kind = 'note';
alter table adult_step_in_messages add column if not exists idea_draws integer;
-- A scene's continuity sheet (lib/adult/step-in-tracker.ts): where the two of them are, what each has on and what's
-- within reach, read again after every reply and corrected by the viewer. { upto, sheet, before, reads, cost }: the
-- sheet, the turn it's good as of, and the sheet as it stood before that turn was read (what it falls back to when
-- that reply is drawn again or taken back). It's the scene's own, like its recap: it goes when the scene does.
alter table adult_step_in_scenes add column if not exists tracker jsonb;

-- Character tags (lib/character-tags.ts, docs/tags.md, 2026-11-17): what kind of person a character is, in the shared
-- vocabulary (lib/tags.ts, type facet only). One source at a time per character: the owner's pick, the house's hand
-- tags for its own cast, or an automatic read of the traits (filled by the lobby job). Keyed to the character and
-- cascading with it; no person column (the owner is the character's). Status is never stored: it's read from the
-- relationship graph's public columns.
create table if not exists character_tags (
  character_id text not null references characters (id) on delete cascade,
  tag text not null,
  source text not null check (source in ('owner', 'house', 'auto')),
  created_at timestamptz not null default now(),
  primary key (character_id, tag)
);
create index if not exists character_tags_tag_idx on character_tags (tag, character_id);

-- The social network (docs/PRDs/social-network.md sections 5.2 to 5.4; lib/social/). One store of typed ties between
-- characters, or from a character to one of its off-screen people; the ties' append-only event log; those off-screen
-- people; the places of the show's shared world and who belongs to them. Every row hangs off characters (on delete
-- cascade), so deleting a character takes its circle with it; a character kept as a tombstone loses what was declared
-- for it in lib/account.ts forgetEverything, and keeps what aired, like its dates. The open vocabularies (a tie's kind
-- and layer, a place's kind, a membership's role, an event) are checked in code (lib/social/kinds.ts, types.ts), so a
-- new one needs no migration; who may see a row (visibility), who made it (source) and a tie's status are checked here.
-- created_by, answered_by and actor hold a person's id (lib/person-columns.ts).
create table if not exists social_people (
  id text primary key,
  holder_id text not null references characters (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  pronouns text check (pronouns is null or char_length(pronouns) <= 20),
  note text check (note is null or char_length(note) <= 160),
  deceased boolean not null default false,
  visibility text not null default 'public' check (visibility in ('public', 'owner', 'private')),
  source text not null check (source in ('owner', 'agent', 'house', 'derived', 'admin', 'import')),
  origin_model text,
  prompt_version text,
  created_by text,
  promoted_to text references characters (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_people_holder_idx on social_people (holder_id);
-- A tie: from_id is the lower id of a symmetric pair; a directed tie reads "to is from's <kind>" (a parent tie from A to
-- B: B is A's parent); a tie to an off-screen person always starts at its holder. One row a pair a kind: evidence (the
-- newest 20 refs) accumulates on it and its history is social_tie_events.
create table if not exists social_ties (
  id text primary key,
  from_id text not null references characters (id) on delete cascade,
  to_id text references characters (id) on delete cascade,
  to_person_id text references social_people (id) on delete cascade,
  kind text not null,
  layer text not null,
  directed boolean not null default false,
  valence smallint not null default 1 check (valence between -2 and 2),
  closeness real not null default 0.5 check (closeness >= 0 and closeness <= 1),
  status text not null default 'active' check (status in ('proposed', 'active', 'ended', 'declined')),
  visibility text not null default 'public' check (visibility in ('public', 'owner', 'private')),
  source text not null check (source in ('owner', 'agent', 'house', 'derived', 'admin', 'import')),
  source_ref text,
  evidence jsonb not null default '[]',
  detail jsonb not null default '{}',
  story text check (story is null or char_length(story) <= 240),
  since_text text check (since_text is null or char_length(since_text) <= 40),
  origin_model text,
  prompt_version text,
  confidence real not null default 1 check (confidence >= 0 and confidence <= 1),
  created_by text,
  answered_by text,
  started_at timestamptz,
  ended_at timestamptz,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(to_id, to_person_id) = 1),
  check (from_id <> to_id)
);
create unique index if not exists social_ties_pair_kind_idx on social_ties (from_id, coalesce(to_id, to_person_id), kind);
create index if not exists social_ties_to_idx on social_ties (to_id) where to_id is not null;
create index if not exists social_ties_person_idx on social_ties (to_person_id) where to_person_id is not null;
create index if not exists social_ties_layer_idx on social_ties (layer, status);
create index if not exists social_ties_source_idx on social_ties (source);
create index if not exists social_ties_updated_idx on social_ties (updated_at);
-- Proposals waiting on another owner (Phase 2b): the hourly job lapses the ones unanswered for 14 days.
create index if not exists social_ties_proposed_idx on social_ties (created_at) where status = 'proposed';
-- Its log: created, proposed, accepted, declined, changed, ended, revived, contact, decayed; changes as field: [from, to].
-- One row a change, kept as long as its tie. Past about 10 million rows, partition it by month.
create table if not exists social_tie_events (
  id bigserial primary key,
  tie_id text not null references social_ties (id) on delete cascade,
  event text not null,
  changes jsonb not null default '{}',
  source text,
  source_ref text,
  actor text,
  at timestamptz not null default now()
);
create index if not exists social_tie_events_tie_idx on social_tie_events (tie_id, at);
create index if not exists social_tie_events_at_idx on social_tie_events (at);
-- The shared world: the house and its rooms, every date venue, the show's city and its neighbourhoods (seeded from
-- lib/social/world.ts), hometowns (from a character's extras), and later workplaces, schools and clubs. key is unique and
-- normalised (venue:dive_bar, house:kitchen, hometown:leeds).
create table if not exists social_places (
  id text primary key,
  key text not null unique,
  kind text not null,
  name text not null check (char_length(name) between 1 and 60),
  parent_id text references social_places (id) on delete set null,
  venue_id text,
  description text check (description is null or char_length(description) <= 200),
  visibility text not null default 'public' check (visibility in ('public', 'owner', 'private')),
  source text not null check (source in ('owner', 'agent', 'house', 'derived', 'admin', 'import')),
  origin_model text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists social_places_parent_idx on social_places (parent_id) where parent_id is not null;
-- Who belongs to a place, and how (lives, works, regular, studied, from, visited). Pairs who share one (regulars at the
-- dive bar, both from Leeds) are worked out when read, never stored, so a place stays one row a member.
create table if not exists social_place_members (
  place_id text not null references social_places (id) on delete cascade,
  character_id text not null references characters (id) on delete cascade,
  role text not null,
  since_text text check (since_text is null or char_length(since_text) <= 40),
  started_at timestamptz,
  ended_at timestamptz,
  source text not null check (source in ('owner', 'agent', 'house', 'derived', 'admin', 'import')),
  visibility text not null default 'public' check (visibility in ('public', 'owner', 'private')),
  detail jsonb not null default '{}',
  origin_model text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (place_id, character_id, role)
);
create index if not exists social_place_members_character_idx on social_place_members (character_id);
-- Where the hourly social backfill (lib/social/derive.ts backfillSocial) is in each of its steps: the cursor while it is
-- part way through, and when it last finished (it goes round again a day later). No person data.
create table if not exists social_backfill (
  step text primary key,
  cursor text,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);

-- The social network's daily numbers (docs/PRDs/social-network.md section 5.5; lib/social/metrics-job.ts,
-- SOCIAL_METRICS): one row per character, day and layer ('all' for every layer at once), measured from the public
-- record only. Keyed to the character and cascading with it; no person column. Kept 400 days a day, then one day a
-- week (lib/retention.ts). burt_constraint is the PRD's constraint (a reserved word in SQL).
create table if not exists social_metrics (
  character_id text not null references characters (id) on delete cascade,
  day date not null,
  layer text not null,
  degree integer not null default 0,
  weighted_degree real not null default 0,
  in_valence real,
  out_valence real,
  reciprocity real,
  clustering real,
  pagerank real,
  betweenness real,
  kcore integer,
  community integer,
  burt_constraint real,
  triads_balanced integer,
  triads_unbalanced integer,
  ring_inner integer,
  ring_close integer,
  ring_friends integer,
  ring_acquaintances integer,
  computed_at timestamptz not null default now(),
  primary key (character_id, day, layer)
);
create index if not exists social_metrics_day_idx on social_metrics (day, layer);
-- The whole network, one row a day: size, shape, mixing and balance (no character, no person). complete and progress
-- let a run that ran out of time pick up where it stopped the same day.
create table if not exists social_network_daily (
  day date primary key,
  nodes integer not null default 0,
  ties jsonb not null default '{}',
  density real,
  avg_degree real,
  clustering real,
  modularity real,
  communities integer,
  giant_component integer,
  assortativity jsonb not null default '{}',
  balance jsonb,
  reciprocity real,
  stats jsonb not null default '{}',
  complete boolean not null default false,
  progress jsonb not null default '{}',
  computed_at timestamptz not null default now()
);
-- "Might know" (PRD section 6.3): each suggestion shown to a character's owner, and what came of it, the network's
-- link-prediction ground truth. viewer is the person it was shown to (lib/person-columns.ts). Kept 400 days.
create table if not exists social_suggestion_log (
  id bigint generated by default as identity primary key,
  viewer text not null,
  character_id text not null references characters (id) on delete cascade,
  suggested_id text not null references characters (id) on delete cascade,
  reason text not null,
  score real not null default 0,
  shown_at timestamptz not null default now(),
  outcome text check (outcome in ('accepted', 'dismissed', 'ignored')),
  outcome_at timestamptz
);
create index if not exists social_suggestion_log_character_idx on social_suggestion_log (character_id, shown_at desc);
create index if not exists social_suggestion_log_viewer_idx on social_suggestion_log (viewer);
create index if not exists social_suggestion_log_shown_idx on social_suggestion_log (shown_at);
-- Files in the stores waiting to be deleted (lib/media-deletions.ts, 2026-11-22). A row that names a file (each column
-- below) queues it when the row goes or names another file instead: a person's deletion, a cascade from a deleted
-- account or character, a picture drawn again. The daily upkeep deletes it from the stores a week later, and only if no
-- row names it then; a deletion in Bunny can't be undone, so the week is the time to stop one (delete its row here).
-- Holds only the key.
create table if not exists media_deletions (
  key text primary key,
  due_at timestamptz not null,
  reason text not null,
  queued_at timestamptz not null default now(),
  tries integer not null default 0,
  last_error text,
  done_at timestamptz,
  outcome text check (outcome in ('deleted', 'kept', 'failed'))
);
create index if not exists media_deletions_due_idx on media_deletions (due_at) where done_at is null;
-- The column is the trigger's argument, read from the row by name (not the whole row: some keep their bytes beside it).
-- A key already waiting keeps its time; one done before waits its week again.
create or replace function media_file_gone() returns trigger language plpgsql as $$
declare
  gone text;
  still text;
begin
  execute format('select ($1).%I::text', tg_argv[0]) using old into gone;
  if tg_op = 'UPDATE' then
    execute format('select ($1).%I::text', tg_argv[0]) using new into still;
  end if;
  if gone is not null and gone is distinct from still then
    insert into media_deletions (key, due_at, reason)
    values (gone, now() + interval '7 days', tg_table_name || '.' || tg_argv[0] || ' ' || lower(tg_op))
    on conflict (key) do update
      set due_at = excluded.due_at, reason = excluded.reason, queued_at = now(), tries = 0, last_error = null, done_at = null, outcome = null
      where media_deletions.done_at is not null;
  end if;
  return null;
end $$;
create or replace trigger adult_images_object_key_gone after delete or update of object_key on adult_images for each row execute function media_file_gone('object_key');
create or replace trigger adult_talks_object_key_gone after delete or update of object_key on adult_talks for each row execute function media_file_gone('object_key');
create or replace trigger adult_presence_object_key_gone after delete or update of object_key on adult_presence for each row execute function media_file_gone('object_key');
create or replace trigger studio_pg_pictures_object_key_gone after delete or update of object_key on studio_pg_pictures for each row execute function media_file_gone('object_key');
create or replace trigger look_tiles_object_key_gone after delete or update of object_key on look_tiles for each row execute function media_file_gone('object_key');
create or replace trigger media_exports_object_key_gone after delete or update of object_key on media_exports for each row execute function media_file_gone('object_key');
create or replace trigger companion_voice_object_key_gone after delete or update of object_key on companion_voice for each row execute function media_file_gone('object_key');
create or replace trigger face_kits_object_key_gone after delete or update of object_key on face_kits for each row execute function media_file_gone('object_key');
create or replace trigger show_shots_object_key_gone after delete or update of object_key on show_shots for each row execute function media_file_gone('object_key');
create or replace trigger live_face_compares_audio_key_gone after delete or update of audio_key on live_face_compares for each row execute function media_file_gone('audio_key');
create or replace trigger live_face_renders_mp4_key_gone after delete or update of mp4_key on live_face_renders for each row execute function media_file_gone('mp4_key');
create or replace trigger live_face_clips_object_key_gone after delete or update of object_key on live_face_clips for each row execute function media_file_gone('object_key');
create or replace trigger character_intros_audio_key_gone after delete or update of audio_key on character_intros for each row execute function media_file_gone('audio_key');
create or replace trigger character_intros_object_key_gone after delete or update of object_key on character_intros for each row execute function media_file_gone('object_key');
create or replace trigger place_sounds_object_key_gone after delete or update of object_key on place_sounds for each row execute function media_file_gone('object_key');
create or replace trigger home_clips_loop_key_gone after delete or update of loop_key on home_clips for each row execute function media_file_gone('loop_key');
create or replace trigger home_clips_poster_key_gone after delete or update of poster_key on home_clips for each row execute function media_file_gone('poster_key');
create or replace trigger home_clips_cut_key_gone after delete or update of cut_key on home_clips for each row execute function media_file_gone('cut_key');

-- A character's own world in words (lib/world-words.ts, 2026-11-22): the words of its work, hobbies and habits that a
-- companion reply rests after leaning on them, metaphors included ("tick", "mainspring" for a clockmaker). Written once
-- per version of the sheet by a cheap model; sheet_key is the hash of the sheet it was written from, so an edited sheet
-- is written again. source 'none': the model's reply had no usable words (not asked again until the sheet changes).
-- cost: what that one call cost, in USD. Keyed to the character and cascading with it; no person column.
create table if not exists character_world_words (
  character_id text primary key references characters (id) on delete cascade,
  words text[] not null default '{}',
  sheet_key text not null,
  source text not null check (source in ('model', 'none')),
  cost numeric,
  made_at timestamptz not null default now()
);
`;

/**
 * Where each After Dark post was made, a date (a night) or the Studio, by the one rule every gallery tags with
 * (lib/made-in.ts; 2026-11-18, David: "go through all assets and tag accordingly"). lib/showcase.ts FROM_DATE decides it
 * for new posts; this puts it on the ones kept before (a living portrait was "from a date" on some posts and not others).
 * Apart from SCHEMA_SQL because it's built from the rule, and SCHEMA_SQL stays plain text (tests/schema-sql.ts reads it).
 */
const MADE_IN_SQL = `
update showcase_posts p set from_date = (${madeInSql("i")} = 'night')
  from adult_images i
 where p.source = 'after_dark' and i.id = p.media_id and p.from_date is distinct from (${madeInSql("i")} = 'night');
`;

/**
 * Limits for the apply's one transaction (2026-11-21 audit). Each ALTER in it waits for its table's lock, and while it
 * waits every other query on that table queues behind it, so one slow read could hold the site. Now any lock wait over
 * 5 s (the advisory lock included: another instance is applying) fails the apply, which rolls back and is tried again,
 * and one statement running over two minutes is a runaway and fails too (on a copy of production on 2026-11-22 the
 * slowest of its 929 statements took 0.1 s, and the whole apply 2.5 s). SET LOCAL ends with the transaction: the pooled
 * connection goes back with its usual settings. Not hashed in schemaVersion, since it writes nothing.
 */
const SCHEMA_LIMITS_SQL = `
set local lock_timeout = '5s';
set local statement_timeout = '120s';
`;

/** Idempotent: creates the tables and upserts the house characters, free and premium. */
export async function ensureSchema(db: Db): Promise<void> {
  // One round trip: the made-in re-tag goes after the tables it reads, in the same exec.
  await db.exec(SCHEMA_LIMITS_SQL + SCHEMA_SQL + MADE_IN_SQL);
  const cast = [
    ...HOUSE_CHARACTERS.map((c) => ({ ...c, sku: null })),
    ...PREMIUM_HOUSE_CHARACTERS.map((c) => ({ ...c, sku: c.sku })),
  ];
  for (const c of cast) {
    await db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, premium_sku,
                               appearance, avatar_hue, pronouns, voice, extras)
       values ($1, null, true, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       on conflict (id) do update set
         owner_id = null, is_house = true, name = excluded.name, age = excluded.age, bio = excluded.bio,
         traits = excluded.traits, want = excluded.want, dealbreaker = excluded.dealbreaker,
         premium_sku = excluded.premium_sku, appearance = excluded.appearance, avatar_hue = excluded.avatar_hue,
         pronouns = excluded.pronouns, voice = excluded.voice, extras = excluded.extras`,
      // Their voice kit (lib/house-kits.ts): sample lines, never-says and tells, written in each one's voice.
      [c.id, c.name, c.age, c.bio, JSON.stringify(c.traits), c.want, c.dealbreaker, c.sku, c.appearance, c.hue, c.pronouns, c.voice, JSON.stringify(HOUSE_KITS[c.id] ?? {})],
    );
    // A house character's temperament, as engine-only signals. The text fields stay empty and
    // local_only is true, so there is no private prose to leak — only the numbers the engine decides
    // with, which is what stops a house date running on half the signal of a creator's OC.
    await db.query(
      `insert into souls (character_id, local_only, signals, updated_at)
       values ($1, true, $2::jsonb, now())
       on conflict (character_id) do update set local_only = true, signals = excluded.signals, updated_at = now()`,
      [c.id, JSON.stringify(c.signals)],
    );
  }
}

/** Everything ensureSchema writes, hashed: the DDL above, the made-in re-tag and the house cast it upserts. */
export function schemaVersion(): string {
  return createHash("sha256")
    .update(SCHEMA_SQL)
    .update(MADE_IN_SQL)
    .update(JSON.stringify([HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS, HOUSE_KITS]))
    .digest("hex")
    .slice(0, 16);
}

/** Where the apply's line goes: a failure to the error log, the rest to the usual one. Tests pass their own. */
export type SchemaLog = (line: string, failed: boolean) => void;
const consoleSchemaLog: SchemaLog = (line, failed) => (failed ? console.error(line) : console.log(line));

/** A database error for a log line: its message on one line, cut short, with its SQLSTATE; never a connection string. */
export function dbFailure(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const message = typeof e?.message === "string" && e.message ? e.message : String(err);
  const code = typeof e?.code === "string" ? ` (${e.code})` : "";
  const flat = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://…").replace(/\s+/g, " ").trim();
  return `${flat.length > 200 ? `${flat.slice(0, 199)}…` : flat}${code}`;
}

/**
 * ensureSchema, skipped when this exact schema and house cast are already applied. Every serverless cold start used to
 * re-run ~150 DDL statements (two of them table-locking constraint rebuilds) and two upserts per house character, one
 * round trip each, before its first query: /feed took 3.9s on a cold start against 0.7s warm (2026-10-16). Now a cold
 * start costs one select; the first instance after a schema or cast change applies it and records the new version.
 * Either way it logs one line with how it went and how long it took ("[db] schema apply ok 8123 ms (version …)",
 * "skipped (unchanged)", "failed after … ms: …"): nothing said how long a deploy's apply held the site (2026-11-21 audit).
 */
export async function ensureSchemaCurrent(db: Db, log: SchemaLog = consoleSchemaLog): Promise<void> {
  const started = Date.now();
  const version = schemaVersion();
  // Its queries are named in the pool's slow-query lines (lib/db-watch.ts), not "outside a request".
  await withDbLabel("schema apply", async () => {
    try {
      const { rows } = await db.query<{ version: string }>("select version from schema_meta where id = 1");
      if (rows[0]?.version === version) {
        log(`[db] schema apply skipped (unchanged) ${Date.now() - started} ms`, false);
        return;
      }
    } catch {
      // No schema_meta yet (a fresh database, or one from before it existed): apply everything below.
    }
    try {
      await ensureSchema(db);
      await db.query(
        `insert into schema_meta (id, version, applied_at) values (1, $1, now())
           on conflict (id) do update set version = excluded.version, applied_at = now()`,
        [version],
      );
    } catch (err) {
      log(`[db] schema apply failed after ${Date.now() - started} ms: ${dbFailure(err)}`, true);
      throw err;
    }
    log(`[db] schema apply ok ${Date.now() - started} ms (version ${version})`, false);
  });
}

// PGLITE_DIR lets a throwaway run (scripts/screenshots.mjs) keep its sample data apart from yours.
const DEFAULT_LOCAL_DATA_DIR = ".data/pglite";
/**
 * Connections per process. Three suited a Vercel function; on one long-lived server every request shares them, and on
 * 2026-11-01 a page asking for 140 pictures queued the whole site (and its health check) behind them until
 * DigitalOcean gave up on the replica (audit R1). Ten each for the show and After Dark is well inside even the smallest
 * Neon compute's ~100 connections. DB_POOL_SIZE overrides it.
 */
const POOL_SIZE = Math.max(1, Number(process.env.DB_POOL_SIZE) || 10);
/** How long a request waits for a free connection before failing, rather than queueing forever (pg's default). */
const CONNECT_WAIT_MS = 10_000;

/**
 * node-postgres already treats sslmode=require/prefer/verify-ca as verify-full (certificate and hostname checked),
 * but warns on every cold start that pg v9 will weaken them to libpq's meaning (316 warnings a week on prod, burying
 * real errors). Saying verify-full explicitly keeps today's behaviour and silences it.
 */
export function withVerifyFullSsl(url: string): string {
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, "$1verify-full");
}

/**
 * The Postgres pool for a DATABASE_URL. Neon closes idle connections when its compute scales down or
 * restarts ("terminating connection due to administrator command", 57P01); node-postgres reports that as an
 * "error" event on the pool, and an unhandled "error" event crashes the whole function instance (seen on prod,
 * 2026-10-15). The pool has already discarded the dead client, so logging it is all that's needed.
 */
export async function createPool(url: string) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: withVerifyFullSsl(url), max: POOL_SIZE, connectionTimeoutMillis: CONNECT_WAIT_MS });
  pool.on("error", (err) => console.error(`[db] idle connection closed: ${err.message}`));
  return pool;
}

const healthCache = globalThis as typeof globalThis & { __botchelorHealthPool?: Promise<import("pg").Pool> };

/**
 * The health check's `select 1`, on a connection of its own: through the shared pool it waited behind every busy
 * request, so a slow page made DigitalOcean take the only replica out of service (2026-11-01 audit, R1). This says
 * whether the database can be reached, not whether the pool is free. Tests and local runs use the usual database.
 */
export async function pingDb(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (testDb || !url) {
    await (await getDb()).query("select 1");
    return;
  }
  if (!healthCache.__botchelorHealthPool) {
    healthCache.__botchelorHealthPool = import("pg").then(({ Pool }) => {
      const pool = new Pool({ connectionString: withVerifyFullSsl(url), max: 1, connectionTimeoutMillis: 2_500 });
      pool.on("error", (err) => console.error(`[db] health connection closed: ${err.message}`));
      return pool;
    });
  }
  await (await healthCache.__botchelorHealthPool).query("select 1");
}

async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return pgPoolDb(await createPool(url));
  // A deployment never falls back to a local file: on After Dark's own host (lib/after-dark-host.ts) that would be an
  // empty database of its own, silently, instead of the show's.
  if (isDeployed() || afterDarkOnly()) throw new Error("DATABASE_URL is not configured for this deployment");
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
const cache = globalThis as typeof globalThis & { __botchelorDb?: Promise<Db>; __botchelorStartupApply?: Promise<boolean> };

/**
 * This season's stored cast (lib/season-cast.ts), loaded into memory at most once a minute so its many synchronous
 * readers see it; on the season's first read it picks the cast. A failure keeps the stand-in, never the request.
 */
async function withSeasonCast(db: Db): Promise<Db> {
  try {
    const { refreshSeasonCast } = await import("./season-cast");
    await refreshSeasonCast(db);
  } catch (err) {
    console.error("[season-cast] could not load:", err instanceof Error ? err.message : "unknown");
  }
  return db;
}

/** The process's database, opened once with its schema brought up to date. */
function openShared(): Promise<Db> {
  if (!cache.__botchelorDb) {
    const opening = openDb().then(async (db) => {
      // The apply this server started with (prepareDb) may still be running: wait for it rather than race it. Once it
      // has brought the schema up to date there is nothing to check again (and no second log line).
      if (!(await cache.__botchelorStartupApply)) await ensureSchemaCurrent(db);
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

export function getDb(): Promise<Db> {
  if (testDb) return Promise.resolve(testDb);
  return openShared().then(withSeasonCast).then(withSessionVersions).then(withBans);
}

/** The live bans every change is checked against (lib/bans.ts), loaded as the session versions are. */
async function withBans(db: Db): Promise<Db> {
  try {
    const { refreshBans, bansLoaded } = await import("./bans");
    const loading = refreshBans(db).catch((err) => console.error("[bans] could not load:", err instanceof Error ? err.message : "unknown"));
    if (!bansLoaded()) await loading;
  } catch (err) {
    console.error("[bans] could not load:", err instanceof Error ? err.message : "unknown");
  }
  return db;
}

/**
 * The session versions every session check reads (lib/session-versions.ts), loaded at most once a minute: a process's
 * first load is waited for, later ones run behind the request.
 */
async function withSessionVersions(db: Db): Promise<Db> {
  try {
    const { refreshSessionVersions, sessionVersionsLoaded } = await import("./session-versions");
    const loading = refreshSessionVersions(db).catch((err) => console.error("[session-versions] could not load:", err instanceof Error ? err.message : "unknown"));
    if (!sessionVersionsLoaded()) await loading;
  } catch (err) {
    console.error("[session-versions] could not load:", err instanceof Error ? err.message : "unknown");
  }
  return db;
}

/** How long a server's start waits for its schema: DigitalOcean's first health check comes 20 s in (.do/*.yaml). */
const STARTUP_WAIT_MS = 15_000;
/** The pause before a blocked apply is tried again at startup. */
const STARTUP_RETRY_MS = 1_000;

/** Worth another try: a lock wait or a statement over its limit (55P03, 57014), or Neon dropping the connection. */
function worthRetrying(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "55P03" || code === "57014" || isDroppedConnection(err);
}

/** A database to apply the schema on, and how to let it go. */
type Connection = { db: Db; close: () => Promise<void> };

/**
 * At a server's start (instrumentation.ts register, which Next awaits before it serves a request): bring the schema up
 * to date, so a deploy's first visitors don't wait for the apply (2026-11-21 audit). It runs on a pool of its own, closed
 * after: instrumentation is a separate bundle, and the shared pool's slow-query lines read the app's own request labels
 * (lib/db-watch.ts). An apply that timed out (the other host is applying, or a table stayed locked) is tried again for
 * up to 15 s. Never throws: if the database still isn't ready the server starts anyway and the first request tries
 * again, as it always did; if the apply is still running, requests wait for it (openShared). Local runs without a
 * DATABASE_URL open their file database on first use, as before (a second PGlite on the same files would clash).
 * `onReady` runs on the same connection once the schema is current (instrumentation.ts writes the server's start row,
 * lib/ops-log.ts); its own failure is its own and never fails the start.
 */
export async function prepareDb(
  options: { waitMs?: number; connect?: () => Promise<Connection>; onReady?: (db: Db) => Promise<void> } = {},
): Promise<void> {
  const url = process.env.DATABASE_URL;
  const connect =
    options.connect ??
    (url && !testDb
      ? async (): Promise<Connection> => {
          const pool = await createPool(url);
          return { db: pgPoolDb(pool), close: () => pool.end() };
        }
      : null);
  if (!connect) return;
  const waitMs = options.waitMs ?? STARTUP_WAIT_MS;
  const deadline = Date.now() + waitMs;
  const applying = (async () => {
    const { db, close } = await connect();
    try {
      for (;;) {
        try {
          await ensureSchemaCurrent(db);
          break;
        } catch (err) {
          if (!worthRetrying(err) || Date.now() + STARTUP_RETRY_MS >= deadline) throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, STARTUP_RETRY_MS));
      }
      await options.onReady?.(db).catch(() => undefined);
    } finally {
      await close().catch(() => undefined);
    }
  })();
  // Never rejects: a failed apply at startup is the first request's to try again.
  const settled = applying.then(
    () => true,
    (err: unknown) => {
      console.error(`[db] database not ready at startup (${dbFailure(err)}); the first request tries again`);
      return false;
    },
  );
  cache.__botchelorStartupApply = settled;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = await Promise.race([settled, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)))]);
  clearTimeout(timer);
  if (done === null) console.warn(`[db] schema apply still running after ${Math.round(waitMs / 1000)} s at startup; requests wait for it`);
}
