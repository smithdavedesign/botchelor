/**
 * M10 — account data export and deletion (PRD §6.1 / privacy guardrails: "delete private character
 * profile data and associated debriefs", and a data export flow).
 *
 * Identity here is the anonymous cookie user id. "Your data" is everything keyed to it: your profile,
 * your characters and their private souls, your predictions, orders and the free side-games.
 *
 * Deletion removes all of it. Characters that never appeared in an episode are hard-deleted (cascading
 * their soul, assets, relationships and matchmaker proposals). A character that is already in a shared
 * episode can't be hard-deleted (the episode references it, and it is fictional content other viewers
 * have seen), so its private soul is deleted and its ownership is detached to a tombstone — the personal
 * data is gone, the fictional sheet stays in the shared episode. The tombstone can never collide with a
 * real user: real ids are UUIDs (lib/http readUserId).
 */
import { deleteAdultProfile } from "./adult/profile-data";
import { isTextTag } from "./companion-shared";
import { forgetUnusedVoices } from "./companion-voice";
import type { Db } from "./db";
import { getPoints } from "./game";
import { DELETED_OWNER } from "./rules";
import { refreshEpisodePair } from "./relationships";

/** The owner link set on a character that must stay (it's in a shared episode) after its owner deletes. */
export { DELETED_OWNER };

export type AccountExport = {
  exported_at: string;
  user_id: string;
  profile: { name: string; attested_adult_at: string } | null;
  /** The sign-in itself: the handle, the email on it (Google's, or the recovery email) and how it signs in. Never the password's hash. */
  account: { handle: string | null; email: string | null; signs_in_with: string[]; created_at: string } | null;
  points: number;
  characters: Record<string, unknown>[];
  souls: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  dealbreaker_guesses: Record<string, unknown>[];
  matchmaker_proposals: Record<string, unknown>[];
  leagues_owned: Record<string, unknown>[];
  leagues_joined: Record<string, unknown>[];
  /** What each of the user's characters has learned from its dates (lib/memory.ts), with where it came from. */
  character_memory: Record<string, unknown>[];
  character_lessons: Record<string, unknown>[];
  /** What each of their characters remembers from every mode (lib/character-memories.ts). */
  character_episodes: Record<string, unknown>[];
  /** What the user told their characters to forget. */
  memory_forgets: Record<string, unknown>[];
  /** Their characters' reflections on each date (show-written or their own), by episode and character. */
  reflections: Record<string, unknown>[];
  reflection_labels: Record<string, unknown>[];
  /** Saved provider keys: the provider, last four and model only (the key itself is never exported or shown). */
  provider_keys: Record<string, unknown>[];
  provider_spend: Record<string, unknown>[];
  /** Between dates (lib/between-dates.ts): their characters' texts, the nudges they left, their second-date yeses. */
  couple_texts: Record<string, unknown>[];
  nudges: Record<string, unknown>[];
  second_date_yeses: Record<string, unknown>[];
  /** Dates they proposed to another owner's character, or were proposed (lib/date-proposals.ts). */
  date_proposals: Record<string, unknown>[];
  /** The swipe deck (lib/swipes.ts): their characters' own swipes (never anyone's likes on them: those stay secret), and their matches. */
  swipes: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  /** Matches that ended from their thread (lib/unmatch.ts), and whose side ended them. */
  unmatches: Record<string, unknown>[];
  /** The couples they follow, their arc predictions, their notifications and where browser push goes (host only). */
  couple_follows: Record<string, unknown>[];
  /** The characters they follow (lib/character-follows.ts), and whether the follow switched that character's texts on. */
  character_follows: Record<string, unknown>[];
  arc_predictions: Record<string, unknown>[];
  /** Their votes on tonight's situation (lib/situations.ts). */
  situation_votes: Record<string, unknown>[];
  season_format_votes: Record<string, unknown>[];
  show_idea_votes: Record<string, unknown>[];
  /** Their writing styles (lib/writing-style.ts) and the After Dark stories made for them (lib/stories.ts). */
  writing_styles: Record<string, unknown>[];
  stories: Record<string, unknown>[];
  /** Who they are in scenes (lib/persona.ts): the name, look and line about themselves they wrote for scenes. */
  persona: Record<string, unknown>[];
  show_ideas_proposed: Record<string, unknown>[];
  notification_mutes: Record<string, unknown>[];
  recoupling_votes: Record<string, unknown>[];
  /** The cast members they backed by season (lib/backing.ts), and how each pick ended. */
  cast_backings: Record<string, unknown>[];
  /** Their votes on tonight's dare (lib/dares.ts). */
  dare_votes: Record<string, unknown>[];
  /** The weeks they won the earned cast-date slot (lib/cast-date.ts). */
  cast_date_weeks: Record<string, unknown>[];
  /** Their votes on Sunday's reveal (lib/weekly-reveal.ts), and their place in each season pool (lib/season-pool.ts). */
  weekly_reveal_votes: Record<string, unknown>[];
  season_pool_entries: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  push_subscriptions: Record<string, unknown>[];
  /** Email notifications: the address, whether it's on, and how many emails were sent (lib/email.ts). */
  email: Record<string, unknown>[];
  /** Feedback they sent from the site (lib/user-feedback.ts): what they wrote and what was captured with it. */
  feedback: Record<string, unknown>[];
  /** Complaints and takedown requests they sent from /report (lib/content-reports.ts), and what became of them. */
  content_reports: Record<string, unknown>[];
  /** Their choice on machine-learning use of their data (lib/ml-consent.ts). */
  ml_consent: Record<string, unknown>[];
  /** The cards their characters' decks showed them (lib/swipes.ts logImpressions). */
  swipe_impressions: Record<string, unknown>[];
  /** Their characters' pairs' stage changes over time (lib/relationships.ts). */
  relationship_events: Record<string, unknown>[];
  /** Every prediction, nudge, review and consent decision they made, not just the latest (lib/choice-history.ts). */
  choice_history: Record<string, unknown>[];
  /** Lines on their characters' sides that didn't go in: critic-replaced drafts, refused and checked lines (lib/turn-drafts.ts). */
  turn_drafts: Record<string, unknown>[];
  /** Their 👍 and 👎 on lines (lib/line-feedback.ts). */
  line_feedback: Record<string, unknown>[];
  /** Sliding Doors runs on their dates (lib/simulation.ts saveDoors): what was changed and how the alternate ended. */
  episode_variations: Record<string, unknown>[];
  /** Their taps on the "Botchelor Plus" tile (lib/plus-interest.ts): where, when, and whether they left an email. */
  plus_interest: Record<string, unknown>[];
  /**
   * Their conversations with companions (lib/companion.ts), a thread each: the character, every message with who said
   * it, when and whether it was said on a call, what the character remembers about them (the facts and the running
   * notes), and the blank markers left by texts they deleted. After Dark is not here: nothing of it is in this export.
   */
  companion_conversations: CompanionConversationExport[];
  /** The record of each live call (lib/companion-live.ts): its times, minutes and turns. No words or sound exist there. */
  companion_calls: Record<string, unknown>[];
  /**
   * What the person-column registry found the export had left out (lib/person-columns.ts, 2026-11-16): every table that
   * holds this id is now either here or listed there with why not. Nobody else's id is ever in any of it
   * (tests/person-columns.test.ts): another person is named by their character, their handle or nothing.
   */
  /** Whether this id is an admin, and since when. */
  admin: { since: string } | null;
  /** When they were last on the site, and the visit before (lib/activity.ts). */
  last_seen: { last_seen: string; prev_seen: string | null } | null;
  /** The dates they booked: which two characters, how public, when. The date itself is the show's, on its page. */
  dates_booked: Record<string, unknown>[];
  scheduled_dates: Record<string, unknown>[];
  /** Their links: "date my character" invites, the double-date links they made, and the ones they took. */
  date_links: { invites: Record<string, unknown>[]; doubles_made: Record<string, unknown>[]; doubles_taken: Record<string, unknown>[] };
  /** Double dates and mixers: the nights they proposed or were invited to, and the seats they booked. */
  double_dates: { nights: Record<string, unknown>[]; seats: Record<string, unknown>[] };
  /** Roleplays proposed for a couple's next date (lib/date-roleplays.ts): the ones they sent and the ones sent to them. */
  date_roleplays: Record<string, unknown>[];
  /** When they last read each couple's thread (lib/inbox.ts). */
  thread_reads: Record<string, unknown>[];
  /** Their yes to showing their name to a date's other owner (app/api/reveal), and the old morning-after opt-ins. */
  identity_reveals: Record<string, unknown>[];
  afterglow_consents: Record<string, unknown>[];
  /** Casting (lib/auditions.ts, lib/casting-invites.ts, lib/ceremony.ts): their auditions, an invite they used, their votes. */
  auditions: Record<string, unknown>[];
  casting_invites_used: Record<string, unknown>[];
  audition_votes: Record<string, unknown>[];
  /** What their characters said in the confessional booth (lib/confessionals.ts), and their upvotes there. */
  confessionals: Record<string, unknown>[];
  confessional_votes: Record<string, unknown>[];
  ceremony_votes: Record<string, unknown>[];
  /** Places they paid to suggest on a filming date (lib/scene-suggestions.ts). */
  scene_suggestions: Record<string, unknown>[];
  /** Their ratings and reviews of other people's characters (lib/ratings.ts, lib/reviews.ts). */
  character_ratings: Record<string, unknown>[];
  character_reviews: Record<string, unknown>[];
  /** The dates they blocked a creator from: never who that creator is (lib/game.ts keeps that from them too). */
  blocks: Record<string, unknown>[];
  /** What they reported: dates (open and reviewed), watch-party messages and house-scene lines. */
  reports: { dates: Record<string, unknown>[]; dates_reviewed: Record<string, unknown>[]; watch_messages: Record<string, unknown>[]; house_scenes: Record<string, unknown>[] };
  /** League badges they won. */
  badges: Record<string, unknown>[];
  /** Counters: free and pack dates used, dates an admin gave them, step-in dates, companion replies and extras, call credits. */
  usage: {
    free_dates: Record<string, unknown>[];
    free_second_dates: Record<string, unknown>[];
    pack_dates: Record<string, unknown>[];
    date_grants: Record<string, unknown>[];
    step_in: Record<string, unknown>[];
    companion: Record<string, unknown>[];
    companion_extras: Record<string, unknown>[];
    companion_credits: Record<string, unknown>[];
  };
  /** Watch parties: the premieres they hosted, what they said in a room, their reactions and poll answers. */
  watch_parties: { hosted: Record<string, unknown>[]; messages: Record<string, unknown>[]; reactions: Record<string, unknown>[]; poll_votes: Record<string, unknown>[] };
  /**
   * The PG Studio and the Create library (lib/studio): their shoots and pictures (what was asked for, never the image
   * bytes: those are on the character's pages), pinned photos, date photos, and their own prompts, venues and
   * roleplays. After Dark's are not here.
   */
  studio: {
    shoots: Record<string, unknown>[];
    pictures: Record<string, unknown>[];
    profile_photos: Record<string, unknown>[];
    date_photos: Record<string, unknown>[];
    prompts: Record<string, unknown>[];
    places: Record<string, unknown>[];
    roleplays: Record<string, unknown>[];
    identity_views: Record<string, unknown>[];
  };
  /** The Gallery (lib/showcase.ts): their creator page, their PG posts and living portraits, the OKs they gave, their likes, who they follow (by handle). */
  showcase: {
    profile: Record<string, unknown> | null;
    posts: Record<string, unknown>[];
    loops: Record<string, unknown>[];
    consents: Record<string, unknown>[];
    likes: Record<string, unknown>[];
    following: Record<string, unknown>[];
  };
  /**
   * When this id is an agent's (or has one linked): its public handle, the model it says it runs on, the clients it
   * connected with, the feedback it sent and voted on, the model stamp on its dates, and its account links (never the
   * other side's id).
   */
  agent: {
    handle: Record<string, unknown> | null;
    model: Record<string, unknown> | null;
    sessions: Record<string, unknown>[];
    feedback: Record<string, unknown>[];
    feedback_votes: Record<string, unknown>[];
    date_models: Record<string, unknown>[];
    links: Record<string, unknown>[];
  };
  /** Paid plans (lib/paid-plans.ts): which, their state, and the address they were paid with. */
  plans: Record<string, unknown>[];
  operator_pass: { entitlement: Record<string, unknown> | null; usage: Record<string, unknown>[] };
  /** Their renderer for live calls, and an admin's renderer tests (the line typed, never the audio). */
  call_renderer: Record<string, unknown> | null;
  renderer_compares: Record<string, unknown>[];
  /** Which languages they wrote in, counted by day (lib/language-seen.ts): never the words. */
  languages_written: Record<string, unknown>[];
  /**
   * Their characters' circles (lib/social/; docs/PRDs/social-network.md): their characters' off-screen people (and any
   * they added to someone else's), the ties that touch their characters or that they declared or answered, those ties'
   * history, the places they added, and their characters' places. Who declared or answered a tie is said only as
   * whether it was them; a private tie that someone else's character holds about theirs is that character's, and not here.
   * `suggestions`: the "Might know" suggestions shown to them (section 6.3), why, and what they did; kept 400 days.
   */
  social: {
    people: Record<string, unknown>[];
    ties: Record<string, unknown>[];
    tie_events: Record<string, unknown>[];
    places: Record<string, unknown>[];
    place_memberships: Record<string, unknown>[];
    suggestions: Record<string, unknown>[];
  };
  /**
   * The anonymous identities this account claimed (lib/account-claim.ts): each one's id, when, and `left_behind`, what
   * stayed under that id because it is one a person (its votes, calls, allowances, settings), exported the same way.
   * An identity that has since got a sign-in of its own is listed without it: that data is that account's.
   */
  claimed_identities: { id: string; linked_at: string; left_behind: Record<string, unknown> | null }[];
  /** For an identity that was claimed: that it was, and when. Never which account. */
  claimed_into: { linked_at: string } | null;
};

export type CompanionConversationExport = {
  thread_id: string;
  character_id: string;
  character: string;
  started_at: string;
  last_at: string;
  /** The thread's settings: how much the character says, whether it may text first, and whether the crisis pause is up. */
  reply_length: string;
  texts_on: boolean;
  paused: boolean;
  /** The scene being played now and its roleplay (the person's own words when they wrote one), or null while texting. */
  scene: string | null;
  roleplay: unknown;
  /** The running notes the character keeps of everything older than its recent turns (lib/companion-memory.ts). */
  notes: string | null;
  messages: Record<string, unknown>[];
  /** What the character remembers about them (the memory page's facts). */
  memory: Record<string, unknown>[];
  /** Texts the character sent first that they deleted: what each was about and when, never its words (lib/companion-message-delete.ts). */
  deleted_text_markers: { about: string; at: string }[];
};

/** Everything stored under this user id, as JSON. Owner-only (the route checks the cookie is the user). */
export async function exportAccount(db: Db, userId: string, o: { nested?: boolean } = {}): Promise<AccountExport> {
  const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
  const profileRows = await q("select name, attested_adult_at from profiles where user_id = $1", [userId]);
  const profile = profileRows[0]
    ? { name: String(profileRows[0].name), attested_adult_at: String(profileRows[0].attested_adult_at) }
    : null;
  const accountRow = (
    await db.query<{ handle: string | null; email: string | null; google: boolean; password: boolean; created_at: Date | string }>(
      `select handle_display as handle, email, google_sub is not null as google, password_hash is not null as password, created_at
         from accounts where user_id = $1`,
      [userId],
    )
  ).rows[0];
  const account = accountRow
    ? {
        handle: accountRow.handle,
        email: accountRow.email,
        signs_in_with: [...(accountRow.password ? ["password"] : []), ...(accountRow.google ? ["google"] : [])],
        created_at: new Date(accountRow.created_at).toISOString(),
      }
    : null;
  return {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile,
    account,
    points: await getPoints(db, userId),
    characters: await q(
      `select id, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, premium_sku, pronouns, voice, extras,
              this_week, open_to_dates, created_via, created_at,
              -- Their tags (lib/character-tags.ts), with whose they are: the owner's own pick, or read from the traits.
              (select coalesce(json_agg(json_build_object('tag', t.tag, 'source', t.source) order by t.tag), '[]'::json)
                 from character_tags t where t.character_id = characters.id) as tags
         from characters where owner_id = $1 and not is_house order by created_at`,
      [userId],
    ),
    souls: await q(
      `select s.* from souls s join characters c on c.id = s.character_id where c.owner_id = $1`,
      [userId],
    ),
    predictions: await q("select episode_id, pick, drama_pick, created_at from predictions where user_id = $1", [userId]),
    orders: await q("select id, sku, kind, amount_cents, status, created_at, paid_at from orders where user_id = $1", [userId]),
    dealbreaker_guesses: await q("select episode_id, pick, created_at from dealbreaker_guesses where user_id = $1", [userId]),
    matchmaker_proposals: await q("select id, character_a, character_b, created_at from matchmaker_proposals where proposer_id = $1", [userId]),
    leagues_owned: await q("select id, name, created_at from leagues where owner_id = $1", [userId]),
    leagues_joined: await q(
      "select league_id, joined_at from league_members where user_id = $1",
      [userId],
    ),
    character_memory: await q(
      `select m.* from character_memory m join characters c on c.id = m.character_id where c.owner_id = $1 and not c.is_house`,
      [userId],
    ),
    // What their characters learned about themselves (lib/character-lessons.ts): the lines, the dates behind them, when.
    character_lessons: await q(
      `select l.character_id, l.week, l.lines, l.trying_next, l.episodes, l.source, l.created_at from character_lessons l
         join characters c on c.id = l.character_id where c.owner_id = $1 and not c.is_house and l.source in ('model', 'template') order by l.created_at`,
      [userId],
    ),
    // What their characters remember from every mode (lib/character-memories.ts), without the embeddings.
    character_episodes: await q(
      `select e.character_id, e.source, e.about_id, e.visibility, e.text, e.importance, e.folded_into, e.created_at from character_episodes e
         join characters c on c.id = e.character_id where c.owner_id = $1 and not c.is_house and e.room = 'sfw' order by e.created_at`,
      [userId],
    ),
    memory_forgets: await q(
      `select f.character_id, f.kind, f.item, f.created_at from memory_forgets f join characters c on c.id = f.character_id where c.owner_id = $1`,
      [userId],
    ),
    reflections: await q(
      `select e.id as episode_id, c.id as character_id,
              case when e.character_a = c.id then e.reflections->>'a' else e.reflections->>'b' end as reflection
         from episodes e join characters c on c.id in (e.character_a, e.character_b)
        where c.owner_id = $1 and not c.is_house and e.reflections is not null
          and (case when e.character_a = c.id then e.reflections->>'a' else e.reflections->>'b' end) is not null
        order by e.created_at`,
      [userId],
    ),
    // How each of their characters rated its dates (data plan Tier 2): rating, would date again, what worked and didn't.
    reflection_labels: await q(
      `select e.id as episode_id, c.id as character_id,
              case when e.character_a = c.id then e.reflection_labels->'a' else e.reflection_labels->'b' end as labels
         from episodes e join characters c on c.id in (e.character_a, e.character_b)
        where c.owner_id = $1 and not c.is_house and e.reflection_labels is not null
          and jsonb_typeof(case when e.character_a = c.id then e.reflection_labels->'a' else e.reflection_labels->'b' end) = 'object'
        order by e.created_at`,
      [userId],
    ),
    // Their own keys as they're shown: the provider, the last four, when they were checked and used, and each job's model.
    // Never the key: not even sealed (the ciphertext stays out of the export).
    provider_keys: await q(
      `select c.provider, c.last4, c.verified_at, c.last_used_at, c.created_at, j.job, j.model
         from user_connections c left join user_connection_jobs j on j.user_id = c.user_id and j.provider = c.provider
        where c.user_id = $1 order by c.created_at`,
      [userId],
    ),
    // What each of their jobs spent on their own keys, by month (Connections M3).
    provider_spend: await q(
      `select job, month, cost_usd, calls, estimated_calls, unpriced_calls from user_connection_usage where user_id = $1 order by month, job`,
      [userId],
    ),
    couple_texts: await q(
      `select t.character_lo, t.character_hi, t.day, t.seq, t.who, t.text, t.created_at
         from couple_texts t
        where exists (select 1 from characters c where c.id in (t.character_lo, t.character_hi) and c.owner_id = $1 and not c.is_house)
        order by t.day, t.seq`,
      [userId],
    ),
    nudges: await q("select character_id, other_id, note, created_at, used_at from nudges where user_id = $1", [userId]),
    swipes: await q(
      `select s.swiper, s.target, s.liked, s.created_at from swipes s
        where exists (select 1 from characters c where c.id = s.swiper and c.owner_id = $1 and not c.is_house) order by s.created_at`,
      [userId],
    ),
    swipe_impressions: await q(
      `select i.viewer, i.card, i.rank, i.served_via, i.at from swipe_impressions i
        where exists (select 1 from characters c where c.id = i.viewer and c.owner_id = $1 and not c.is_house) order by i.at`,
      [userId],
    ),
    relationship_events: await q(
      `select e.character_a, e.character_b, e.layer, e.kind, e.from_stage, e.to_stage, e.from_shown, e.to_shown, e.episode_id, e.at from relationship_events e
        where exists (select 1 from characters c where c.id in (e.character_a, e.character_b) and c.owner_id = $1 and not c.is_house)
        order by e.at`,
      [userId],
    ),
    matches: await q(
      `select m.character_lo, m.character_hi, m.matched_at, m.yes_lo, m.yes_hi, m.answer_source_lo, m.answer_source_hi, m.agreed_at from matches m
        where exists (select 1 from characters c where c.id in (m.character_lo, m.character_hi) and c.owner_id = $1 and not c.is_house)
        order by m.matched_at`,
      [userId],
    ),
    unmatches: await q(
      `select u.character_lo, u.character_hi, u.by_character, u.created_at from unmatches u
        where exists (select 1 from characters c where c.id in (u.character_lo, u.character_hi) and c.owner_id = $1 and not c.is_house)
        order by u.created_at`,
      [userId],
    ),
    second_date_yeses: await q("select episode_id, overnight, created_at from second_date_requests where user_id = $1", [userId]),
    date_proposals: await q(
      "select from_character, to_character, status, created_at, decided_at, case when from_user = $1 then 'sent' else 'received' end as direction from date_proposals where from_user = $1 or to_user = $1 order by created_at",
      [userId],
    ),
    couple_follows: await q("select character_lo, character_hi, created_at from couple_follows where user_id = $1", [userId]),
    character_follows: await q("select character_id, texts_on, created_at from character_follows where user_id = $1 order by created_at", [userId]),
    arc_predictions: await q("select character_lo, character_hi, target, pick, created_at, resolved_at, outcome from arc_predictions where user_id = $1", [userId]),
    situation_votes: await q("select day, pick, created_at, updated_at from situation_votes where user_id = $1 order by day", [userId]),
    season_format_votes: await q("select season_id, pick, created_at, updated_at from season_format_votes where user_id = $1 order by season_id", [userId]),
    // Show ideas (lib/show-ideas.ts): what they said they'd want, and the ideas they proposed.
    show_idea_votes: await q("select idea_id, watch, enter_character, produce, created_at, updated_at from show_idea_votes where user_id = $1 order by created_at", [userId]),
    // Writing styles (lib/writing-style.ts): the style they picked for each side, and the stories of their After Dark chapters.
    writing_styles: await q("select show_style, adult_style, updated_at from writing_prefs where user_id = $1", [userId]),
    stories: await q("select kind, ref_id, title, paragraphs, created_at from stories where owner_id = $1 order by created_at", [userId]),
    // Who they are in scenes (lib/persona.ts).
    persona: await q("select name, look, about, updated_at from personas where user_id = $1", [userId]),
    show_ideas_proposed: await q("select id, title, pitch, status, created_at from show_ideas where proposed_by = $1 order by created_at", [userId]),
    notification_mutes: await q("select type, created_at from notification_mutes where user_id = $1 order by type", [userId]),
    recoupling_votes: await q("select night_at, pick, created_at, updated_at from recoupling_votes where user_id = $1 order by night_at", [userId]),
    cast_backings: await q("select season_id, character_id, created_at, updated_at, won, settled_at from cast_backings where user_id = $1 order by season_id", [userId]),
    dare_votes: await q("select day, pick, points, settled_at, created_at, updated_at from dare_votes where user_id = $1 order by day", [userId]),
    cast_date_weeks: await q("select week_id, granted_at from cast_date_weeks where user_id = $1 order by week_id", [userId]),
    weekly_reveal_votes: await q("select week_id, pick, created_at, updated_at from weekly_reveal_votes where user_id = $1 order by week_id", [userId]),
    season_pool_entries: await q("select season_id, place, points, calls_right from season_pool_entries where user_id = $1 order by season_id", [userId]),
    notifications: await q("select kind, title, body, link, created_at, read_at from notifications where user_id = $1 order by created_at", [userId]),
    push_subscriptions: await q("select split_part(endpoint, '/', 3) as push_service, created_at from push_subscriptions where user_id = $1", [userId]),
    email: await q(
      `select p.email, p.status, p.confirmed_at, p.last_digest_at, (select count(*)::int from email_sends s where s.user_id = p.user_id) as emails_sent
         from email_prefs p where p.user_id = $1`,
      [userId],
    ),
    feedback: await q(
      "select created_at, category, rating, message, email, page, viewport, version, user_agent from user_feedback where user_id = $1 order by created_at",
      [userId],
    ),
    content_reports: await q(
      "select created_at, category, target, details, contact_email, status, decided_at from content_reports where reporter_id = $1 order by created_at",
      [userId],
    ),
    ml_consent: await q("select granted, version, decided_at from ml_consents where user_id = $1", [userId]),
    choice_history: await q("select kind, episode_id, character_id, other_id, value, at from choice_history where user_id = $1 order by at", [userId]),
    turn_drafts: await q(
      `select d.episode_id, d.turn_index, d.side, d.source, d.reason, d.rejected, d.created_at from turn_drafts d join episodes e on e.id = d.episode_id
        where exists (select 1 from characters c where c.owner_id = $1 and not c.is_house
                        and c.id = case when d.side = 'a' then e.character_a else e.character_b end)
        order by d.created_at`,
      [userId],
    ),
    line_feedback: await q("select kind, ref_id, line_index, vote, tag, created_at, updated_at from line_feedback where user_id = $1 order by created_at", [userId]),
    // The run's trace is left out: its numbers average both characters' temperaments, so it isn't one person's to take.
    episode_variations: await q(
      `select v.varies_episode_id as episode_id, v.variation, v.engine_version, v.base_ending, v.stored_ending, v.alt_ending,
              v.alt_box_score, v.alt_sides, v.faithful, v.requests, v.created_at
         from episode_variations v join episodes e on e.id = v.varies_episode_id
        where e.creator_id = $1
           or exists (select 1 from characters c where c.id in (e.character_a, e.character_b) and c.owner_id = $1 and not c.is_house)
        order by v.created_at`,
      [userId],
    ),
    plus_interest: await q("select place, with_email, created_at from plus_interest where user_id = $1 order by created_at", [userId]),
    companion_conversations: await companionConversations(db, userId),
    // A call's row has no words and no sound (its words are messages, marked on_call, in the conversation above).
    companion_calls: await q(
      `select thread_id, started_at, ended_at, last_at, minutes, turns, tts_chars as voiced_characters, face_provider, face_seconds,
              first_ticket->>'source' as first_minute_paid_with
         from companion_live_calls where user_id = $1 order by started_at`,
      [userId],
    ),
    ...(await exportTheRest(db, userId)),
    ...(await exportClaims(db, userId, Boolean(o.nested))),
  };
}

/** True when an id has a sign-in of its own (lib/auth hasAccount, kept here so this file stays free of the auth code). */
async function hasSignIn(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from accounts where user_id = $1 and (handle is not null or email is not null or google_sub is not null or password_hash is not null)`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * The claims this id is part of (lib/account-claim.ts). What stayed under a claimed identity is the same person's (the
 * claim proved it), so it is exported with the account: one level deep, and never for an identity that has since got a
 * sign-in of its own.
 */
async function exportClaims(db: Db, userId: string, nested: boolean): Promise<Pick<AccountExport, "claimed_identities" | "claimed_into">> {
  const iso = (v: Date | string) => new Date(v).toISOString();
  const into = (await db.query<{ linked_at: Date | string }>(`select linked_at from account_aliases where alias_id = $1`, [userId])).rows[0];
  const aliases = nested ? [] : (await db.query<{ alias_id: string; linked_at: Date | string }>(`select alias_id, linked_at from account_aliases where user_id = $1 order by linked_at, alias_id`, [userId])).rows;
  const claimed: AccountExport["claimed_identities"] = [];
  for (const a of aliases) {
    const theirs = !(await hasSignIn(db, a.alias_id));
    claimed.push({ id: a.alias_id, linked_at: iso(a.linked_at), left_behind: theirs ? ((await exportAccount(db, a.alias_id, { nested: true })) as unknown as Record<string, unknown>) : null });
  }
  return { claimed_identities: claimed, claimed_into: into ? { linked_at: iso(into.linked_at) } : null };
}

type TheRest = Pick<
  AccountExport,
  | "admin" | "last_seen" | "dates_booked" | "scheduled_dates" | "date_links" | "double_dates" | "date_roleplays" | "thread_reads" | "identity_reveals"
  | "afterglow_consents" | "auditions" | "casting_invites_used" | "audition_votes" | "ceremony_votes" | "scene_suggestions" | "character_ratings"
  | "confessionals" | "confessional_votes" | "character_reviews" | "blocks" | "reports" | "badges" | "usage" | "watch_parties" | "studio" | "showcase" | "agent" | "plans" | "operator_pass"
  | "call_renderer" | "renderer_compares" | "languages_written" | "social"
>;

/**
 * The tables the registry found the export had missed (lib/person-columns.ts). One statement each, in turn (an export is
 * rare, and a burst would take the pool: docs/audits/2026-11-01-audit.md). Every statement is keyed by this id alone and
 * selects no other person's id: a block says which date, not whom; a follow names a handle; a link says only that it is.
 */
async function exportTheRest(db: Db, userId: string): Promise<TheRest> {
  const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql, [userId])).rows;
  const one = async (sql: string) => (await q(sql))[0] ?? null;
  const iso = (v: unknown) => new Date(v as string | Date).toISOString();
  const adminRow = await one("select created_at from admins where user_id = $1");
  const seen = await one("select last_seen, prev_seen from owner_activity where user_id = $1");
  return {
    admin: adminRow ? { since: iso(adminRow.created_at) } : null,
    last_seen: seen ? { last_seen: iso(seen.last_seen), prev_seen: seen.prev_seen ? iso(seen.prev_seen) : null } : null,
    dates_booked: await q("select id, character_a, character_b, visibility, created_at, revealed_at from episodes where creator_id = $1 order by created_at"),
    scheduled_dates: await q("select id, character_id, partner_id, run_at, visibility, place, created_at, ran_at, episode_id, outcome from scheduled_dates where creator_id = $1 order by created_at"),
    date_links: {
      invites: await q("select code, character_id, accepted, created_at, revoked_at from date_invites where owner_id = $1 order by created_at"),
      doubles_made: await q("select code, character_id, partner_id, created_at, revoked_at, taken_at, night_id from double_links where created_by = $1 order by created_at"),
      // A link someone else made: the couple it was for and when, never its code (theirs to share) or who made it.
      doubles_taken: await q("select character_id, partner_id, taken_at, night_id from double_links where taken_by = $1 order by taken_at"),
    },
    double_dates: {
      nights: await q(
        `select id, kind, venue, status, couple_a, couple_b, episode_a, episode_b, created_at, decided_at,
                case when created_by = $1 then 'proposed' else 'invited' end as side
           from group_nights where created_by = $1 or invite_to = $1 order by created_at`,
      ),
      seats: await q("select night_id, character_id, joined_at from group_night_seats where booker = $1 order by joined_at"),
    },
    date_roleplays: await q(
      `select id, character_lo, character_hi, proposed_by as from_character, terms, note, round, status, created_at, decided_at, episode_id,
              case when proposer_user = $1 then 'sent' else 'received' end as direction
         from date_roleplays where proposer_user = $1 or answerer_user = $1 order by created_at`,
    ),
    thread_reads: await q("select character_lo, character_hi, read_at from thread_reads where user_id = $1 order by read_at"),
    identity_reveals: await q("select episode_id, created_at from identity_consents where user_id = $1 order by created_at"),
    afterglow_consents: await q("select episode_id, created_at from afterglow_consents where user_id = $1 order by created_at"),
    auditions: await q("select season_id, character_id, status, created_at, decided_at from cast_auditions where owner_id = $1 order by created_at"),
    // The code and the admin's note on it are the show's: only that they used one, for which season and character.
    casting_invites_used: await q("select season_id, character_id, used_at from casting_invites where used_by = $1 order by used_at"),
    audition_votes: await q("select season_id, character_id, created_at, updated_at from audition_votes where voter_id = $1 order by season_id"),
    confessionals: await q("select id, character_id, body, about_episode, status, created_at, removed_at from confessionals where owner_id = $1 order by created_at"),
    confessional_votes: await q("select confessional_id, created_at from confessional_votes where voter_id = $1 order by created_at"),
    ceremony_votes: await q("select held_on, pick, created_at, updated_at from ceremony_votes where user_id = $1 order by held_on"),
    scene_suggestions: await q("select episode_id, place, label, tokens, status, created_at from scene_suggestions where user_id = $1 order by created_at"),
    character_ratings: await q("select character_id, category, created_at from character_ratings where rater_id = $1 order by created_at"),
    character_reviews: await q("select character_id, stars, body, via, created_at, updated_at from character_reviews where reviewer_id = $1 order by created_at"),
    blocks: await q("select via_episode_id as episode_id, created_at from blocks where blocker_id = $1 order by created_at"),
    reports: {
      dates: await q("select episode_id, reason, created_at from reports where reporter_id = $1 order by created_at"),
      dates_reviewed: await q("select episode_id, reason, created_at, reviewed_at, decision from reports_reviewed where reporter_id = $1 order by created_at"),
      watch_messages: await q("select message_id, created_at from watch_message_reports where reporter_id = $1 order by created_at"),
      house_scenes: await q("select scene_id, line, reason, created_at from house_scene_reports where reporter_id = $1 order by created_at"),
    },
    badges: await q("select season_id, league_id, place, points from badges where user_id = $1 order by season_id"),
    usage: {
      free_dates: await q("select season_id, used from free_episode_usage where user_id = $1 order by season_id"),
      free_second_dates: await q("select season_id, created_at from free_second_date_usage where user_id = $1 order by season_id"),
      pack_dates: await q("select used from pack_episode_usage where user_id = $1"),
      date_grants: await q("select episodes, created_at from token_grants where user_id = $1 order by created_at"),
      step_in: await q("select day, dates, free_used from step_in_usage where user_id = $1 order by day"),
      companion: await q("select day, replies from companion_usage where user_id = $1 order by day"),
      companion_extras: await q("select month, kind, used from companion_extras_usage where user_id = $1 order by month, kind"),
      companion_credits: await q("select kind, credits from companion_credits where user_id = $1 order by kind"),
    },
    watch_parties: {
      hosted: await q("select id, episode_id, kind, starts_at, created_at from watch_parties where host_id = $1 order by created_at"),
      messages: await q("select party_id, handle, body, hidden, created_at from watch_messages where user_id = $1 order by created_at"),
      reactions: await q("select party_id, emoji, created_at from watch_reactions where user_id = $1 order by created_at"),
      poll_votes: await q("select party_id, poll, choice, updated_at from watch_poll_votes where user_id = $1 order by updated_at"),
    },
    studio: {
      shoots: await q("select id, character_id, kind, choices, model, tokens, free, asked, made, status, created_at from studio_pg_shoots where owner_id = $1 order by created_at"),
      pictures: await q("select id, character_id, shoot_id, prompt, content_rating, clothing, model, created_at from studio_pg_pictures where owner_id = $1 order by created_at"),
      profile_photos: await q("select character_id, picture_id, created_at from profile_photos where owner_id = $1 order by created_at"),
      date_photos: await q("select episode_id, style, created_at from date_photos where owner_id = $1 order by created_at"),
      // The library and the identity views are shared with After Dark: only the safe side is exported here.
      prompts: await q("select id, title, text, created_at from creator_prompts where owner_id = $1 and mode = 'safe' order by created_at"),
      places: await q("select id, name, description, created_at from creator_places where owner_id = $1 and mode = 'safe' order by created_at"),
      roleplays: await q("select id, title, premise, role_a, role_b, category, created_at from creator_roleplays where owner_id = $1 and mode = 'safe' order by created_at"),
      identity_views: await q("select character_id, view, image_id, created_at from identity_views where owner_id = $1 and studio = 'pg' order by created_at"),
    },
    showcase: {
      profile: await one(
        `select p.handle, p.display_name, p.bio, p.hidden, p.created_at, (select count(*)::int from creator_follows f where f.creator_id = p.user_id) as followers
           from creator_profiles p where p.user_id = $1`,
      ),
      posts: await q(
        "select id, character_id, character_b, rating, medium, caption, tags, status, created_at, published_at from showcase_posts where owner_id = $1 and source = 'pg' order by created_at",
      ),
      loops: await q("select id, source, character_id, status, created_at from showcase_loops where owner_id = $1 order by created_at"),
      consents: await q("select post_id, character_id, status, created_at from showcase_consents where owner_id = $1 order by created_at"),
      likes: await q("select post_id, created_at from showcase_likes where user_id = $1 order by created_at"),
      // Who they follow, by the creator's public handle: never the creator's id.
      following: await q("select p.handle, f.created_at from creator_follows f left join creator_profiles p on p.user_id = f.creator_id and not p.hidden where f.follower_id = $1 order by f.created_at"),
    },
    agent: {
      handle: await one("select handle, display_name, bio, created_at from agent_handles where agent_id = $1"),
      model: await one("select model, family, via, declared_at, updated_at from agent_models where agent_id = $1"),
      sessions: await q("select client_name, client_version, user_agent, calls, created_at, last_seen from mcp_sessions where agent_id = $1 order by created_at"),
      feedback: await q("select rating, liked, wants, problems, message, model, shared, created_at from agent_feedback where agent_id = $1 order by created_at"),
      feedback_votes: await q("select feedback_id, kind, vote, created_at from feedback_votes where agent_id = $1 order by created_at"),
      date_models: await q("select episode_id, side, family, model, stamped_at from episode_models where agent_id = $1 order by stamped_at"),
      // A link's two ends are an agent's id (a bearer token) and an account's: neither is exported, only that the link is.
      links: await q(
        `select case when user_id = $1 then 'an agent is linked to this account' else 'this agent is linked to an account' end as link, linked_at
           from agent_links where user_id = $1 or agent_id = $1 order by linked_at`,
      ),
    },
    plans: await q("select plan, status, period_end, provider, email, subscribed_at, updated_at from plan_entitlements where user_id = $1 order by plan"),
    operator_pass: {
      entitlement: await one("select subscription_status, period_end, provider, updated_at from operator_entitlements where user_id = $1"),
      usage: await q("select period_month, used from operator_date_usage where user_id = $1 order by period_month"),
    },
    call_renderer: await one("select renderer, updated_at from user_live_face where user_id = $1"),
    renderer_compares: await q("select id, character_id, line, voice, audio_seconds, created_at from live_face_compares where user_id = $1 order by created_at"),
    languages_written: await q("select day, surface, lang, n from language_seen where actor = $1 order by day, surface, lang"),
    social: await exportSocial(db, userId),
  };
}

/**
 * Their characters' circles (lib/social/), one statement each like the rest. Keyed by their id and their characters
 * alone; another person is never named: who declared or answered a tie, who added a person or did a change, is only
 * whether it was them.
 */
async function exportSocial(db: Db, userId: string): Promise<AccountExport["social"]> {
  const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql, [userId])).rows;
  const mine = `(select id from characters where owner_id = $1 and not is_house)`;
  // The ties of theirs: held by one of their characters, or to one (unless it's another character's private one), or
  // declared or answered by them.
  const theirTies = `from_id in ${mine} or (to_id in ${mine} and visibility <> 'private') or created_by = $1 or answered_by = $1`;
  return {
    people: await q(
      `select id, holder_id as character_id, name, pronouns, note, deceased, visibility, source, promoted_to, created_at, updated_at,
              coalesce(created_by = $1, false) as added_by_you
         from social_people where holder_id in ${mine} or created_by = $1 order by created_at, id`,
    ),
    ties: await q(
      `select id, from_id, to_id, to_person_id, kind, layer, directed, valence, closeness, status, visibility, source, source_ref, evidence, detail,
              story, since_text, origin_model, confidence, started_at, ended_at, last_contact_at, created_at, updated_at,
              coalesce(created_by = $1, false) as declared_by_you, coalesce(answered_by = $1, false) as answered_by_you
         from social_ties where ${theirTies} order by created_at, id`,
    ),
    tie_events: await q(
      `select tie_id, event, changes, source, source_ref, at, coalesce(actor = $1, false) as by_you
         from social_tie_events where actor = $1 or tie_id in (select id from social_ties where ${theirTies}) order by at, id`,
    ),
    places: await q("select id, key, kind, name, description, visibility, created_at from social_places where created_by = $1 order by created_at, id"),
    place_memberships: await q(
      `select m.place_id, p.key as place_key, p.name as place, m.character_id, m.role, m.since_text, m.started_at, m.ended_at, m.source, m.visibility,
              m.detail, m.created_at, m.updated_at, coalesce(m.created_by = $1, false) as declared_by_you
         from social_place_members m left join social_places p on p.id = m.place_id
        where m.character_id in ${mine} or m.created_by = $1 order by m.created_at, m.place_id, m.role`,
    ),
    suggestions: await q(
      "select character_id, suggested_id, reason, score, shown_at, outcome, outcome_at from social_suggestion_log where viewer = $1 order by shown_at, id",
    ),
  };
}

/**
 * The person's companion threads for the export, three reads whatever the number of threads. A message says who said it
 * (`you`, `character`, or `notice` for the AI notice and a scene's line), when, whether it was said on a call, and the
 * date it is about when the character texted about one (`episode_id`); a voice note is a flag (the audio is made from
 * the words and isn't the person's), a photo its address. A reply drawn
 * again is here too, marked `redrawn`: it is kept, hidden, until its reply or the conversation is deleted. Only the
 * person's own threads: the character is named, and nothing of any other person's is read.
 */
async function companionConversations(db: Db, userId: string): Promise<CompanionConversationExport[]> {
  const iso = (v: Date | string) => new Date(v).toISOString();
  const [threads, messages, facts] = await Promise.all([
    db.query<{ id: string; character_id: string; character: string; created_at: Date | string; last_at: Date | string; reply_length: string; muted_proactive: boolean; paused_at: Date | string | null; scene: string | null; roleplay: unknown; summary: string | null }>(
      `select t.id, t.character_id, c.name as character, t.created_at, t.last_at, t.reply_length, t.muted_proactive, t.paused_at, t.scene, t.roleplay, t.summary
         from companion_threads t join characters c on c.id = t.character_id
        where t.user_id = $1 order by t.created_at, t.id`,
      [userId],
    ),
    db.query<{ thread_id: string; id: string; role: string; text: string; created_at: Date | string; on_call: boolean; via: string; media_url: string | null; scene: string | null; action: string | null; roleplay: string | null; reported: string | null; reported_at: Date | string | null; voice_note: boolean; replaced_by: string | null; episode_id: string | null }>(
      `select m.thread_id, m.id, m.role, m.text, m.created_at, m.on_call, m.via, m.media_url, m.scene, m.action, m.roleplay, m.reported, m.reported_at,
              m.voice_key is not null as voice_note, m.replaced_by, m.episode_id
         from companion_messages m join companion_threads t on t.id = m.thread_id
        where t.user_id = $1 order by m.created_at, m.id`,
      [userId],
    ),
    db.query<{ thread_id: string; kind: string; text: string; pinned: boolean; edited_by_user: boolean; created_at: Date | string }>(
      `select f.thread_id, f.kind, f.text, f.pinned, f.edited_by_user, f.created_at
         from companion_facts f join companion_threads t on t.id = f.thread_id
        where t.user_id = $1 order by f.created_at, f.id`,
      [userId],
    ),
  ]);
  return threads.rows.map((t) => {
    const mine = messages.rows.filter((m) => m.thread_id === t.id);
    // A deleted text's marker is the row blanked and pointed at itself (lib/companion-message-delete.ts).
    const marker = (m: (typeof mine)[number]) => m.replaced_by === m.id;
    return {
      thread_id: t.id,
      character_id: t.character_id,
      character: t.character,
      started_at: iso(t.created_at),
      last_at: iso(t.last_at),
      reply_length: t.reply_length,
      texts_on: !t.muted_proactive,
      paused: t.paused_at !== null,
      scene: t.scene,
      roleplay: t.roleplay ?? null,
      notes: t.summary,
      messages: mine
        .filter((m) => !marker(m))
        .map((m) => ({
          said_by: m.role === "user" ? "you" : m.role === "character" ? "character" : "notice",
          text: m.text,
          at: iso(m.created_at),
          on_call: m.on_call,
          ...(m.via === "photo" ? { photo: m.media_url } : {}),
          ...(m.voice_note ? { voice_note: true } : {}),
          ...(m.scene ? { scene: m.scene } : {}),
          ...(m.roleplay ? { roleplay: m.roleplay } : {}),
          // What they did as they said it (a scene), or what a text they sent first was about (its tag).
          ...(m.action ? (isTextTag(m.action) ? { about: m.action } : { action: m.action }) : {}),
          // The date a text they were sent is about (companion_messages.episode_id), when it is about one.
          ...(m.episode_id ? { episode_id: m.episode_id } : {}),
          ...(m.reported ? { reported: m.reported, reported_at: m.reported_at ? iso(m.reported_at) : null } : {}),
          ...(m.replaced_by ? { redrawn: true } : {}),
        })),
      memory: facts.rows.filter((f) => f.thread_id === t.id).map((f) => ({ kind: f.kind, text: f.text, pinned: f.pinned, edited_by_you: f.edited_by_user, at: iso(f.created_at) })),
      deleted_text_markers: mine.filter(marker).map((m) => ({ about: m.action ?? "", at: iso(m.created_at) })),
    };
  });
}

/**
 * The numbers in an engine trace (lib/engine.ts EngineTrace) that come from the characters' temperaments, read off their
 * private souls and learned memory: the averaged signals and every term that's a multiple of one. A forgotten
 * character's soul and memory are deleted, so these go with them; the margin, the score and the other terms stay
 * (they're sums over everything, and explain the aired ending).
 */
export const TRACE_SOUL_PATHS = [
  ["signals"],
  ["terms", "chemistry", "humor"],
  ["terms", "chemistry", "warmth"],
  ["terms", "attraction", "openness"],
  ["terms", "trust", "warmth"],
  ["terms", "trust", "guarded"],
  ["terms", "awkwardness", "guarded"],
  ["terms", "awkwardness", "humor"],
] as const;
const stripTraceSql = (col: string) => TRACE_SOUL_PATHS.reduce<string>((sql, path) => `(${sql} #- '{${path.join(",")}}')`, col);

/**
 * Removes a character's private learned layer: its memory (which holds how it felt about each person), what it was
 * told to forget, and its reflections on its dates. Run before a character becomes a tombstone (kept only because
 * a shared episode still shows it), so nothing private outlives its owner. The episodes themselves stay.
 */
async function forgetEverything(db: Db, characterIds: string[]): Promise<void> {
  if (!characterIds.length) return;
  await db.query("delete from character_memory where character_id = any($1)", [characterIds]);
  await db.query("delete from memory_forgets where character_id = any($1)", [characterIds]);
  // What it learned about itself (lib/character-lessons.ts): written from its private side of its dates.
  await db.query("delete from character_lessons where character_id = any($1)", [characterIds]);
  // Its shared memory from every mode (lib/character-memories.ts): private like the rest.
  await db.query("delete from character_episodes where character_id = any($1)", [characterIds]);
  // Their texts between dates and any notes about them (lib/between-dates.ts) go too; the shared episodes stay.
  await db.query("delete from couple_texts where character_lo = any($1) or character_hi = any($1)", [characterIds]);
  await db.query("delete from nudges where character_id = any($1) or other_id = any($1)", [characterIds]);
  await db.query("delete from swipes where swiper = any($1) or target = any($1)", [characterIds]);
  await db.query("delete from matches where character_lo = any($1) or character_hi = any($1)", [characterIds]);
  await db.query("delete from unmatches where character_lo = any($1) or character_hi = any($1)", [characterIds]);
  // Nobody follows a character whose creator left (lib/character-follows.ts): its sheet stays for the dates it aired in.
  await db.query("delete from character_follows where character_id = any($1)", [characterIds]);
  // The data plan's logs about them (lib/db.ts, Tier 1): the decks they saw and were shown in, and their pairs' timelines.
  await db.query("delete from swipe_impressions where viewer = any($1) or card = any($1)", [characterIds]);
  await db.query("delete from relationship_events where character_a = any($1) or character_b = any($1)", [characterIds]);
  await db.query("delete from choice_history where character_id = any($1) or other_id = any($1)", [characterIds]);
  // Lines on their side that didn't go in: the dates themselves stay (shared), and so do the other side's drafts.
  await db.query(
    `delete from turn_drafts d using episodes e
      where e.id = d.episode_id and ((d.side = 'a' and e.character_a = any($1)) or (d.side = 'b' and e.character_b = any($1)))`,
    [characterIds],
  );
  // Sliding Doors runs on their dates (lib/simulation.ts): a replay built on their soul's numbers, so it goes whole.
  await db.query(
    "delete from episode_variations v using episodes e where e.id = v.varies_episode_id and (e.character_a = any($1) or e.character_b = any($1))",
    [characterIds],
  );
  // The soul-derived numbers on their dates (data plan Tier 1, episodes.engine_trace: the temperament signals and the
  // terms built from them), and their side's signal snapshot on the setup (setup.signals_a/b, what a replay reads). The
  // soul is deleted, so what was read off it goes too. A date still being written keeps its snapshot until it's done.
  await db.query(
    `update episodes set engine_trace = ${stripTraceSql("engine_trace")}
      where engine_trace is not null and (character_a = any($1) or character_b = any($1))`,
    [characterIds],
  );
  await db.query(
    `update episodes set setup = setup - (case when character_a = any($1) then 'signals_a' else '' end)
                                       - (case when character_b = any($1) then 'signals_b' else '' end)
      where status = 'ready' and ((character_a = any($1) and setup ? 'signals_a') or (character_b = any($1) and setup ? 'signals_b'))`,
    [characterIds],
  );
  await db.query(
    `update episodes set reflections = jsonb_build_object(
        'a', case when character_a = any($1) then null else reflections->'a' end,
        'b', case when character_b = any($1) then null else reflections->'b' end)
      where reflections is not null and (character_a = any($1) or character_b = any($1))`,
    [characterIds],
  );
  // Their side's reflection labels (data plan Tier 2), like the reflection text above.
  await db.query(
    `update episodes set reflection_labels = jsonb_build_object(
        'a', case when character_a = any($1) then null else reflection_labels->'a' end,
        'b', case when character_b = any($1) then null else reflection_labels->'b' end)
      where reflection_labels is not null and (character_a = any($1) or character_b = any($1))`,
    [characterIds],
  );
  // Their concept embedding (lib/originality-concept.ts): a tombstone keeps the row, so the cascade wouldn't take it.
  await db.query("delete from character_embeddings where character_id = any($1)", [characterIds]);
  // Their circle as someone declared it (lib/social/): off-screen people (the ties to them go too), declared ties either
  // way, declared places. What aired made (source 'derived') stays, like the dates it came from.
  await db.query("delete from social_people where holder_id = any($1)", [characterIds]);
  await db.query("delete from social_ties where (from_id = any($1) or to_id = any($1)) and source <> 'derived'", [characterIds]);
  await db.query("delete from social_place_members where character_id = any($1) and source <> 'derived'", [characterIds]);
}

export type CharacterDeletion = { deleted: boolean; anonymized: boolean };

/**
 * Deletes one of the user's characters. Mirrors account deletion for a single character: a character never
 * used in an episode is hard-deleted (cascading its soul, assets, relationships and proposals); one already
 * in a shared episode keeps its fictional sheet but loses its private soul and its owner link (a tombstone),
 * so the episode other viewers saw still renders. The tombstone is private (2026-11-21): its name on those dates,
 * nothing more; its card, board and sitemap entry go. Owner-checked by the caller; returns what happened.
 */
export async function deleteCharacter(db: Db, userId: string, characterId: string): Promise<CharacterDeletion> {
  const inEpisode = async () =>
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from episodes where character_a = $1 or character_b = $1`,
        [characterId],
      )
    ).rows[0].n > 0;

  // The soul is the sensitive personal data; remove it first either way.
  await db.query("delete from souls where character_id = $1", [characterId]);
  if (await inEpisode()) {
    // A tombstone keeps its public sheet for the episodes it aired in, but nothing it privately learned.
    const owned = await db.query("select 1 from characters where id = $1 and owner_id = $2 and not is_house", [characterId, userId]);
    if (owned.rows.length) await forgetEverything(db, [characterId]);
    const { rows } = await db.query<{ id: string }>(
      // Closed to dates too: a retired character must leave everyone's swipe deck (#260). Private: its name only.
      "update characters set owner_id = $3, open_to_dates = false, visibility = 'private' where id = $1 and owner_id = $2 and not is_house returning id",
      [characterId, userId, DELETED_OWNER],
    );
    return { deleted: false, anonymized: rows.length > 0 };
  }
  const { rows } = await db.query<{ id: string }>(
    "delete from characters where id = $1 and owner_id = $2 and not is_house returning id",
    [characterId, userId],
  );
  return { deleted: rows.length > 0, anonymized: false };
}

export type AccountDeletion = { characters_deleted: number; characters_anonymized: number };

/**
 * Deletes everything stored under this user id. Ordered so foreign keys never block a delete. Not a
 * single transaction (the Db pool has no cross-call transaction), but every step is idempotent and
 * safe to retry, so a partial failure can be re-run.
 */
export async function deleteAccount(db: Db, userId: string): Promise<AccountDeletion> {
  // What stayed under the anonymous identities this account claimed (lib/account-claim.ts) is this person's too: it goes
  // first, the same way. Never an identity that has since got a sign-in of its own: that is someone's account, theirs to delete.
  const aliases = (await db.query<{ alias_id: string }>(`select alias_id from account_aliases where user_id = $1`, [userId])).rows;
  const total: AccountDeletion = { characters_deleted: 0, characters_anonymized: 0 };
  for (const { alias_id } of aliases) {
    if (alias_id === userId || (await hasSignIn(db, alias_id))) continue;
    const gone = await deleteIdentity(db, alias_id);
    total.characters_deleted += gone.characters_deleted;
    total.characters_anonymized += gone.characters_anonymized;
  }
  const own = await deleteIdentity(db, userId);
  return { characters_deleted: total.characters_deleted + own.characters_deleted, characters_anonymized: total.characters_anonymized + own.characters_anonymized };
}

/** Everything stored under one id (deleteAccount, for the account and for each identity it claimed). */
async function deleteIdentity(db: Db, userId: string): Promise<AccountDeletion> {
  const run = (sql: string, params: unknown[] = []) => db.query(sql, params);
  const returning = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows.length;

  // 1. The private souls of this user's characters (the most sensitive personal data), before any
  //    character is kept as a tombstone.
  await run("delete from souls where character_id in (select id from characters where owner_id = $1)", [userId]);
  // The After Dark profile (turn-ons and hard nos, "sex life" data: lib/adult/profile-data.ts), before any character is
  // kept as a tombstone with its row.
  await deleteAdultProfile(db, userId);

  // Step into the date (lib/step-in.ts forgetPersonas): someone's "you" is them, not a fictional sheet. Anonymized, and
  // every date it was on taken offline (their own words are in the lines). Owned by "you:<id>", so steps 2-3 never see it.
  // The couples those dates were part of are refreshed, so no board or sky still counts one (a failed refresh is swept hourly).
  const offline = (
    await db.query<{ id: string }>(
      `update episodes set visibility = 'private' where character_a in (select id from characters where owner_id = 'you:' || $1) or character_b in (select id from characters where owner_id = 'you:' || $1) returning id`,
      [userId],
    )
  ).rows;
  for (const e of offline) await refreshEpisodePair(db, e.id).catch(() => {});
  await run(`delete from souls where character_id in (select id from characters where owner_id = 'you:' || $1)`, [userId]);
  await run(`update characters set owner_id = $2, name = 'A former viewer', bio = 'Someone who stepped into a date.', pronouns = null, visibility = 'private' where owner_id = 'you:' || $1`, [userId, DELETED_OWNER]);

  // 2. Characters never used in an episode: hard delete (cascades assets, relationships, proposals).
  const charactersDeleted = await returning(
    `delete from characters
      where owner_id = $1 and not is_house
        and id not in (select character_a from episodes union select character_b from episodes)
      returning id`,
    [userId],
  );
  // 3. Characters still referenced by a shared episode: detach ownership (fictional sheet stays, soul and learned
  //    memory gone).
  const kept = (await db.query<{ id: string }>("select id from characters where owner_id = $1 and not is_house", [userId])).rows.map((r) => r.id);
  await forgetEverything(db, kept);
  // Their After Dark turn-ons (sex-life data, GDPR Art. 9) go too; a deleted character's went with it (on delete cascade).
  if (kept.length) await run("delete from adult_profiles where character_id = any($1::text[])", [kept]);
  const charactersAnonymized = await returning(
    // Closed to dates too: a deleted creator's character must never be asked out or blind-matched again. Private (its name
    // on the dates it aired in, nothing more), as deleteCharacter's tombstone; those dates stay up for the other side.
    "update characters set owner_id = $2, open_to_dates = false, visibility = 'private' where owner_id = $1 and not is_house returning id",
    [userId, DELETED_OWNER],
  );

  // 4. Everything else keyed to the user id.
  // Companions (lib/companion.ts): every thread, with its messages and what the character remembered (on delete cascade).
  await run("delete from companion_threads where user_id = $1", [userId]);
  // Their voice notes went with the replies; the files no reply points at any more go now (lib/companion-voice.ts).
  await forgetUnusedVoices(db);
  // A plan's billing record (lib/paid-plans.ts: plan, status, Stripe's subscription id, the address they paid with; nothing
  // they said) stays while Stripe may still renew it (the yearly reminder is owed); its usage counts and Subscribe clicks go.
  await run("delete from companion_usage where user_id = $1", [userId]);
  await run("delete from companion_extras_usage where user_id = $1", [userId]);
  await run("delete from companion_credits where user_id = $1", [userId]);
  await run("delete from companion_live_calls where user_id = $1", [userId]);
  await run("delete from plan_checkouts where user_id = $1", [userId]);
  await run("delete from league_members where user_id = $1", [userId]);
  await run("delete from leagues where owner_id = $1", [userId]); // cascades its remaining members
  await run("delete from predictions where user_id = $1", [userId]);
  await run("delete from identity_consents where user_id = $1", [userId]);
  await run("delete from ml_consents where user_id = $1", [userId]);
  await run("delete from choice_history where user_id = $1", [userId]);
  await run("delete from line_feedback where user_id = $1", [userId]);
  // Sliding Doors runs they asked for on a date they booked (their own characters' went with forgetEverything above).
  await run("delete from episode_variations v using episodes e where e.id = v.varies_episode_id and e.creator_id = $1", [userId]);
  // The agents linked to this account: the link is the account's, so it (and the consent it carried) goes with it.
  // (An agent that deletes itself is the other end of that link: its id is a person's id like any other.)
  await run("delete from agent_links where user_id = $1 or agent_id = $1", [userId]);
  await run("delete from reports where reporter_id = $1", [userId]);
  await run("delete from reports_reviewed where reporter_id = $1", [userId]);
  // Both ways: the blocks they made, and the ones made against them (there is nobody left to block).
  await run("delete from blocks where blocker_id = $1 or blocked_id = $1", [userId]);
  await run("delete from orders where user_id = $1", [userId]);
  await run("delete from badges where user_id = $1", [userId]);
  await run("delete from free_episode_usage where user_id = $1", [userId]);
  await run("delete from pack_episode_usage where user_id = $1", [userId]);
  await run("delete from free_second_date_usage where user_id = $1", [userId]);
  await run("delete from token_grants where user_id = $1", [userId]);
  await run("delete from dealbreaker_guesses where user_id = $1", [userId]);
  await run("delete from matchmaker_proposals where proposer_id = $1", [userId]);
  await run("delete from watch_message_reports where reporter_id = $1", [userId]);
  await run("delete from house_scene_reports where reporter_id = $1", [userId]);
  await run("delete from watch_messages where user_id = $1", [userId]);
  await run("delete from watch_reactions where user_id = $1", [userId]);
  await run("delete from watch_poll_votes where user_id = $1", [userId]);
  await run("delete from watch_presence where user_id = $1", [userId]);
  await run("delete from notifications where user_id = $1", [userId]);
  await run("delete from push_subscriptions where user_id = $1", [userId]);
  await run("delete from email_prefs where user_id = $1", [userId]);
  await run("delete from email_sends where user_id = $1", [userId]);
  await run("delete from couple_follows where user_id = $1", [userId]);
  await run("delete from character_follows where user_id = $1", [userId]);
  await run("delete from arc_predictions where user_id = $1", [userId]);
  await run("delete from situation_votes where user_id = $1", [userId]);
  await run("delete from season_format_votes where user_id = $1", [userId]);
  // Their writing styles and the stories made for them (lib/writing-style.ts, lib/stories.ts).
  await run("delete from writing_prefs where user_id = $1", [userId]);
  await run("delete from stories where owner_id = $1", [userId]);
  // Who they are in scenes (lib/persona.ts).
  await run("delete from personas where user_id = $1", [userId]);
  // Show ideas (lib/show-ideas.ts): their answers, the ideas they proposed, and everyone's answers on those ideas.
  await run("delete from show_idea_votes where user_id = $1 or idea_id in (select id from show_ideas where proposed_by = $1)", [userId]);
  await run("delete from show_ideas where proposed_by = $1", [userId]);
  await run("delete from notification_mutes where user_id = $1", [userId]);
  await run("delete from recoupling_votes where user_id = $1", [userId]);
  await run("delete from cast_backings where user_id = $1", [userId]);
  await run("delete from dare_votes where user_id = $1", [userId]);
  await run("delete from cast_date_weeks where user_id = $1", [userId]);
  await run("delete from weekly_reveal_votes where user_id = $1", [userId]);
  await run("delete from season_pool_entries where user_id = $1", [userId]);
  await run("delete from nudges where user_id = $1", [userId]);
  await run("delete from second_date_requests where user_id = $1", [userId]);
  await run("delete from date_proposals where from_user = $1 or to_user = $1", [userId]);
  await run("delete from user_feedback where user_id = $1", [userId]);
  // Their taps on the Plus tile (lib/plus-interest.ts); an email they left is on the Sunday letter's list, which has its own exit.
  await run("delete from plus_interest where user_id = $1", [userId]);
  // The "Might know" suggestions shown to them (lib/social): the rows about their own characters go with those anyway.
  await run("delete from social_suggestion_log where viewer = $1", [userId]);
  await run("delete from language_seen where actor = $1", [userId]);
  // Site engagement rows logged while signed in (lib/engagement.ts), and every other row from the same browsers.
  await run("delete from web_events where visitor in (select visitor from web_events where user_id = $1)", [userId]);
  await run("delete from web_events where user_id = $1", [userId]);
  // A complaint or takedown request stays as the record of what was reported and what we did; who sent it doesn't.
  await run("update content_reports set reporter_id = null, contact_email = null where reporter_id = $1", [userId]);
  await deleteTheRest(db, userId);
  await run("delete from profiles where user_id = $1", [userId]);
  await deleteAfterDarkData(db, userId);
  await run("delete from accounts where user_id = $1", [userId]);

  return { characters_deleted: charactersDeleted, characters_anonymized: charactersAnonymized };
}

/**
 * What the person-column registry found deleteAccount had missed (lib/person-columns.ts, 2026-11-16): rows keyed to the
 * person under a column nothing above names. Each statement is idempotent, like the rest. What is still kept on purpose
 * (the id on a shared date, a plan Stripe may renew, an admin's name on someone else's row) is listed there with why.
 */
async function deleteTheRest(db: Db, userId: string): Promise<void> {
  const run = (sql: string) => db.query(sql, [userId]);
  // Their votes, ratings and reviews of other people's characters: a review holds their own words.
  await run("delete from character_ratings where rater_id = $1");
  await run("delete from character_reviews where reviewer_id = $1");
  await run("delete from audition_votes where voter_id = $1");
  // The confessional booth (lib/confessionals.ts): their upvotes, and their characters' posts (their own words).
  await run("delete from confessional_votes where voter_id = $1");
  await run("delete from confessionals where owner_id = $1");
  await run("delete from ceremony_votes where user_id = $1");
  // Casting: an audition of a character that stays as a tombstone would keep it in the running; a used invite stays used.
  await run("delete from cast_auditions where owner_id = $1");
  await run("update casting_invites set used_by = null where used_by = $1");
  // Links and plans for dates that can no longer happen: a kept character has no owner to book them.
  await run("delete from date_invites where owner_id = $1");
  await run("delete from double_links where created_by = $1");
  await run("update double_links set taken_by = null where taken_by = $1");
  await run("delete from scheduled_dates where creator_id = $1");
  await run("delete from date_roleplays where proposer_user = $1 or answerer_user = $1");
  await run("delete from scene_suggestions where user_id = $1");
  // Markers, counters and settings.
  await run("delete from thread_reads where user_id = $1");
  await run("delete from afterglow_consents where user_id = $1");
  await run("delete from step_in_usage where user_id = $1");
  await run("delete from user_live_face where user_id = $1");
  await run("delete from live_face_compares where user_id = $1");
  await run("delete from owner_activity where user_id = $1");
  await run("delete from away_reports where owner_id = $1");
  await run("delete from analytics_events where user_id = $1");
  // Admin goes with the account: a deleted admin's id must not still open the admin tools.
  await run("delete from admins where user_id = $1");
  // The operator pass (built, off): the entitlement and its counter go; Stripe's events stay, unlinked, as After Dark's do.
  await run("delete from operator_entitlements where user_id = $1");
  await run("delete from operator_date_usage where user_id = $1");
  await run("update operator_pass_events set user_id = null where user_id = $1");
  // When the id is an agent's: its sessions and call log, its handle and declared model, what it sent as feedback (the
  // votes on that go with it) and its own votes, its one-time link codes and status cursor, and a held job.
  await run("delete from mcp_sessions where agent_id = $1");
  await run("delete from mcp_calls where agent_id = $1");
  await run("delete from agent_status_cursors where agent_id = $1");
  await run("delete from agent_link_codes where agent_id = $1");
  await run("delete from feedback_votes where agent_id = $1");
  await run("delete from agent_feedback where agent_id = $1");
  await run("delete from agent_handles where agent_id = $1");
  await run("delete from agent_models where agent_id = $1");
  await run("delete from job_deals where holder = $1");
  // The record of a claim (lib/account-claim.ts), from either end.
  await run("delete from account_aliases where user_id = $1 or alias_id = $1");
  // The social network (lib/social/): their own characters' circles went with the characters above. What still has their
  // id is on someone else's character (a proposal they answered, a person, place or tie an admin added): it stays, without it.
  await run("update social_ties set created_by = null where created_by = $1");
  await run("update social_ties set answered_by = null where answered_by = $1");
  await run("update social_tie_events set actor = null where actor = $1");
  await run("update social_people set created_by = null where created_by = $1");
  await run("update social_places set created_by = null where created_by = $1");
  await run("update social_place_members set created_by = null where created_by = $1");
}

/** Every After Dark table keyed to a person, and the column it's keyed by: dependents first. */
const AFTER_DARK_OWNED: readonly [string, string][] = [
  ["adult_media_ratings", "user_id"], ["adult_media_thumbs", "owner_id"], ["adult_short_views", "user_id"], ["adult_short_calls", "user_id"],
  ["adult_beats", "owner_id"], ["adult_monologues", "owner_id"], ["adult_monologues", "created_by"], ["adult_voice_lines", "owner_id"], ["adult_reels", "owner_id"],
  // Their characters' presence in the theater (lib/adult/presence.ts): expressions and living portraits.
  ["adult_presence", "owner_id"], ["adult_talks", "owner_id"],
  // What their scene pictures were drawn from (lib/adult/picture-brief.ts).
  ["adult_picture_briefs", "owner_id"],
  ["adult_steps", "owner_id"], ["adult_facts", "owner_id"], ["adult_memories", "owner_id"], ["adult_rejections", "owner_id"],
  // Step in (lib/adult/step-in.ts): their scenes with one character, messages before the scenes they belong to.
  ["adult_step_in_messages", "owner_id"], ["adult_step_in_scenes", "owner_id"], ["adult_step_in_facts", "owner_id"], ["adult_step_in_bonds", "owner_id"],
  ["adult_light_picks", "owner_id"], ["adult_face_refs", "owner_id"], ["adult_nude_refs", "owner_id"], ["adult_identity", "owner_id"],
  // The Studio's shares (as the sharer, and as the one shared with), share settings and saved setups.
  ["adult_shares", "owner_id"], ["adult_shares", "recipient_id"], ["adult_share_prefs", "user_id"], ["adult_studio_setups", "owner_id"],
  ["adult_prefs", "user_id"],
  ["adult_images", "owner_id"], ["adult_studio_shoots", "owner_id"],
  ["adult_steer_resets", "owner_id"], ["adult_shorts", "owner_id"], ["adult_nights", "owner_id"], ["adult_scenes", "owner_id"],
  // The nights that continued an overnight date (lib/adult/overnight.ts).
  ["adult_overnights", "owner_id"],
  ["adult_characters", "owner_id"], ["adult_switches", "owner_id"], ["adult_usage", "owner_id"], ["adult_privacy", "user_id"],
  ["adult_entitlements", "user_id"], ["adult_viewer_places", "user_id"], ["adult_billing_flags", "user_id"], ["adult_tastes", "user_id"],
  // Their Didit age check (lib/adult/age-check.ts): passed or not, when, where.
  ["adult_age_checks", "user_id"],
  // Their request for the invite-only beta (lib/adult/invites.ts: the email and note they sent), and an agent's ask for
  // After Dark (its reason, in its own words). Found by the person-column registry, 2026-11-16.
  ["adult_invites", "user_id"], ["adult_access_requests", "agent_id"],
  // After Dark's own tokens (lib/adult/tokens.ts): what they bought or were given, and what they spent.
  ["adult_token_grants", "user_id"], ["adult_token_usage", "user_id"],
  // The PG Studio's (lib/studio/pg.ts): not After Dark's, but deleted the same way, pictures before their shoots.
  ["studio_pg_pictures", "owner_id"], ["studio_pg_shoots", "owner_id"], ["profile_photos", "owner_id"], ["date_photos", "owner_id"],
  // The Create library's (lib/studio/library.ts): their own prompts, venues and roleplays.
  ["creator_prompts", "owner_id"], ["creator_places", "owner_id"], ["creator_roleplays", "owner_id"],
  // Their exports (lib/media-tools/export.ts): the files in the bucket go first (removeExportsOf), then the rows.
  ["media_exports", "owner_id"],
  // Their ⭐ favorites (app/after-dark/FavoriteStar.tsx).
  ["media_favorites", "owner_id"],
  // The showcase (lib/showcase.ts): the OKs they gave or were asked for, their posts, and their creator page.
  ["showcase_consents", "owner_id"], ["showcase_likes", "user_id"], ["showcase_views", "viewer_id"], ["creator_follows", "follower_id"], ["creator_follows", "creator_id"],
  ["showcase_posts", "owner_id"], ["creator_profiles", "user_id"], ["showcase_loops", "owner_id"],
  // Their identity packs' views, in both Studios (lib/studio/identity-pack.ts).
  ["identity_views", "owner_id"],
];

/**
 * Billing records kept, unlinked, when an account is deleted (lib/adult/billing.ts): the orders and the processors'
 * postbacks are what a chargeback dispute or a card network's audit asks for, so they stay with user_id cleared. They
 * hold no name, email, address, IP or card digits (only our order id, the processor's ids, amounts and dates), so once
 * unlinked nothing in them points back at the person. The chargeback flag is the person's and goes with the account.
 */
const AFTER_DARK_UNLINKED: readonly string[] = ["adult_billing_orders", "adult_billing_events"];

/**
 * After Dark's part of deleting an account (2026-10-24, the privacy notice's promise): everything the person made, chose
 * or rated there, their subscription record, their last-seen place and any chargeback flag; their billing orders and
 * postbacks are kept unlinked (AFTER_DARK_UNLINKED). The tables point at one another in places, so a
 * delete a reference still blocks is tried again on the next pass; a table that doesn't exist yet is skipped. Their
 * files in Bunny and the bucket go with the rows: each row's trigger queues its file, deleted a week later
 * (lib/media-deletions.ts).
 */
export async function deleteAfterDarkData(db: Db, userId: string): Promise<void> {
  // Their exports' files in the bucket first (lib/media-tools/export.ts): the rows below are all that points at them.
  await (await import("./media-tools/export")).removeExportsOf(db, userId).catch(() => {});
  for (const table of AFTER_DARK_UNLINKED) {
    await db.query(`update ${table} set user_id = null where user_id = $1`, [userId]).catch((err: unknown) => {
      if (!/does not exist/.test(err instanceof Error ? err.message : "")) throw err;
    });
  }
  // The PG notes their nights left in characters' shared memory (lib/character-memories.ts) go with the notes.
  await db
    .query(
      `delete from character_episodes e using adult_memories m
        where m.owner_id = $1 and e.source = 'after_dark_note' and e.character_id = m.character_id and e.source_ref = m.other_id`,
      [userId],
    )
    .catch(() => {});
  let left = [...AFTER_DARK_OWNED];
  for (let pass = 0; pass < 4 && left.length; pass++) {
    const blocked: [string, string][] = [];
    for (const [table, column] of left) {
      await db.query(`delete from ${table} where ${column} = $1`, [userId]).catch((err: unknown) => {
        if (!/does not exist/.test(err instanceof Error ? err.message : "")) blocked.push([table, column]);
      });
    }
    left = blocked;
  }
  if (left.length) throw new Error(`After Dark data left after deleting an account: ${left.map(([t]) => t).join(", ")}`);
}

export type AdminRemoval = { id: string; name: string | null; outcome: "deleted" | "anonymized" | "house" | "not_found" };

/**
 * The admin takes characters off the show (2026-10-20: test characters left on production by checks run by hand). Each
 * goes the way its owner's own delete would (deleteCharacter): a character never in an episode is deleted outright, one
 * that is keeps its sheet for those episodes but loses its owner, soul and memory, and drops out of every list. House
 * characters are never removed here.
 */
export async function adminRemoveCharacters(db: Db, ids: string[]): Promise<AdminRemoval[]> {
  const out: AdminRemoval[] = [];
  for (const id of ids) {
    const row = (await db.query<{ name: string; owner_id: string | null; is_house: boolean }>(`select name, owner_id, is_house from characters where id = $1`, [id])).rows[0];
    if (!row) {
      out.push({ id, name: null, outcome: "not_found" });
      continue;
    }
    if (row.is_house) {
      out.push({ id, name: row.name, outcome: "house" });
      continue;
    }
    // An ownerless character (never claimed) is detached the same way, under the deleted owner.
    const owner = row.owner_id ?? DELETED_OWNER;
    if (!row.owner_id) await db.query(`update characters set owner_id = $2 where id = $1 and owner_id is null`, [id, DELETED_OWNER]);
    const r = await deleteCharacter(db, owner, id);
    if (!r.deleted) await db.query(`update characters set open_to_dates = false where id = $1`, [id]);
    // Off the showcase too, the show's own living portraits of them included (2026-10-30: five stayed in the reels).
    await db.query(`update showcase_posts set status = 'removed' where (character_id = $1 or character_b = $1) and status <> 'removed'`, [id]);
    out.push({ id, name: row.name, outcome: r.deleted ? "deleted" : "anonymized" });
  }
  return out;
}
