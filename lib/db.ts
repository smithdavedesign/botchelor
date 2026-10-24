import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterDarkOnly } from "./after-dark-host";
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
  check (kind in ('portrait', 'expression', 'background', 'decoration', 'clip', 'photo'));

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
-- When the current run of a subscription began (for California's yearly reminder, on each anniversary) and when that
-- reminder last went.
alter table adult_entitlements add column if not exists subscribed_at timestamptz;
alter table adult_entitlements add column if not exists renewal_reminded_at timestamptz;
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

-- Marketing posters (scripts/post/*.mjs): a stamp per channel so cron re-runs are idempotent.
alter table episodes add column if not exists last_posted_discord_at timestamptz;
alter table episodes add column if not exists last_posted_bluesky_at timestamptz;
alter table episodes add column if not exists last_posted_x_at timestamptz;

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
  job text not null check (job in ('text', 'image', 'video', 'after_dark')),
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
-- Who writes the scenes (lib/adult/writer-config.ts; David, 2026-10-24): the writers a person can pick and the default,
-- as JSON; and each person's own pick (adult_prefs.writer_model, null: the default), which goes with their account.
alter table adult_settings add column if not exists writer jsonb;
create table if not exists adult_prefs (
  user_id text primary key,
  writer_model text,
  updated_at timestamptz not null default now()
);

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
  // A deployment never falls back to a local file: on After Dark's own host (lib/after-dark-host.ts) that would be an
  // empty database of its own, silently, instead of the show's.
  if (process.env.VERCEL || afterDarkOnly()) throw new Error("DATABASE_URL is not configured for this deployment");
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
  return cache.__botchelorDb.then(withSeasonCast);
}
