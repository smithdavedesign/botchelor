/**
 * The week's biggest chemistry shifts (docs/ideas.md "Bringing viewers back", idea 5; David 2026-11-01). Every couple page
 * has a chemistry meter: the running chemistry across their public dates (lib/relationships.ts summarize, an exponential
 * moving average of each date's final chemistry). This is how far that meter moved this week, for the couples who went
 * on a public date in it: the meter now against where it stood before the week's dates. Both directions: the couples
 * warming up and the ones going cold. $0: read from aired dates, no model call.
 *
 *  - Public only: public dates that aired and weren't reported away, between two public characters.
 *  - A couple needs a meter before the week to have moved it, so a pair whose first date was this week isn't listed.
 *  - The same order as the couple page's history (by when each date was made), so the meter here matches the page.
 */
import type { Db } from "./db";
import { RUNNING_WEIGHT } from "./relationships";
import { REPORT_HIDE_THRESHOLD } from "./rules";

/** How long "this week" looks back. */
export const SHIFT_DAYS = 7;
/** How many couples each direction lists. */
export const SHIFTS_SHOWN = 3;
/** A move smaller than this isn't a shift worth listing (the meter is 0..100). */
export const SHIFT_MIN = 1;

export type ChemistryShift = { lo: string; hi: string; a: string; b: string; before: number; now: number; shift: number };
export type ChemistryShifts = { up: ChemistryShift[]; down: ChemistryShift[] };

/** The running chemistry over a couple's dates in order (the couple page's meter), or null before any. */
export function runningChemistry(values: readonly (number | null)[]): number | null {
  let c: number | null = null;
  for (const v of values) if (v !== null) c = c === null ? v : c + RUNNING_WEIGHT * (v - c);
  return c;
}

/** The week's shifts, warmest first and coldest first. */
export async function chemistryShifts(db: Db, now: Date = new Date()): Promise<ChemistryShifts> {
  const since = new Date(now.getTime() - SHIFT_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await db.query<{ lo: string; hi: string; a: string; b: string; chemistry: number | null; this_week: boolean }>(
    `with pairs as (
       select distinct least(e.character_a, e.character_b) as lo, greatest(e.character_a, e.character_b) as hi
         from episodes e
        where e.revealed_at > $1 and e.revealed_at <= $2 and e.visibility = 'public'
          and (select count(*) from reports r where r.episode_id = e.id) < $3
     )
     select p.lo, p.hi, ca.name as a, cb.name as b, (e.box_score->'chemistry'->>'final')::float as chemistry, e.revealed_at > $1 as this_week
       from pairs p
       join episodes e on least(e.character_a, e.character_b) = p.lo and greatest(e.character_a, e.character_b) = p.hi
       join characters ca on ca.id = p.lo
       join characters cb on cb.id = p.hi
      where e.revealed_at is not null and e.revealed_at <= $2 and e.visibility = 'public'
        and (select count(*) from reports r where r.episode_id = e.id) < $3
        and ca.visibility = 'public' and cb.visibility = 'public'
      order by p.lo, p.hi, e.created_at, e.id`,
    [since.toISOString(), now.toISOString(), REPORT_HIDE_THRESHOLD],
  );
  const byPair = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.lo}|${r.hi}`;
    byPair.set(key, [...(byPair.get(key) ?? []), r]);
  }
  const shifts: ChemistryShift[] = [];
  for (const dates of byPair.values()) {
    const before = runningChemistry(dates.filter((d) => !d.this_week).map((d) => d.chemistry));
    const after = runningChemistry(dates.map((d) => d.chemistry));
    if (before === null || after === null) continue;
    const shift = Math.round(after - before);
    if (Math.abs(shift) < SHIFT_MIN) continue;
    const { lo, hi, a, b } = dates[0];
    shifts.push({ lo, hi, a, b, before: Math.round(before), now: Math.round(after), shift });
  }
  const order = (x: ChemistryShift, y: ChemistryShift) => Math.abs(y.shift) - Math.abs(x.shift) || x.lo.localeCompare(y.lo) || x.hi.localeCompare(y.hi);
  return {
    up: shifts.filter((s) => s.shift > 0).sort(order).slice(0, SHIFTS_SHOWN),
    down: shifts.filter((s) => s.shift < 0).sort(order).slice(0, SHIFTS_SHOWN),
  };
}
