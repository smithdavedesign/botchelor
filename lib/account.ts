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

/** The owner link set on a character that must stay (it's in a shared episode) after its owner deletes. */
export const DELETED_OWNER = "deleted";

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
  /** Saved provider keys: the provider, last four and model only (the key itself is never exported or shown). */
  provider_keys: Record<string, unknown>[];
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
    provider_keys: await q("select provider, kind, last4, model, created_at from user_keys where user_id = $1", [userId]),
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
  await db.query(
    `update episodes set reflections = jsonb_build_object(
        'a', case when character_a = any($1) then null else reflections->'a' end,
        'b', case when character_b = any($1) then null else reflections->'b' end)
      where reflections is not null and (character_a = any($1) or character_b = any($1))`,
    [characterIds],
  );
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
      "update characters set owner_id = $3 where id = $1 and owner_id = $2 and not is_house returning id",
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
    "update characters set owner_id = $2 where owner_id = $1 and not is_house returning id",
    [userId, DELETED_OWNER],
  );

  // 4. Everything else keyed to the user id.
  await run("delete from league_members where user_id = $1", [userId]);
  await run("delete from leagues where owner_id = $1", [userId]); // cascades its remaining members
  await run("delete from predictions where user_id = $1", [userId]);
  await run("delete from identity_consents where user_id = $1", [userId]);
  await run("delete from reports where reporter_id = $1", [userId]);
  await run("delete from reports_reviewed where reporter_id = $1", [userId]);
  await run("delete from blocks where blocker_id = $1", [userId]);
  await run("delete from orders where user_id = $1", [userId]);
  await run("delete from badges where user_id = $1", [userId]);
  await run("delete from free_episode_usage where user_id = $1", [userId]);
  await run("delete from pack_episode_usage where user_id = $1", [userId]);
  await run("delete from dealbreaker_guesses where user_id = $1", [userId]);
  await run("delete from matchmaker_proposals where proposer_id = $1", [userId]);
  await run("delete from watch_message_reports where reporter_id = $1", [userId]);
  await run("delete from watch_messages where user_id = $1", [userId]);
  await run("delete from watch_reactions where user_id = $1", [userId]);
  await run("delete from watch_poll_votes where user_id = $1", [userId]);
  await run("delete from watch_presence where user_id = $1", [userId]);
  await run("delete from profiles where user_id = $1", [userId]);
  await run("delete from accounts where user_id = $1", [userId]);

  return { characters_deleted: charactersDeleted, characters_anonymized: charactersAnonymized };
}
