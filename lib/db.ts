import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "./house";
import { HOUSE_KITS } from "./house-kits";

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

export function pgPoolDb(pool: Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      let result;
      try {
        result = await pool.query(sql, params);
      } catch (err) {
        if (!isDroppedConnection(err)) throw err;
        // The pool has already discarded the dead client, so this runs on a fresh connection.
        result = await pool.query(sql, params);
      }
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
-- Spectators follow couples (lib/follows.ts): they hear when the couple goes on another public date or moves up.
create table if not exists couple_follows (
  user_id text not null,
  character_lo text not null references characters (id) on delete cascade,
  character_hi text not null references characters (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, character_lo, character_hi)
);
create index if not exists couple_follows_pair on couple_follows (character_lo, character_hi);
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
  check (kind in ('portrait', 'expression', 'background', 'decoration', 'clip'));

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
-- Every MCP call (lib/mcp.ts logCall), for the owner's analytics page (lib/agent-analytics.ts, /admin/analytics):
-- the method or tool and whether it worked, never its arguments. Pruned after 60 days by the daily job.
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
create index if not exists mcp_calls_session_idx on mcp_calls (session_id, created_at);
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
create table if not exists feedback_votes (
  feedback_id text not null references agent_feedback (id) on delete cascade,
  kind text not null check (kind in ('liked', 'wants', 'problems', 'message')),
  agent_id text not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (feedback_id, kind, agent_id)
);
create index if not exists feedback_votes_agent_idx on feedback_votes (agent_id, created_at desc);

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

-- Server errors (lib/errors.ts): a short row per unexpected error, reported by GET /api/health so the owner hears about
-- them. Route patterns and cleaned messages only, never a request body. Pruned after a week by the daily job.
create table if not exists server_errors (
  at timestamptz not null default now(),
  kind text not null,
  route text not null,
  message text not null
);
create index if not exists server_errors_at_idx on server_errors (at);

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

-- What ensureSchema last applied: a hash of this SQL and the house cast (ensureSchemaCurrent), so a cold start
-- whose schema is already in place skips the whole thing.
create table if not exists schema_meta (
  id integer primary key check (id = 1),
  version text not null,
  applied_at timestamptz not null default now()
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

/** Everything ensureSchema writes, hashed: the DDL above and the house cast it upserts. */
export function schemaVersion(): string {
  return createHash("sha256")
    .update(SCHEMA_SQL)
    .update(JSON.stringify([HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS, HOUSE_KITS]))
    .digest("hex")
    .slice(0, 16);
}

/**
 * ensureSchema, skipped when this exact schema and house cast are already applied. Every serverless cold start used to
 * re-run ~150 DDL statements (two of them table-locking constraint rebuilds) and two upserts per house character, one
 * round trip each, before its first query: /feed took 3.9s on a cold start against 0.7s warm (2026-10-16). Now a cold
 * start costs one select; the first instance after a schema or cast change applies it and records the new version.
 */
export async function ensureSchemaCurrent(db: Db): Promise<void> {
  const version = schemaVersion();
  try {
    const { rows } = await db.query<{ version: string }>("select version from schema_meta where id = 1");
    if (rows[0]?.version === version) return;
  } catch {
    // No schema_meta yet (a fresh database, or one from before it existed): apply everything below.
  }
  await ensureSchema(db);
  await db.query(
    `insert into schema_meta (id, version, applied_at) values (1, $1, now())
       on conflict (id) do update set version = excluded.version, applied_at = now()`,
    [version],
  );
}

// PGLITE_DIR lets a throwaway run (scripts/screenshots.mjs) keep its sample data apart from yours.
const DEFAULT_LOCAL_DATA_DIR = ".data/pglite";
const POOL_SIZE = 3;

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
  const pool = new Pool({ connectionString: withVerifyFullSsl(url), max: POOL_SIZE });
  pool.on("error", (err) => console.error(`[db] idle connection closed: ${err.message}`));
  return pool;
}

async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return pgPoolDb(await createPool(url));
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
      await ensureSchemaCurrent(db);
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
