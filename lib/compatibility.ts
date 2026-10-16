/**
 * What the show has learned about who clicks: across every date that aired publicly, how often two characters with
 * a given pair of traits ended up on a second date. It's the "learning across the whole show" half of the
 * relationship graph (docs/relationship-graph.md). It only ever ranks suggestions; it never touches an outcome.
 *
 * Statistics, not a black box, and built to stay honest:
 *  - **Smoothed** (an empirical-Bayes prior at the show's overall second-date rate), so one lucky date between a
 *    "witty" and a "shy" character doesn't make them a sure thing.
 *  - **Evidence-gated:** a pairing counts only once enough dates back it.
 *  - **Public record only:** aired, public dates. Nothing private teaches it.
 *  - **Explainable:** every suggestion says why ("witty × curious: 4 of 6 dates became second dates").
 */
import type { Db } from "./db";

/** How strongly the show-wide rate pulls a trait pair with few dates (pseudo-dates of prior). */
export const PRIOR_STRENGTH = 5;
/** A trait pair needs this many dates before it's mentioned as a reason. */
export const MIN_EVIDENCE = 3;
/** How many recent aired dates the statistics read. */
export const STATS_WINDOW = 2000;

export type TraitStats = { pairs: Map<string, { n: number; hits: number }>; base: number; dates: number };

const norm = (t: string) => t.trim().toLowerCase();
const pairOf = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Counts, per unordered trait pair, the aired public dates between characters with those traits and the second dates. */
export function buildTraitStats(dates: { a: readonly string[]; b: readonly string[]; second: boolean }[]): TraitStats {
  const pairs = new Map<string, { n: number; hits: number }>();
  let hits = 0;
  for (const d of dates) {
    if (d.second) hits++;
    const seen = new Set<string>();
    for (const x of d.a.map(norm).filter(Boolean)) {
      for (const y of d.b.map(norm).filter(Boolean)) {
        const k = pairOf(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        const s = pairs.get(k) ?? { n: 0, hits: 0 };
        s.n++;
        if (d.second) s.hits++;
        pairs.set(k, s);
      }
    }
  }
  return { pairs, base: dates.length ? hits / dates.length : 0, dates: dates.length };
}

/** Reads the statistics from the aired public record (each date's traits as they were that night). */
export async function loadTraitStats(db: Db): Promise<TraitStats> {
  const { rows } = await db.query<{ a: string[] | null; b: string[] | null; ending: string }>(
    `select coalesce(e.setup->'sheet_a'->'traits', ca.traits) as a,
            coalesce(e.setup->'sheet_b'->'traits', cb.traits) as b,
            e.ending
       from episodes e
       join characters ca on ca.id = e.character_a
       join characters cb on cb.id = e.character_b
      where e.status = 'ready' and e.revealed_at is not null and e.visibility = 'public'
      order by e.revealed_at desc limit $1`,
    [STATS_WINDOW],
  );
  return buildTraitStats(rows.map((r) => ({ a: r.a ?? [], b: r.b ?? [], second: r.ending === "second_date" })));
}

export type Compatibility = {
  /** The smoothed second-date rate for this pairing, 0..1, and how it compares with the show's (1 = average). */
  rate: number;
  lift: number;
  /** Dates behind it (summed over trait pairs). */
  evidence: number;
  /** The best-backed trait pair with a better-than-average record, for the "why". */
  reason: { traits: [string, string]; hits: number; n: number } | null;
};

/** How well two sets of traits have done together on the show. */
export function compatibility(stats: TraitStats, a: readonly string[], b: readonly string[]): Compatibility {
  const prior = stats.base;
  let sum = 0;
  let count = 0;
  let evidence = 0;
  let reason: Compatibility["reason"] = null;
  for (const x of a.map(norm).filter(Boolean)) {
    for (const y of b.map(norm).filter(Boolean)) {
      const s = stats.pairs.get(pairOf(x, y)) ?? { n: 0, hits: 0 };
      const smoothed = (s.hits + PRIOR_STRENGTH * prior) / (s.n + PRIOR_STRENGTH);
      sum += smoothed;
      count++;
      evidence += s.n;
      if (s.n >= MIN_EVIDENCE && smoothed > prior && (!reason || s.hits / s.n > reason.hits / reason.n)) reason = { traits: [x, y], hits: s.hits, n: s.n };
    }
  }
  const rate = count ? sum / count : prior;
  return { rate, lift: prior > 0 ? rate / prior : 1, evidence, reason };
}

/** Each character's number of public relationships, for the popularity damper in suggestions. */
export async function publicDegrees(db: Db, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; n: number }>(
    `select c.id, count(r.*)::int as n
       from unnest($1::text[]) as c(id)
       left join relationships r on r.public_dates > 0 and c.id in (r.character_a, r.character_b)
      group by c.id`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.n]));
}
