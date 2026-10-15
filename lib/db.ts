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

-- M11 afterglow reveal: each owner opts in to open the morning-after thread. Mirrors identity_consents
-- (one row per owner who agreed); the thread and the mutual verdict unlock once every real owner has.
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
  arc text,                                     -- one templated "who they've become" sentence (no model)
  updated_at timestamptz not null default now()
);

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
create index if not exists characters_open_idx on characters (open_to_dates) where open_to_dates;
alter table episodes add column if not exists created_via text not null default 'web'
  check (created_via in ('web', 'mcp'));
create index if not exists episodes_via_idx on episodes (created_via, created_at);

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
                               appearance, avatar_hue, pronouns, voice)
       values ($1, null, true, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update set
         owner_id = null, is_house = true, name = excluded.name, age = excluded.age, bio = excluded.bio,
         traits = excluded.traits, want = excluded.want, dealbreaker = excluded.dealbreaker,
         premium_sku = excluded.premium_sku, appearance = excluded.appearance, avatar_hue = excluded.avatar_hue,
         pronouns = excluded.pronouns, voice = excluded.voice`,
      [c.id, c.name, c.age, c.bio, JSON.stringify(c.traits), c.want, c.dealbreaker, c.sku, c.appearance, c.hue, c.pronouns, c.voice],
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

// PGLITE_DIR lets a throwaway run (scripts/screenshots.mjs) keep its sample data apart from yours.
const DEFAULT_LOCAL_DATA_DIR = ".data/pglite";
const POOL_SIZE = 3;

/**
 * The Postgres pool for a DATABASE_URL. Neon closes idle connections when its compute scales down or
 * restarts ("terminating connection due to administrator command", 57P01); node-postgres reports that as an
 * "error" event on the pool, and an unhandled "error" event crashes the whole function instance (seen on prod,
 * 2026-10-15). The pool has already discarded the dead client, so logging it is all that's needed.
 */
export async function createPool(url: string) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: POOL_SIZE });
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
