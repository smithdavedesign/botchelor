/**
 * Back a cast member for the month (docs/ideas.md "Bringing viewers back", idea 3; David 2026-11-01). A viewer picks ONE
 * of the season's house cast to back: if their pick ends the season coupled (a public couple, Dating or Going steady,
 * when the season closes), they earn points (POINTS_PER_BACKING, lib/game.ts getPointsBreakdown) and a season badge on
 * their account page. The stake is the reason to keep coming back: how is my pick's month going?
 *
 *  - One pick a season per viewer, changeable until mid-month, then locked ("No take-backs"). The book closes at the
 *    lock for everyone (wave 2, 2026-11-02): no first picks after it either, so nobody backs a sure thing late in the
 *    month. A latecomer sees "Picks open again next month"; picks already made stand.
 *  - Settled once, alongside the season recap's freeze (lib/season-recap.ts) with a daily backstop (app/api/jobs/daily).
 *    A season with a recoupling night that ran (lib/recoupling.ts) settles on who left its last one together (its
 *    aired tables, lib/mixer-room.ts leftTogether); a pick who wasn't seated, or a season whose night hasn't fully
 *    aired, falls back to the relationship graph's public layer: Dating or Going steady, the recap's "who stayed".
 *  - $0: rows the show already has, no model call. Counts are public ("most backed"); who backed whom never is.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { leftTogether } from "./mixer-room";
import { notify } from "./notifications";
import { POINTS_PER_BACKING, type Ending } from "./rules";
import { isOnSeasonCast, seasonCastIds } from "./season-cast";
import { seasonPath } from "./season-ref";
import { seasonIdOf, seasonLabel, seasonWindow } from "./season-window";

/** When a season's picks lock: halfway through it ("changeable until mid-month", David 2026-11-01). */
export function backingLockAt(now: Date): Date {
  const { start, end } = seasonWindow(now);
  return new Date((start.getTime() + end.getTime()) / 2);
}

export const backingLocked = (now: Date): boolean => now.getTime() >= backingLockAt(now).getTime();

export type BackResult = { ok: true; character_id: string } | { ok: false; status: number; error: string; message: string };

/** The producer's line for a latecomer once the book has closed. */
export const PICKS_CLOSED_MESSAGE = "The producers closed the book at mid-month. Picks open again next month.";

/** One viewer's pick for the season. After mid-month nothing changes: no new picks, no take-backs. */
export async function backCastMember(db: Db, userId: string, characterId: string, now: Date = new Date()): Promise<BackResult> {
  if (!isOnSeasonCast(characterId, now)) {
    return { ok: false, status: 400, error: "not_on_the_cast", message: "They're not on this season's cast." };
  }
  const season = seasonIdOf(now);
  const have = (await db.query<{ character_id: string }>(`select character_id from cast_backings where season_id = $1 and user_id = $2`, [season, userId])).rows[0];
  if (backingLocked(now)) {
    if (!have) return { ok: false, status: 409, error: "picks_closed", message: PICKS_CLOSED_MESSAGE };
    if (have.character_id !== characterId) return { ok: false, status: 409, error: "pick_locked", message: "Your pick is locked for the month. No take-backs." };
    return { ok: true, character_id: characterId };
  }
  await db.query(
    `insert into cast_backings (season_id, user_id, character_id) values ($1, $2, $3)
     on conflict (season_id, user_id) do update set character_id = excluded.character_id, updated_at = now()`,
    [season, userId, characterId],
  );
  return { ok: true, character_id: characterId };
}

export type BackingCast = { id: string; name: string; hue: number | null; portrait: string | null; backers: number };
export type BackingBoard = {
  season: string;
  /** "November 2026": the month the pick is for. */
  label: string;
  locks_at: string;
  /** Picks can no longer change, and no new ones are taken (the book closed at mid-month). */
  locked: boolean;
  cast: BackingCast[];
  my_pick: string | null;
  /** Viewers with a pick this season. */
  total: number;
  /** The season's most backed cast member (counts only, never who backed them); null until someone has backed. */
  most: { id: string; name: string; backers: number } | null;
};

/** The card's data for one viewer: the cast with backer counts, their pick, and the lock. Null without a cast. */
export async function backingBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<BackingBoard | null> {
  const ids = seasonCastIds(now);
  if (ids.length < 2) return null;
  const season = seasonIdOf(now);
  const [chars, counts, mine] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null; portrait: string | null }>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1)`,
      [ids],
    ),
    db.query<{ character_id: string; n: number }>(`select character_id, count(*)::int as n from cast_backings where season_id = $1 group by character_id`, [season]),
    viewerId
      ? db.query<{ character_id: string }>(`select character_id from cast_backings where season_id = $1 and user_id = $2`, [season, viewerId])
      : Promise.resolve({ rows: [] as { character_id: string }[] }),
  ]);
  const byId = new Map(chars.rows.map((c) => [c.id, c]));
  const backers = new Map(counts.rows.map((r) => [r.character_id, r.n]));
  const cast = ids.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ id, name: c.name, hue: c.hue, portrait: c.portrait, backers: backers.get(id) ?? 0 }] : [];
  });
  const most = [...cast].sort((a, b) => b.backers - a.backers)[0];
  return {
    season,
    label: seasonLabel(season),
    locks_at: backingLockAt(now).toISOString(),
    locked: backingLocked(now),
    cast,
    my_pick: mine.rows[0]?.character_id ?? null,
    total: counts.rows.reduce((s, r) => s + r.n, 0),
    most: most && most.backers > 0 ? { id: most.id, name: most.name, backers: most.backers } : null,
  };
}

export type SettledBackings = { season_id: string; settled: number; won: number };

/** Who sat at a season's last recoupling night, and who left it together. Null when the season's rule can't use one. */
export type RecouplingOutcome = { night_id: string; seated: Set<string>; coupled: Set<string> };

/**
 * The season's last recoupling night that ran (lib/recoupling.ts), read the way its closing reads it (lib/mixer-night.ts):
 * only once every booked table has aired, from the public tables in their rotation order, paired by leftTogether. Null
 * when no night ran, none of its tables booked, or one still hasn't aired: the settle then falls back to the graph.
 */
export async function recouplingOutcome(db: Db, seasonId: string): Promise<RecouplingOutcome | null> {
  const night = (
    await db.query<{ night_id: string; rotations: { a: string; b: string; episode_id?: string | null }[] | null }>(
      `select n.night_id, g.rotations from recoupling_nights n join group_nights g on g.id = n.night_id
        where n.season_id = $1 and n.night_id is not null order by n.night_at desc limit 1`,
      [seasonId],
    )
  ).rows[0];
  if (!night) return null;
  const booked = (night.rotations ?? []).filter((r) => r.episode_id);
  if (!booked.length) return null;
  const { rows } = await db.query<{ id: string; ending: Ending | null; aired: boolean; public: boolean }>(
    `select id, ending, revealed_at is not null as aired, visibility = 'public' as public from episodes where id = any($1)`,
    [booked.map((r) => r.episode_id)],
  );
  const ep = new Map(rows.map((r) => [r.id, r]));
  if (!booked.every((r) => ep.get(r.episode_id!)?.aired)) return null;
  const tables = booked.flatMap((r) => {
    const e = ep.get(r.episode_id!);
    return e?.public && e.ending ? [{ a: r.a, b: r.b, ending: e.ending }] : [];
  });
  const seated = new Set(
    (await db.query<{ character_id: string }>(`select character_id from group_night_seats where night_id = $1`, [night.night_id])).rows.map((s) => s.character_id),
  );
  return { night_id: night.night_id, seated, coupled: new Set(leftTogether(tables).flat()) };
}

/**
 * Settles a closed season's backings, once. A pick won when its cast member ends the season coupled: on a season with
 * a recoupling night, coupled means they left its last night together (recouplingOutcome); otherwise — no night, the
 * night not fully aired, or the pick wasn't seated — the public record: a Dating or Going steady couple in the
 * relationship graph (the recap's "who stayed"). Every backer is told how their stake landed. Idempotent: only
 * unsettled rows settle, so running it again does nothing.
 */
export async function settleSeasonBackings(db: Db, seasonId: string): Promise<SettledBackings> {
  const pending = (
    await db.query<{ user_id: string; character_id: string; name: string; graph_coupled: boolean }>(
      `select b.user_id, b.character_id, c.name,
              exists (select 1 from relationships r
                       where b.character_id in (r.character_a, r.character_b)
                         and r.public_stage in ('dating', 'going_steady')) as graph_coupled
         from cast_backings b join characters c on c.id = b.character_id
        where b.season_id = $1 and b.settled_at is null`,
      [seasonId],
    )
  ).rows;
  if (!pending.length) return { season_id: seasonId, settled: 0, won: 0 };
  const night = await recouplingOutcome(db, seasonId).catch(() => null);
  const rows: { user_id: string; name: string; won: boolean }[] = [];
  for (const p of pending) {
    const won = night && night.seated.has(p.character_id) ? night.coupled.has(p.character_id) : p.graph_coupled;
    // Only an unsettled row settles: two runs racing settle (and notify) each backer once.
    const done = await db.query(
      `update cast_backings set won = $3, settled_at = now() where season_id = $1 and user_id = $2 and settled_at is null returning user_id`,
      [seasonId, p.user_id, won],
    );
    if (done.rows.length) rows.push({ user_id: p.user_id, name: p.name, won });
  }
  const label = seasonLabel(seasonId);
  for (const r of rows) {
    await notify(db, r.user_id, {
      kind: "backing_settled",
      title: r.won ? `Your pick ended ${label} coupled up` : `Your pick ended ${label} single`,
      body: r.won
        ? `You backed ${r.name}, and they closed the season coupled. The producers salute you: +${POINTS_PER_BACKING} points and a season badge.`
        : `You backed ${r.name}; the season ended without a couple to show for it. A bold pick all the same — the producers are casting the next one now.`,
      link: seasonPath(seasonId),
    });
  }
  return { season_id: seasonId, settled: rows.length, won: rows.filter((r) => r.won).length };
}

/** The daily backstop: settles every season that has closed but still has unsettled backings. */
export async function settleDueBackings(db: Db, now: Date = new Date()): Promise<SettledBackings[]> {
  const { rows } = await db.query<{ season_id: string }>(
    `select distinct season_id from cast_backings where settled_at is null and season_id < $1 order by season_id`,
    [seasonIdOf(now)],
  );
  const out: SettledBackings[] = [];
  for (const r of rows) out.push(await settleSeasonBackings(db, r.season_id));
  return out;
}

export type BackingBadge = { season_id: string; label: string; name: string; character_id: string };

/** The season badges a viewer's winning picks earned, newest first (the account page shows them beside league badges). */
export async function backingBadges(db: Db, userId: string): Promise<BackingBadge[]> {
  const { rows } = await db.query<{ season_id: string; character_id: string; name: string }>(
    `select b.season_id, b.character_id, c.name from cast_backings b join characters c on c.id = b.character_id
      where b.user_id = $1 and b.won order by b.season_id desc`,
    [userId],
  );
  return rows.map((r) => ({ season_id: r.season_id, label: seasonLabel(r.season_id), name: r.name, character_id: r.character_id }));
}

export type BackingSince = { character_id: string; name: string; aired: number };

/** The viewer's pick's news since `at` ("Since you were here"): how many of their dates aired. Null without a pick. */
export async function backingSince(db: Db, viewerId: string, at: string, now: Date = new Date()): Promise<BackingSince | null> {
  const season = seasonIdOf(now);
  const pick = (
    await db.query<{ character_id: string; name: string }>(
      `select b.character_id, c.name from cast_backings b join characters c on c.id = b.character_id
        where b.season_id = $1 and b.user_id = $2`,
      [season, viewerId],
    )
  ).rows[0];
  if (!pick) return null;
  const aired = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from episodes e
        where $1 in (e.character_a, e.character_b) and e.revealed_at > $2 and e.visibility = 'public'`,
      [pick.character_id, at],
    )
  ).rows[0];
  return aired && aired.n > 0 ? { character_id: pick.character_id, name: pick.name, aired: aired.n } : null;
}
