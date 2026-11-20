/**
 * The social network's small algorithms for one character's world and the sky's tense triangles
 * (docs/PRDs/social-network.md sections 7 and 9). Pure: no database and no app imports, so a page, the API
 * (lib/social/read.ts) and the daily job share them, and the browser can import them too. The network-wide measures
 * (PageRank, communities, betweenness) are lib/social/analytics.ts.
 *
 * - `rings`: Dunbar's layers. The people in a character's world, closest first, each in the innermost ring its ties
 *   allow (kinds.ts `ring`: a coworker is at most a friend, however close) that still has room: 5 in the inner circle,
 *   15 counting the close ones, 50 friends, 150 acquaintances. A new best friend pushes someone down a ring; past 150
 *   they're `beyond`.
 * - `signedTriads`: structural balance. A pair's sign is its ties' valences summed (a coworker who's also a rival nets
 *   out, and an unsigned pair makes no triangle). A triangle is balanced when the product of its three signs is
 *   positive (three friends; two friends who share a rival) and unbalanced when it's negative (two of my friends are
 *   rivals; three rivals): an unbalanced one is a story the producer can stage.
 */
import { RING_CAPS, RINGS, type Ring, type Rings } from "./types";

/* ------------------------------------------------------- rings ------------------------------------------------------- */

/**
 * One tie in a character's world, as `rings` reads it: who's at the other end (a character's or a person's id), how
 * close (0..1), and the innermost ring its kind allows (kinds.ts `ring`). A shared place counts as a tie
 * (lib/social/read.ts SHARED). Someone with several ties is placed by their closest, as far in as any of them allows.
 */
export type RingTie = { other: string; closeness: number; ring: Ring };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A character's rings, from its ties. `caps` count from the centre (RING_CAPS: 5, 15, 50, 150), so the close ring holds
 * 10 more than the inner circle. Equal closeness goes by id, so the answer doesn't depend on the order of `ties`.
 */
export function rings(ties: Iterable<RingTie>, caps: Record<Ring, number> = RING_CAPS): Rings {
  const best = new Map<string, { closeness: number; ceiling: number }>();
  for (const t of ties) {
    const ceiling = RINGS.indexOf(t.ring);
    if (ceiling < 0 || !t.other) continue;
    const closeness = Number.isFinite(t.closeness) ? t.closeness : 0;
    const was = best.get(t.other);
    best.set(t.other, was ? { closeness: Math.max(was.closeness, closeness), ceiling: Math.min(was.ceiling, ceiling) } : { closeness, ceiling });
  }
  const room = RINGS.map((r, i) => Math.max(0, caps[r] - (i ? caps[RINGS[i - 1]] : 0)));
  const out: Rings = { inner: [], close: [], friends: [], acquaintances: [], beyond: [] };
  const closestFirst = [...best].sort(([x, a], [y, b]) => b.closeness - a.closeness || cmp(x, y));
  for (const [id, { ceiling }] of closestFirst) {
    let ring = ceiling;
    while (ring < RINGS.length && room[ring] === 0) ring++;
    if (ring === RINGS.length) {
      out.beyond.push(id);
      continue;
    }
    room[ring]--;
    out[RINGS[ring]].push(id);
  }
  return out;
}

/* --------------------------------------------------- signed triads --------------------------------------------------- */

/** A tie as balance reads it: its two characters and its valence (-2..2). Direction doesn't matter here. */
export type SignedTie = { from: string; to: string; valence: number };
export type Sign = 1 | -1;
/** A triangle of signed pairs: its three ids in order, and the signs of a–b, a–c and b–c. */
export type SignedTriad = { ids: [string, string, string]; signs: [Sign, Sign, Sign]; balanced: boolean };
/** Every triangle counted; `triads` lists the unbalanced ones first, then balanced, at most `limit`, each by ids. */
export type TriadCensus = { balanced: number; unbalanced: number; triads: SignedTriad[] };

/** Each signed pair once, both ways: the sum of its ties' valences, as 1 or -1. A sum of 0 isn't signed. */
export function pairSigns(ties: Iterable<SignedTie>): Map<string, Map<string, Sign>> {
  const sums = new Map<string, Map<string, number>>();
  for (const t of ties) {
    if (!t.from || !t.to || t.from === t.to || !Number.isFinite(t.valence) || t.valence === 0) continue;
    const [lo, hi] = t.from < t.to ? [t.from, t.to] : [t.to, t.from];
    let row = sums.get(lo);
    if (!row) sums.set(lo, (row = new Map()));
    row.set(hi, (row.get(hi) ?? 0) + t.valence);
  }
  const signs = new Map<string, Map<string, Sign>>();
  const put = (x: string, y: string, s: Sign) => {
    let row = signs.get(x);
    if (!row) signs.set(x, (row = new Map()));
    row.set(y, s);
  };
  for (const [lo, row] of sums)
    for (const [hi, sum] of row) {
      if (sum === 0) continue;
      const s: Sign = sum > 0 ? 1 : -1;
      put(lo, hi, s);
      put(hi, lo, s);
    }
  return signs;
}

/**
 * The signed triangle census of these ties. Each triangle is found once, from its lowest-ranked corner (by degree,
 * then id), in O(m^1.5); the result is the same whatever order the ties come in.
 */
export function signedTriads(ties: Iterable<SignedTie>, o: { limit?: number } = {}): TriadCensus {
  const limit = Math.max(0, o.limit ?? 100);
  const signs = pairSigns(ties);
  const ids = [...signs.keys()].sort((x, y) => signs.get(x)!.size - signs.get(y)!.size || cmp(x, y));
  const rank = new Map(ids.map((id, i) => [id, i]));
  // Each pair once, from its lower-ranked end, its later ends in rank order.
  const later = new Map(ids.map((id) => [id, [...signs.get(id)!.keys()].filter((n) => rank.get(n)! > rank.get(id)!).sort((x, y) => rank.get(x)! - rank.get(y)!)]));
  let balanced = 0;
  let unbalanced = 0;
  const kept: { balanced: SignedTriad[]; unbalanced: SignedTriad[] } = { balanced: [], unbalanced: [] };
  for (const u of ids) {
    const su = signs.get(u)!;
    for (const v of later.get(u)!) {
      const sv = signs.get(v)!;
      for (const w of later.get(v)!) {
        if (!su.has(w)) continue;
        const [a, b, c] = [u, v, w].sort(cmp);
        const triad: SignedTriad = { ids: [a, b, c], signs: [signs.get(a)!.get(b)!, signs.get(a)!.get(c)!, signs.get(b)!.get(c)!], balanced: su.get(v)! * su.get(w)! * sv.get(w)! > 0 };
        if (triad.balanced) balanced++;
        else unbalanced++;
        const list = triad.balanced ? kept.balanced : kept.unbalanced;
        if (list.length < limit) list.push(triad);
      }
    }
  }
  const byIds = (x: SignedTriad, y: SignedTriad) => cmp(x.ids.join("\0"), y.ids.join("\0"));
  return { balanced, unbalanced, triads: [...kept.unbalanced.sort(byIds), ...kept.balanced.sort(byIds)].slice(0, limit) };
}
