import type { Db } from "./db";
import { FREE_EPISODES_PER_SEASON } from "./rules";
import { seasonAt } from "./seasons";

/**
 * How many dates a creator can still send their characters on (M4): FREE_EPISODES_PER_SEASON each
 * season, then the dates from episode packs, which never expire. Packs add dates, never points.
 *
 * A date is reserved before the showrunner call and released if no episode is saved, so parallel
 * requests can't overspend during the seconds a model call takes. Each reservation is one conditional
 * upsert: under READ COMMITTED, Postgres locks the conflicting row and re-checks `used < limit`
 * against its latest version, so the limit holds without a transaction or an advisory lock.
 */

export type Allowance = {
  season_id: string;
  /** When this season's free dates come back (next Monday 00:00 UTC). */
  resets_at: string;
  free_per_season: number;
  free_left: number;
  pack_left: number;
  left: number;
};

export type Reservation = { source: "free"; season_id: string } | { source: "pack" };

/** Dates bought: the episodes on the user's paid pack orders. A refunded order stops counting. */
const PACK_EPISODES_BOUGHT = `(select coalesce(sum(o.episodes), 0)::int from orders o
                                where o.user_id = $1 and o.kind = 'episode_pack' and o.status = 'paid')`;

function allowance(now: Date, freeUsed: number, packBought: number, packUsed: number): Allowance {
  const season = seasonAt(now);
  const free_left = Math.max(0, FREE_EPISODES_PER_SEASON - freeUsed);
  const pack_left = Math.max(0, packBought - packUsed);
  return {
    season_id: season.id,
    resets_at: season.ends_at,
    free_per_season: FREE_EPISODES_PER_SEASON,
    free_left,
    pack_left,
    left: free_left + pack_left,
  };
}

/** A visitor without a session: a full week of free dates, no packs. Touches no database. */
export const freshAllowance = (now = new Date()): Allowance => allowance(now, 0, 0, 0);

export async function episodeAllowance(db: Db, userId: string | null, now = new Date()): Promise<Allowance> {
  if (!userId) return freshAllowance(now);
  const { rows } = await db.query<{ free_used: number; pack_bought: number; pack_used: number }>(
    `select coalesce((select used from free_episode_usage where user_id = $1 and season_id = $2), 0)::int as free_used,
            ${PACK_EPISODES_BOUGHT} as pack_bought,
            coalesce((select used from pack_episode_usage where user_id = $1), 0)::int as pack_used`,
    [userId, seasonAt(now).id],
  );
  const { free_used, pack_bought, pack_used } = rows[0];
  return allowance(now, free_used, pack_bought, pack_used);
}

/** Takes one date: a free one this season if any is left, else a pack date; null when none is left. */
export async function reserveEpisode(db: Db, userId: string, now = new Date()): Promise<Reservation | null> {
  const season = seasonAt(now).id;
  const free = await db.query(
    `insert into free_episode_usage as u (user_id, season_id, used) values ($1, $2, 1)
     on conflict (user_id, season_id) do update set used = u.used + 1 where u.used < $3
     returning used`,
    [userId, season, FREE_EPISODES_PER_SEASON],
  );
  if (free.rows.length) return { source: "free", season_id: season };

  const pack = await db.query(
    `insert into pack_episode_usage as u (user_id, used)
     select $1, 1 where ${PACK_EPISODES_BOUGHT} > 0
     on conflict (user_id) do update set used = u.used + 1 where u.used < ${PACK_EPISODES_BOUGHT}
     returning used`,
    [userId],
  );
  return pack.rows.length ? { source: "pack" } : null;
}

/** Gives back a date reserved for an episode that was never saved. Never goes below zero. */
export async function releaseEpisode(db: Db, userId: string, reservation: Reservation): Promise<void> {
  if (reservation.source === "free") {
    await db.query(
      "update free_episode_usage set used = used - 1 where user_id = $1 and season_id = $2 and used > 0",
      [userId, reservation.season_id],
    );
  } else {
    await db.query("update pack_episode_usage set used = used - 1 where user_id = $1 and used > 0", [userId]);
  }
}
