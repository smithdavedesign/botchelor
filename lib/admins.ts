/**
 * Admins: the accounts that claimed admin by entering the admin password once on /admin (the same password that
 * gates the admin tools, FRONTIER_PASSWORD). It's for the show's owner: an admin skips the clip paywall (no tokens
 * spent), though a clip still runs on their own Google key.
 */
import type { Db } from "./db";

export async function isAdmin(db: Db, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await db.query("select 1 from admins where user_id = $1", [userId]);
  return rows.length > 0;
}

/** Free dates for an admin's own account (testing the show without buying): 20 at a time. */
export const ADMIN_TOKEN_GRANT = 20;

export async function grantTokens(db: Db, userId: string, episodes: number, grantedBy: string): Promise<void> {
  await db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, $4)`, [crypto.randomUUID(), userId, episodes, grantedBy]);
}

export async function claimAdmin(db: Db, userId: string): Promise<void> {
  await db.query("insert into admins (user_id) values ($1) on conflict do nothing", [userId]);
}

export async function releaseAdmin(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query("delete from admins where user_id = $1 returning user_id", [userId]);
  return rows.length > 0;
}
