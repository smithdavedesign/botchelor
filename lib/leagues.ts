import type { Db } from "./db";
import { predictionPointsSql } from "./game";
import { POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "./rules";
import { listLeagueSeasons, seasonAt, UNNAMED_MEMBER, weekWindow, type PastSeason } from "./seasons";

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

  const { start, end } = weekWindow(now);
  // Rank and points come only from predictions; the frame is joined beside them and can't move anyone.
  const { rows } = await db.query<Omit<LeaderboardEntry, "frame"> & { frame: string | null }>(
    `with week_points as (
       select p.user_id, sum(${predictionPointsSql("$5", "$6")})::int as points
         from predictions p
         join episodes e on e.id = p.episode_id
        where e.revealed_at >= $3 and e.revealed_at < $4
          and p.user_id in (select user_id from league_members where league_id = $1)
        group by p.user_id
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
