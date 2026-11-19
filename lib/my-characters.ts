/**
 * The viewer's own characters for the header's face (app/CharacterPicker.tsx; lib/current-character.ts): each one's
 * face, who it's dating when it's taken (lib/partners.ts takenSql: one partner and with someone, so it can't swipe or
 * go on other dates), and how much is new for it (lib/inbox.ts newsByCharacter). Two statements started together, so
 * the layout waits one round trip for them, the same as the "has a character" check they replace.
 */
import type { Db } from "./db";
import { newsByCharacter } from "./inbox";
import { takenSql } from "./partners";
import { portraitPathSql } from "./portrait-sql";

export type PickerCharacter = {
  id: string;
  name: string;
  hue: number | null;
  portrait: string | null;
  /** Who it's dating, newest first, when it's taken; empty when it isn't. */
  taken: string[];
  /** Unread texts and new matches. */
  news: number;
};

/** The most a header lists: the same cap as an owner's own list (lib/dating.ts listMyDatingProfiles). */
export const PICKER_MAX = 50;

/** Newest first, the order every list of an owner's characters uses. */
export async function pickerCharacters(db: Db, userId: string): Promise<PickerCharacter[]> {
  const rows = db
    .query<{ id: string; name: string; hue: number | null; portrait: string | null; taken: string[] | null }>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait,
              case when ${takenSql("c")} then (
                select array_agg(p.name order by r.last_at desc nulls last, p.id)
                  from relationships r
                  join characters p on p.id = case when r.character_a = c.id then r.character_b else r.character_a end
                 where (r.character_a = c.id or r.character_b = c.id) and r.stage in ('dating', 'going_steady')
              ) end as taken
         from characters c
        where c.owner_id = $1 and not c.is_house
        order by c.created_at desc, c.id
        limit ${PICKER_MAX}`,
      [userId],
    )
    .then((r) => r.rows);
  const [mine, news] = await Promise.all([rows, newsByCharacter(db, userId, rows.then((r) => r.map((c) => c.id))).catch(() => new Map())]);
  return mine.map((c) => {
    const n = news.get(c.id);
    return { id: c.id, name: c.name, hue: c.hue, portrait: c.portrait, taken: c.taken ?? [], news: n ? n.texts + n.matches : 0 };
  });
}
