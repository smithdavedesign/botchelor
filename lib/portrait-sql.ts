/**
 * The portrait SQL, apart from lib/assets.ts so a module the browser bundle also reads (lib/originality.ts, via
 * /create) can use it: lib/assets.ts pulls in sharp (lib/compact-image.ts), which can't build for the browser.
 */
import type { Db } from "./db";

/**
 * The newest approved portrait of the character whose id is the SQL expression `characterId`. Only a pg one: a
 * portrait is their face on every public page and share card.
 */
export const approvedPortraitSelect = (characterId: string) =>
  `select portrait_asset.id from character_assets portrait_asset
    where portrait_asset.character_id = ${characterId} and portrait_asset.kind = 'portrait'
      and portrait_asset.review_status = 'approved' and portrait_asset.url is not null
      and portrait_asset.content_rating = 'pg'
    order by portrait_asset.created_at desc limit 1`;

/**
 * SQL for the served path (`/api/assets/<id>`) of the newest approved portrait of the `characters` row aliased
 * `alias`, or null when it has none. approvedPortraitId inline, so every list of characters (an episode's two,
 * the feed, the cast, a watch room) carries its generated portraits in the same statement, not a read per avatar.
 */
export const portraitPathSql = (alias: string): string => `('/api/assets/' || (${approvedPortraitSelect(`${alias}.id`)}))`;

/**
 * Each character in a list already loaded, with its portrait (portraitPathSql) in one query: for lists built from
 * stored data or scored in code, where the portrait can't ride in the statement that found them (2026-11-03: these
 * showed initials). A private character's stays null unless `private` (the owner's or an admin's own view).
 */
export async function withPortraits<T extends { id: string }>(db: Db, items: T[], opts: { private?: boolean } = {}): Promise<(T & { portrait: string | null })[]> {
  if (!items.length) return [];
  const { rows } = await db.query<{ id: string; portrait: string | null }>(
    `select c.id, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1) and ($2 or c.visibility = 'public')`,
    [[...new Set(items.map((i) => i.id))], Boolean(opts.private)],
  );
  const byId = new Map(rows.map((r) => [r.id, r.portrait]));
  return items.map((i) => ({ ...i, portrait: byId.get(i.id) ?? null }));
}

