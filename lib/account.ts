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
      `select id, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, premium_sku, created_at
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
  };
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
  // 3. Characters still referenced by a shared episode: detach ownership (fictional sheet stays, soul gone).
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

  return { characters_deleted: charactersDeleted, characters_anonymized: charactersAnonymized };
}
