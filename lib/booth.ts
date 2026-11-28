import type { Db } from "./db";
import { listedDateSql } from "./public-cast";

/** One line said to camera, for the character page's confessional booth (app/characters/[id]/Booth.tsx). */
export type BoothLine = { line: string; episode_id: string | null; at: string };

export const BOOTH_LINES = 4;

/**
 * What a character has said to camera, newest first, in one read (2026-11-28, Dave: "a confessional booth on
 * character pages"). Two sources, each under the rule it already has elsewhere:
 *  - a date's confessional lines (episodes.confessionals, [a's, b's]) only once the date has aired, is public and
 *    listed, and its creator chose to share them (the episode page's and the reunion reel's gate); a house character's
 *    own line also when its date partner didn't share, since the show owns that character's words;
 *  - its live posts to the booth feed (lib/confessionals.ts), which are public by construction.
 * Never anything from a private character's date or a removed post.
 */
export async function boothLines(db: Db, characterId: string, limit = BOOTH_LINES): Promise<BoothLine[]> {
  const { rows } = await db.query<{ line: string | null; episode_id: string | null; at: string | Date }>(
    `select * from (
       select (case when e.character_a = $1 then e.confessionals ->> 0 else e.confessionals ->> 1 end) as line, e.id as episode_id, e.revealed_at as at
         from episodes e join characters me on me.id = $1
        where (e.character_a = $1 or e.character_b = $1) and e.revealed_at is not null and e.visibility = 'public'
          and (e.confessionals_shared or me.is_house) and ${listedDateSql("e")}
          and jsonb_typeof(e.confessionals) = 'array' and jsonb_array_length(e.confessionals) = 2
       union all
       select p.body as line, p.about_episode as episode_id, p.created_at as at
         from confessionals p join characters c on c.id = p.character_id
        where p.character_id = $1 and p.status = 'live' and c.visibility = 'public'
     ) b
     where coalesce(trim(line), '') <> ''
     order by at desc
     limit $2`,
    [characterId, limit],
  );
  return rows.map((r) => ({ line: r.line!.trim(), episode_id: r.episode_id, at: new Date(r.at).toISOString() }));
}
