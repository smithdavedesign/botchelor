/**
 * How recent aired public dates ended (2.6.0; #728, David 2026-10-23: "picks aren't blind"): the prior a prediction starts
 * from, as counts and shares and in a line ("lately: 45% second date, 30% friends, 25% disaster"). Only dates that have
 * aired publicly count, so it never says anything about a date still open for picks, and it never names a single date's
 * ending. Cheap: one grouped count over the last LATELY_OF aired public dates, kept for LATELY_TTL_MS per database.
 */
import type { Db } from "./db";
import { ENDINGS, type Ending } from "./rules";

export const LATELY_OF = 100;
export const LATELY_TTL_MS = 5 * 60_000;

export type EndingsLately = Record<Ending, number> & {
  of: number;
  over: string;
  /** Each ending's share, in whole percent. */
  shares: Record<Ending, number>;
  /** The mix in a line, e.g. "lately: 45% second date, 30% friends, 25% disaster (the last 100 aired public dates)". */
  says: string;
};

const WORDS: Record<Ending, string> = { second_date: "second date", friends: "friends", disaster: "disaster" };

/** The mix in words, from counts (pure). */
export function latelyFrom(counts: Record<Ending, number>): EndingsLately {
  const of = ENDINGS.reduce((n, e) => n + counts[e], 0);
  const shares = Object.fromEntries(ENDINGS.map((e) => [e, of ? Math.round((counts[e] / of) * 100) : 0])) as Record<Ending, number>;
  const over = `the last ${of} aired public dates`;
  return {
    ...counts,
    of,
    over,
    shares,
    says: of ? `lately: ${ENDINGS.map((e) => `${shares[e]}% ${WORDS[e]}`).join(", ")} (${over})` : "lately: no public date has aired yet, so there's no mix to go on",
  };
}

let cache = new WeakMap<object, { at: number; value: EndingsLately }>();

/** The recent mix, cached per database for LATELY_TTL_MS. */
export async function endingsLately(db: Db, now: number = Date.now()): Promise<EndingsLately> {
  const hit = cache.get(db);
  if (hit && now - hit.at < LATELY_TTL_MS) return hit.value;
  const rows = (
    await db.query<{ ending: string; k: number }>(
      `select ending, count(*)::int as k from (select ending from episodes where revealed_at is not null and visibility = 'public' order by revealed_at desc limit $1) x group by ending`,
      [LATELY_OF],
    )
  ).rows;
  const value = latelyFrom(Object.fromEntries(ENDINGS.map((e) => [e, rows.find((r) => r.ending === e)?.k ?? 0])) as Record<Ending, number>);
  cache.set(db, { at: now, value });
  return value;
}

/** Tests: forget the cached mix. */
export function clearEndingsLatelyForTests(): void {
  cache = new WeakMap();
}
