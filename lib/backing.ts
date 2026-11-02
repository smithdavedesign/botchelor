/**
 * Back a cast member for the month (docs/ideas.md "Bringing viewers back", idea 3; David 2026-11-01). A viewer picks ONE
 * of the season's house cast to back: if their pick ends the season coupled (a public couple, Dating or Going steady,
 * when the season closes), they earn points (POINTS_PER_BACKING, lib/game.ts getPointsBreakdown) and a season badge on
 * their account page. The stake is the reason to keep coming back: how is my pick's month going?
 *
 *  - One pick a season per viewer, changeable until mid-month, then locked ("No take-backs"). A first pick can still be
 *    placed after the lock — a latecomer deserves a stake too — but it locks the moment it's made.
 *  - Settled once, alongside the season recap's freeze (lib/season-recap.ts) with a daily backstop (app/api/jobs/daily),
 *    from the relationship graph's public layer: the same record the recap's "who stayed" reads.
 *  - $0: rows the show already has, no model call. Counts are public ("most backed"); who backed whom never is.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { notify } from "./notifications";
import { POINTS_PER_BACKING } from "./rules";
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

/** One viewer's pick for the season. A change after mid-month is refused; the first pick always lands. */
export async function backCastMember(db: Db, userId: string, characterId: string, now: Date = new Date()): Promise<BackResult> {
  if (!isOnSeasonCast(characterId, now)) {
    return { ok: false, status: 400, error: "not_on_the_cast", message: "They're not on this season's cast." };
  }
  const season = seasonIdOf(now);
  const have = (await db.query<{ character_id: string }>(`select character_id from cast_backings where season_id = $1 and user_id = $2`, [season, userId])).rows[0];
  if (have && have.character_id !== characterId && backingLocked(now)) {
    return { ok: false, status: 409, error: "pick_locked", message: "Your pick is locked for the month. No take-backs." };
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
  /** Picks can no longer change (a first pick still lands, already locked). */
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

/**
 * Settles a closed season's backings, once: a pick won when its cast member ends the season coupled on the public
 * record (a Dating or Going steady couple in the relationship graph — the recap's "who stayed"). Every backer is told
 * how their stake landed. Idempotent: only unsettled rows settle, so running it again does nothing.
 */
export async function settleSeasonBackings(db: Db, seasonId: string): Promise<SettledBackings> {
  const { rows } = await db.query<{ user_id: string; character_id: string; name: string; won: boolean }>(
    `update cast_backings b
        set won = exists (select 1 from relationships r
                           where b.character_id in (r.character_a, r.character_b)
                             and r.public_stage in ('dating', 'going_steady')),
            settled_at = now()
       from characters c
      where b.season_id = $1 and b.settled_at is null and c.id = b.character_id
      returning b.user_id, b.character_id, c.name, b.won`,
    [seasonId],
  );
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
