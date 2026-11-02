/**
 * Audience ratings — the cast leaderboard ("most likable / most surprising").
 *
 * A $0 social signal: one vote per viewer per character per category, toggled on and off, never a model
 * call. It NEVER touches the engine, the date outcome, predictions, or league/season scoring — those stay
 * the prediction game. Ratings feed only the cast leaderboard and the owner's all-time points total (see
 * getPoints in lib/game.ts). You can't rate your own character.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { RATING_CATEGORY_IDS, type RatingCategory } from "./rules";

export type RatingCounts = Record<RatingCategory, number>;
export type RatingMine = Record<RatingCategory, boolean>;

const zeroCounts = (): RatingCounts =>
  Object.fromEntries(RATING_CATEGORY_IDS.map((c) => [c, 0])) as RatingCounts;

async function countsFor(db: Db, characterId: string): Promise<RatingCounts> {
  const { rows } = await db.query<{ category: RatingCategory; n: number }>(
    `select category, count(*)::int as n from character_ratings where character_id = $1 group by category`,
    [characterId],
  );
  const counts = zeroCounts();
  for (const r of rows) counts[r.category] = r.n;
  return counts;
}

export type RateResult = { rated: boolean; counts: RatingCounts };

/**
 * Toggle the viewer's rating of a character in one category. Returns the new state and the fresh counts,
 * `null` if the character doesn't exist, or `"self"` if the viewer owns it (you can't rate your own OC).
 */
export async function rateCharacter(
  db: Db,
  userId: string,
  characterId: string,
  category: RatingCategory,
): Promise<RateResult | null | "self"> {
  const { rows } = await db.query<{ owner_id: string | null }>(
    `select owner_id from characters where id = $1`,
    [characterId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id === userId) return "self";

  const removed = (
    await db.query<{ rater_id: string }>(
      `delete from character_ratings where rater_id = $1 and character_id = $2 and category = $3 returning rater_id`,
      [userId, characterId, category],
    )
  ).rows.length;
  if (!removed) {
    await db.query(
      `insert into character_ratings (rater_id, character_id, category) values ($1, $2, $3)
       on conflict do nothing`,
      [userId, characterId, category],
    );
  }
  return { rated: removed === 0, counts: await countsFor(db, characterId) };
}

export type CharacterRatings = { counts: RatingCounts; mine: RatingMine; is_owner: boolean };

/** The ratings for a character: counts per category, which ones this viewer gave, and whether they own it. */
export async function getCharacterRatings(
  db: Db,
  characterId: string,
  viewerId: string | null,
): Promise<CharacterRatings> {
  const counts = await countsFor(db, characterId);
  const mine = Object.fromEntries(RATING_CATEGORY_IDS.map((c) => [c, false])) as RatingMine;
  let isOwner = false;
  if (viewerId) {
    const owner = (
      await db.query<{ is_owner: boolean }>(
        `select owner_id = $2 as is_owner from characters where id = $1`,
        [characterId, viewerId],
      )
    ).rows[0];
    isOwner = owner?.is_owner ?? false;
    const { rows } = await db.query<{ category: RatingCategory }>(
      `select category from character_ratings where rater_id = $1 and character_id = $2`,
      [viewerId, characterId],
    );
    for (const r of rows) mine[r.category] = true;
  }
  return { counts, mine, is_owner: isOwner };
}

export type TopRated = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null; count: number };

/**
 * The top-rated characters in a category, for the cast leaderboard. Ties break by name. `within`: only the ratings given
 * in that window (a season's awards, lib/reunion.ts); without it, all time.
 */
export async function topRatedCharacters(db: Db, category: RatingCategory, limit = 5, within?: { start: Date; end: Date }): Promise<TopRated[]> {
  const { rows } = await db.query<TopRated>(
    `select c.id, c.name, c.is_house as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, count(*)::int as count
       from character_ratings r
       join characters c on c.id = r.character_id
      where r.category = $1
        and ($3::timestamptz is null or r.created_at >= $3::timestamptz) and ($4::timestamptz is null or r.created_at < $4::timestamptz)
      group by c.id, c.name, c.is_house, c.avatar_hue
      order by count desc, c.name
      limit $2`,
    [category, limit, within?.start.toISOString() ?? null, within?.end.toISOString() ?? null],
  );
  return rows;
}
