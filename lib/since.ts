/**
 * "Since you were here" (2026-11-01 audit, J4): a returning visitor's characters, the newest news first, each with the
 * one thing waiting on them. Coming back used to look like a first visit: "Jump back in" sat ~1,460 px down a phone
 * and only offered another date, whatever had happened meanwhile.
 *
 * Per character, the first of: an unread text from the character itself (its companion thread, lib/after-date-text.ts),
 * unread texts, new matches (lib/inbox.ts newsByCharacter), a text of its own still waiting on the person's word (about a
 * date, or about what the house said: lib/house-texts.ts), a date being filmed, a date ready to watch, the last date's
 * ending; else no date yet. All $0 reads.
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
  /** The house booked it while the owner was away (lib/character-life.ts LIFE_MET_VIA). */
  life: boolean;
};

/** Each character's newest date (After Dark's stay on its own host). */
async function latestDates(db: Db, ids: readonly string[]): Promise<Map<string, LatestDate>> {
  const { rows } = await db.query<LatestDate>(
    `select distinct on (c.id) c.id as character_id, e.id as episode_id, e.status, e.ending, e.revealed_at is not null as aired,
            p.name as partner, (e.setup->>'date_number')::int as date_number, e.created_at,
            coalesce(e.setup->>'met_via' = 'life', false) as life
       from unnest($1::text[]) as c(id)
       join episodes e on c.id in (e.character_a, e.character_b)
       join characters p on p.id = case when e.character_a = c.id then e.character_b else e.character_a end
      where e.status in ('generating', 'ready') and coalesce((e.setup->>'after_dark')::boolean, false) = false
      order by c.id, e.created_at desc, e.id`,
    [ids],
  );
  return new Map(rows.map((r) => [r.character_id, r]));
}

type CompanionNews = {
  character_id: string;
  thread_id: string;
  at: Date | string;
  /** The waiting text's tag (`day_after:<episode>`, `house_scene:<scene>`): which line it gets. */
  action?: string | null;
};

/** How long a text from the character stays "waiting on your advice" with no answer, before the line drops. */
export const ADVICE_WAIT_DAYS = 7;

/**
 * Each character's own unread text to its owner (a `character_texted_you` notification still unread, keyed by the
 * thread's link), and each character whose last text about a date (`after_date:`/`day_after:` tagged) or about the
 * house (`house_scene:`/`house_tonight:`, lib/house-texts.ts), within ADVICE_WAIT_DAYS, got neither a reply in the
 * thread nor a nudge for the next date (lib/between-dates.ts nudges).
 */
async function companionNews(db: Db, userId: string, ids: readonly string[], now: Date): Promise<{ texted: Map<string, CompanionNews>; waiting: Map<string, CompanionNews> }> {
  const [texted, waiting] = await Promise.all([
    db.query<CompanionNews>(
      `select distinct on (t.character_id) t.character_id, t.id as thread_id, n.created_at as at
         from notifications n
         join companion_threads t on t.user_id = n.user_id and n.link = '/companion/' || t.id
        where n.user_id = $1 and n.read_at is null and n.kind = 'character_texted_you' and t.character_id = any($2::text[])
        order by t.character_id, n.created_at desc`,
      [userId, ids],
    ),
    db.query<CompanionNews>(
      `select distinct on (t.character_id) t.character_id, t.id as thread_id, m.created_at as at, m.action
         from companion_threads t
         join companion_messages m on m.thread_id = t.id and m.role = 'character' and m.action ~ '^(after_date|day_after|house_scene|house_tonight):'
        where t.user_id = $1 and t.character_id = any($2::text[]) and m.created_at > $3::timestamptz - make_interval(days => $4::int)
          and not exists (select 1 from companion_messages u where u.thread_id = t.id and u.role = 'user' and u.created_at > m.created_at)
          and not exists (select 1 from nudges g where g.character_id = t.character_id and g.user_id = t.user_id and g.created_at > m.created_at)
        order by t.character_id, m.created_at desc`,
      [userId, ids, now.toISOString(), ADVICE_WAIT_DAYS],
    ),
  ]);
  return { texted: new Map(texted.rows.map((r) => [r.character_id, r])), waiting: new Map(waiting.rows.map((r) => [r.character_id, r])) };
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const plural = (n: number, one: string) => `${n} new ${one}${n === 1 ? "" : one.endsWith("h") ? "es" : "s"}`;

export async function sinceYouWereHere(db: Db, userId: string, mine: readonly CharacterRef[], now = new Date()): Promise<SinceRow[]> {
  if (!mine.length) return [];
  const ids = mine.map((c) => c.id);
  const [news, latest, own] = await Promise.all([newsByCharacter(db, userId, ids), latestDates(db, ids), companionNews(db, userId, ids, now).catch(() => ({ texted: new Map<string, CompanionNews>(), waiting: new Map<string, CompanionNews>() }))]);
  const rows = mine.map((character): SinceRow => {
    const n = news.get(character.id);
    const matches = `/matches?character=${encodeURIComponent(character.id)}`;
    const another = `/create?character=${encodeURIComponent(character.id)}`;
    const first = firstNameOf(character.name);
    // The character's own text to them comes first: it is the one thing on the site that is theirs alone.
    const texted = own.texted.get(character.id);
    if (texted) return { character, news: `${first} texted you`, action: "Read", href: `/companion/${encodeURIComponent(texted.thread_id)}`, at: new Date(texted.at).toISOString() };
    if (n?.texts) return { character, news: plural(n.texts, "text"), action: "Read", href: matches, at: n.latest };
    if (n?.matches) return { character, news: plural(n.matches, "match"), action: "See who", href: matches, at: n.latest };
    const waiting = own.waiting.get(character.id);
    if (waiting) {
      // What the house said about them is news of its own, not a question about a date.
      const news = /^house_/.test(waiting.action ?? "") ? `${first} told you what the house is saying` : `${first} is waiting on your advice`;
      return { character, news, action: "Reply", href: `/companion/${encodeURIComponent(waiting.thread_id)}`, at: new Date(waiting.at).toISOString() };
    }
    const d = latest.get(character.id);
    if (!d) return { character, news: "No dates yet", action: "Send on a date", href: another, at: null };
    const at = new Date(d.created_at).toISOString();
    const episode = `/episodes/${encodeURIComponent(d.episode_id)}`;
    // A date the house booked while they were away (lib/character-life.ts), aired: the one thing that happened without them.
    if (d.life && d.aired && d.ending) return { character, news: `${first} went on a date with ${d.partner} while you were away`, action: "See how it went", href: episode, at };
    if (d.status === "generating") return { character, news: `On a date with ${d.partner} right now`, action: "Watch", href: `${episode}?play=1`, at };
    if (!d.aired || !d.ending) return { character, news: `Their date with ${d.partner} is ready`, action: "Watch it", href: episode, at };
    return { character, news: `Last date, with ${d.partner}: ${endingLabel(d.ending, d.date_number)}`, action: "Another date", href: another, at };
  });
  // Newest news first; characters with nothing yet keep their order, last.
  return rows.map((r, i) => ({ r, i })).sort((x, y) => (y.r.at ?? "").localeCompare(x.r.at ?? "") || x.i - y.i).map(({ r }) => r);
}
