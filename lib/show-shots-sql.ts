/**
 * Reading the show kit's shots (lib/show-shots.ts) for a page: which are current, as addresses. Kept apart from the
 * drawing so the pages' queries (lib/game.ts, lib/watch.ts, lib/ceremony.ts) don't load the checker or the image code.
 */
import { showStyleSql } from "./portrait-sql";
import type { Db } from "./db";
import { SHOTS, type Shot, type ShotUrls } from "./show-shots-shared";

export const shotUrl = (id: string): string => `/api/shots/${encodeURIComponent(id)}.webp`;

/**
 * The ready shots of a character's current portrait and style: the joins and the condition, on `s` (show_shots). A
 * house character's file can only change with a deploy, so any of their static portraits counts until the batch redraws.
 */
const CURRENT_SHOTS = `
       from show_shots s
       join characters c on c.id = s.character_id
       left join lateral (
         select id from character_assets
          where character_id = c.id and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' and url is not null
          order by created_at desc limit 1
       ) a on true
      where s.status = 'ready'
        and s.style = ${showStyleSql("c")}
        and (s.portrait_key = a.id or (a.id is null and s.portrait_key like 'static:%'))`;

/** SQL: one character's ready shots as {shot: id}, or null, for a query that already has their id (`idExpr`). */
export const shotsJsonSql = (idExpr: string): string => `(select json_object_agg(s.shot, s.id) ${CURRENT_SHOTS} and s.character_id = ${idExpr})`;

/** {shot: id} as a row's shots column has it, as the page's addresses. */
export function shotUrlsOf(ids: Record<string, string> | null | undefined): ShotUrls | null {
  if (!ids) return null;
  const out: ShotUrls = {};
  for (const [shot, id] of Object.entries(ids)) if ((SHOTS as readonly string[]).includes(shot)) out[shot as Shot] = shotUrl(id);
  return Object.keys(out).length ? out : null;
}

/** The ready shots of each character's current portrait and style, for a page: one query. */
export async function shotsFor(db: Db, characterIds: readonly string[]): Promise<Record<string, ShotUrls>> {
  const ids = [...new Set(characterIds.filter(Boolean))];
  if (!ids.length) return {};
  const { rows } = await db.query<{ id: string; character_id: string; shot: Shot }>(`select s.id, s.character_id, s.shot ${CURRENT_SHOTS} and s.character_id = any($1::text[])`, [ids]);
  const out: Record<string, ShotUrls> = {};
  for (const r of rows) (out[r.character_id] ??= {})[r.shot] = shotUrl(r.id);
  return out;
}
