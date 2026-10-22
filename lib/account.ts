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
import type { Db } from "./db";
import { getPoints } from "./game";
import { DELETED_OWNER } from "./rules";

/** The owner link set on a character that must stay (it's in a shared episode) after its owner deletes. */
export { DELETED_OWNER };

export type AccountExport = {
  exported_at: string;
  user_id: string;
  profile: { name: string; attested_adult_at: string } | null;
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
  /** What the user told their characters to forget. */
  memory_forgets: Record<string, unknown>[];
  /** Their characters' reflections on each date (show-written or their own), by episode and character. */
  reflections: Record<string, unknown>[];
  reflection_labels: Record<string, unknown>[];
  /** Saved provider keys: the provider, last four and model only (the key itself is never exported or shown). */
  provider_keys: Record<string, unknown>[];
  /** Between dates (lib/between-dates.ts): their characters' texts, the nudges they left, their second-date yeses. */
  couple_texts: Record<string, unknown>[];
  nudges: Record<string, unknown>[];
  second_date_yeses: Record<string, unknown>[];
  /** Dates they proposed to another owner's character, or were proposed (lib/date-proposals.ts). */
  date_proposals: Record<string, unknown>[];
  /** The swipe deck (lib/swipes.ts): their characters' own swipes (never anyone's likes on them: those stay secret), and their matches. */
  swipes: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  /** The couples they follow, their arc predictions, their notifications and where browser push goes (host only). */
  couple_follows: Record<string, unknown>[];
  arc_predictions: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  push_subscriptions: Record<string, unknown>[];
  /** Email notifications: the address, whether it's on, and how many emails were sent (lib/email.ts). */
  email: Record<string, unknown>[];
  /** Feedback they sent from the site (lib/user-feedback.ts): what they wrote and what was captured with it. */
  feedback: Record<string, unknown>[];
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
};

/** Everything stored under this user id, as JSON. Owner-only (the route checks the cookie is the user). */
export async function exportAccount(db: Db, userId: string): Promise<AccountExport> {
  const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
  const profileRows = await q("select name, attested_adult_at from profiles where user_id = $1", [userId]);
  const profile = profileRows[0]
    ? { name: String(profileRows[0].name), attested_adult_at: String(profileRows[0].attested_adult_at) }
    : null;
  return {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile,
    points: await getPoints(db, userId),
    characters: await q(
      `select id, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, premium_sku, pronouns, voice, extras,
              this_week, open_to_dates, created_via, created_at
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
    provider_keys: await q("select provider, kind, last4, model, created_at from user_keys where user_id = $1", [userId]),
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
      `select e.character_a, e.character_b, e.layer, e.from_stage, e.to_stage, e.episode_id, e.at from relationship_events e
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
    second_date_yeses: await q("select episode_id, created_at from second_date_requests where user_id = $1", [userId]),
    date_proposals: await q(
      "select from_character, to_character, status, created_at, decided_at, case when from_user = $1 then 'sent' else 'received' end as direction from date_proposals where from_user = $1 or to_user = $1 order by created_at",
      [userId],
    ),
    couple_follows: await q("select character_lo, character_hi, created_at from couple_follows where user_id = $1", [userId]),
    arc_predictions: await q("select character_lo, character_hi, target, pick, created_at, resolved_at, outcome from arc_predictions where user_id = $1", [userId]),
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
    ml_consent: await q("select granted, version, decided_at from ml_consents where user_id = $1", [userId]),
    choice_history: await q("select kind, episode_id, character_id, other_id, value, at from choice_history where user_id = $1 order by at", [userId]),
    turn_drafts: await q(
      `select d.episode_id, d.turn_index, d.side, d.source, d.reason, d.rejected, d.created_at from turn_drafts d join episodes e on e.id = d.episode_id
        where exists (select 1 from characters c where c.owner_id = $1 and not c.is_house
                        and c.id = case when d.side = 'a' then e.character_a else e.character_b end)
        order by d.created_at`,
      [userId],
    ),
  };
}

/**
 * Removes a character's private learned layer: its memory (which holds how it felt about each person), what it was
 * told to forget, and its reflections on its dates. Run before a character becomes a tombstone (kept only because
 * a shared episode still shows it), so nothing private outlives its owner. The episodes themselves stay.
 */
async function forgetEverything(db: Db, characterIds: string[]): Promise<void> {
  if (!characterIds.length) return;
  await db.query("delete from character_memory where character_id = any($1)", [characterIds]);
  await db.query("delete from memory_forgets where character_id = any($1)", [characterIds]);
  // Their texts between dates and any notes about them (lib/between-dates.ts) go too; the shared episodes stay.
  await db.query("delete from couple_texts where character_lo = any($1) or character_hi = any($1)", [characterIds]);
  await db.query("delete from nudges where character_id = any($1) or other_id = any($1)", [characterIds]);
  await db.query("delete from swipes where swiper = any($1) or target = any($1)", [characterIds]);
  await db.query("delete from matches where character_lo = any($1) or character_hi = any($1)", [characterIds]);
  // The data plan's logs about them (lib/db.ts, Tier 1): the decks they saw and were shown in, and their pairs' timelines.
  await db.query("delete from swipe_impressions where viewer = any($1) or card = any($1)", [characterIds]);
  await db.query("delete from relationship_events where character_a = any($1) or character_b = any($1)", [characterIds]);
  await db.query("delete from choice_history where character_id = any($1) or other_id = any($1)", [characterIds]);
  // Lines that didn't go in on their dates: the dates themselves stay (shared), the drafts about them don't.
  await db.query(
    "delete from turn_drafts d using episodes e where e.id = d.episode_id and (e.character_a = any($1) or e.character_b = any($1))",
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
}

export type CharacterDeletion = { deleted: boolean; anonymized: boolean };

/**
 * Deletes one of the user's characters. Mirrors account deletion for a single character: a character never
 * used in an episode is hard-deleted (cascading its soul, assets, relationships and proposals); one already
 * in a shared episode keeps its fictional sheet but loses its private soul and its owner link (a tombstone),
 * so the episode other viewers saw still renders. Owner-checked by the caller; returns what happened.
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
      // Closed to dates too: a retired character must leave everyone's swipe deck (#260).
      "update characters set owner_id = $3, open_to_dates = false where id = $1 and owner_id = $2 and not is_house returning id",
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
  const run = (sql: string, params: unknown[] = []) => db.query(sql, params);
  const returning = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows.length;

  // 1. The private souls of this user's characters (the most sensitive personal data), before any
  //    character is kept as a tombstone.
  await run("delete from souls where character_id in (select id from characters where owner_id = $1)", [userId]);

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
  const charactersAnonymized = await returning(
    // Closed to dates too: a deleted creator's character must never be asked out or blind-matched again.
    "update characters set owner_id = $2, open_to_dates = false where owner_id = $1 and not is_house returning id",
    [userId, DELETED_OWNER],
  );

  // 4. Everything else keyed to the user id.
  await run("delete from league_members where user_id = $1", [userId]);
  await run("delete from leagues where owner_id = $1", [userId]); // cascades its remaining members
  await run("delete from predictions where user_id = $1", [userId]);
  await run("delete from identity_consents where user_id = $1", [userId]);
  await run("delete from ml_consents where user_id = $1", [userId]);
  await run("delete from choice_history where user_id = $1", [userId]);
  await run("delete from reports where reporter_id = $1", [userId]);
  await run("delete from reports_reviewed where reporter_id = $1", [userId]);
  await run("delete from blocks where blocker_id = $1", [userId]);
  await run("delete from orders where user_id = $1", [userId]);
  await run("delete from badges where user_id = $1", [userId]);
  await run("delete from free_episode_usage where user_id = $1", [userId]);
  await run("delete from pack_episode_usage where user_id = $1", [userId]);
  await run("delete from free_second_date_usage where user_id = $1", [userId]);
  await run("delete from token_grants where user_id = $1", [userId]);
  await run("delete from dealbreaker_guesses where user_id = $1", [userId]);
  await run("delete from matchmaker_proposals where proposer_id = $1", [userId]);
  await run("delete from watch_message_reports where reporter_id = $1", [userId]);
  await run("delete from watch_messages where user_id = $1", [userId]);
  await run("delete from watch_reactions where user_id = $1", [userId]);
  await run("delete from watch_poll_votes where user_id = $1", [userId]);
  await run("delete from watch_presence where user_id = $1", [userId]);
  await run("delete from notifications where user_id = $1", [userId]);
  await run("delete from push_subscriptions where user_id = $1", [userId]);
  await run("delete from email_prefs where user_id = $1", [userId]);
  await run("delete from email_sends where user_id = $1", [userId]);
  await run("delete from couple_follows where user_id = $1", [userId]);
  await run("delete from arc_predictions where user_id = $1", [userId]);
  await run("delete from nudges where user_id = $1", [userId]);
  await run("delete from second_date_requests where user_id = $1", [userId]);
  await run("delete from date_proposals where from_user = $1 or to_user = $1", [userId]);
  await run("delete from user_feedback where user_id = $1", [userId]);
  await run("delete from profiles where user_id = $1", [userId]);
  await run("delete from accounts where user_id = $1", [userId]);

  return { characters_deleted: charactersDeleted, characters_anonymized: charactersAnonymized };
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
    out.push({ id, name: row.name, outcome: r.deleted ? "deleted" : "anonymized" });
  }
  return out;
}
