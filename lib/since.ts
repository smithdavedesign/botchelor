/**
 * "Since you were here" (2026-11-01 audit, J4): a returning visitor's characters, the newest news first, each with the
 * one thing waiting on them. Coming back used to look like a first visit: "Jump back in" sat ~1,460 px down a phone
 * and only offered another date, whatever had happened meanwhile.
 *
 * Per character, the first of: unread texts, new matches (lib/inbox.ts newsByCharacter), a date being filmed, a date
 * ready to watch, the last date's ending; else no date yet. All $0 reads.
 */
import type { Db } from "./db";
import type { CharacterRef } from "./game";
import { newsByCharacter } from "./inbox";
import { endingLabel, type Ending } from "./rules";

export type SinceRow = {
  character: CharacterRef;
  /** What happened, in a few words ("2 new texts", "On a date with Juniper right now"). */
  news: string;
  /** The one thing to do about it, and where. */
  action: string;
  href: string;
  /** When it happened (ISO); null for a character with nothing yet. */
  at: string | null;
};

type LatestDate = {
  character_id: string;
  episode_id: string;
  status: "generating" | "ready";
  ending: Ending | null;
  aired: boolean;
  partner: string;
  date_number: number | null;
  created_at: Date | string;
};

/** Each character's newest date (After Dark's stay on its own host). */
async function latestDates(db: Db, ids: readonly string[]): Promise<Map<string, LatestDate>> {
  const { rows } = await db.query<LatestDate>(
    `select distinct on (c.id) c.id as character_id, e.id as episode_id, e.status, e.ending, e.revealed_at is not null as aired,
            p.name as partner, (e.setup->>'date_number')::int as date_number, e.created_at
       from unnest($1::text[]) as c(id)
       join episodes e on c.id in (e.character_a, e.character_b)
       join characters p on p.id = case when e.character_a = c.id then e.character_b else e.character_a end
      where e.status in ('generating', 'ready') and coalesce((e.setup->>'after_dark')::boolean, false) = false
      order by c.id, e.created_at desc, e.id`,
    [ids],
  );
  return new Map(rows.map((r) => [r.character_id, r]));
}

const plural = (n: number, one: string) => `${n} new ${one}${n === 1 ? "" : one.endsWith("h") ? "es" : "s"}`;

export async function sinceYouWereHere(db: Db, userId: string, mine: readonly CharacterRef[]): Promise<SinceRow[]> {
  if (!mine.length) return [];
  const ids = mine.map((c) => c.id);
  const [news, latest] = await Promise.all([newsByCharacter(db, userId, ids), latestDates(db, ids)]);
  const rows = mine.map((character): SinceRow => {
    const n = news.get(character.id);
    const matches = `/matches?character=${encodeURIComponent(character.id)}`;
    const another = `/create?character=${encodeURIComponent(character.id)}`;
    if (n?.texts) return { character, news: plural(n.texts, "text"), action: "Read", href: matches, at: n.latest };
    if (n?.matches) return { character, news: plural(n.matches, "match"), action: "See who", href: matches, at: n.latest };
    const d = latest.get(character.id);
    if (!d) return { character, news: "No dates yet", action: "Send on a date", href: another, at: null };
    const at = new Date(d.created_at).toISOString();
    const episode = `/episodes/${encodeURIComponent(d.episode_id)}`;
    if (d.status === "generating") return { character, news: `On a date with ${d.partner} right now`, action: "Watch", href: `${episode}?play=1`, at };
    if (!d.aired || !d.ending) return { character, news: `Their date with ${d.partner} is ready`, action: "Watch it", href: episode, at };
    return { character, news: `Last date, with ${d.partner}: ${endingLabel(d.ending, d.date_number)}`, action: "Send on another", href: another, at };
  });
  // Newest news first; characters with nothing yet keep their order, last.
  return rows.map((r, i) => ({ r, i })).sort((x, y) => (y.r.at ?? "").localeCompare(x.r.at ?? "") || x.i - y.i).map(({ r }) => r);
}
