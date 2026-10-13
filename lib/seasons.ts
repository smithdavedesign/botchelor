import type { Db } from "./db";
import { predictionPointsSql } from "./game";
import { PODIUM_SIZE, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "./rules";

/**
 * Seasons (M4). A season is the leaderboard week: Monday 00:00 UTC to the next Monday. When it ends,
 * the top 3 in each friend league earn a badge (Olympic places, so ties share; a badge needs points).
 *
 * Nothing runs at the deadline. A season's standings depend only on rows stamped before it: finales
 * aired in the window (picks lock when a finale airs) and members who joined before it. So the first
 * read after the deadline closes the season, with exactly the result a close on the second would give,
 * and closing again changes nothing. Vercel Hobby cron runs once a day within an hour, so it couldn't.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** Shown for a league member who has no display name (boards and podiums). */
export const UNNAMED_MEMBER = "Unnamed player";
/** How many closed seasons a league page lists. */
export const PAST_SEASONS_SHOWN = 4;

/**
 * The leaderboard week containing `now`: Monday 00:00 UTC to the next Monday. Points count in the week
 * the episode airs (when they are earned). One UTC rule everywhere, so no viewer sees a different week.
 */
export function weekWindow(now: Date): { start: Date; end: Date } {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const start = new Date(midnight - daysSinceMonday * DAY_MS);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

/** `id` is the Monday the season starts (YYYY-MM-DD, UTC); it closes at `ends_at`. */
export type Season = { id: string; starts_at: string; ends_at: string };

export function seasonAt(now: Date): Season {
  const { start, end } = weekWindow(now);
  return { id: start.toISOString().slice(0, 10), starts_at: start.toISOString(), ends_at: end.toISOString() };
}

function seasonFromId(id: string): Season {
  return seasonAt(new Date(`${id}T00:00:00.000Z`));
}

/** "week of Oct 12" */
export function seasonLabel(id: string): string {
  const day = new Date(`${id}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `week of ${day}`;
}

/**
 * Closes every season that ended before `now` and had a finale air, oldest first; returns their ids.
 * Without `now`, "now" is the database's clock, the same clock that stamps revealed_at and joined_at,
 * so an app server whose clock runs ahead can't close a week the database is still writing into.
 * Seasons close in order, so anything before the latest closed season's end is already done, and the
 * usual call is one indexed lookup that finds nothing. Safe to run concurrently: both runs compute the
 * same podium, and every insert is ON CONFLICT DO NOTHING.
 */
export async function closeDueSeasons(db: Db, now?: Date): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select distinct to_char(date_trunc('week', e.revealed_at at time zone 'UTC'), 'YYYY-MM-DD') as id
       from episodes e
      where e.revealed_at < coalesce($1::timestamptz, date_trunc('week', now() at time zone 'UTC') at time zone 'UTC')
        and e.revealed_at >= coalesce((select max(ends_at) from seasons), '-infinity'::timestamptz)
      order by id`,
    [now ? weekWindow(now).start.toISOString() : null],
  );
  for (const { id } of rows) await closeSeason(db, seasonFromId(id));
  return rows.map((r) => r.id);
}

/**
 * For page and API reads: closing is a side job, so a failure (a database blip) is logged and the read
 * goes on with what is already closed. The next read tries again.
 */
export async function tryCloseDueSeasons(db: Db): Promise<void> {
  try {
    await closeDueSeasons(db);
  } catch (err) {
    console.error("[seasons] could not close due seasons:", err instanceof Error ? err.message : "unknown");
  }
}

/**
 * One statement: the season's points per player (picks on finales aired inside it), ranked per league
 * among members who joined before the deadline and scored, the top PODIUM_SIZE places stored as
 * badges, and the season marked closed.
 */
async function closeSeason(db: Db, season: Season): Promise<void> {
  await db.query(
    `with week_points as (
       select p.user_id, sum(${predictionPointsSql("$4", "$5")})::int as points
         from predictions p
         join episodes e on e.id = p.episode_id
        where e.revealed_at >= $2 and e.revealed_at < $3
        group by p.user_id
     ),
     podium as (
       select m.league_id, m.user_id, w.points,
              rank() over (partition by m.league_id order by w.points desc)::int as place
         from league_members m
         join week_points w on w.user_id = m.user_id
        where m.joined_at < $3 and w.points > 0
     ),
     awarded as (
       insert into badges (season_id, league_id, user_id, place, points)
       select $1, league_id, user_id, place, points from podium where place <= $6
       on conflict do nothing
     )
     insert into seasons (id, starts_at, ends_at) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [season.id, season.starts_at, season.ends_at, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK, PODIUM_SIZE],
  );
}

export type PodiumEntry = { place: number; name: string; points: number; me: boolean };
export type PastSeason = Season & { podium: PodiumEntry[] };

/** A league's latest closed seasons that had a podium, newest first. Names only, never user ids. */
export async function listLeagueSeasons(
  db: Db,
  leagueId: string,
  viewerId: string | null,
  limit = PAST_SEASONS_SHOWN,
): Promise<PastSeason[]> {
  const { rows } = await db.query<{ season_id: string; place: number; points: number; name: string; me: boolean }>(
    `with recent as (
       select distinct season_id from badges where league_id = $1 order by season_id desc limit $3
     )
     select b.season_id, b.place::int as place, b.points, coalesce(pr.name, $4) as name,
            coalesce(b.user_id = $2::text, false) as me
       from badges b
       join recent r on r.season_id = b.season_id
       left join profiles pr on pr.user_id = b.user_id
      where b.league_id = $1
      order by b.season_id desc, b.place, name`,
    [leagueId, viewerId, limit, UNNAMED_MEMBER],
  );
  const seasons: PastSeason[] = [];
  for (const { season_id, ...entry } of rows) {
    if (seasons.at(-1)?.id !== season_id) seasons.push({ ...seasonFromId(season_id), podium: [] });
    seasons.at(-1)!.podium.push(entry);
  }
  return seasons;
}

export type Badge = { season_id: string; league_id: string; league_name: string; place: number; points: number };

/** Every badge the user has earned, newest season first. */
export async function listMyBadges(db: Db, userId: string): Promise<Badge[]> {
  const { rows } = await db.query<Badge>(
    `select b.season_id, b.league_id, l.name as league_name, b.place::int as place, b.points
       from badges b
       join leagues l on l.id = b.league_id
      where b.user_id = $1
      order by b.season_id desc, b.place, l.name`,
    [userId],
  );
  return rows;
}
