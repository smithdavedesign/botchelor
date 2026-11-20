/**
 * The social network's daily numbers (docs/PRDs/social-network.md §5.5, §10), the pure half: the public, active ties
 * between characters in, every character's row per layer (social_metrics) and the whole network's row
 * (social_network_daily) out. computeSocialMetrics (./metrics-job.ts) reads the ties, runs this and writes the rows;
 * the dataset builder (scripts/social/export-dataset.mjs) exports them.
 *
 * Each layer is its own graph (who's central among friends isn't who's central in the feuds), and "all" is every layer
 * at once, a pair linked once however many ties it has (lib/social/analytics.ts). Within a graph:
 * - PageRank, betweenness, clustering, k-core and Burt's constraint read every tie, rivalries included: being someone's
 *   enemy is a connection too, and notoriety is a kind of centrality;
 * - communities read only the ties that aren't negative, so a feud never makes two people one crowd;
 * - reciprocity reads only the one-way ties an answer means something for (a crush returned), never a role such as
 *   parent → child or manager → report (`answerable`).
 */
import {
  ALL_LAYERS,
  assortativity,
  averageDegree,
  betweenness,
  buildGraph,
  clustering,
  communities,
  components,
  constraint,
  coreNumbers,
  degreeOf,
  density,
  pagerank,
  reciprocity,
  valences,
  type Clustering,
  type Communities,
  type Graph,
  type Reciprocity,
  type Tie,
  type Valences,
} from "./analytics";
import { rings, type RingTie, type TriadCensus } from "./algorithms";
import { isTieKind, TIE_KINDS } from "./kinds";

/** One public, active tie between two characters, as the job reads it. */
export type MetricTie = {
  from_id: string;
  to_id: string;
  kind: string;
  layer: string;
  directed: boolean;
  valence: number;
  closeness: number;
};

/** What the network's mixing is measured by: what each character is (lib/kinds.ts), who made it (lib/origin.ts), its tags. */
export type MetricNode = { id: string; kind: string | null; origin: string | null; tags: readonly string[] };

/** Layers whose one-way ties are roles (parent and child, manager and report): the other end never "answers" one. */
export const ROLE_LAYERS: ReadonlySet<string> = new Set(["kin", "work"]);

/** A one-way tie that an answer would mean something for: a crush returned, a grudge held back, being told and telling. */
export const answerable = (t: MetricTie): boolean => t.directed && !ROLE_LAYERS.has(t.layer);

export type MeasureOptions = {
  /** The day's seed (label propagation's order, betweenness's pivots): the same day gives the same numbers. */
  seed: string;
  /** The one-way ties reciprocity reads. Default `answerable`. */
  reciprocable?: (t: MetricTie) => boolean;
  /** Betweenness: exact up to this many characters, then this many sampled pivots (lib/social/analytics.ts). */
  exactUpTo?: number;
  samples?: number;
  /** Awaited before each measure: the job yields to the event loop there, so the show keeps answering while it works. */
  pause?: () => Promise<void>;
};

/** Every measure of one layer's graph (or of all of them, ALL_LAYERS), by node in `graph.ids` order. */
export type LayerMeasures = {
  layer: string;
  graph: Graph;
  /** How many tie rows the layer holds (a pair can have several kinds in one layer). */
  ties: number;
  pagerank: Float64Array;
  betweenness: Float64Array;
  clustering: Clustering;
  kcore: Int32Array;
  constraint: Float64Array;
  valences: Valences;
  reciprocity: Reciprocity;
  /** Over the layer's ties that aren't negative; −1 for a character with only negative ties. */
  communities: Communities;
};

const toTie = (t: MetricTie): Tie => ({
  from: t.from_id,
  to: t.to_id,
  weight: t.closeness,
  valence: t.valence,
  directed: t.directed,
  layer: t.layer,
  kind: t.kind,
});

/** Measures one layer's ties (every tie for ALL_LAYERS). */
export async function measureLayer(layer: string, ties: readonly MetricTie[], options: MeasureOptions): Promise<LayerMeasures> {
  const { seed, reciprocable = answerable, exactUpTo, samples, pause } = options;
  const next = async <T>(measure: () => T): Promise<T> => {
    if (pause) await pause();
    return measure();
  };
  const graph = await next(() => buildGraph(ties.map(toTie)));
  // The same node list for the side graphs, so every answer lines up with graph.ids.
  const nodes = graph.ids;
  const oneWay = buildGraph(ties.filter((t) => t.directed && reciprocable(t)).map(toTie), { nodes });
  const friendly = buildGraph(ties.filter((t) => t.valence >= 0).map(toTie), { nodes });
  return {
    layer,
    graph,
    ties: ties.length,
    pagerank: await next(() => pagerank(graph)),
    betweenness: await next(() => betweenness(graph, { seed: `${seed}:${layer}`, exactUpTo, samples })),
    clustering: await next(() => clustering(graph)),
    kcore: coreNumbers(graph),
    constraint: await next(() => constraint(graph)),
    valences: valences(graph),
    reciprocity: reciprocity(oneWay),
    communities: await next(() => communities(friendly, { seed: `${seed}:${layer}` })),
  };
}

/** The ties of each layer, every layer once in a stable order, ALL_LAYERS first (every tie). */
export function byLayer(ties: readonly MetricTie[]): [string, MetricTie[]][] {
  const layers = new Map<string, MetricTie[]>();
  for (const t of ties) (layers.get(t.layer) ?? layers.set(t.layer, []).get(t.layer)!).push(t);
  return [[ALL_LAYERS, [...ties]], ...[...layers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))];
}

/** One social_metrics row: a character's numbers on one layer (or all of them) for one day. */
export type CharacterMetricRow = {
  character_id: string;
  layer: string;
  degree: number;
  weighted_degree: number;
  in_valence: number | null;
  out_valence: number | null;
  reciprocity: number | null;
  clustering: number;
  pagerank: number;
  betweenness: number;
  kcore: number;
  community: number | null;
  burt_constraint: number | null;
  /** Signed triangles through the character (lib/social/algorithms.ts signedTriads); all layers only. */
  triads_balanced: number | null;
  triads_unbalanced: number | null;
  /** How many of their people sit in each Dunbar ring (lib/social/algorithms.ts rings); all layers only. */
  ring_inner: number | null;
  ring_close: number | null;
  ring_friends: number | null;
  ring_acquaintances: number | null;
};

/** A number a row can store: NaN (undefined, such as reciprocity with no one-way ties) is null. */
const real = (x: number): number | null => (Number.isFinite(x) ? x : null);

/** Every character's row on this layer: one per character with a tie on it. */
export function metricRows(m: LayerMeasures): CharacterMetricRow[] {
  const { graph: g } = m;
  const rows: CharacterMetricRow[] = [];
  for (let i = 0; i < g.n; i++) {
    const degree = degreeOf(g, i);
    if (degree === 0) continue;
    rows.push({
      character_id: g.ids[i],
      layer: m.layer,
      degree,
      weighted_degree: g.strength[i],
      in_valence: real(m.valences.in[i]),
      out_valence: real(m.valences.out[i]),
      reciprocity: real(m.reciprocity.node[i]),
      clustering: m.clustering.local[i],
      pagerank: m.pagerank[i],
      betweenness: m.betweenness[i],
      kcore: m.kcore[i],
      community: m.communities.membership[i] >= 0 ? m.communities.membership[i] : null,
      burt_constraint: real(m.constraint[i]),
      triads_balanced: null,
      triads_unbalanced: null,
      ring_inner: null,
      ring_close: null,
      ring_friends: null,
      ring_acquaintances: null,
    });
  }
  return rows;
}

/** Signed triangles, the whole network's census (lib/social/algorithms.ts signedTriads). */
export type Balance = { balanced: number; unbalanced: number; share_balanced: number | null; by_signs: Record<string, number> };

/**
 * The most triangles the job keeps to count each character's (lib/social/algorithms.ts signedTriads `limit`). Past it,
 * the network's totals still stand and each character's triangle counts stay unset that day, never half counted.
 */
export const TRIADS_KEPT = 200_000;

/** A census cut at TRIADS_KEPT lists fewer triangles than it counted. */
const wholeCensus = (c: TriadCensus): boolean => c.triads.length === c.balanced + c.unbalanced;

/**
 * The network's row of it: the totals, the balanced share, and how many of each sign pattern ("+++", "++-", "+--",
 * "---"; empty when the census was cut short).
 */
export function balanceOf(census: TriadCensus): Balance {
  const total = census.balanced + census.unbalanced;
  const by_signs: Record<string, number> = {};
  if (wholeCensus(census)) {
    for (const t of census.triads) {
      const key = t.signs.map((s) => (s > 0 ? "+" : "-")).sort().join("");
      by_signs[key] = (by_signs[key] ?? 0) + 1;
    }
  }
  return { balanced: census.balanced, unbalanced: census.unbalanced, share_balanced: total ? census.balanced / total : null, by_signs };
}

/** Each character's balanced and unbalanced triangles; null when the census was cut short. */
export function triadsByCharacter(census: TriadCensus): Map<string, { balanced: number; unbalanced: number }> | null {
  if (!wholeCensus(census)) return null;
  const out = new Map<string, { balanced: number; unbalanced: number }>();
  for (const t of census.triads) {
    for (const id of t.ids) {
      const c = out.get(id) ?? { balanced: 0, unbalanced: 0 };
      if (t.balanced) c.balanced++;
      else c.unbalanced++;
      out.set(id, c);
    }
  }
  return out;
}

/** A public, active tie from a character to one of its public off-screen people, as the rings read it. */
export type PersonRingTie = { from_id: string; to_person_id: string; kind: string; closeness: number };
export type RingSizes = { inner: number; close: number; friends: number; acquaintances: number };

/**
 * How many sit in each of a character's Dunbar rings (lib/social/algorithms.ts rings, as "X's world" places them): its
 * public ties to characters and to its people, each placed by its closeness as far in as its kind allows. Shared places
 * aren't counted here ("X's world" adds them when it's read).
 */
export function ringSizes(ties: readonly MetricTie[], people: readonly PersonRingTie[]): Map<string, RingSizes> {
  const by = new Map<string, RingTie[]>();
  const add = (id: string, t: RingTie) => {
    const list = by.get(id);
    if (list) list.push(t);
    else by.set(id, [t]);
  };
  for (const t of ties) {
    if (!isTieKind(t.kind)) continue;
    const ring = TIE_KINDS[t.kind].ring;
    add(t.from_id, { other: t.to_id, closeness: t.closeness, ring });
    add(t.to_id, { other: t.from_id, closeness: t.closeness, ring });
  }
  for (const p of people) if (isTieKind(p.kind)) add(p.from_id, { other: p.to_person_id, closeness: p.closeness, ring: TIE_KINDS[p.kind].ring });
  const out = new Map<string, RingSizes>();
  for (const [id, list] of by) {
    const r = rings(list);
    out.set(id, { inner: r.inner.length, close: r.close.length, friends: r.friends.length, acquaintances: r.acquaintances.length });
  }
  return out;
}

/** Puts each character's triangles and ring sizes on its all-layers row; every other layer's stay null. */
export function withBalanceAndRings(
  rows: readonly CharacterMetricRow[],
  triads: Map<string, { balanced: number; unbalanced: number }> | null,
  sizes: Map<string, RingSizes>,
): CharacterMetricRow[] {
  return rows.map((r) => {
    if (r.layer !== ALL_LAYERS) return r;
    const t = triads ? (triads.get(r.character_id) ?? { balanced: 0, unbalanced: 0 }) : null;
    const s = sizes.get(r.character_id);
    return {
      ...r,
      triads_balanced: t ? t.balanced : null,
      triads_unbalanced: t ? t.unbalanced : null,
      ring_inner: s ? s.inner : null,
      ring_close: s ? s.close : null,
      ring_friends: s ? s.friends : null,
      ring_acquaintances: s ? s.acquaintances : null,
    };
  });
}

/** One social_network_daily row (the day is the job's). */
export type NetworkDailyRow = {
  /** Characters with at least one public tie to another character. */
  nodes: number;
  /** Tie rows by layer, and "all". */
  ties: Record<string, number>;
  density: number;
  avg_degree: number;
  /** Mean local clustering. */
  clustering: number;
  modularity: number;
  communities: number;
  /** How many characters the largest connected group holds. */
  giant_component: number;
  /** Do like and like link? By what they are, who made them, their tags (null when it can't say). */
  assortativity: { kind: number | null; origin: number | null; tags: number | null };
  balance: Balance | null;
  /** The share of answerable one-way ties answered; null with none. */
  reciprocity: number | null;
  /** The rest worth keeping: transitivity, triangles, the deepest core, how the communities were found, linked pairs. */
  stats: { transitivity: number; triangles: number; max_kcore: number; community_method: Communities["method"]; pairs: number };
};

/** The whole network's row, from the all-layers measures and every layer's tie count. */
export function networkRow(all: LayerMeasures, layers: readonly LayerMeasures[], nodes: readonly MetricNode[]): NetworkDailyRow {
  const g = all.graph;
  const attrs = new Map(nodes.map((n) => [n.id, n]));
  const mix = (of: (n: MetricNode) => string | readonly string[] | null) => real(assortativity(g, (id) => (attrs.has(id) ? of(attrs.get(id)!) : null)));
  let maxCore = 0;
  for (const k of all.kcore) if (k > maxCore) maxCore = k;
  return {
    nodes: g.n,
    ties: Object.fromEntries(layers.map((l) => [l.layer, l.ties])),
    density: density(g),
    avg_degree: averageDegree(g),
    clustering: all.clustering.average,
    modularity: all.communities.modularity,
    communities: all.communities.count,
    giant_component: components(g).sizes[0] ?? 0,
    assortativity: { kind: mix((n) => n.kind), origin: mix((n) => n.origin), tags: mix((n) => n.tags) },
    balance: null,
    reciprocity: real(all.reciprocity.overall),
    stats: {
      transitivity: all.clustering.transitivity,
      triangles: all.clustering.triangles,
      max_kcore: maxCore,
      community_method: all.communities.method,
      pairs: g.pairs,
    },
  };
}
