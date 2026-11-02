/**
 * "Previously on Botchelor": the cold-open line a TV episode starts with when the couple has history
 * (docs/show-style.md). Built from the pair's last aired public date — data that is already public (its ending
 * aired), so it spoils nothing about the episode it opens.
 */
import { dateNumberSql, publicDateSql } from "./date-number";
import type { Db } from "./db";
import { endingWithDetail, type Ending } from "./rules";
import { venuePhrase } from "./venues";

export type PreviouslyOn = {
  /** The pair's last aired date, the way back in for a viewer who missed it. */
  episode_id: string;
  /** The cold-open line itself ("Their second date at the night market ended in a third date."). */
  line: string;
};

/**
 * The cold open for one episode, or null when the pair has no earlier aired public date (a first date, or history
 * that stayed private). Reads only what has aired: the earlier date's venue and its public ending.
 */
export async function previouslyOn(db: Db, episodeId: string): Promise<PreviouslyOn | null> {
  const prev = (
    await db.query<{ id: string; venue: string | null; ending: Ending; ending_detail: string | null; date_number: number | null }>(
      `select pd.id, pd.setup->>'venue' as venue, pd.ending, pd.ending_detail, ${dateNumberSql("pd")} as date_number
         from episodes e
         join episodes pd
           on ((pd.character_a = e.character_a and pd.character_b = e.character_b)
            or (pd.character_a = e.character_b and pd.character_b = e.character_a))
          and pd.id <> e.id and (pd.created_at, pd.id) < (e.created_at, e.id)
        where e.id = $1 and ${publicDateSql("pd")}
        order by pd.created_at desc, pd.id desc
        limit 1`,
      [episodeId],
    )
  ).rows[0];
  if (!prev) return null;
  const n = prev.date_number ?? 1;
  const which = n > 1 ? `Their ${ordinalWord(n)} date` : "Their first date";
  const where = prev.venue ? ` at ${venuePhrase(prev.venue)}` : "";
  const ended = endingWithDetail(prev.ending, n, prev.ending_detail);
  return { episode_id: prev.id, line: `${which}${where} ended in ${ended.charAt(0).toLowerCase()}${ended.slice(1)}.` };
}

const WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
/** "second", "third", … "12th": the ordinal as the narrator would say it. */
function ordinalWord(n: number): string {
  if (n >= 1 && n <= WORDS.length) return WORDS[n - 1];
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
