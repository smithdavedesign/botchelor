/**
 * The portrait SQL, apart from lib/assets.ts so a module the browser bundle also reads (lib/originality.ts, via
 * /create) can use it: lib/assets.ts pulls in sharp (lib/compact-image.ts), which can't build for the browser.
 */
import { artStyleSql, HOUSE_LOOK_VERSION } from "./art-style";
import type { Db } from "./db";
import { HOUSE_PORTRAIT_IDS } from "./portraits";

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
 *
 * A portrait whose ledger row records a reviewed file shipped with the app (`/cast/<file>`, the only shape the image
 * route redirects to) is that file's path itself: no database read and no redirect per face (2026-11-22: Barnaby, a
 * season newcomer in the house look, was the one face of the cast that every list fetched through the image route).
 * The length is asked first, and only a short value is matched: a stored length comes from the value's header, so the
 * multi-megabyte data URLs most rows hold are never read just to rule them out.
 */
export const portraitPathSql = (alias: string): string =>
  `(${approvedPortraitSelect(`${alias}.id`).replace(
    /^select portrait_asset\.id /,
    // A function, so the pattern's `$'` is SQL and not replace()'s "the text after the match".
    () => `select case when octet_length(portrait_asset.url) > 200 then '/api/assets/' || portrait_asset.id
                 when portrait_asset.url ~ '^/cast/[A-Za-z0-9_.-]+\\.(webp|png|jpe?g)$' then portrait_asset.url
                 else '/api/assets/' || portrait_asset.id end `,
  )})`;

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

/**
 * SQL on `alias`: how the show draws the character (PRD styles-and-storylines phase 3). A house character whose face is
 * a house-look portrait is drawn in 2.5D: their newest approved PG portrait is one (HOUSE_LOOK_VERSION), or they have
 * none and their committed file is (lib/portraits.ts v5), the same face the shots start from (lib/show-shots.ts
 * shotSource). Anyone else, in their own style (artStyleSql). It goes by the face, not by is_house alone, so a newcomer
 * whose house-look redraw hasn't been drawn yet keeps a photograph's shots until it is. Their own style stays unset, and
 * After Dark's gate reads artStyleSql, never this, so the house cast stays in After Dark as photographs.
 */
export const showStyleSql = (alias: string): string =>
  `(case when ${alias}.is_house and coalesce(
      (select coalesce(portrait_asset.prompt_version, '') ${approvedPortraitSelect(`${alias}.id`).replace(/^select portrait_asset\.id /, "")}),
      case when ${alias}.id in (${[...HOUSE_PORTRAIT_IDS].map((id) => `'${id}'`).join(", ")}) then '${HOUSE_LOOK_VERSION}' end
    ) = '${HOUSE_LOOK_VERSION}' then 'semi_real' else ${artStyleSql(alias)} end)`;
