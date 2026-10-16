/**
 * Spectators follow couples: anyone can follow a pair whose dates aired publicly, and hears (lib/notifications.ts)
 * when they go on another public date or move up a stage. Following is per person and private: the page only shows
 * how many follow.
 */
import type { Db } from "./db";
import { pairKey } from "./relationships";

export async function followCouple(db: Db, userId: string, x: string, y: string): Promise<boolean> {
  const [lo, hi] = pairKey(x, y);
  const listed = (await db.query(`select 1 from relationships where character_a = $1 and character_b = $2 and public_dates > 0`, [lo, hi])).rows.length > 0;
  if (!listed) return false;
  await db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ($1, $2, $3) on conflict do nothing`, [userId, lo, hi]);
  return true;
}

export async function unfollowCouple(db: Db, userId: string, x: string, y: string): Promise<void> {
  const [lo, hi] = pairKey(x, y);
  await db.query(`delete from couple_follows where user_id = $1 and character_lo = $2 and character_hi = $3`, [userId, lo, hi]);
}

export async function followerIds(db: Db, x: string, y: string): Promise<string[]> {
  const [lo, hi] = pairKey(x, y);
  return (await db.query<{ user_id: string }>(`select user_id from couple_follows where character_lo = $1 and character_hi = $2`, [lo, hi])).rows.map((r) => r.user_id);
}

export async function followState(db: Db, userId: string | null, x: string, y: string): Promise<{ following: boolean; followers: number }> {
  const [lo, hi] = pairKey(x, y);
  const { rows } = await db.query<{ n: number; me: boolean }>(
    `select count(*)::int as n, coalesce(bool_or(user_id = $3::text), false) as me
       from couple_follows where character_lo = $1 and character_hi = $2`,
    [lo, hi, userId],
  );
  return { following: rows[0]?.me ?? false, followers: rows[0]?.n ?? 0 };
}
