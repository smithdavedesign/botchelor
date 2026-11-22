import type { Db } from "./db";

/**
 * Whether an address's id names anything at all: the one cheap read a page with a loading screen makes before that
 * screen goes out (app/NotFoundBeforeLoading.tsx), so an unknown id answers a real 404 instead of a 200 with the
 * not-found page in it (a "soft 404" to a search engine; 2026-11-22 audit). Each check is no stricter than its page's own
 * rule: a private date, a hidden one or a couple with only private dates still reach their page, which turns them away
 * itself.
 */
async function any(db: Db, sql: string, params: unknown[]): Promise<boolean> {
  return (await db.query(sql, params)).rows.length > 0;
}

export const knownCharacter = (db: Db, id: string) => any(db, `select 1 from characters where id = $1`, [id]);

export const knownEpisode = (db: Db, id: string) => any(db, `select 1 from episodes where id = $1`, [id]);

/** Both characters of a pair: their texts. */
export const knownPair = (db: Db, a: string, b: string) => (a === b ? Promise.resolve(false) : any(db, `select 1 from characters where id in ($1, $2) having count(*) = 2`, [a, b]));

/**
 * A couple's page: two characters that have dated (their relationship row, public or not) or matched. Its page shows
 * one or the other, and is a 404 for a pair with neither, whoever asks.
 */
export const knownCouple = (db: Db, a: string, b: string) => {
  if (a === b) return Promise.resolve(false);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return any(
    db,
    `select 1 where exists (select 1 from relationships where character_a = $1 and character_b = $2)
                 or exists (select 1 from matches where character_lo = $1 and character_hi = $2)`,
    [lo, hi],
  );
};

export const knownAgent = (db: Db, handle: string) => any(db, `select 1 from agent_handles where handle = $1`, [handle]);

/** As the creator's page reads it: the handle in lower case, and not hidden. */
export const knownCreator = (db: Db, handle: string) => any(db, `select 1 from creator_profiles where handle = $1 and not hidden`, [handle.toLowerCase()]);

/** A mixer night that wasn't called off (its page turns a cancelled one away too). */
export const knownMixer = (db: Db, id: string) => any(db, `select 1 from group_nights where id = $1 and kind = 'mixer' and status is distinct from 'cancelled'`, [id]);

/** A double-date invite this viewer is one of the two people on: its page is theirs alone. */
export const knownDouble = (db: Db, id: string, viewerId: string) =>
  any(db, `select 1 from group_nights where id = $1 and kind = 'double' and (created_by = $2 or invite_to = $2)`, [id, viewerId]);
