/**
 * Graph analytics for the social network (docs/PRDs/social-network.md §5.5, §10, §13): pure functions over characters
 * and their weighted, signed, optionally directed ties. No database and no app imports, so the daily job
 * (computeSocialMetrics), an offline script and the tests all run the same code. Node scripts import it straight from
 * the .ts file (type stripping), so it keeps to erasable syntax: no enums, namespaces or parameter properties.
 *
 * Build a graph once (`buildGraph`), then ask it things. Answers come back as typed arrays in the graph's node order
 * (`g.ids`, sorted, with the ties put in one canonical order first), so the numbers come out bit-for-bit the same
 * whatever order the rows arrived in; `byId` turns an answer into a Map.
 *
 * What "linked" means here: a pair with any tie is linked once, whatever the layer, and `combine` adds their ties'
 * weights (the default: coworkers who are also exes are closer for it) or keeps the strongest. A one-way tie (a crush,
 * `told`) links the pair too. PageRank and reciprocity keep direction; everything structural reads the linked pairs.
 * Which ties go in (only the positive ones for communities, say) is the caller's call: these functions measure what
 * they're given.
 *
 * Cost, for n characters and m linked pairs: building, PageRank, k-core, components, label propagation and each Louvain
 * pass are about linear in m; clustering is O(m^1.5) at worst; Burt's constraint is O(Σ degree²); exact betweenness is
 * O(n·m), so above `exactUpTo` characters it samples pivots, seeded so a day's numbers can be reproduced. About 400
 * characters and 600 ties on 2026-11-20; built to run 100k characters in the daily batch.
 */

/** The least a tie weighs: a tie that has faded to nothing still links two characters, just barely (as lib/graph.ts). */
export const MIN_WEIGHT = 1e-6;

/** The across-layers name in per-layer answers (`layerDegrees`), as social_metrics stores it. */
export const ALL_LAYERS = "all";

export type Tie = {
  from: string;
  to: string;
  /** How strong (closeness, 0..1 on social ties). Missing or not a number: 1. Never below MIN_WEIGHT. */
  weight?: number;
  /** How it feels, −2..2 (valence). Missing or not a number: 1. */
  valence?: number;
  /** One-way (a crush, a grudge, `told`). Default false: the tie reads the same from either end. */
  directed?: boolean;
  /** Its layer (kin, romance, friendship, work...), for degree by layer. Default "other". */
  layer?: string;
  /** Its kind, so reciprocity matches like with like (a crush answered by a crush). Default: its layer. */
  kind?: string;
};

export type Combine = "sum" | "max";

export type GraphOptions = {
  /** Characters to count even with no ties (density, isolates, PageRank's even share). Tie ends are added anyway. */
  nodes?: Iterable<string>;
  /** How a pair's ties combine into one link: "sum" (default) or "max". */
  combine?: Combine;
};

/** The ties as given, in canonical order, by node index (struct of arrays, so a million ties stay compact). */
export type TieArrays = {
  readonly length: number;
  readonly from: Int32Array;
  readonly to: Int32Array;
  readonly weight: Float64Array;
  readonly valence: Float64Array;
  /** 1 for a one-way tie. */
  readonly directed: Uint8Array;
  /** Indexes into Graph.layers and Graph.kinds. */
  readonly layer: Int32Array;
  readonly kind: Int32Array;
};

export type Graph = {
  /** Node ids, sorted: index i of every answer is ids[i]. */
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  readonly n: number;
  readonly combine: Combine;
  /**
   * The linked pairs as an undirected adjacency (CSR): node i's neighbours are targets[offsets[i] .. offsets[i + 1]),
   * ascending, each with its combined weight. No self-loops.
   */
  readonly offsets: Int32Array;
  readonly targets: Int32Array;
  readonly weights: Float64Array;
  /** Each node's summed link weight (its weighted degree). */
  readonly strength: Float64Array;
  /** How many pairs are linked, and their summed weight (m, weighted). */
  readonly pairs: number;
  readonly totalWeight: number;
  readonly ties: TieArrays;
  /** Sorted. */
  readonly layers: readonly string[];
  readonly kinds: readonly string[];
};

const num = (x: unknown, fallback: number): number => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Builds the graph every other function reads. Ties from a character to itself are dropped. */
export function buildGraph(input: Iterable<Tie>, options: GraphOptions = {}): Graph {
  const combine: Combine = options.combine === "max" ? "max" : "sum";
  const idSet = new Set<string>();
  for (const id of options.nodes ?? []) if (id) idSet.add(id);
  const layerSet = new Set<string>();
  const kindSet = new Set<string>();
  type Row = { from: string; to: string; weight: number; valence: number; directed: boolean; layer: string; kind: string };
  const rows: Row[] = [];
  for (const t of input) {
    if (!t.from || !t.to || t.from === t.to) continue;
    const directed = t.directed === true;
    const layer = t.layer || "other";
    const kind = t.kind || layer;
    // A two-way tie reads the same from either end: keep it lower id first, so input order can't change a thing.
    const [from, to] = !directed && t.to < t.from ? [t.to, t.from] : [t.from, t.to];
    rows.push({ from, to, weight: Math.max(num(t.weight, 1), MIN_WEIGHT), valence: num(t.valence, 1), directed, layer, kind });
    idSet.add(from);
    idSet.add(to);
    layerSet.add(layer);
    kindSet.add(kind);
  }
  const ids = [...idSet].sort(cmp);
  const index = new Map(ids.map((id, i) => [id, i]));
  const layers = [...layerSet].sort(cmp);
  const kinds = [...kindSet].sort(cmp);
  const layerIndex = new Map(layers.map((l, i) => [l, i]));
  const kindIndex = new Map(kinds.map((k, i) => [k, i]));
  const n = ids.length;

  // One canonical order for the ties, so every sum below adds up in the same order whatever order they came in.
  const m0 = rows.length;
  const from = Int32Array.from(rows, (r) => index.get(r.from)!);
  const to = Int32Array.from(rows, (r) => index.get(r.to)!);
  const order = Array.from(rows, (_, i) => i).sort((x, y) => {
    const a = rows[x];
    const b = rows[y];
    return (
      from[x] - from[y] ||
      to[x] - to[y] ||
      kindIndex.get(a.kind)! - kindIndex.get(b.kind)! ||
      layerIndex.get(a.layer)! - layerIndex.get(b.layer)! ||
      Number(a.directed) - Number(b.directed) ||
      a.weight - b.weight ||
      a.valence - b.valence
    );
  });
  const ties: TieArrays = {
    length: m0,
    from: new Int32Array(m0),
    to: new Int32Array(m0),
    weight: new Float64Array(m0),
    valence: new Float64Array(m0),
    directed: new Uint8Array(m0),
    layer: new Int32Array(m0),
    kind: new Int32Array(m0),
  };
  order.forEach((src, i) => {
    const r = rows[src];
    ties.from[i] = from[src];
    ties.to[i] = to[src];
    ties.weight[i] = r.weight;
    ties.valence[i] = r.valence;
    ties.directed[i] = r.directed ? 1 : 0;
    ties.layer[i] = layerIndex.get(r.layer)!;
    ties.kind[i] = kindIndex.get(r.kind)!;
  });

  const linked = pairWeights(n, ties, combine, () => true);
  const keys = [...linked.keys()].sort((x, y) => x - y);
  const offsets = new Int32Array(n + 1);
  for (const key of keys) {
    offsets[Math.floor(key / n) + 1]++;
    offsets[(key % n) + 1]++;
  }
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const cursor = offsets.slice(0, n);
  const targets = new Int32Array(offsets[n]);
  const weights = new Float64Array(offsets[n]);
  const strength = new Float64Array(n);
  let totalWeight = 0;
  // In key order (lower end, then higher), each row fills ascending: a node's lower neighbours come from pairs keyed
  // under them, before any pair keyed under the node itself.
  for (const key of keys) {
    const a = Math.floor(key / n);
    const b = key % n;
    const w = linked.get(key)!;
    targets[cursor[a]] = b;
    weights[cursor[a]++] = w;
    targets[cursor[b]] = a;
    weights[cursor[b]++] = w;
    strength[a] += w;
    strength[b] += w;
    totalWeight += w;
  }
  return { ids, index, n, combine, offsets, targets, weights, strength, pairs: keys.length, totalWeight, ties, layers, kinds };
}

/** Each linked pair's combined weight, keyed lower × n + higher, over the ties `keep` lets in. */
function pairWeights(n: number, t: TieArrays, combine: Combine, keep: (e: number) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (let e = 0; e < t.length; e++) {
    if (!keep(e)) continue;
    const [a, b] = t.from[e] < t.to[e] ? [t.from[e], t.to[e]] : [t.to[e], t.from[e]];
    const key = a * n + b;
    const prev = out.get(key);
    out.set(key, prev === undefined ? t.weight[e] : combine === "max" ? Math.max(prev, t.weight[e]) : prev + t.weight[e]);
  }
  return out;
}

/** An answer as a Map by id. */
export function byId(g: Graph, values: ArrayLike<number>): Map<string, number> {
  return new Map(g.ids.map((id, i) => [id, values[i]]));
}

/** How many neighbours node i is linked to. */
export const degreeOf = (g: Graph, i: number): number => g.offsets[i + 1] - g.offsets[i];

/** A seeded random number generator (mulberry32 over an FNV-1a hash of the seed): the same seed, the same draws. */
export function seeded(seed: string | number): () => number {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over the first `k` places (all by default): a uniform random sample in place. */
function shuffle(xs: Int32Array, rand: () => number, k = xs.length): Int32Array {
  for (let i = 0; i < Math.min(k, xs.length - 1); i++) {
    const j = i + Math.floor(rand() * (xs.length - i));
    const x = xs[i];
    xs[i] = xs[j];
    xs[j] = x;
  }
  return xs;
}

const range = (n: number): Int32Array => {
  const xs = new Int32Array(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  return xs;
};

// ---------------------------------------------------------------------------------------------------------------------
// Size and shape

/** The share of possible pairs that are linked. */
export const density = (g: Graph): number => (g.n < 2 ? 0 : (2 * g.pairs) / (g.n * (g.n - 1)));

/** Linked neighbours per node, on average. */
export const averageDegree = (g: Graph): number => (g.n === 0 ? 0 : (2 * g.pairs) / g.n);

export type Components = {
  /** Each node's connected group, 0 the biggest (ties by the smallest member); a node with no links is a group of one. */
  membership: Int32Array;
  /** Group sizes, biggest first: sizes[0] is the giant component. */
  sizes: number[];
};

export function components(g: Graph): Components {
  const { n, offsets, targets } = g;
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let groups = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    label[s] = groups;
    queue[tail++] = s;
    while (head < tail) {
      const v = queue[head++];
      for (let e = offsets[v]; e < offsets[v + 1]; e++) {
        const w = targets[e];
        if (label[w] < 0) {
          label[w] = groups;
          queue[tail++] = w;
        }
      }
    }
    groups++;
  }
  const membership = numberBySize(label, () => true);
  const sizes = new Array<number>(groups).fill(0);
  for (let i = 0; i < n; i++) sizes[membership[i]]++;
  return { membership, sizes };
}

/**
 * Renumbers groups by size, 0 the biggest, ties by the smallest member index (the numbering lib/graph.ts uses), and
 * gives −1 to the nodes `keep` leaves out.
 */
function numberBySize(labels: Int32Array, keep: (i: number) => boolean): Int32Array {
  const size = new Map<number, number>();
  const first = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    if (!keep(i)) continue;
    size.set(labels[i], (size.get(labels[i]) ?? 0) + 1);
    if (!first.has(labels[i])) first.set(labels[i], i);
  }
  const ordered = [...size.keys()].sort((p, q) => size.get(q)! - size.get(p)! || first.get(p)! - first.get(q)!);
  const rank = new Map(ordered.map((l, i) => [l, i]));
  const out = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = keep(i) ? rank.get(labels[i])! : -1;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Degree, valence and reciprocity

export type LayerDegree = {
  /** A layer, or ALL_LAYERS across them. */
  layer: string;
  /** Distinct neighbours through that layer's ties, whichever way they point. */
  degree: Int32Array;
  /** Their combined weights (`combine`, per pair, within the layer). */
  weighted: Float64Array;
};

/** Degree and weighted degree, across all layers (first) and per layer, as social_metrics stores them. */
export function layerDegrees(g: Graph): LayerDegree[] {
  const { n } = g;
  const all: LayerDegree = { layer: ALL_LAYERS, degree: new Int32Array(n), weighted: g.strength.slice() };
  for (let i = 0; i < n; i++) all.degree[i] = degreeOf(g, i);
  return [
    all,
    ...g.layers.map((layer, l) => {
      const degree = new Int32Array(n);
      const weighted = new Float64Array(n);
      for (const [key, w] of pairWeights(n, g.ties, g.combine, (e) => g.ties.layer[e] === l)) {
        const a = Math.floor(key / n);
        const b = key % n;
        degree[a]++;
        degree[b]++;
        weighted[a] += w;
        weighted[b] += w;
      }
      return { layer, degree, weighted };
    }),
  ];
}

export type Valences = {
  /** Mean valence of the ties toward each node (its reputation, on public ties); NaN with none. */
  in: Float64Array;
  /** Mean valence of the ties from each node; NaN with none. */
  out: Float64Array;
  inCount: Int32Array;
  outCount: Int32Array;
};

/** How the ties toward and from each node feel, on average. A two-way tie counts both ways for both ends. */
export function valences(g: Graph): Valences {
  const { n, ties: t } = g;
  const inSum = new Float64Array(n);
  const outSum = new Float64Array(n);
  const inCount = new Int32Array(n);
  const outCount = new Int32Array(n);
  for (let e = 0; e < t.length; e++) {
    const [u, v, x] = [t.from[e], t.to[e], t.valence[e]];
    outSum[u] += x;
    outCount[u]++;
    inSum[v] += x;
    inCount[v]++;
    if (!t.directed[e]) {
      outSum[v] += x;
      outCount[v]++;
      inSum[u] += x;
      inCount[u]++;
    }
  }
  const mean = (sum: Float64Array, count: Int32Array) => sum.map((s, i) => (count[i] ? s / count[i] : NaN));
  return { in: mean(inSum, inCount), out: mean(outSum, outCount), inCount, outCount };
}

export type Reciprocity = {
  /** The share of one-way ties answered by the same kind back (a crush returned); NaN with no one-way ties. */
  overall: number;
  /** Per node, 2·|answered| / (|out| + |in|) over its one-way ties (as networkx); NaN for a node with none. */
  node: Float64Array;
};

/**
 * Reciprocity of the one-way kinds: a crush answered by a crush, a grudge by a grudge, being told about by telling
 * about. Two-way ties are mutual by definition and don't count. Pass only kinds where an answer means something:
 * parent → child is one-way by nature, so "unanswered" says nothing there.
 */
export function reciprocity(g: Graph): Reciprocity {
  const { n, ties: t } = g;
  // An arc per (kind, from, to), each once. Kinds × n² stays exact in a double up to about 30 kinds at 10 million nodes.
  const key = (kind: number, u: number, v: number) => (kind * n + u) * n + v;
  const arcs = new Set<number>();
  const list: number[] = [];
  for (let e = 0; e < t.length; e++) {
    if (!t.directed[e]) continue;
    const k = key(t.kind[e], t.from[e], t.to[e]);
    if (arcs.has(k)) continue;
    arcs.add(k);
    list.push(e);
  }
  const out = new Int32Array(n);
  const inn = new Int32Array(n);
  const answered = new Int32Array(n);
  let mutual = 0;
  for (const e of list) {
    const [u, v] = [t.from[e], t.to[e]];
    out[u]++;
    inn[v]++;
    if (arcs.has(key(t.kind[e], v, u))) {
      mutual++;
      answered[u]++;
    }
  }
  const node = new Float64Array(n);
  for (let i = 0; i < n; i++) node[i] = out[i] + inn[i] ? (2 * answered[i]) / (out[i] + inn[i]) : NaN;
  return { overall: list.length ? mutual / list.length : NaN, node };
}

// ---------------------------------------------------------------------------------------------------------------------
// Centrality

export type PageRankOptions = {
  /** The chance of following a tie rather than jumping anywhere. Default 0.85. */
  damping?: number;
  /** Stop when the ranks move less than this in all (L1). Default 1e-10. */
  tolerance?: number;
  maxIterations?: number;
  /** Follow ties in proportion to their weight (default), or evenly. */
  weighted?: boolean;
};

/**
 * Weighted PageRank by power iteration. A two-way tie points both ways, a one-way tie from its holder; a pair's ties in
 * one direction combine like links. A node with nowhere to go (no ties out) shares its rank with everyone evenly, so
 * the ranks always sum to 1. Matches networkx's pagerank.
 */
export function pagerank(g: Graph, options: PageRankOptions = {}): Float64Array {
  const { damping = 0.85, tolerance = 1e-10, maxIterations = 200, weighted = true } = options;
  const { n, ties: t } = g;
  if (n === 0) return new Float64Array(0);
  const arcs = new Map<number, number>();
  const add = (u: number, v: number, w: number) => {
    const k = u * n + v;
    const prev = arcs.get(k);
    arcs.set(k, prev === undefined ? w : !weighted || g.combine === "max" ? Math.max(prev, w) : prev + w);
  };
  for (let e = 0; e < t.length; e++) {
    const w = weighted ? t.weight[e] : 1;
    add(t.from[e], t.to[e], w);
    if (!t.directed[e]) add(t.to[e], t.from[e], w);
  }
  // Pull form: each node sums its in-arcs, each carrying its source's rank times the arc's share of the source's out.
  const out = new Float64Array(n);
  const inCount = new Int32Array(n + 1);
  for (const [k, w] of arcs) {
    out[Math.floor(k / n)] += w;
    inCount[(k % n) + 1]++;
  }
  for (let i = 0; i < n; i++) inCount[i + 1] += inCount[i];
  const cursor = inCount.slice(0, n);
  const src = new Int32Array(arcs.size);
  const share = new Float64Array(arcs.size);
  for (const [k, w] of arcs) {
    const u = Math.floor(k / n);
    const v = k % n;
    src[cursor[v]] = u;
    share[cursor[v]++] = w / out[u];
  }
  let x = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);
  for (let it = 0; it < maxIterations; it++) {
    let dangling = 0;
    for (let i = 0; i < n; i++) if (out[i] === 0) dangling += x[i];
    const base = (1 - damping) / n + (damping * dangling) / n;
    let moved = 0;
    for (let v = 0; v < n; v++) {
      let s = 0;
      for (let a = inCount[v]; a < inCount[v + 1]; a++) s += x[src[a]] * share[a];
      next[v] = base + damping * s;
      moved += Math.abs(next[v] - x[v]);
    }
    [x, next] = [next, x];
    if (moved < tolerance) break;
  }
  return x;
}

export type BetweennessOptions = {
  /** Scale to 0..1 by the pairs that could pass through a node, (n−1)(n−2) ordered (default), or raw pair counts. */
  normalized?: boolean;
  /** Up to this many nodes, every node is a source (exact). Default 5000. */
  exactUpTo?: number;
  /** Above it, this many seeded random sources, scaled up by n / samples. Default 500. */
  samples?: number;
  seed?: string | number;
};

/**
 * Betweenness centrality (Brandes 2001) over the linked pairs by hops: how often a character sits on the shortest
 * paths between two others, the network's brokers and bridges. Above `exactUpTo` nodes it samples source pivots
 * (Brandes and Pich 2007), seeded, so the same day gives the same numbers. Matches networkx's betweenness_centrality.
 */
export function betweenness(g: Graph, options: BetweennessOptions = {}): Float64Array {
  const { normalized = true, exactUpTo = 5000, samples = 500, seed = "betweenness" } = options;
  const { n, offsets, targets } = g;
  const bc = new Float64Array(n);
  if (n < 3) return bc;
  const sampled = n > exactUpTo && samples < n;
  const sources = sampled ? shuffle(range(n), seeded(seed), samples).subarray(0, Math.max(1, samples)) : range(n);
  const sigma = new Float64Array(n);
  const dist = new Int32Array(n).fill(-1);
  const delta = new Float64Array(n);
  const queue = new Int32Array(n);
  for (const s of sources) {
    let head = 0;
    let tail = 0;
    sigma[s] = 1;
    dist[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const v = queue[head++];
      const dv = dist[v] + 1;
      for (let e = offsets[v]; e < offsets[v + 1]; e++) {
        const w = targets[e];
        if (dist[w] < 0) {
          dist[w] = dv;
          queue[tail++] = w;
        }
        if (dist[w] === dv) sigma[w] += sigma[v];
      }
    }
    // The queue backwards is farthest first, so each node's share is complete before it passes it on.
    for (let q = tail - 1; q > 0; q--) {
      const w = queue[q];
      const dw = dist[w] - 1;
      const coeff = (1 + delta[w]) / sigma[w];
      for (let e = offsets[w]; e < offsets[w + 1]; e++) {
        const v = targets[e];
        if (dist[v] === dw) delta[v] += sigma[v] * coeff;
      }
      bc[w] += delta[w];
    }
    for (let q = 0; q < tail; q++) {
      const v = queue[q];
      sigma[v] = 0;
      dist[v] = -1;
      delta[v] = 0;
    }
  }
  // Every pair was counted from both ends: halve the raw count, or divide by the ordered pairs when normalising.
  let scale = normalized ? 1 / ((n - 1) * (n - 2)) : 0.5;
  if (sampled) scale *= n / sources.length;
  for (let i = 0; i < n; i++) bc[i] *= scale;
  return bc;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cohesion

export type Clustering = {
  /** Each node's local clustering: the share of its neighbour pairs that are linked themselves (0 under 2 links). */
  local: Float64Array;
  /** Mean local clustering over every node (networkx's average_clustering). */
  average: number;
  /** Global transitivity: 3 × triangles / connected triples. */
  transitivity: number;
  triangles: number;
};

/**
 * Clustering and transitivity, unweighted, from a triangle count that orients each link from the lower-degree end
 * (the forward algorithm), so each triangle is found once and a hub costs O(m^1.5) at worst, not O(degree²).
 */
export function clustering(g: Graph): Clustering {
  const { n, offsets, targets } = g;
  const order = range(n).sort((a, b) => degreeOf(g, a) - degreeOf(g, b) || a - b);
  const rank = new Int32Array(n);
  order.forEach((v, r) => (rank[v] = r));
  const fOffsets = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) {
    let k = 0;
    for (let e = offsets[v]; e < offsets[v + 1]; e++) if (rank[targets[e]] > rank[v]) k++;
    fOffsets[v + 1] = fOffsets[v] + k;
  }
  const forward = new Int32Array(fOffsets[n]);
  for (let v = 0, c = 0; v < n; v++) for (let e = offsets[v]; e < offsets[v + 1]; e++) if (rank[targets[e]] > rank[v]) forward[c++] = targets[e];
  const tri = new Float64Array(n);
  const mark = new Int32Array(n).fill(-1);
  let triangles = 0;
  for (let u = 0; u < n; u++) {
    for (let e = fOffsets[u]; e < fOffsets[u + 1]; e++) mark[forward[e]] = u;
    for (let e = fOffsets[u]; e < fOffsets[u + 1]; e++) {
      const v = forward[e];
      for (let f = fOffsets[v]; f < fOffsets[v + 1]; f++) {
        const w = forward[f];
        if (mark[w] === u) {
          tri[u]++;
          tri[v]++;
          tri[w]++;
          triangles++;
        }
      }
    }
  }
  const local = new Float64Array(n);
  let triples = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = degreeOf(g, i);
    const pairs = (d * (d - 1)) / 2;
    triples += pairs;
    local[i] = pairs > 0 ? tri[i] / pairs : 0;
    sum += local[i];
  }
  return { local, average: n ? sum / n : 0, transitivity: triples ? (3 * triangles) / triples : 0, triangles };
}

/**
 * Core numbers (k-core decomposition, Batagelj and Zaversnik 2003, O(m)): the largest k such that the node sits in a
 * group where everyone has at least k links inside it. The show's dense centre has the highest.
 */
export function coreNumbers(g: Graph): Int32Array {
  const { n, offsets, targets } = g;
  const deg = new Int32Array(n);
  let maxDeg = 0;
  for (let i = 0; i < n; i++) {
    deg[i] = degreeOf(g, i);
    if (deg[i] > maxDeg) maxDeg = deg[i];
  }
  const bin = new Int32Array(maxDeg + 2);
  for (let i = 0; i < n; i++) bin[deg[i]]++;
  for (let d = 0, start = 0; d <= maxDeg; d++) {
    const count = bin[d];
    bin[d] = start;
    start += count;
  }
  const pos = new Int32Array(n);
  const vert = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i] = bin[deg[i]]++;
    vert[pos[i]] = i;
  }
  for (let d = maxDeg; d > 0; d--) bin[d] = bin[d - 1];
  bin[0] = 0;
  for (let i = 0; i < n; i++) {
    const v = vert[i];
    for (let e = offsets[v]; e < offsets[v + 1]; e++) {
      const u = targets[e];
      if (deg[u] > deg[v]) {
        const du = deg[u];
        const pu = pos[u];
        const pw = bin[du];
        const w = vert[pw];
        if (u !== w) {
          pos[u] = pw;
          vert[pu] = w;
          pos[w] = pu;
          vert[pw] = u;
        }
        bin[du]++;
        deg[u]--;
      }
    }
  }
  return deg;
}

/**
 * Burt's constraint (structural holes, 1992), weighted: how much a node's ties lead back into each other.
 * c_i = Σ_j (p_ij + Σ_q p_iq·p_qj)², where p_ij is the share of i's tie weight that goes to j. A broker whose friends
 * don't know each other scores low; someone inside one tight clique, or with a single tie (1), scores high. NaN for a
 * node with no ties. Matches networkx's constraint.
 */
export function constraint(g: Graph): Float64Array {
  const { n, offsets, targets, weights, strength } = g;
  const out = new Float64Array(n);
  const p = new Float64Array(n);
  const mark = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (offsets[i] === offsets[i + 1]) {
      out[i] = NaN;
      continue;
    }
    for (let e = offsets[i]; e < offsets[i + 1]; e++) {
      p[targets[e]] = weights[e] / strength[i];
      mark[targets[e]] = i;
    }
    let c = 0;
    for (let e = offsets[i]; e < offsets[i + 1]; e++) {
      const j = targets[e];
      // Paths i → q → j through i's other ties: walk j's ties to find the q that i holds too.
      let indirect = 0;
      for (let f = offsets[j]; f < offsets[j + 1]; f++) {
        const q = targets[f];
        if (q !== i && mark[q] === i) indirect += p[q] * (weights[f] / strength[q]);
      }
      c += (p[j] + indirect) ** 2;
    }
    out[i] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Communities

/** Gains closer than this are a tie (float noise). */
const EPSILON = 1e-10;

/**
 * Modularity (Newman 2004) of a split, weighted: the share of link weight inside communities, less what chance would
 * put there. A node with membership −1 counts as a community of its own. 0 with no links. Matches networkx's modularity.
 */
export function modularity(g: Graph, membership: ArrayLike<number>): number {
  const { n, offsets, targets, weights, strength } = g;
  const m2 = 2 * g.totalWeight;
  if (m2 <= 0) return 0;
  const community = (i: number) => (membership[i] < 0 ? -1 - i : membership[i]);
  const inside = new Map<number, number>();
  const total = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = community(i);
    total.set(c, (total.get(c) ?? 0) + strength[i]);
    for (let e = offsets[i]; e < offsets[i + 1]; e++) if (community(targets[e]) === c) inside.set(c, (inside.get(c) ?? 0) + weights[e]);
  }
  let q = 0;
  for (const [c, tot] of total) q += (inside.get(c) ?? 0) / m2 - (tot / m2) ** 2;
  return q;
}

export type LabelPropagationOptions = { seed?: string | number; maxIterations?: number };

/**
 * Communities by weighted label propagation (Raghavan, Albert and Kumara 2007), asynchronous and seeded: in a shuffled
 * order each node takes the label its neighbours' tie weight backs most, keeping its own when that's among the best,
 * otherwise drawing among the best. Stops when nobody changes. About linear per sweep, but on dense, weakly divided
 * graphs it can flood a whole connected group into one community; `communities` checks it against Louvain.
 * Returns −1 for nodes with no links, others numbered by size.
 */
export function labelPropagation(g: Graph, options: LabelPropagationOptions = {}): Int32Array {
  const { seed = "communities", maxIterations = 100 } = options;
  const { n, offsets, targets, weights } = g;
  const rand = seeded(seed);
  const label = range(n);
  const order = range(n);
  const acc = new Float64Array(n);
  const stamp = new Int32Array(n).fill(-1);
  const touched: number[] = [];
  const best: number[] = [];
  let visit = 0;
  for (let it = 0; it < maxIterations; it++) {
    shuffle(order, rand);
    let changed = 0;
    for (const i of order) {
      if (offsets[i] === offsets[i + 1]) continue;
      visit++;
      touched.length = 0;
      for (let e = offsets[i]; e < offsets[i + 1]; e++) {
        const l = label[targets[e]];
        if (stamp[l] !== visit) {
          stamp[l] = visit;
          acc[l] = 0;
          touched.push(l);
        }
        acc[l] += weights[e];
      }
      let top = -Infinity;
      for (const l of touched) if (acc[l] > top) top = acc[l];
      const bar = top - EPSILON * Math.max(1, top);
      if (stamp[label[i]] === visit && acc[label[i]] >= bar) continue;
      best.length = 0;
      for (const l of touched) if (acc[l] >= bar) best.push(l);
      label[i] = best[Math.floor(rand() * best.length)];
      changed++;
    }
    if (!changed) break;
  }
  return numberBySize(label, (i) => offsets[i] !== offsets[i + 1]);
}

/**
 * Communities by modularity (the Louvain method, Blondel et al. 2008), weighted and deterministic: nodes visited in id
 * order, a move needs a strictly better gain, ties go to the smaller community, then each community collapses into one
 * node and it repeats until nothing moves. The same method as the Constellation's lib/graph.ts communities, on arrays
 * so it scales. Returns −1 for nodes with no links, others numbered by size.
 */
export function louvain(g: Graph): Int32Array {
  let n = g.n;
  let offsets = g.offsets;
  let targets = g.targets;
  let weights = g.weights;
  // Original node → its node at the current level.
  const member = range(g.n);
  for (let level = 0; level < 32 && n > 0; level++) {
    // A collapsed community keeps its inside weight as a self-loop holding both directions, so a node's degree is
    // always its row's sum and 2m the sum of every row.
    const k = new Float64Array(n);
    let m2 = 0;
    for (let i = 0; i < n; i++) {
      for (let e = offsets[i]; e < offsets[i + 1]; e++) k[i] += weights[e];
      m2 += k[i];
    }
    if (m2 <= 0) break;
    const comm = range(n);
    const tot = k.slice();
    const acc = new Float64Array(n);
    const stamp = new Int32Array(n).fill(-1);
    const touched: number[] = [];
    let visit = 0;
    let movedAny = false;
    for (let pass = 0; pass < 100; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        visit++;
        touched.length = 0;
        for (let e = offsets[i]; e < offsets[i + 1]; e++) {
          const j = targets[e];
          if (j === i) continue;
          const c = comm[j];
          if (stamp[c] !== visit) {
            stamp[c] = visit;
            acc[c] = 0;
            touched.push(c);
          }
          acc[c] += weights[e];
        }
        const from = comm[i];
        tot[from] -= k[i];
        // The modularity gain of joining community c, up to a constant: the weight into c less what chance would put there.
        const gain = (c: number) => (stamp[c] === visit ? acc[c] : 0) - (tot[c] * k[i]) / m2;
        let best = from;
        let bestGain = gain(from);
        for (const c of touched) {
          if (c === from) continue;
          const x = gain(c);
          if (x > bestGain + EPSILON || (best !== from && Math.abs(x - bestGain) <= EPSILON && c < best)) {
            best = c;
            bestGain = x;
          }
        }
        tot[best] += k[i];
        if (best !== from) {
          comm[i] = best;
          moved = movedAny = true;
        }
      }
      if (!moved) break;
    }
    if (!movedAny) break;
    // Collapse each community into one node, numbered by its first member, and go again one level up.
    const renumber = new Int32Array(n).fill(-1);
    let count = 0;
    for (let i = 0; i < n; i++) if (renumber[comm[i]] < 0) renumber[comm[i]] = count++;
    for (let v = 0; v < g.n; v++) member[v] = renumber[comm[member[v]]];
    if (count === n) break;
    const merged = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const ci = renumber[comm[i]];
      for (let e = offsets[i]; e < offsets[i + 1]; e++) {
        const key = ci * count + renumber[comm[targets[e]]];
        merged.set(key, (merged.get(key) ?? 0) + weights[e]);
      }
    }
    const keys = [...merged.keys()].sort((x, y) => x - y);
    const nextOffsets = new Int32Array(count + 1);
    for (const key of keys) nextOffsets[Math.floor(key / count) + 1]++;
    for (let i = 0; i < count; i++) nextOffsets[i + 1] += nextOffsets[i];
    const nextTargets = new Int32Array(keys.length);
    const nextWeights = new Float64Array(keys.length);
    keys.forEach((key, e) => {
      nextTargets[e] = key % count;
      nextWeights[e] = merged.get(key)!;
    });
    [n, offsets, targets, weights] = [count, nextOffsets, nextTargets, nextWeights];
  }
  return numberBySize(member, (i) => degreeOf(g, i) > 0);
}

export type Communities = {
  /** Each node's community, 0 the biggest (ties by the smallest member); −1 for a node with no links. */
  membership: Int32Array;
  count: number;
  modularity: number;
  method: "louvain" | "label_propagation";
};

/**
 * The network's communities: seeded label propagation and Louvain both run, and the split with the higher modularity
 * wins (Louvain on a tie, the steadier of the two from day to day). Label propagation is the cheap, classic answer, but
 * it once flooded whole connected groups of this very graph into one cluster (lib/graph.ts), so it never stands alone.
 */
export function communities(g: Graph, options: LabelPropagationOptions = {}): Communities {
  const fromLouvain = louvain(g);
  const fromLabels = labelPropagation(g, options);
  const [qL, qP] = [modularity(g, fromLouvain), modularity(g, fromLabels)];
  const [membership, q, method] = qP > qL + EPSILON ? [fromLabels, qP, "label_propagation" as const] : [fromLouvain, qL, "louvain" as const];
  let count = 0;
  for (const c of membership) if (c + 1 > count) count = c + 1;
  return { membership, count, modularity: q, method };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mixing

/**
 * Categorical assortativity (Newman 2003) over the linked pairs: 1 when every link joins two of a kind (vampires with
 * vampires), 0 when kinds mix as chance would, below 0 when opposites link. `categoryOf` gives a node's category (its
 * kind, its origin), several (its tags: each link's share is spread evenly over the pairs of their categories), or
 * nothing (its links are left out). NaN when it can't say: no categorised links, or a single category.
 */
export function assortativity(
  g: Graph,
  categoryOf: (id: string) => string | readonly string[] | null | undefined,
  options: { weighted?: boolean } = {},
): number {
  const { n, offsets, targets, weights } = g;
  const index = new Map<string, number>();
  const cats: (number[] | null)[] = g.ids.map((id) => {
    const c = categoryOf(id);
    const list = (c == null ? [] : typeof c === "string" ? [c] : [...new Set(c)]).filter((x) => x !== "");
    if (!list.length) return null;
    return list.map((x) => index.get(x) ?? index.set(x, index.size).get(x)!);
  });
  const k = index.size;
  if (k < 2) return NaN;
  const mix = new Float64Array(k * k);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const ci = cats[i];
    if (!ci) continue;
    for (let e = offsets[i]; e < offsets[i + 1]; e++) {
      const j = targets[e];
      const cj = cats[j];
      if (j < i || !cj) continue;
      const w = options.weighted ? weights[e] : 1;
      const share = w / (ci.length * cj.length);
      for (const a of ci) {
        for (const b of cj) {
          mix[a * k + b] += share;
          mix[b * k + a] += share;
        }
      }
      total += 2 * w;
    }
  }
  if (total <= 0) return NaN;
  let trace = 0;
  const margin = new Float64Array(k);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) margin[a] += mix[a * k + b] / total;
    trace += mix[a * k + a] / total;
  }
  let chance = 0;
  for (let a = 0; a < k; a++) chance += margin[a] * margin[a];
  return 1 - chance < EPSILON ? NaN : (trace - chance) / (1 - chance);
}

// ---------------------------------------------------------------------------------------------------------------------
// Time

/**
 * Closeness after `days` without contact, halving every `halfLifeDays` (PRD §7: friendship 120 days). A kind with no
 * half-life (null: kin) never decays, and neither does anything over zero or negative days. Clamped to 0..1.
 */
export function decay(closeness: number, days: number, halfLifeDays: number | null | undefined): number {
  const c = Math.min(1, Math.max(0, closeness));
  if (halfLifeDays == null || !(halfLifeDays > 0) || !(days > 0)) return c;
  return c * 0.5 ** (days / halfLifeDays);
}
