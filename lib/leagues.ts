import type { Db } from "./db";
import { predictionPointsSql } from "./game";
import { POINTS_PER_ARC, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "./rules";
import { listLeagueSeasons, seasonAt, seasonWindow, UNNAMED_MEMBER, weekWindow, type PastSeason } from "./seasons";

// The week rule moved to lib/seasons.ts with M4 (a season is the leaderboard week); M2 code imports it here.
export { weekWindow };

/** A league is a handful of friends; a soft cap (concurrent joins can overshoot by a few). */
export const LEAGUE_MEMBER_CAP = 50;
export const LEAGUE_NAME_MAX = 40;

export const invitePath = (leagueId: string) => `/leagues/${leagueId}`;

/** `frame` is the member's latest bought frame (cosmetic, M3); the key is absent when they have none. */
export type LeaderboardEntry = { rank: number; name: string; points: number; me: boolean; frame?: string };

export type LeagueView = {
  id: string;
  name: string;
  invite_path: string;
  is_member: boolean;
  members: number;
  week: { start: string; end: string };
  leaderboard: LeaderboardEntry[];
  /** M4: the open season is this week's board; it closes at `closes_at` and its top 3 earn badges. */
  season: { id: string; closes_at: string };
  /** M4: podiums of the latest closed seasons, newest first (stored when a season closes). */
  past_seasons: PastSeason[];
};

/** A league's weekly board. Members only, ranked Olympic-style (ties share a rank), no user ids. */
export async function getLeague(db: Db, id: string, viewerId: string | null, now = new Date()): Promise<LeagueView | null> {
  const league = (await db.query<{ id: string; name: string }>("select id, name from leagues where id = $1", [id])).rows[0];
  if (!league) return null;

  const { start, end } = seasonWindow(now);
  // Rank and points come only from predictions (episodes, and couples' arcs settled this week: lib/arcs.ts); the
  // frame is joined beside them and can't move anyone.
  const { rows } = await db.query<Omit<LeaderboardEntry, "frame"> & { frame: string | null }>(
    `with week_points as (
       select user_id, sum(points)::int as points from (
         select p.user_id, ${predictionPointsSql("$5", "$6")} as points
           from predictions p
           join episodes e on e.id = p.episode_id
          where e.revealed_at >= $3 and e.revealed_at < $4 and e.visibility = 'public'
            and p.user_id in (select user_id from league_members where league_id = $1)
         union all
         select ap.user_id, case when ap.pick = ap.outcome then $8::int else 0 end as points
           from arc_predictions ap
          where ap.resolved_at >= $3 and ap.resolved_at < $4
            and ap.user_id in (select user_id from league_members where league_id = $1)
       ) scored
       group by user_id
     )
     select rank() over (order by coalesce(w.points, 0) desc)::int as rank,
            coalesce(pr.name, $7) as name,
            coalesce(w.points, 0) as points,
            coalesce(m.user_id = $2::text, false) as me,
            fr.sku as frame
       from league_members m
       left join profiles pr on pr.user_id = m.user_id
       left join week_points w on w.user_id = m.user_id
       left join lateral (
         select o.sku from orders o
          where o.user_id = m.user_id and o.kind = 'frame' and o.status = 'paid'
          order by o.paid_at desc, o.id
          limit 1
       ) fr on true
      where m.league_id = $1
      order by points desc, name asc, m.joined_at asc`,
    [
      id,
      viewerId,
      start.toISOString(),
      end.toISOString(),
      POINTS_PER_CORRECT_PICK,
      POINTS_PER_DRAMA_PICK,
      UNNAMED_MEMBER,
      POINTS_PER_ARC,
    ],
  );

  const season = seasonAt(now);
  return {
    id: league.id,
    name: league.name,
    invite_path: invitePath(league.id),
    is_member: rows.some((r) => r.me),
    members: rows.length,
    week: { start: start.toISOString(), end: end.toISOString() },
    leaderboard: rows.map(({ frame, ...entry }) => (frame ? { ...entry, frame } : entry)),
    season: { id: season.id, closes_at: season.ends_at },
    past_seasons: await listLeagueSeasons(db, league.id, viewerId),
  };
}

export type LeagueSummary = { id: string; name: string; invite_path: string; members: number };

export async function listMyLeagues(db: Db, userId: string): Promise<LeagueSummary[]> {
  const { rows } = await db.query<{ id: string; name: string; members: number }>(
    `select l.id, l.name, (select count(*)::int from league_members c where c.league_id = l.id) as members
       from league_members m
       join leagues l on l.id = m.league_id
      where m.user_id = $1
      order by m.joined_at desc`,
    [userId],
  );
  return rows.map((r) => ({ ...r, invite_path: invitePath(r.id) }));
}

export type SeasonStanding = { points: number; place: number | null; players: number };

/**
 * Where one player stands this season among everyone who has scored (2026-10-20, the MCP's get_leaderboard): their
 * points, scored the way a league scores them (calls on public dates that aired this season, and arcs settled in it),
 * their place (ties share it; null with no points yet) and how many players have points. No one else's name or id.
 */
export async function seasonStanding(db: Db, userId: string, now = new Date()): Promise<SeasonStanding> {
  const { start, end } = seasonWindow(now);
  const { rows } = await db.query<{ points: number | null; ahead: number; players: number }>(
    `with scored as (
       select user_id, sum(points)::int as points from (
         select p.user_id, ${predictionPointsSql("$3", "$4")} as points
           from predictions p
           join episodes e on e.id = p.episode_id
          where e.revealed_at >= $1 and e.revealed_at < $2 and e.visibility = 'public'
         union all
         select ap.user_id, case when ap.pick = ap.outcome then $5::int else 0 end as points
           from arc_predictions ap
          where ap.resolved_at >= $1 and ap.resolved_at < $2
       ) s
       group by user_id
     )
     select (select points from scored where user_id = $6) as points,
            (select count(*)::int from scored where points > coalesce((select points from scored where user_id = $6), 0)) as ahead,
            (select count(*)::int from scored where points > 0) as players`,
    [start.toISOString(), end.toISOString(), POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK, POINTS_PER_ARC, userId],
  );
  const r = rows[0];
  const points = r?.points ?? 0;
  return { points, place: points > 0 ? (r?.ahead ?? 0) + 1 : null, players: r?.players ?? 0 };
}
