/**
 * The season pool (docs/audits/2026-11-07-audit-and-benchmark.md, item 8): one season score and one board, revealed
 * when the season closes — as Love Island reveals its prediction game before Aftersun. The parts were all on the show
 * already; this joins them:
 *
 *  - The score: every point a viewer earned in the season's window, the way each part already scores it (lib/rules.ts):
 *    ending and drama calls on public dates that aired in it, arc calls settled in it, dealbreaker guesses on its public
 *    dates, dares voted on its days (settled by verdict, lib/dare-points.ts), and the backing (lib/backing.ts) when the
 *    pick ended the season coupled. The MCP's get_leaderboard reads the same score (lib/leagues.ts seasonStanding).
 *  - During the season the board stays hidden: a viewer sees their own score and place, how many play and the top
 *    score, nobody's name. When the season closes, the first lobby pass after it settles the backings, freezes every
 *    player's place (ties share one) and tells each player where they finished. The finale page (/seasons/<month>) and
 *    the Reunion show the frozen board.
 *  - Who's ranked: people and outside agents. The show's own accounts (admins, our traffic and test characters,
 *    lib/our-traffic.ts loadOurIds) score but aren't ranked, so the house never wins its own game; house-run bots can't
 *    score at all (lib/house-bots.ts). Names: a display name when the player has one (read live, so a rename or a
 *    removed name shows as it is now), else "A viewer" or "An AI agent".
 *  - $0: reads of rows the show already has, cached a few minutes while the season runs; one freeze a season.
 */
import type { Db } from "./db";
import { settleSeasonBackings } from "./backing";
import { predictionPointsSql } from "./game";
import { notifyAll } from "./notifications";
import { loadOurIds } from "./our-traffic";
import { POINTS_PER_ARC, POINTS_PER_BACKING, POINTS_PER_CORRECT_PICK, POINTS_PER_DEALBREAKER_PICK, POINTS_PER_DRAMA_PICK } from "./rules";
import { isMonthlySeason, seasonPath } from "./season-ref";
import { seasonIdOf, seasonLabel, seasonWindow } from "./season-window";
import { sharedStale } from "./shared-cache";

/** How many places the revealed board lists. */
export const POOL_SHOWN = 10;
/** How long the live scores are kept between reads while the season runs (the place may be minutes old). */
export const POOL_TTL_MS = 5 * 60 * 1000;
/** A freeze claimed this long ago with nothing written died half-way: the next pass takes it over. */
const CLAIM_STALE_MS = 5 * 60 * 1000;
/** How long after a season closes /watch keeps showing its revealed board. */
export const REVEALED_SHOWN_DAYS = 7;

export type PoolScore = { user_id: string; points: number; calls_right: number; agent: boolean };

/**
 * Everyone's season score, the most first, the show's own accounts left out (they score, but aren't ranked). Only
 * players with points. Ties: more right calls first, then the id, so the order is stable.
 */
export async function poolScores(db: Db, seasonId: string): Promise<PoolScore[]> {
  const { start, end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  const [ours, scored] = await Promise.all([
    loadOurIds(db).catch(() => [] as string[]),
    db.query<{ user_id: string; points: number; calls_right: number; agent: boolean }>(
      `with s as (
         select p.user_id, ${predictionPointsSql("$3", "$4")} as points, (case when p.pick = e.ending then 1 else 0 end) as right_call
           from predictions p join episodes e on e.id = p.episode_id
          where e.revealed_at >= $1 and e.revealed_at < $2 and e.visibility = 'public'
         union all
         select ap.user_id, case when ap.pick = ap.outcome then $5::int else 0 end, 0
           from arc_predictions ap
          where ap.resolved_at >= $1 and ap.resolved_at < $2
         union all
         select g.user_id, $6::int, 0
           from dealbreaker_guesses g
           join episodes e on e.id = g.episode_id
           join characters a on a.id = e.character_a
          where e.revealed_at >= $1 and e.revealed_at < $2 and e.visibility = 'public' and g.pick = a.dealbreaker
         union all
         select dv.user_id, coalesce(dv.points, 0), 0
           from dare_votes dv
          where dv.settled_at is not null and dv.day >= $8 and dv.day < $9
         union all
         select cb.user_id, $7::int, 0
           from cast_backings cb
          where cb.season_id = $8 and cb.won
       )
       select s.user_id, sum(s.points)::int as points, sum(s.right_call)::int as calls_right,
              exists (select 1 from mcp_sessions m where m.agent_id = s.user_id) as agent
         from s
        group by s.user_id
       having sum(s.points) > 0
        order by points desc, calls_right desc, s.user_id`,
      [
        start.toISOString(),
        end.toISOString(),
        POINTS_PER_CORRECT_PICK,
        POINTS_PER_DRAMA_PICK,
        POINTS_PER_ARC,
        POINTS_PER_DEALBREAKER_PICK,
        POINTS_PER_BACKING,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      ],
    ),
  ]);
  const skip = new Set(ours);
  return scored.rows.filter((r) => !skip.has(r.user_id));
}

/** Places for scores in order, Olympic style: a tie shares the place, and the next place skips past it. */
export function placesOf(points: readonly number[]): number[] {
  return points.map((p, i) => (i > 0 && p === points[i - 1] ? -1 : i + 1)).map((place, i, all) => {
    let j = i;
    while (all[j] === -1) j--;
    return all[j];
  });
}

/** The viewer's own score this season, from the full score list (they may score unranked: one of the show's accounts). */
async function ownPoints(db: Db, seasonId: string, userId: string): Promise<number> {
  const { start, end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  const { rows } = await db.query<{ points: number }>(
    `select (coalesce((select sum(${predictionPointsSql("$4", "$5")}) from predictions p join episodes e on e.id = p.episode_id
                        where p.user_id = $1 and e.revealed_at >= $2 and e.revealed_at < $3 and e.visibility = 'public'), 0)
           + coalesce((select count(*) * $6 from arc_predictions ap where ap.user_id = $1 and ap.resolved_at >= $2 and ap.resolved_at < $3 and ap.pick = ap.outcome), 0)
           + coalesce((select count(*) * $7 from dealbreaker_guesses g join episodes e on e.id = g.episode_id join characters a on a.id = e.character_a
                        where g.user_id = $1 and e.revealed_at >= $2 and e.revealed_at < $3 and e.visibility = 'public' and g.pick = a.dealbreaker), 0)
           + coalesce((select sum(dv.points) from dare_votes dv where dv.user_id = $1 and dv.settled_at is not null and dv.day >= $9 and dv.day < $10), 0)
           + coalesce((select count(*) * $8 from cast_backings cb where cb.user_id = $1 and cb.season_id = $9 and cb.won), 0))::int as points`,
    [
      userId,
      start.toISOString(),
      end.toISOString(),
      POINTS_PER_CORRECT_PICK,
      POINTS_PER_DRAMA_PICK,
      POINTS_PER_ARC,
      POINTS_PER_DEALBREAKER_PICK,
      POINTS_PER_BACKING,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    ],
  );
  return rows[0]?.points ?? 0;
}

export type PoolStanding = {
  season_id: string;
  points: number;
  /** Their place among the ranked players (ties share it); null with no points, or for one of the show's own accounts. */
  place: number | null;
  players: number;
  /** The top score so far (no name: the board is revealed when the season closes). */
  leader: number;
  /** When the board is revealed: the season's close. */
  reveals_at: string;
};

/** Where a viewer stands in the running season's pool (the board itself stays hidden until it closes). */
export async function poolStanding(db: Db, viewerId: string | null, now: Date = new Date()): Promise<PoolStanding> {
  const seasonId = seasonIdOf(now);
  const scores = await sharedStale(`season-pool:${seasonId}`, () => poolScores(db, seasonId), POOL_TTL_MS);
  const places = placesOf(scores.map((s) => s.points));
  const i = viewerId ? scores.findIndex((s) => s.user_id === viewerId) : -1;
  const points = i >= 0 ? scores[i].points : viewerId ? await ownPoints(db, seasonId, viewerId).catch(() => 0) : 0;
  return {
    season_id: seasonId,
    points,
    place: i >= 0 ? places[i] : null,
    players: scores.length,
    leader: scores[0]?.points ?? 0,
    reveals_at: seasonWindow(now).end.toISOString(),
  };
}

export type PoolFreeze = { season_id: string; frozen: boolean; players: number; notified: number };

/**
 * Freezes a closed monthly season's pool, once: settles its backings first (lib/backing.ts, idempotent), then writes
 * every ranked player's place. A claim that died half-way is taken over after CLAIM_STALE_MS. Players are told where
 * they finished, once (notified_at).
 */
export async function freezeSeasonPool(db: Db, seasonId: string, now: Date = new Date()): Promise<PoolFreeze> {
  const none = { season_id: seasonId, frozen: false, players: 0, notified: 0 };
  if (!isMonthlySeason(seasonId) || seasonId >= seasonIdOf(now)) return none;
  const claimed = await db.query(`insert into season_pools (season_id) values ($1) on conflict do nothing returning season_id`, [seasonId]);
  if (!claimed.rows.length) {
    const taken = await db.query(
      `update season_pools set claimed_at = now() where season_id = $1 and frozen_at is null and claimed_at < now() - ($2::int * interval '1 millisecond') returning season_id`,
      [seasonId, CLAIM_STALE_MS],
    );
    if (!taken.rows.length) return none;
  }
  await settleSeasonBackings(db, seasonId).catch(() => null);
  const scores = await poolScores(db, seasonId);
  const places = placesOf(scores.map((s) => s.points));
  await db.query(`delete from season_pool_entries where season_id = $1`, [seasonId]);
  for (const [i, s] of scores.entries()) {
    await db.query(
      `insert into season_pool_entries (season_id, user_id, place, points, calls_right, agent) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [seasonId, s.user_id, places[i], s.points, s.calls_right, s.agent],
    );
  }
  await db.query(`update season_pools set frozen_at = now(), players = $2 where season_id = $1`, [seasonId, scores.length]);
  const notified = await tellPlayers(db, seasonId).catch(() => 0);
  return { season_id: seasonId, frozen: true, players: scores.length, notified };
}

/** Tells each ranked player where they finished, once a season. */
async function tellPlayers(db: Db, seasonId: string): Promise<number> {
  const claimed = await db.query(`update season_pools set notified_at = now() where season_id = $1 and frozen_at is not null and notified_at is null returning players`, [
    seasonId,
  ]);
  if (!claimed.rows.length) return 0;
  const { rows } = await db.query<{ user_id: string; place: number; points: number }>(`select user_id, place, points from season_pool_entries where season_id = $1`, [seasonId]);
  const players = rows.length;
  const label = seasonLabel(seasonId);
  const link = `${seasonPath(seasonId)}#pool`;
  // One notice per place line, so each player reads their own; grouped to keep it to a few writes.
  const byPlace = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.place}|${r.points}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), r.user_id]);
  }
  for (const [key, ids] of byPlace) {
    const [place, points] = key.split("|").map(Number);
    await notifyAll(db, ids, {
      kind: "season_pool",
      title: place === 1 ? `🏆 You won the ${label} pool` : `🏆 The ${label} pool is out: you finished ${ordinal(place)}`,
      body: `${points} points, ${ordinal(place)} of ${players}. See the whole board on the finale page.`,
      link,
    });
  }
  return players;
}

/** 1st, 2nd, 3rd, 11th, 22nd. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The hourly lobby job's part: freeze the season that just closed, once. Null when it's done already. */
export async function revealDueSeasonPool(db: Db, now: Date = new Date()): Promise<PoolFreeze | null> {
  const prev = seasonIdOf(new Date(seasonWindow(now).start.getTime() - 1));
  if (!isMonthlySeason(prev)) return null;
  const have = (await db.query<{ frozen_at: string | null }>(`select frozen_at from season_pools where season_id = $1`, [prev])).rows[0];
  if (have?.frozen_at) return null;
  return freezeSeasonPool(db, prev, now);
}

export type PoolEntry = { place: number; name: string | null; agent: boolean; points: number; calls_right: number; mine: boolean };
export type PoolBoard = {
  season_id: string;
  label: string;
  path: string;
  players: number;
  top: PoolEntry[];
  /** The viewer's own line when they placed (it may be below the shown top). */
  me: { place: number; points: number } | null;
  frozen_at: string;
};

/** A closed season's revealed board for one viewer, or null before it's frozen (or when nobody played). */
export async function poolBoard(db: Db, seasonId: string, viewerId: string | null): Promise<PoolBoard | null> {
  const pool = (await db.query<{ frozen_at: string | Date | null; players: number }>(`select frozen_at, players from season_pools where season_id = $1`, [seasonId])).rows[0];
  if (!pool?.frozen_at || pool.players === 0) return null;
  const [top, me] = await Promise.all([
    db.query<{ user_id: string; place: number; points: number; calls_right: number; agent: boolean; name: string | null }>(
      `select e.user_id, e.place, e.points, e.calls_right, e.agent, nullif(trim(p.name), '') as name
         from season_pool_entries e left join profiles p on p.user_id = e.user_id
        where e.season_id = $1 order by e.place, e.calls_right desc, e.user_id limit $2`,
      [seasonId, POOL_SHOWN],
    ),
    viewerId
      ? db.query<{ place: number; points: number }>(`select place, points from season_pool_entries where season_id = $1 and user_id = $2`, [seasonId, viewerId])
      : Promise.resolve({ rows: [] as { place: number; points: number }[] }),
  ]);
  return {
    season_id: seasonId,
    label: seasonLabel(seasonId),
    path: seasonPath(seasonId),
    players: pool.players,
    top: top.rows.map((r) => ({ place: r.place, name: r.name, agent: r.agent, points: r.points, calls_right: r.calls_right, mine: r.user_id === viewerId })),
    me: me.rows[0] ?? null,
    frozen_at: new Date(pool.frozen_at).toISOString(),
  };
}

/** The pool /watch shows: the season just closed while its reveal is fresh, else none (the running season's stays hidden). */
export async function recentPoolBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<PoolBoard | null> {
  const { start } = seasonWindow(now);
  if (now.getTime() - start.getTime() > REVEALED_SHOWN_DAYS * 24 * 60 * 60 * 1000) return null;
  const prev = seasonIdOf(new Date(start.getTime() - 1));
  return isMonthlySeason(prev) ? poolBoard(db, prev, viewerId) : null;
}
