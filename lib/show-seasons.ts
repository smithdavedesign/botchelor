/**
 * Shows and their seasons as rows (docs/data-model.md; the 2026-11-16 "one connected model" plan, stages 1 and 2).
 *
 * Until now a season was only an id computed from a date (lib/season-window.ts): 29 columns hold one and none could be
 * joined to anything, a date's season was worked out from when it aired on every read, and a season's format was read
 * from the live ballot, so a past season's format could change when votes were deleted. Now:
 *
 *  - `shows` has one row, `botchelor`. A second show is another row (and its seasons get ids of their own, `<show>-s1`:
 *    Botchelor keeps the date ids every table already holds).
 *  - `show_seasons` has a row for every season from the first date that aired to the one after the season on air:
 *    its show, number, start and end, and its FORMAT, frozen on the first pass after it starts (the admin's pick, else
 *    the ballot as it stood, else classic). An admin changing a season's format on /admin/season refreezes it.
 *  - Every date that airs is stamped with its season and show (`episodes.season_id`, `episodes.show_id`) at the moment
 *    it airs, by looking the season up in the registry (`seasonAtSql`). Dates that aired before this shipped, and any
 *    row a path missed, are filled by the hourly job a batch at a time (`backfillEpisodeSeasons`). Never in the schema.
 *
 * `seasonIdOf` (lib/season-window.ts) stays the answer to "which season is it now"; the stored key is the answer to
 * "which season was this date in". tests/show-seasons.test.ts holds the two to each other.
 *
 * SEASON_KEYS=0 stops the stamping and the backfill (the columns stay, null): nothing reads them that has no fallback.
 */
import type { Db } from "./db";
import { DEFAULT_SEASON_FORMAT, SEASON_FORMAT_SLUGS, type SeasonFormatSlug } from "./season-format";
import { seasonNumber } from "./season-ref";
import { ballotWinner, seasonBallotTally } from "./season-vote";
import { nextSeasonStart, seasonIdOf, seasonWindow } from "./season-window";

type Env = Record<string, string | undefined>;

/** The one show there is. A column that names a show defaults to it. */
export const SHOW_ID = "botchelor";

export const seasonKeysOn = (env: Env = process.env): boolean => env.SEASON_KEYS?.trim() !== "0";

const isSlug = (s: string | null | undefined): s is SeasonFormatSlug => typeof s === "string" && (SEASON_FORMAT_SLUGS as readonly string[]).includes(s);

/**
 * SQL for "the season of a show that was on air at this moment": a scalar subquery over the registry, null when the
 * registry has no row for that moment yet (the backfill fills the date in later). `at` and `show` are SQL expressions.
 */
export const seasonAtSql = (at: string, show = `'${SHOW_ID}'`): string =>
  `(select s.id from show_seasons s where s.show_id = ${show} and s.starts_at <= ${at} and s.ends_at > ${at} order by s.starts_at desc limit 1)`;

export type SeasonSpan = { id: string; number: number | null; starts_at: string; ends_at: string };

/** Every season from the one containing `from` to the one containing `to`, in order (lib/season-window.ts decides each). */
export function seasonSpans(from: Date, to: Date): SeasonSpan[] {
  const out: SeasonSpan[] = [];
  let at = new Date(Math.min(from.getTime(), to.getTime()));
  // A guard, not a limit anyone should meet: 600 seasons is fifty years of months.
  for (let i = 0; i < 600; i++) {
    const { start, end } = seasonWindow(at);
    const id = start.toISOString().slice(0, 10);
    out.push({ id, number: seasonNumber(id), starts_at: start.toISOString(), ends_at: end.toISOString() });
    if (end.getTime() > to.getTime()) break;
    at = end;
  }
  return out;
}

/** A started season's format, decided now: the admin's row, else the ballot as it stands, else classic. */
async function resolveFormat(db: Db, seasonId: string): Promise<{ format: SeasonFormatSlug; source: "admin" | "ballot" | "default" }> {
  const admin = (await db.query<{ slug: string }>(`select slug from season_formats where season_id = $1`, [seasonId])).rows[0]?.slug;
  if (admin) return { format: isSlug(admin) ? admin : DEFAULT_SEASON_FORMAT, source: "admin" };
  const winner = ballotWinner(await seasonBallotTally(db, seasonId).catch(() => new Map()));
  return winner ? { format: winner, source: "ballot" } : { format: DEFAULT_SEASON_FORMAT, source: "default" };
}

/**
 * Freezes (or refreezes) one season's format in the registry, when the season has started. Called by the hourly pass
 * for a season that has none yet, and by /admin/season after an admin changes a season's format.
 */
export async function freezeFormat(db: Db, seasonId: string, now: Date = new Date(), opts: { again?: boolean } = {}): Promise<SeasonFormatSlug | null> {
  const row = (await db.query<{ format: string | null; started: boolean }>(`select format, starts_at <= $2::timestamptz as started from show_seasons where id = $1`, [seasonId, now.toISOString()])).rows[0];
  if (!row || !row.started) return null;
  if (row.format && !opts.again) return isSlug(row.format) ? row.format : DEFAULT_SEASON_FORMAT;
  const { format, source } = await resolveFormat(db, seasonId);
  await db.query(`update show_seasons set format = $2, format_source = $3 where id = $1`, [seasonId, format, source]);
  return format;
}

/** A season's frozen format, or null (not started, not in the registry yet, or frozen as something that no longer exists). */
export async function frozenFormat(db: Db, seasonId: string): Promise<SeasonFormatSlug | null> {
  const f = (await db.query<{ format: string | null }>(`select format from show_seasons where id = $1`, [seasonId])).rows[0]?.format;
  return isSlug(f) ? f : null;
}

/**
 * Keeps the registry whole: a row for every season from the first date that aired to the season after this one, and a
 * frozen format on every season that has started. One cheap read when there is nothing to do (the hourly job's case).
 */
export async function ensureShowSeasons(db: Db, now: Date = new Date()): Promise<{ added: number; frozen: number }> {
  const current = seasonIdOf(now);
  const next = seasonIdOf(nextSeasonStart(now));
  const have = (
    await db.query<{ id: string; format: string | null; started: boolean }>(
      `select id, format, starts_at <= $2::timestamptz as started from show_seasons where show_id = $1 and (ends_at > $2::timestamptz or format is null)`,
      [SHOW_ID, now.toISOString()],
    )
  ).rows;
  const unfrozen = have.filter((r) => r.started && !r.format).map((r) => r.id);
  let added = 0;
  if (!have.some((r) => r.id === current) || !have.some((r) => r.id === next)) {
    const first = (await db.query<{ first: Date | string | null }>(`select min(revealed_at) as first from episodes where revealed_at is not null`)).rows[0]?.first;
    const spans = seasonSpans(first ? new Date(first) : now, nextSeasonStart(now));
    const res = await db.query<{ id: string }>(
      `insert into show_seasons (id, show_id, number, starts_at, ends_at)
       select * from unnest($1::text[], $2::text[], $3::int[], $4::timestamptz[], $5::timestamptz[])
       on conflict (id) do nothing returning id`,
      [spans.map((s) => s.id), spans.map(() => SHOW_ID), spans.map((s) => s.number), spans.map((s) => s.starts_at), spans.map((s) => s.ends_at)],
    );
    added = res.rows.length;
    for (const r of res.rows) if (Date.parse(`${r.id}T00:00:00Z`) <= now.getTime()) unfrozen.push(r.id);
  }
  let frozen = 0;
  for (const id of new Set(unfrozen)) if (await freezeFormat(db, id, now)) frozen++;
  return { added, frozen };
}

/**
 * Stamps dates that aired without a season (everything before this shipped; anything a write path missed): a batch a
 * pass, each from the registry row its air time falls in. Idempotent; returns how many it filled.
 */
export async function backfillEpisodeSeasons(db: Db, limit = 2000): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `with due as (select id from episodes where season_id is null and revealed_at is not null order by revealed_at limit $1),
          done as (
            update episodes e set season_id = s.id
              from show_seasons s, due
             where e.id = due.id and s.show_id = e.show_id and e.revealed_at >= s.starts_at and e.revealed_at < s.ends_at
            returning 1)
     select count(*)::int as n from done`,
    [limit],
  );
  return Number(rows[0]?.n ?? 0);
}

export type SeasonKeyHealth = { seasons: number; frozen: number; aired: number; stamped: number; unstamped: number; mismatched: number };

/** How whole the keys are: aired dates with and without a season, and any whose stored season isn't the one its air time falls in. */
export async function seasonKeyHealth(db: Db): Promise<SeasonKeyHealth> {
  const [s, e] = await Promise.all([
    db.query<{ seasons: number; frozen: number }>(`select count(*)::int as seasons, count(format)::int as frozen from show_seasons`),
    db.query<{ aired: number; stamped: number; mismatched: number }>(
      `select count(*)::int as aired, count(e.season_id)::int as stamped,
              count(*) filter (where e.season_id is not null and e.season_id is distinct from ${seasonAtSql("e.revealed_at", "e.show_id")})::int as mismatched
         from episodes e where e.revealed_at is not null`,
    ),
  ]);
  const ep = e.rows[0] ?? { aired: 0, stamped: 0, mismatched: 0 };
  return { seasons: s.rows[0]?.seasons ?? 0, frozen: s.rows[0]?.frozen ?? 0, aired: ep.aired, stamped: ep.stamped, unstamped: ep.aired - ep.stamped, mismatched: ep.mismatched };
}

/** The hourly pass for stages 1 and 2: the registry, then a batch of the backfill. */
export async function seasonKeysUpkeep(db: Db, now: Date = new Date(), env: Env = process.env): Promise<{ added: number; frozen: number; stamped: number } | null> {
  const seasons = await ensureShowSeasons(db, now);
  if (!seasonKeysOn(env)) return { ...seasons, stamped: 0 };
  return { ...seasons, stamped: await backfillEpisodeSeasons(db) };
}
