/**
 * Same-character return (David, 2026-11-16, after two outside reviews): the one number for "does anyone care what
 * happens to their character?". Of the new people who finished a first meaningful thing with a character, how many did
 * another meaningful thing with that same character on a later day within seven days.
 *
 *  - A person: an identity that isn't ours (lib/our-traffic.ts) and isn't an agent; the caller decides (`real`).
 *  - The first meaningful thing (what puts someone in the count): they watched a date their own character was on to
 *    its ending (the `date_watched` beacon, which names its date since this shipped), or they sent a character a
 *    message of their own.
 *  - Coming back: on a later UTC day, within seven days of that first moment, with a character from that first day:
 *    watching another of its dates end, booking it a date, messaging it, or leaving it advice for its next date.
 *  - Never counted: a page view, a notice or a text sent TO them, a date the house booked for their character.
 *
 * Someone whose first day is today hasn't had a later day yet: they wait (`pending`) rather than count as lost, the
 * way next-day return is counted (lib/real-metrics.ts). Small on purpose: no new table, and one new prop on one event.
 *
 * Split in two since 2026-11-16 (the connected model, stage 6): the same count for the people who had used the Studio
 * for that character by the end of their seven days, and for those who had not (`splitByStudio`). Nothing else about
 * the definition changes, and the two halves add up to the whole.
 */
import type { Db } from "./db";
import { notPersonaSql } from "./step-in-shared";

export type ActKind = "watch" | "message" | "book" | "advice";
export type CharacterAct = { user: string; character: string; at: Date; kind: ActKind };

/** The acts that put a person in the count; the others only bring them back. */
const FIRST: ReadonlySet<ActKind> = new Set(["watch", "message"]);
const DAY_MS = 86_400_000;
export const RETURN_DAYS = 7;
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY_MS);

/** One person in the count, for the admin's table. */
export type ReturnRow = {
  user: string;
  character: string;
  first_at: string;
  first_kind: ActKind;
  /** The first later-day act with that character inside the seven days; null when there is none (yet). */
  returned_at: string | null;
  returned_kind: ActKind | null;
  /** Their first day is today: no later day has come. */
  pending: boolean;
};

export type CharacterReturn = { num: number; den: number; pending: number; rows: ReturnRow[] };

/**
 * The count (pure). `acts` is every act ever, any order; `days` is how far back a person's first moment may be;
 * `real` says who is a person of ours to count.
 */
export function characterReturn(acts: readonly CharacterAct[], opts: { now: Date; days: number; real: (id: string) => boolean }): CharacterReturn {
  const byUser = new Map<string, CharacterAct[]>();
  for (const a of acts) {
    if (!opts.real(a.user) || a.at > opts.now) continue;
    const list = byUser.get(a.user);
    if (list) list.push(a);
    else byUser.set(a.user, [a]);
  }
  const since = opts.now.getTime() - opts.days * DAY_MS;
  const today = dayOf(opts.now);
  const rows: ReturnRow[] = [];
  for (const [user, list] of byUser) {
    list.sort((x, y) => x.at.getTime() - y.at.getTime());
    const first = list.find((a) => FIRST.has(a.kind));
    // New in the window: their first such moment ever is inside it.
    if (!first || first.at.getTime() < since) continue;
    const day0 = dayOf(first.at);
    const theirs = new Set(list.filter((a) => FIRST.has(a.kind) && dayOf(a.at) === day0).map((a) => a.character));
    const until = first.at.getTime() + RETURN_DAYS * DAY_MS;
    const back = list.find((a) => theirs.has(a.character) && dayOf(a.at) > day0 && a.at.getTime() <= until) ?? null;
    rows.push({
      user,
      character: back?.character ?? first.character,
      first_at: first.at.toISOString(),
      first_kind: first.kind,
      returned_at: back ? back.at.toISOString() : null,
      returned_kind: back?.kind ?? null,
      pending: !back && day0 >= today,
    });
  }
  rows.sort((x, y) => y.first_at.localeCompare(x.first_at));
  const counted = rows.filter((r) => !r.pending);
  return { num: counted.filter((r) => r.returned_at).length, den: counted.length, pending: rows.length - counted.length, rows };
}

/** A person's first Studio shoot for a character (studio_pg_shoots, a shoot of any kind). */
export type StudioUse = { user: string; character: string; at: Date };

/** Every person's first shoot for each character: one row a pair, small whatever the number of shoots. */
export async function loadStudioUses(db: Db): Promise<StudioUse[]> {
  const { rows } = await db.query<{ user: string; character: string; at: Date | string }>(
    `select owner_id as "user", character_id as character, min(created_at) as at from studio_pg_shoots group by owner_id, character_id`,
  );
  return rows.map((r) => ({ user: r.user, character: r.character, at: new Date(r.at) }));
}

/** Whether a counted person had used the Studio for their row's character by the end of their seven days (pure). */
export function usedStudio(row: Pick<ReturnRow, "user" | "character" | "first_at">, uses: readonly StudioUse[]): boolean {
  const until = new Date(row.first_at).getTime() + RETURN_DAYS * DAY_MS;
  return uses.some((u) => u.user === row.user && u.character === row.character && u.at.getTime() <= until);
}

export type ReturnSplit = { studio: { num: number; den: number }; no_studio: { num: number; den: number } };

/**
 * The same count in two halves (pure): the people who had used the Studio for that character by the end of their
 * window, and the people who had not. Someone still waiting for a later day is in neither, as in the whole.
 */
export function splitByStudio(r: Pick<CharacterReturn, "rows">, uses: readonly StudioUse[]): ReturnSplit {
  const out: ReturnSplit = { studio: { num: 0, den: 0 }, no_studio: { num: 0, den: 0 } };
  for (const row of r.rows) {
    if (row.pending) continue;
    const half = usedStudio(row, uses) ? out.studio : out.no_studio;
    half.den++;
    if (row.returned_at) half.num++;
  }
  return out;
}

/**
 * Every act there is, one row per person, character, kind and UTC day (the earliest that day): all the count needs,
 * and small whatever the chat volume. A step-in "you" is a seat at a table, not a character (lib/step-in-shared.ts).
 */
export async function loadCharacterActs(db: Db): Promise<CharacterAct[]> {
  const { rows } = await db.query<{ user: string; character: string; at: Date | string; kind: ActKind }>(
    `select a.user_id as "user", a.character_id as character, a.kind, min(a.at) as at
       from (
         select w.user_id, c.id as character_id, w.at, 'watch' as kind
           from web_events w
           join episodes e on e.id = w.props->>'episode_id'
           join characters c on c.id in (e.character_a, e.character_b) and c.owner_id = w.user_id
          where w.event = 'date_watched' and w.user_id is not null
         union all
         select t.user_id, t.character_id, m.created_at, 'message'
           from companion_messages m join companion_threads t on t.id = m.thread_id
          where m.role = 'user'
         union all
         select e.creator_id, e.character_a, e.created_at, 'book'
           from episodes e join characters c on c.id = e.character_a
          where e.creator_id is not null and c.owner_id = e.creator_id
         union all
         select n.user_id, n.character_id, n.created_at, 'advice' from nudges n
       ) a
       join characters ch on ch.id = a.character_id
      where ${notPersonaSql("ch")}
      group by a.user_id, a.character_id, a.kind, date_trunc('day', a.at at time zone 'utc')`,
  );
  return rows.map((r) => ({ user: r.user, character: r.character, kind: r.kind, at: new Date(r.at) }));
}

/**
 * What the admin's table shows beside each row: the character's name, where the person first came from, and (set by
 * lib/real-metrics.ts realUse) whether they had used the Studio for that character by the end of their window.
 */
export type ReturnDetail = ReturnRow & { name: string | null; source: string | null; studio?: boolean };

export async function describeReturns(db: Db, rows: readonly ReturnRow[]): Promise<ReturnDetail[]> {
  if (!rows.length) return [];
  const [names, sources] = await Promise.all([
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[...new Set(rows.map((r) => r.character))]]),
    // The source of the first visit we saw them signed in as that identity on (lib/engagement.ts `sourceOf`).
    db.query<{ user_id: string; source: string | null }>(`select distinct on (user_id) user_id, source from web_events where user_id = any($1) order by user_id, at`, [[...new Set(rows.map((r) => r.user))]]),
  ]);
  const name = new Map(names.rows.map((r) => [r.id, r.name]));
  const source = new Map(sources.rows.map((r) => [r.user_id, r.source]));
  return rows.map((r) => ({ ...r, name: name.get(r.character) ?? null, source: source.get(r.user) ?? null }));
}
