/**
 * Which format each season runs in (lib/season-format.ts): one row a season (season_formats), written from
 * /admin/season only. A season with no row is classic — the show exactly as it was before formats existed — so
 * nothing needs a row until David picks another format for a month.
 */
import type { Db } from "./db";
import {
  DEFAULT_SEASON_FORMAT,
  SEASON_FORMAT_SLUGS,
  seasonFormat,
  type SeasonFormatDef,
  type SeasonFormatSlug,
} from "./season-format";
import { seasonIdOf } from "./season-window";

let override: SeasonFormatSlug | null = null;
/** Tests pin the running season's format (null = read the store). */
export function setSeasonFormatForTests(slug: SeasonFormatSlug | null): void {
  override = slug;
}

const isSlug = (s: string): s is SeasonFormatSlug => (SEASON_FORMAT_SLUGS as readonly string[]).includes(s);

/** The stored slug for a season, 'classic' when there's no row (or a row from a format that no longer exists). */
export async function seasonFormatSlug(db: Db, seasonId: string): Promise<SeasonFormatSlug> {
  const row = (await db.query<{ slug: string }>(`select slug from season_formats where season_id = $1`, [seasonId])).rows[0];
  return row && isSlug(row.slug) ? row.slug : DEFAULT_SEASON_FORMAT;
}

/** The format the season containing `now` runs in. */
export async function seasonFormatNow(db: Db, now: Date = new Date()): Promise<SeasonFormatDef> {
  if (override) return seasonFormat(override);
  return seasonFormat(await seasonFormatSlug(db, seasonIdOf(now)));
}

/** Sets a season's format (/admin/season). Picking classic removes the row: no row IS classic. */
export async function setSeasonFormat(db: Db, seasonId: string, slug: SeasonFormatSlug): Promise<void> {
  if (slug === DEFAULT_SEASON_FORMAT) {
    await db.query(`delete from season_formats where season_id = $1`, [seasonId]);
    return;
  }
  await db.query(
    `insert into season_formats (season_id, slug) values ($1, $2)
     on conflict (season_id) do update set slug = excluded.slug`,
    [seasonId, slug],
  );
}
