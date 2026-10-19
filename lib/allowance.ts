import type { Db } from "./db";
import { FREE_EPISODES_PER_SEASON } from "./rules";
import { weekAt } from "./seasons";

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

export type Reservation = { source: "free"; season_id: string } | { source: "pack" } | { source: "second_date"; season_id: string };

/** Dates bought: the episodes on the user's paid pack orders. A refunded order stops counting. */
/** Pack dates an account has: its paid packs plus any an admin granted (token_grants). `who` is the user id SQL. */
export const packDatesSql = (who: string) => `((select coalesce(sum(o.episodes), 0)::int from orders o
                                where o.user_id = ${who} and o.kind = 'episode_pack' and o.status = 'paid')
                              + (select coalesce(sum(g.episodes), 0)::int from token_grants g where g.user_id = ${who}))`;
const PACK_EPISODES_BOUGHT = packDatesSql("$1");

function allowance(now: Date, freeUsed: number, packBought: number, packUsed: number): Allowance {
  const season = weekAt(now);
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
    [userId, weekAt(now).id],
  );
  const { free_used, pack_bought, pack_used } = rows[0];
  return allowance(now, free_used, pack_bought, pack_used);
}

/** Takes one date: a free one this season if any is left, else a pack date; null when none is left. */
export async function reserveEpisode(db: Db, userId: string, now = new Date()): Promise<Reservation | null> {
  const season = weekAt(now).id;
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

/**
 * A free second date: when FREE_WEEKLY_SECOND_DATE=1, the first second date an owner books each season (week) costs
 * no date, so a couple that both wanted another can have it (docs/relationship-sim-evidence.md: in 30 days live, 22
 * dates ended mutual and only 4 second dates were booked). Off by default; it's the owner's pricing call. About 1¢ of
 * model per free date.
 */
export function freeSecondDateOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.FREE_WEEKLY_SECOND_DATE === "1";
}

/** Takes this season's free second date, or null when it's off or already used. */
export async function reserveSecondDate(db: Db, userId: string, now = new Date(), env: Record<string, string | undefined> = process.env): Promise<Reservation | null> {
  if (!freeSecondDateOn(env)) return null;
  const season = weekAt(now).id;
  const taken = await db.query(
    `insert into free_second_date_usage (user_id, season_id) values ($1, $2) on conflict (user_id, season_id) do nothing returning user_id`,
    [userId, season],
  );
  return taken.rows.length ? { source: "second_date", season_id: season } : null;
}

/** Whether this season's free second date is still there for the user (false when the offer is off). */
export async function secondDateFreeNow(db: Db, userId: string, now = new Date(), env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!freeSecondDateOn(env)) return false;
  const used = await db.query(`select 1 from free_second_date_usage where user_id = $1 and season_id = $2`, [userId, weekAt(now).id]);
  return used.rows.length === 0;
}

/** Gives back a date reserved for an episode that was never saved. Never goes below zero. */
export async function releaseEpisode(db: Db, userId: string, reservation: Reservation): Promise<void> {
  if (reservation.source === "second_date") {
    await db.query("delete from free_second_date_usage where user_id = $1 and season_id = $2", [userId, reservation.season_id]);
    return;
  }
  if (reservation.source === "free") {
    await db.query(
      "update free_episode_usage set used = used - 1 where user_id = $1 and season_id = $2 and used > 0",
      [userId, reservation.season_id],
    );
  } else {
    await db.query("update pack_episode_usage set used = used - 1 where user_id = $1 and used > 0", [userId]);
  }
}

/* ------------------------------------ bought tokens (the clip paywall) ------------------------------------ */

/**
 * What an intro clip costs in BOUGHT tokens (the ones from a pack: tokens are dates, a pack is 5). Clips are a
 * paid extra: the weekly free tokens stay for dates. Admins skip it (lib/admins.ts).
 */
export const CLIP_TOKEN_COST = 1;

/**
 * What setting the scene costs (David, 2026-10-19: "set the venue to any scene… for 1 token"): a bought token, like a
 * clip, given back when the place is refused or the move doesn't happen.
 */
export const SET_SCENE_TOKEN_COST = 1;

/** Spends `n` bought tokens if the user has them; false (nothing spent) when they don't. One conditional upsert. */
export async function spendBoughtTokens(db: Db, userId: string, n: number): Promise<boolean> {
  const { rows } = await db.query(
    `insert into pack_episode_usage as u (user_id, used)
     select $1, $2::int where ${PACK_EPISODES_BOUGHT} >= $2::int
     on conflict (user_id) do update set used = u.used + $2::int where u.used + $2::int <= ${PACK_EPISODES_BOUGHT}
     returning used`,
    [userId, n],
  );
  return rows.length > 0;
}

/** Gives back `n` bought tokens (a clip that never got made). Never below zero. */
export async function refundBoughtTokens(db: Db, userId: string, n: number): Promise<void> {
  await db.query("update pack_episode_usage set used = greatest(0, used - $2::int) where user_id = $1", [userId, n]);
}
