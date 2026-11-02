/**
 * What happened on the show since your last visit (docs/ideas.md "Bringing viewers back", idea 12; David 2026-11-01).
 * lib/since.ts (2026-11-01 audit J4) tells someone with characters what happened to THEM; this is the show's half, for
 * everyone who comes back, characters or not: how many dates aired, the couples who moved (the ones you follow first),
 * dates by couples you follow, how your calls did and your run, the situation the viewers picked, and the newest diary
 * cam take (lib/game.ts EpisodeJson.diary: a house character's, or a shared one, from a date that has aired), and the
 * week's biggest chemistry shift (lib/chemistry-shifts.ts). Home puts it in
 * the "Since you were here" card for an owner and in a card of its own for a spectator; /watch opens with it.
 *
 *  - "Your last visit" is owner_activity.prev_seen: the visit before this one, kept by lib/activity.ts touchOwner when
 *    someone comes back after RETURN_GAP_HOURS, so it holds still while they look around. On the very first page of a
 *    return the touch may not have landed yet, so a last_seen that's already that old is the last visit itself.
 *  - $0: counts and names from rows the show already has, no model call, nothing generated or stored.
 *  - Public only, like the graph's public layer: public dates, public stage moves between public characters.
 *  - Looks back at most LOOKBACK_DAYS, and shows nothing when nothing happened.
 *  - A season that closed since (lib/season-ref.ts): its finale, /seasons/<month-year>.
 */
import { newestSecretOut, type SecretOut } from "./cast-secrets";
import type { Db } from "./db";
import { RETURN_GAP_HOURS } from "./activity";
import { STAGE_LABELS, type Stage } from "./relationships";
import { DATE_ROLEPLAYS } from "./roleplays";
import { seasonClosedSince, type SeasonRef } from "./season-ref";
import { callRecord } from "./streaks";
import { chemistryShifts, type ChemistryShift } from "./chemistry-shifts";
import { clipBody } from "./notifications";
import { REPORT_HIDE_THRESHOLD } from "./rules";

/** The furthest back the card counts from. */
export const LOOKBACK_DAYS = 30;
/** How much of a diary cam take the card quotes (the episode has the whole of it). */
export const DIARY_SHOWN_MAX = 160;
/** How many couples' moves it names. */
export const MOVES_SHOWN = 4;

export type SinceMove = { lo: string; hi: string; a: string; b: string; label: string; following: boolean };

export type ShowSince = {
  /** When their last visit was (ISO): the card counts from here (or LOOKBACK_DAYS ago, whichever is later). */
  since: string;
  /** Public dates that aired since. */
  aired: number;
  /** Couples whose stage changed since, on the public record: the ones you follow first, then the latest. */
  moves: SinceMove[];
  /** Your calls on dates that aired since: how many, how many right, and your run now. */
  calls: { called: number; right: number; streak: number } | null;
  /** Dates by couples you follow that aired since. */
  followed: number;
  /** The newest date the viewers picked the situation for (lib/situations.ts), made since. */
  situation: { title: string; icon: string; room_path: string } | null;
  /** The newest diary cam take from a public date that aired since: who said it, about whom, and the episode. */
  diary: { name: string; partner: string; line: string; episode_path: string } | null;
  /** The week's biggest chemistry shift either way (lib/chemistry-shifts.ts), when there's one. */
  shift: ChemistryShift | null;
  /** The newest of this season's cast secrets to come out since (lib/cast-secrets.ts). */
  secret: SecretOut | null;
  /** A season that closed since: its finale page. */
  season: SeasonRef | null;
};

/** When this person's last visit was, or null for a first visit (or one too recent to count as a return). */
export async function lastVisit(db: Db, userId: string, now: Date = new Date()): Promise<Date | null> {
  const row = (
    await db.query<{ last_seen: Date | string; prev_seen: Date | string | null }>(`select last_seen, prev_seen from owner_activity where user_id = $1`, [userId])
  ).rows[0];
  if (!row) return null;
  const last = new Date(row.last_seen);
  if (now.getTime() - last.getTime() >= RETURN_GAP_HOURS * 60 * 60 * 1000) return last;
  return row.prev_seen ? new Date(row.prev_seen) : null;
}

/** The show's news for one viewer, or null: a first visit, or nothing happened since their last one. */
export async function showSince(db: Db, viewerId: string | null, now: Date = new Date()): Promise<ShowSince | null> {
  if (!viewerId) return null;
  const visit = await lastVisit(db, viewerId, now);
  if (!visit) return null;
  const floor = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const since = visit > floor ? visit : floor;
  const at = since.toISOString();
  const [aired, moves, calls, followed, night, diaryRows, shifts] = await Promise.all([
    db.query<{ n: number }>(`select count(*)::int as n from episodes where revealed_at > $1 and visibility = 'public'`, [at]),
    db.query<{ lo: string; hi: string; a: string; b: string; to_stage: string; following: boolean }>(
      `select * from (
         select distinct on (r.character_a, r.character_b) r.character_a as lo, r.character_b as hi, ca.name as a, cb.name as b, r.to_stage,
                exists (select 1 from couple_follows f where f.user_id = $2 and f.character_lo = r.character_a and f.character_hi = r.character_b) as following,
                r.at
           from relationship_events r
           join characters ca on ca.id = r.character_a
           join characters cb on cb.id = r.character_b
          where r.layer = 'public' and r.at > $1 and r.to_stage is not null
            and ca.visibility = 'public' and cb.visibility = 'public'
          order by r.character_a, r.character_b, r.at desc
       ) x order by following desc, at desc limit $3`,
      [at, viewerId, MOVES_SHOWN],
    ),
    db.query<{ called: number; hits: number }>(
      `select count(*)::int as called, count(*) filter (where p.pick = e.ending)::int as hits
         from predictions p join episodes e on e.id = p.episode_id
        where p.user_id = $2 and e.revealed_at > $1 and e.visibility = 'public' and e.ending is not null`,
      [at, viewerId],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from episodes e
         join couple_follows f on f.user_id = $2
          and f.character_lo = least(e.character_a, e.character_b) and f.character_hi = greatest(e.character_a, e.character_b)
        where e.revealed_at > $1 and e.visibility = 'public'`,
      [at, viewerId],
    ),
    db.query<{ pick: string; party_id: string }>(
      `select pick, party_id from situation_nights where party_id is not null and created_at > $1 order by day desc limit 1`,
      [at],
    ),
    // The diary cam's rule (lib/game.ts): a house character's take, or either side's when the host shared them. Never a
    // reported-away date.
    db.query<{ id: string; a: string; b: string; a_ok: boolean; b_ok: boolean; lines: [string, string] }>(
      `select e.id, ca.name as a, cb.name as b, (ca.is_house or e.confessionals_shared) as a_ok, (cb.is_house or e.confessionals_shared) as b_ok,
              e.confessionals as lines
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.revealed_at > $1 and e.visibility = 'public' and e.confessionals is not null
          and (ca.is_house or cb.is_house or e.confessionals_shared)
          and (select count(*) from reports r where r.episode_id = e.id) < $2
        order by e.revealed_at desc limit 1`,
      [at, REPORT_HIDE_THRESHOLD],
    ),
    chemistryShifts(db, now).catch(() => ({ up: [], down: [] })),
  ]);
  const secret = await newestSecretOut(db, since, now).catch(() => null);
  const d = diaryRows.rows[0];
  const side = d ? ([0, 1] as const).find((i) => (i === 0 ? d.a_ok : d.b_ok) && d.lines?.[i]?.trim()) : undefined;
  const c = calls.rows[0];
  const n = night.rows[0];
  const def = n ? DATE_ROLEPLAYS.find((r) => r.id === n.pick) : undefined;
  const card: ShowSince = {
    since: visit.toISOString(),
    aired: aired.rows[0]?.n ?? 0,
    moves: moves.rows
      .filter((m) => m.to_stage in STAGE_LABELS)
      .map((m) => ({ lo: m.lo, hi: m.hi, a: m.a, b: m.b, label: STAGE_LABELS[m.to_stage as Stage], following: m.following })),
    calls: c && c.called > 0 ? { called: c.called, right: c.hits, streak: (await callRecord(db, viewerId)).streak } : null,
    followed: followed.rows[0]?.n ?? 0,
    situation: n && def ? { title: def.title, icon: def.icon, room_path: `/watch/${n.party_id}` } : null,
    diary:
      d && side !== undefined
        ? { name: side === 0 ? d.a : d.b, partner: side === 0 ? d.b : d.a, line: clipBody(d.lines[side].trim(), DIARY_SHOWN_MAX), episode_path: `/episodes/${d.id}` }
        : null,
    shift: [...shifts.up, ...shifts.down].sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift))[0] ?? null,
    secret,
    season: seasonClosedSince(since, now),
  };
  // The week's shift alone isn't news since a visit (it can predate it), so it never shows the card by itself.
  const anything = card.aired || card.moves.length || card.calls || card.followed || card.situation || card.diary || card.secret || card.season;
  return anything ? card : null;
}
