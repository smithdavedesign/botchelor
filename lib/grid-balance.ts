/**
 * How many columns a short grid of `n` cards should have so its last row isn't one lonely card (2026-11-08 UI audit,
 * item 6: the season's four cast members sat three and one on home and on /characters). Up to `max` columns: all of
 * them in one row when they fit, else the count from 3 up that leaves the fewest empty places in the last row, the
 * wider one on a tie. 4 → 4, 5 → 3, 6 → 3, 7 → 4, 8 → 4, 9 → 3, 10 → 4. Never 2 for a long list just because 2 divides
 * it: ten cards are 4 + 4 + 2, not five rows of two on a wide screen. Set as `--cols` on a `.grid-balanced` list
 * (app/ux/catalog.css), which uses it from a tablet's width up; a phone keeps two a row.
 */
export function balancedColumns(n: number, max = 4): number {
  const count = Math.max(1, Math.floor(n));
  const top = Math.max(1, Math.floor(max));
  if (count <= top) return count;
  let best = top;
  let bestEmpty = (top - (count % top)) % top;
  for (let c = top - 1; c >= Math.min(3, top); c--) {
    const empty = (c - (count % c)) % c;
    if (empty < bestEmpty) {
      best = c;
      bestEmpty = empty;
    }
  }
  return best;
}
