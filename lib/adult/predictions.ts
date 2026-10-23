/**
 * Call it (David, 2026-10-22, from the competitor read): before a Short plays (lib/adult/shorts.ts), an entitled viewer
 * calls how the night goes:
 *  - who makes the first move (or neither: it never gets past talking);
 *  - how far it goes: the furthest stage the night reaches (lib/adult/stages.ts);
 *  - whether they end up at one of their places;
 *  - and, as a bonus they can skip, whether it ends in a second night.
 *
 * It settles the moment they press play, from the recorded night itself, the way the show airs a date once its
 * predictions close: the stages on the lines, the place history and where they went (`moved_to`), and the pair's saved
 * nights. Never a model. Calls lock when play starts, and a Short already watched can't be called. Its owner (who wrote
 * the night) and admins (who can read every night) don't call.
 *
 * The points are free: nothing buys them, nothing they buy, nothing cashes them out or moves them to anyone. They count
 * on After Dark's own season board (a calendar month, lib/season-window.ts), never on the show's (lib/game.ts getPoints,
 * league and season boards), with display names as the show does them (profiles, else "Unnamed player").
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { seasonIdOf, seasonLabel, seasonWindow } from "../season-window";
import { UNNAMED_MEMBER } from "../seasons";
import { hasWatched, shortLines, type NightRow } from "./shorts";
import { stageShown } from "./stage-floor";
import { STAGES } from "./stages";

export const FIRST_MOVES = ["a", "b", "neither"] as const;
export type FirstMove = (typeof FIRST_MOVES)[number];
export const YES_NO = ["yes", "no"] as const;
export type YesNo = (typeof YES_NO)[number];
export const FURTHEST_MAX = STAGES.length - 1;

/** What each right call is worth: free points, on After Dark's board only. */
export const CALL_POINTS = { first_move: 5, furthest: 10, their_place: 5, second_night: 5 } as const;
export type CallPart = keyof typeof CALL_POINTS;

/** A viewer's call. The second night is the bonus: null when they skipped it. */
export type Picks = { first_move: FirstMove; furthest: number; their_place: YesNo; second_night: YesNo | null };

/** What the recorded night shows. `first_line` is where the first move came (null: never); `ended` is their last place. */
export type Outcome = { first_move: FirstMove; furthest: number; their_place: YesNo; second_night: YesNo; first_line: number | null; ended: string | null };

export type Scored = Record<CallPart, number> & { total: number };

/**
 * Each line's stage: the one it was written at (stored since 2026-10-21), else, for a line from before that, the
 * furthest its words plainly showed so far (lib/adult/stage-floor.ts, as the stage floor reads them).
 */
export function lineStages(lines: readonly { text: string; stage?: number }[]): number[] {
  let shown = 0;
  return lines.map((l) => {
    const s = stageShown(l.text);
    if (s !== null && s > shown) shown = s;
    return typeof l.stage === "number" ? l.stage : shown;
  });
}

/**
 * The night's outcome from its own record. The first move is the first line that takes it past talking and flirting (the
 * first one at "tension and the first touches" or further), and whoever says or does it made it. How far it goes is the
 * furthest stage on any line (or a chapter's own, for a night from before lines kept theirs). They end up at one of their
 * places when the night's last stop (its place history, the moves they agreed to) is one of their homes. `laterNight`:
 * whether the pair had another night after this one (shortOutcome reads it from their saved nights).
 */
export function outcomeOf(rows: readonly NightRow[], laterNight: boolean): Outcome {
  const lines = rows.flatMap((r) => r.lines ?? []);
  const stages = lineStages(lines);
  const first = stages.findIndex((s) => s >= 1);
  const furthest = Math.min(FURTHEST_MAX, Math.max(0, ...stages, ...rows.map((r) => r.stage ?? 0)));
  const stops = [...rows].reverse().find((r) => (r.place_history ?? []).length)?.place_history ?? [];
  const end = stops.at(-1) ?? null;
  const lastMove = [...lines].reverse().find((l) => l.moved_to)?.moved_to ?? null;
  return {
    first_move: first >= 0 ? lines[first].who : "neither",
    furthest,
    their_place: end?.home ? "yes" : "no",
    second_night: laterNight ? "yes" : "no",
    first_line: first >= 0 ? first : null,
    ended: end?.set ?? end?.place ?? lastMove ?? rows.at(-1)?.set_place ?? rows.at(-1)?.place ?? null,
  };
}

/**
 * A Short's outcome. The second night: whether the owner's saved nights of the pair hold another one (its first chapter)
 * after this night ended and before the Short was first published, so it's the same for every viewer, whenever they
 * press play. Null for a Short that doesn't exist.
 */
export async function shortOutcome(db: Db, shortId: string): Promise<Outcome | null> {
  const s = await shortLines(db, shortId);
  if (!s || !s.rows.length) return null;
  const last = s.rows.at(-1)!;
  const later = await db.query(
    `select 1 from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 and (chapter is null or chapter = 1)
        and created_at > $4 and created_at <= $5 and not (id = any($6)) limit 1`,
    [s.short.owner_id, s.short.character_a, s.short.character_b, new Date(last.created_at).toISOString(), new Date(s.short.created_at).toISOString(), s.short.night_ids],
  );
  return outcomeOf(s.rows, later.rows.length > 0);
}

/** The points a call earns against what happened: each right part, the bonus only when it was called. */
export function score(p: Picks, o: Outcome): Scored {
  const part = {
    first_move: p.first_move === o.first_move ? CALL_POINTS.first_move : 0,
    furthest: p.furthest === o.furthest ? CALL_POINTS.furthest : 0,
    their_place: p.their_place === o.their_place ? CALL_POINTS.their_place : 0,
    second_night: p.second_night !== null && p.second_night === o.second_night ? CALL_POINTS.second_night : 0,
  };
  return { ...part, total: part.first_move + part.furthest + part.their_place + part.second_night };
}

/** A viewer's call on a Short: open (they can change it until they press play), or settled with what happened. */
export type Call = { picks: Picks; settled: { outcome: Outcome; points: Scored; at: string } | null };

type CallRow = {
  first_move: FirstMove;
  furthest: number;
  their_place: YesNo;
  second_night: YesNo | null;
  outcome: Outcome | null;
  points: number | null;
  settled_at: string | Date | null;
};
const callOfRow = (r: CallRow): Call => {
  const picks: Picks = { first_move: r.first_move, furthest: Number(r.furthest), their_place: r.their_place, second_night: r.second_night };
  return { picks, settled: r.settled_at && r.outcome ? { outcome: r.outcome, points: score(picks, r.outcome), at: new Date(r.settled_at).toISOString() } : null };
};

export async function callOf(db: Db, viewer: string, shortId: string): Promise<Call | null> {
  const r = (await db.query<CallRow>(`select first_move, furthest, their_place, second_night, outcome, points, settled_at from adult_short_calls where short_id = $1 and user_id = $2`, [shortId, viewer])).rows[0];
  return r ? callOfRow(r) : null;
}

/**
 * Why this viewer can't call this Short, or null when they can: it has to be published, not theirs (they wrote it), not
 * an admin's (they can read every night), and not watched already (calls close when it plays).
 */
export async function cantCall(db: Db, viewer: string, shortId: string): Promise<{ status: number; error: string; message: string } | null> {
  const s = (await db.query<{ owner_id: string; published_at: string | Date | null }>(`select owner_id, published_at from adult_shorts where id = $1`, [shortId])).rows[0];
  if (!s?.published_at) return { status: 404, error: "not_found", message: "No Short with that id." };
  if (s.owner_id === viewer) return { status: 403, error: "own_short", message: "You wrote this night: you already know how it goes." };
  if (await isAdmin(db, viewer)) return { status: 403, error: "admin", message: "Admins can read every night, so they don't call them." };
  if (await hasWatched(db, viewer, shortId)) return { status: 409, error: "watched", message: "You've pressed play on this one: calls close when it plays." };
  return null;
}

export type CallResult = { ok: true; call: Call } | { ok: false; status: number; error: string; message: string };

/**
 * Makes or changes the viewer's call, while they can (cantCall). One statement, so a call can't slip in once play has
 * started: it's refused when the view is already there, and a call that's settled is never changed.
 */
export async function makeCall(db: Db, viewer: string, shortId: string, picks: Picks): Promise<CallResult> {
  const why = await cantCall(db, viewer, shortId);
  if (why) return { ok: false, ...why };
  const { rows } = await db.query<CallRow>(
    `insert into adult_short_calls (short_id, user_id, first_move, furthest, their_place, second_night)
     select $1, $2, $3, $4, $5, $6
      where not exists (select 1 from adult_short_views v where v.short_id = $1 and v.user_id = $2)
     on conflict (short_id, user_id) do update set first_move = excluded.first_move, furthest = excluded.furthest, their_place = excluded.their_place,
            second_night = excluded.second_night, updated_at = now()
      where adult_short_calls.settled_at is null
     returning first_move, furthest, their_place, second_night, outcome, points, settled_at`,
    [shortId, viewer, picks.first_move, picks.furthest, picks.their_place, picks.second_night],
  );
  return rows[0] ? { ok: true, call: callOfRow(rows[0]) } : { ok: false, status: 409, error: "watched", message: "You've pressed play on this one: calls close when it plays." };
}

/**
 * Pressing play settles the viewer's open call, once, from the recorded night (shortOutcome): what happened and the
 * points are kept with it. The view itself is recorded first (lib/adult/shorts.ts watchShort), which closes calls.
 * Returns their call (settled now or before), or null when they didn't make one.
 */
export async function settleCall(db: Db, viewer: string, shortId: string): Promise<Call | null> {
  const open = (await db.query<CallRow>(`select first_move, furthest, their_place, second_night, outcome, points, settled_at from adult_short_calls where short_id = $1 and user_id = $2`, [shortId, viewer])).rows[0];
  if (!open) return null;
  if (open.settled_at) return callOfRow(open);
  const outcome = await shortOutcome(db, shortId);
  if (!outcome) return callOfRow(open);
  const points = score(callOfRow(open).picks, outcome).total;
  const { rows } = await db.query<CallRow>(
    `update adult_short_calls set outcome = $3::jsonb, points = $4, settled_at = now(), updated_at = now()
      where short_id = $1 and user_id = $2 and settled_at is null
     returning first_move, furthest, their_place, second_night, outcome, points, settled_at`,
    [shortId, viewer, JSON.stringify(outcome), points],
  );
  return rows[0] ? callOfRow(rows[0]) : callOf(db, viewer, shortId);
}

/** One row of the board: a place (ties share it), a display name, the points; never a user id. */
export type BoardEntry = { rank: number; name: string; points: number; me: boolean };
export type CallBoard = { season: { id: string; label: string; ends_at: string }; top: BoardEntry[]; me: BoardEntry | null; players: number };

/**
 * After Dark's season board: the points from calls settled this season (a calendar month), on Shorts still published,
 * ranked Olympic-style (ties share a place), with the show's display names. Apart from the show's boards entirely.
 */
export async function callBoard(db: Db, viewer: string | null, now: Date = new Date(), limit = 10): Promise<CallBoard> {
  const { start, end } = seasonWindow(now);
  const { rows } = await db.query<BoardEntry & { user_id: string }>(
    `with scored as (
       select c.user_id, sum(c.points)::int as points
         from adult_short_calls c
         join adult_shorts s on s.id = c.short_id
        where c.settled_at >= $1 and c.settled_at < $2 and s.published_at is not null
        group by c.user_id
       having sum(c.points) > 0
     )
     select rank() over (order by sc.points desc)::int as rank, coalesce(p.name, $3) as name, sc.points, sc.user_id, coalesce(sc.user_id = $4::text, false) as me
       from scored sc left join profiles p on p.user_id = sc.user_id
      order by sc.points desc, name, sc.user_id`,
    [start.toISOString(), end.toISOString(), UNNAMED_MEMBER, viewer],
  );
  // The user id ranks ties the same way every time, and goes no further.
  const entry = (r: BoardEntry): BoardEntry => ({ rank: r.rank, name: r.name, points: r.points, me: r.me });
  const mine = rows.find((r) => r.me);
  const id = seasonIdOf(now);
  return {
    season: { id, label: seasonLabel(id), ends_at: end.toISOString() },
    top: rows.slice(0, limit).map(entry),
    me: mine ? entry(mine) : null,
    players: rows.length,
  };
}

/** The viewer's display name on the board, as the show's boards write it. */
export async function boardName(db: Db, viewer: string): Promise<string | null> {
  return (await db.query<{ name: string }>(`select name from profiles where user_id = $1`, [viewer])).rows[0]?.name ?? null;
}
