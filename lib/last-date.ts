import type { Db } from "./db";
import type { Reflections } from "./reflection";
import { dateNumberSql } from "./date-number";
import { endingLabel, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
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
  /** Which date it was for the pair (lib/date-number.ts): 2 and up is "another one". */
  dateNumber: number | null;
  /** The place's id (episodes.setup.venue), for a picture of it; `venue` is the place in words. */
  venueId: string | null;
  /** The two names as the date has them, side a then side b (for the snapshot's alt text, lib/date-photo.ts). */
  names: [string, string];
};

type Row = { id: string; ending: Ending; venue: string | null; reflections: Reflections | null; side: "a" | "b"; partner: string; partner_id: string; a_name: string; b_name: string; date_number: number | null; created_at: Date | string };

const select = (where: string) => `select e.id, e.ending, e.setup->>'venue' as venue, e.reflections, e.created_at,
            case when e.character_a = $1 then 'a' else 'b' end as side,
            case when e.character_a = $1 then b.name else a.name end as partner,
            case when e.character_a = $1 then b.id else a.id end as partner_id,
            a.name as a_name, b.name as b_name,
            ${dateNumberSql("e")} as date_number
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where (e.character_a = $1 or e.character_b = $1) and e.status = 'ready' ${where}
      order by e.created_at desc limit 1`;

function toLastDate(r: Row | undefined): LastDate | null {
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
    dateNumber: r.date_number,
    venueId: r.venue,
    names: [r.a_name, r.b_name],
  };
}

export async function lastDateOf(db: Db, characterId: string): Promise<LastDate | null> {
  const { rows } = await db.query<Row>(select(""), [characterId]);
  return toLastDate(rows[0]);
}

/**
 * A character's last date anyone may watch, for someone who isn't its owner (the cast's opener and its prompt,
 * lib/cast-opener.ts): finished, aired, public, on the show (never After Dark's) and not hidden by reports. The
 * reflection is the character's own words about it; a cast character's sheet and memory already reach the people it
 * talks with through its prompt (lib/companion-prompt.ts), so this adds no new kind of thing a stranger may hear.
 */
export async function lastAiredDateOf(db: Db, characterId: string): Promise<LastDate | null> {
  const { rows } = await db.query<Row>(
    select(`and e.revealed_at is not null and e.visibility = 'public'
        and coalesce((e.setup->>'after_dark')::boolean, false) = false
        and (select count(*) from reports r where r.episode_id = e.id) < $2::int`),
    [characterId, REPORT_HIDE_THRESHOLD],
  );
  return toLastDate(rows[0]);
}
