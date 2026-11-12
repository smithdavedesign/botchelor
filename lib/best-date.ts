/**
 * The best recent date, by the same scoring the daily clip uses (scripts/clips/daily-clip.mjs pickClip, kept in plain
 * JS for launchd): a decided ending (a second date or a disaster beats friends), a best line, a little for length, and
 * a tie to the newer. The quiet-week nudge (lib/reengage.ts) and anything else that wants "the week's best date" read
 * this one, so the site and the clips agree on what "best" means. Pure.
 */

export type ScoredDate = { id: string; ending?: string | null; best_line?: string | null; lines?: number | null };

/** A date's score: 2 for a decided ending, 1 for a best line, up to 1 for length (24 lines is full marks). */
export function dateScore(d: ScoredDate): number {
  return (d.ending === "second_date" || d.ending === "disaster" ? 2 : 0) + (d.best_line ? 1 : 0) + Math.min(1, (d.lines ?? 0) / 24);
}

/** The best of `dates` (newest first): the top score, a tie to the earlier in the list. Null for none. */
export function bestDate<T extends ScoredDate>(dates: readonly T[]): T | null {
  let best: T | null = null;
  let top = -1;
  for (const d of dates) {
    const s = dateScore(d);
    if (s > top) {
      top = s;
      best = d;
    }
  }
  return best;
}
