/**
 * Which format each season runs in (lib/season-format.ts): one row a season (season_formats), written from
 * /admin/season only. A season with no row is classic — the show exactly as it was before formats existed — so
 * nothing needs a row until David picks another format for a month.
 */
import { freezeFormat } from "./show-seasons";
import type { Db } from "./db";
import {
  DEFAULT_SEASON_FORMAT,
  SEASON_FORMAT_SLUGS,
  seasonFormat,
  type SeasonFormatDef,
  type SeasonFormatSlug,
} from "./season-format";
import { seasonIdOf } from "./season-window";
import { inFlight } from "./shared-cache";
import { ballotWinner, seasonBallotTally } from "./season-vote";

let override: SeasonFormatSlug | null = null;
/** Tests pin the running season's format (null = read the store). */
export function setSeasonFormatForTests(slug: SeasonFormatSlug | null): void {
  override = slug;
}

const isSlug = (s: string): s is SeasonFormatSlug => (SEASON_FORMAT_SLUGS as readonly string[]).includes(s);

/**
 * A season's format: the admin's row when there is one; else the viewers' ballot winner for it (lib/season-vote.ts,
 * frozen once the season starts); else classic (a row from a format that no longer exists reads as classic too).
 */
export function seasonFormatSlug(db: Db, seasonId: string): Promise<SeasonFormatSlug> {
  // Asked from several corners of one page at once (the season line, the vote, casting, the cast): one read for all of them.
  return inFlight(db, `season-format:${seasonId}`, async () => {
    // One round trip for both: the admin's row, and the format frozen when the season started (lib/show-seasons.ts).
    const row = (
      await db.query<{ admin: string | null; frozen: string | null }>(
        `select (select slug from season_formats where season_id = $1) as admin, (select format from show_seasons where id = $1) as frozen`,
        [seasonId],
      )
    ).rows[0];
    if (row?.admin) return isSlug(row.admin) ? row.admin : DEFAULT_SEASON_FORMAT;
    // A started season's answer no longer moves with the ballot's rows (an account deleted takes its vote with it).
    if (row?.frozen && isSlug(row.frozen)) return row.frozen;
    return ballotWinner(await seasonBallotTally(db, seasonId).catch(() => new Map())) ?? DEFAULT_SEASON_FORMAT;
  });
}

/** The format the season containing `now` runs in. */
export async function seasonFormatNow(db: Db, now: Date = new Date()): Promise<SeasonFormatDef> {
  if (override) return seasonFormat(override);
  return seasonFormat(await seasonFormatSlug(db, seasonIdOf(now)));
}

/**
 * Sets a season's format (/admin/season). Picking classic removes the row (no row IS classic) unless the viewers'
 * ballot would then pick something else: then classic is stored, so the admin's pick still wins.
 */
export async function setSeasonFormat(db: Db, seasonId: string, slug: SeasonFormatSlug): Promise<void> {
  if (slug === DEFAULT_SEASON_FORMAT && (ballotWinner(await seasonBallotTally(db, seasonId)) ?? DEFAULT_SEASON_FORMAT) === DEFAULT_SEASON_FORMAT) {
    await db.query(`delete from season_formats where season_id = $1`, [seasonId]);
  } else {
    await db.query(
      `insert into season_formats (season_id, slug) values ($1, $2)
       on conflict (season_id) do update set slug = excluded.slug`,
      [seasonId, slug],
    );
  }
  // The registry's frozen copy follows the admin (a season that hasn't started has none yet).
  await freezeFormat(db, seasonId, new Date(), { again: true }).catch(() => null);
}
