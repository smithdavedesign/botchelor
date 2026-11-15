import type { Db } from "./db";
import type { Reflections } from "./reflection";
import { dateNumberSql } from "./date-number";
import { endingLabel, type Ending } from "./rules";
import { venuePhrase } from "./venues";

/**
 * A character's last finished date, as its own companion prompt tells it (lib/companion-prompt.ts, the "yours" branch):
 * who with, where, how it ended and what it thought afterwards (lib/reflection.ts, best effort: null when none was
 * produced). Read only for the character's owner, so a private or unaired date is fine here: both are the owner's own.
 */
export type LastDate = {
  episodeId: string;
  partnerId: string;
  partner: string;
  /** The place in words ("the night market"), or null for a date written before venues existed. */
  venue: string | null;
  ending: Ending;
  endingLabel: string;
  reflection: string | null;
  at: string;
};

export async function lastDateOf(db: Db, characterId: string): Promise<LastDate | null> {
  const { rows } = await db.query<{ id: string; ending: Ending; venue: string | null; reflections: Reflections | null; side: "a" | "b"; partner: string; partner_id: string; date_number: number | null; created_at: Date | string }>(
    `select e.id, e.ending, e.setup->>'venue' as venue, e.reflections, e.created_at,
            case when e.character_a = $1 then 'a' else 'b' end as side,
            case when e.character_a = $1 then b.name else a.name end as partner,
            case when e.character_a = $1 then b.id else a.id end as partner_id,
            ${dateNumberSql("e")} as date_number
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where (e.character_a = $1 or e.character_b = $1) and e.status = 'ready'
      order by e.created_at desc limit 1`,
    [characterId],
  );
  const r = rows[0];
  if (!r) return null;
  const reflection = r.reflections?.[r.side] ?? null;
  return {
    episodeId: r.id,
    partnerId: r.partner_id,
    partner: r.partner,
    venue: r.venue ? venuePhrase(r.venue) : null,
    ending: r.ending,
    endingLabel: endingLabel(r.ending, r.date_number),
    reflection: typeof reflection === "string" && reflection.trim() ? reflection.trim() : null,
    at: new Date(r.created_at).toISOString(),
  };
}
