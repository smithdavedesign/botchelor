/**
 * Your character meets the cast (docs/ideas.md "Bringing viewers back", idea 15; David 2026-11-01): a weekly earned
 * slot. Once a week, the show looks at last week's most active viewers (web_events, lib/engagement.ts) and grants ONE
 * of them a date between their character and a cast member they pick, on the show. The producers are watching: showing
 * up earns you a seat at the table.
 *
 *  - One winner a week (spend stays at one show-paid date, ~1-5¢): the most page events last week among people who
 *    have a character of their own, leaving out our own traffic and admins (lib/our-traffic.ts loadOurIds covers both)
 *    and anyone who won in the last four weeks, so the slot travels. A quiet week (nobody over MIN_EVENTS) grants nothing.
 *  - The prize is a date WITH THE CAST (wave 2, 2026-11-02), not a generic free date: the claim row itself
 *    (cast_date_weeks) is redeemable once, within PRIZE_DAYS, for a date between one of their characters and a current
 *    season cast member they pick (app/api/cast-date/route.ts). It books through the ordinary booking route, so every
 *    rule applies as usual, on a request marked show-paid (lib/cast-date-request.ts): it spends none of their dates and
 *    can't be spent on anything else. Weeks won before this got a token_grants date instead (expires_at null) and keep it.
 *  - Spend: one show-paid date a week at most, the show's own model (~1.3¢; ~5¢ on the paid default), so ≤5¢ a week.
 *  - Picked by the daily job; the claim row (cast_date_weeks, one per week) makes it once however often that runs.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { loadOurIds } from "./our-traffic";
import { notify } from "./notifications";
import { seasonCastIds } from "./season-cast";
import { weekIdOf, weekWindow } from "./season-window";

/** Fewer page events than this last week: nobody earned the slot (a stray page view isn't a most-active viewer). */
export const MIN_EVENTS = 10;
/** A winner sits out this many days before they can win again. */
export const WINNER_COOLDOWN_DAYS = 28;
/** How long the winner's banner shows on the cast tab once their date is booked. */
export const BANNER_DAYS = 7;
/** How long the prize keeps: book the cast date within this many days of winning, or it lapses. */
export const PRIZE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CastDatePicked =
  | { picked: true; week_id: string; user_id: string; events: number }
  | { picked: false; reason: "already" | "nobody" | "claimed_elsewhere" };

/** The last completed week (Monday to Monday, UTC) as of `now`: the week the slot is earned for. */
export function lastWeekOf(now: Date): { id: string; start: Date; end: Date } {
  const { start } = weekWindow(now);
  const prev = new Date(start.getTime() - 1);
  const w = weekWindow(prev);
  return { id: weekIdOf(prev), start: w.start, end: w.end };
}

/**
 * The weekly pick: last week's most active viewer with a character of their own, granted one date on the show.
 * Idempotent per week (the claim row), so the daily job can call it every run.
 */
export async function pickWeeklyCastDate(db: Db, now: Date = new Date()): Promise<CastDatePicked> {
  const week = lastWeekOf(now);
  const have = (await db.query<{ user_id: string }>(`select user_id from cast_date_weeks where week_id = $1`, [week.id])).rows[0];
  if (have) return { picked: false, reason: "already" };
  const ours = await loadOurIds(db);
  const winner = (
    await db.query<{ user_id: string; events: number }>(
      `select w.user_id, count(*)::int as events
         from web_events w
        where w.at >= $1 and w.at < $2 and w.user_id is not null
          and not (w.user_id = any($3::text[]))
          and exists (select 1 from characters c where c.owner_id = w.user_id and not c.is_house)
          and not exists (select 1 from cast_date_weeks p where p.user_id = w.user_id and p.granted_at > $2::timestamptz - ($4::int * interval '1 day'))
        group by w.user_id
       having count(*) >= $5
        order by events desc, w.user_id
        limit 1`,
      [week.start.toISOString(), week.end.toISOString(), ours, WINNER_COOLDOWN_DAYS, MIN_EVENTS],
    )
  ).rows[0];
  if (!winner) return { picked: false, reason: "nobody" };
  const expires = new Date(now.getTime() + PRIZE_DAYS * DAY_MS);
  const claimed = (
    await db.query(
      `insert into cast_date_weeks (week_id, user_id, granted_at, expires_at) values ($1, $2, $3, $4) on conflict (week_id) do nothing returning week_id`,
      [week.id, winner.user_id, now.toISOString(), expires.toISOString()],
    )
  ).rows.length;
  if (!claimed) return { picked: false, reason: "claimed_elsewhere" };
  // The prize is the claim row itself: one date with a season cast member, booked from the cast tab within PRIZE_DAYS.
  await notify(db, winner.user_id, {
    kind: "cast_date_won",
    title: "The producers were watching: date the cast, on the show",
    body: `You were one of last week's most active viewers, so this week's earned slot is yours: a date between your character and a season cast member you pick, on the show, on us. Book it within ${PRIZE_DAYS} days.`,
    link: CAST_DATE_PATH,
  });
  return { picked: true, week_id: week.id, user_id: winner.user_id, events: winner.events };
}

/** Where the winner books it: the cast tab's prize card. */
export const CAST_DATE_PATH = "/characters?tab=cast#cast-date";

type Face = { id: string; name: string; hue: number | null; portrait: string | null };

export type CastDatePrize = {
  week_id: string;
  granted_at: string;
  expires_at: string;
  /** Their own characters to send (newest first). Empty: they have to make one first. */
  characters: Face[];
  /** This season's cast to pick from. */
  cast: Face[];
  /** The date it was spent on, once booked. */
  booked: { episode_id: string; path: string } | null;
};

/**
 * The winner's prize card on the cast tab: the open prize (until it's booked or lapses), or the booked date for
 * BANNER_DAYS after. Null for everyone else, and for weeks won before the prize was a cast date (they got a grant).
 */
export async function castDatePrize(db: Db, viewerId: string | null, now: Date = new Date()): Promise<CastDatePrize | null> {
  if (!viewerId) return null;
  const row = (
    await db.query<{ week_id: string; granted_at: Date | string; expires_at: Date | string; episode_id: string | null }>(
      `select week_id, granted_at, expires_at, episode_id from cast_date_weeks
        where user_id = $1 and expires_at is not null
          and ((redeemed_at is null and expires_at > $2) or (episode_id is not null and redeemed_at > $2::timestamptz - ($3::int * interval '1 day')))
        order by granted_at desc limit 1`,
      [viewerId, now.toISOString(), BANNER_DAYS],
    )
  ).rows[0];
  if (!row) return null;
  const [mine, cast] = await Promise.all([
    db.query<Face>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c
        where c.owner_id = $1 and not c.is_house order by c.created_at desc limit 12`,
      [viewerId],
    ),
    db.query<Face>(`select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1)`, [seasonCastIds(now)]),
  ]);
  const order = new Map(seasonCastIds(now).map((id, i) => [id, i]));
  return {
    week_id: row.week_id,
    granted_at: new Date(row.granted_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    characters: mine.rows,
    cast: [...cast.rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    booked: row.episode_id ? { episode_id: row.episode_id, path: `/episodes/${row.episode_id}` } : null,
  };
}

export type PrizeClaim = { ok: true; week_id: string } | { ok: false; status: number; error: string; message: string };

/**
 * Claims a viewer's open prize for a booking, so two taps can't book two dates: marks it redeemed now (released
 * again by releasePrize if the booking fails). Refuses a cast member who isn't on this season's cast.
 */
export async function claimPrize(db: Db, userId: string, castId: string, now: Date = new Date()): Promise<PrizeClaim> {
  if (!seasonCastIds(now).includes(castId)) {
    return { ok: false, status: 400, error: "not_on_the_cast", message: "The prize is a date with this season's cast: pick one of them." };
  }
  const claimed = (
    await db.query<{ week_id: string }>(
      `update cast_date_weeks set redeemed_at = $2
        where week_id = (select week_id from cast_date_weeks where user_id = $1 and expires_at > $2 and redeemed_at is null order by granted_at desc limit 1)
          and redeemed_at is null
        returning week_id`,
      [userId, now.toISOString()],
    )
  ).rows[0];
  if (!claimed) return { ok: false, status: 404, error: "no_prize", message: "There's no cast date waiting for you. The producers pick a new winner every week." };
  return { ok: true, week_id: claimed.week_id };
}

/** The booking went through: the prize is spent on this date. */
export async function spendPrize(db: Db, weekId: string, episodeId: string): Promise<void> {
  await db.query(`update cast_date_weeks set episode_id = $2 where week_id = $1`, [weekId, episodeId]);
}

/** The booking didn't happen: the prize is theirs to book again. */
export async function releasePrize(db: Db, weekId: string): Promise<void> {
  await db.query(`update cast_date_weeks set redeemed_at = null where week_id = $1 and episode_id is null`, [weekId]);
}
