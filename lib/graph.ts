/**
 * The Constellation (/graph): the whole public social graph in one payload — every listed character as a node,
 * every pair with publicly aired dates as an edge, weighted by tie strength (lib/relationships.ts tieNow on the
 * public layer). Built only from the `relationships` public_* columns, the characters table and the aired public dates
 * themselves, so it can never leak a private date, a match, a swipe or a text. Privacy follows the directory's rules
 * (lib/directory.ts): a private character keeps its name and id only (no portrait, hue or origin), an edge touching one
 * keeps the pair's existence only (the cast tab already lists those by name), and a deleted account's characters vanish.
 *
 * The page reads it through lib/graph-cache.ts (60 s, dropped on a visibility change, a report or moderation). A pair's
 * timeline isn't in the payload: the panel asks for it (`pairTimeline`, /api/graph/[a]/[b]) when someone opens it.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { publicDateSql } from "./date-number";
import { originSql, type Origin } from "./origin";
import { KIND_IDS, KINDS, kindLabel, type KindId } from "./kinds";
import { healRelationships, stageOf, tieStrength, type Stage, STAGE_LABELS } from "./relationships";
import { DELETED_OWNER, REPORT_HIDE_THRESHOLD, type DramaAnswer, type DramaQuestion, type Ending } from "./rules";

export type GraphNode = {
  id: string;
  name: string;
  /** The owner's chosen avatar hue (lib/avatar.ts), null for auto; always null on a private character. */
  hue: number | null;
  /** Who made them (lib/origin.ts); null on a private character. */
  origin: Origin | null;
  /** `/api/assets/…` portrait path; null when none or private. */
  portrait: string | null;
  private: boolean;
  /** How many pairs with public dates this character is part of (visible on the canvas either way). */
  degree: number;
  /** What they are (lib/kinds.ts) and its label ("🧛 Vampire", or an "other"'s own words); null when unsaid or private. */
  kind: KindId | null;
  kind_label: string | null;
  /** Which cluster of the sky they're in (`communities`), 0 the biggest; null in orbit or when private. */
  community: number | null;
};

/** One public date of a pair, oldest first, with where the pair stood after it (stageOf over the public endings so far). */
export type TimelineStep = { at: string; ending: Ending; stage: string | null };

/** A pair's public dates (`pairTimeline`): the latest TIMELINE_KEPT, and how many there are in all. */
export type PairTimeline = { timeline: TimelineStep[]; total: number; truncated: boolean };
export const TIMELINE_KEPT = 30;

/** How a pair's first public date came about, coarsely: the show (or a blind draw) set it up, or one of them asked. */
export type MetVia = "set_up" | "asked";

export type GraphEdge = {
  a_id: string;
  b_id: string;
  /** True when either character is private: the pair's existence is public (the cast tab lists it by name), the rest isn't. */
  masked: boolean;
  dates: number;
  second_dates: number;
  /** The public stage's label (STAGE_LABELS), or null while masked/unknown. */
  stage: string | null;
  /** ISO timestamp of the last publicly aired date; null while masked. */
  last_at: string | null;
  /** Tie strength 0..1 (tieNow on the public layer); a fixed faint weight while masked. */
  weight: number;
  /** When their first public date aired (from the episodes, never the trimmed stored history); null while masked. */
  first_at: string | null;
  /**
   * The only directional signals that are public: each aired public date's drama answer (lib/rules.ts DRAMA_QUESTIONS).
   * `turned_down.a`: times a turned b down ("who gets rejected?"); `left_first.a`: times a walked out first. Never a
   * wish, a match or a line's interest. Null while masked. The page folds them behind "Show what happened", like the
   * episode page's recap toggle, since they give endings away.
   */
  turned_down: { a: number; b: number } | null;
  left_first: { a: number; b: number; together: number } | null;
  /**
   * How their first PUBLIC date came about (DateSetup.met_via, coarsely): read from that date alone, so a private date
   * before it changes nothing here. Null when that date was booked before it was recorded (22 October 2026), or while
   * masked: which match or proposal is its owners' business.
   */
  met_via: MetVia | null;
};

/** Who dates whom by kind (`kindMatrix`): one row per pair of kinds, "unsaid" for a character that hasn't said. */
export type KindPair = { a: KindId | "unsaid"; b: KindId | "unsaid"; pairs: number; dates: number };

export type GraphStats = {
  characters: number;
  couples: number;
  /** Publicly aired dates across all pairs (an aggregate: attributes nothing to any private pair). */
  dates: number;
  /** Characters still waiting for their first public date (the orbit ring). */
  singles: number;
  most_connected: { id: string; name: string; degree: number } | null;
  deepest: { a: string; b: string; dates: number } | null;
  /** Public pairs whose two characters said different kinds (a vampire and a robot). */
  cross_kind: number;
  /** Three characters who've all dated each other. */
  triangles: number;
  /** Clusters of two or more on the canvas. */
  communities: number;
  /** The share of people's and agents' public characters that say what they are; null with none. */
  kind_coverage: number | null;
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats; kinds: KindPair[] };

/** The faint weight a masked edge renders at: present, never informative. */
export const MASKED_WEIGHT = 0.15;

/** Tie strength for one public edge as of `now` (second dates stand in for reciprocity on the public layer). */
export function publicWeight(e: { dates: number; second_dates: number; last_at: string | null }, now: Date): number {
  return tieStrength({ dates: e.dates, second_dates: e.second_dates, mutual_yes: 0, chemistry: null, last_at: e.last_at }, now, true);
}

/** A private character keeps its name and id only (the directory's rule), and its degree (its edges are visible anyway). */
export function maskNode(n: GraphNode): GraphNode {
  return n.private ? { ...n, hue: null, origin: null, portrait: null, kind: null, kind_label: null, community: null } : n;
}

/** An edge touching a private character keeps the pair's existence only. */
export function maskEdge(e: GraphEdge, privateIds: Set<string>): GraphEdge {
  if (!privateIds.has(e.a_id) && !privateIds.has(e.b_id)) return e;
  return {
    ...e,
    masked: true,
    dates: 0,
    second_dates: 0,
    stage: null,
    last_at: null,
    weight: MASKED_WEIGHT,
    first_at: null,
    turned_down: null,
    left_first: null,
    met_via: null,
  };
}

/** How many triangles the pairs make: three characters who've each dated the other two. */
export function triangles(edges: readonly { a_id: string; b_id: string }[]): number {
  const adj = new Map<string, Set<string>>();
  const link = (x: string, y: string) => (adj.get(x) ?? adj.set(x, new Set()).get(x)!).add(y);
  for (const e of edges) {
    link(e.a_id, e.b_id);
    link(e.b_id, e.a_id);
  }
  let n = 0;
  for (const e of edges) {
    const [x, y] = [adj.get(e.a_id)!, adj.get(e.b_id)!];
    for (const z of x.size < y.size ? x : y) if (z > e.a_id && z > e.b_id && (x.size < y.size ? y : x).has(z)) n++;
  }
  return n;
}

/** A zero or negative tie still links two characters in the clustering, just barely. */
const MIN_CLUSTER_WEIGHT = 1e-6;
/** Gains closer than this are a tie (float noise), settled by the smaller cluster number. */
const GAIN_EPSILON = 1e-10;

/**
 * Clusters by modularity (the Louvain method, Blondel et al. 2008): each character moves to the neighbouring cluster
 * that raises modularity most, then each cluster becomes one node and it repeats, until nothing moves. Two triangles
 * joined by one date stay two clusters, a star stays one, and characters with no path between them never share one
 * (label propagation, its predecessor here, flooded whole connected groups into a single cluster).
 *
 * Deterministic: the pairs are put in one canonical order first (so the sums come out bit-for-bit the same whatever
 * order they arrive in), characters are visited in id order, a move needs a strictly better gain, and ties go to the
 * smaller cluster. Returns each connected character's cluster, numbered by size (0 the biggest; ties by the smallest
 * member id).
 */
export function communities(edges: readonly { a_id: string; b_id: string; weight: number }[]): Map<string, number> {
  const pairs = new Map<string, [string, string, number]>();
  for (const e of edges) {
    if (e.a_id === e.b_id) continue;
    const [x, y] = e.a_id < e.b_id ? [e.a_id, e.b_id] : [e.b_id, e.a_id];
    pairs.set(`${x}\u0000${y}`, [x, y, e.weight > MIN_CLUSTER_WEIGHT ? e.weight : MIN_CLUSTER_WEIGHT]);
  }
  const list = [...pairs.values()].sort((p, q) => (p[0] !== q[0] ? (p[0] < q[0] ? -1 : 1) : p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0));
  const ids = [...new Set(list.flatMap(([x, y]) => [x, y]))].sort();
  const index = new Map(ids.map((id, i) => [id, i]));

  // adj[i]: neighbour → weight. A cluster collapsed into one node keeps its inside weight as a self-loop, counted twice
  // (both directions), so a node's degree is always the sum of its row and 2m the sum of all of them.
  let adj: Map<number, number>[] = ids.map(() => new Map());
  for (const [x, y, w] of list) {
    const [i, j] = [index.get(x)!, index.get(y)!];
    adj[i].set(j, (adj[i].get(j) ?? 0) + w);
    adj[j].set(i, (adj[j].get(i) ?? 0) + w);
  }
  let member = ids.map((_, i) => i);
  for (let level = 0; level < 32; level++) {
    const n = adj.length;
    const k = adj.map((row) => [...row.values()].reduce((s, w) => s + w, 0));
    const m2 = k.reduce((s, x) => s + x, 0);
    if (m2 <= 0) break;
    const comm = adj.map((_, i) => i);
    const tot = k.slice();
    let movedAny = false;
    for (let pass = 0; pass < 100; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const from = comm[i];
        const into = new Map<number, number>();
        for (const [j, w] of adj[i]) if (j !== i) into.set(comm[j], (into.get(comm[j]) ?? 0) + w);
        tot[from] -= k[i];
        // The modularity gain of joining cluster c, up to a constant: the weight into c less what chance would put there.
        const gain = (c: number) => (into.get(c) ?? 0) - (tot[c] * k[i]) / m2;
        let best = from;
        let bestGain = gain(from);
        for (const c of into.keys()) {
          if (c === from) continue;
          const g = gain(c);
          if (g > bestGain + GAIN_EPSILON || (best !== from && Math.abs(g - bestGain) <= GAIN_EPSILON && c < best)) {
            best = c;
            bestGain = g;
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
    // Collapse each cluster into one node, numbered in order of its first member, and go again one level up.
    const renumber = new Map<number, number>();
    for (let i = 0; i < n; i++) if (!renumber.has(comm[i])) renumber.set(comm[i], renumber.size);
    const next: Map<number, number>[] = Array.from({ length: renumber.size }, () => new Map());
    for (let i = 0; i < n; i++) {
      const ci = renumber.get(comm[i])!;
      for (const [j, w] of adj[i]) {
        const cj = renumber.get(comm[j])!;
        next[ci].set(cj, (next[ci].get(cj) ?? 0) + w);
      }
    }
    member = member.map((v) => renumber.get(comm[v])!);
    adj = next;
    if (renumber.size === n) break;
  }
  const groups = new Map<number, string[]>();
  ids.forEach((id, i) => (groups.get(member[i]) ?? groups.set(member[i], []).get(member[i])!).push(id));
  const ordered = [...groups.values()].sort((p, q) => q.length - p.length || (p[0] < q[0] ? -1 : 1));
  return new Map(ordered.flatMap((members, i) => members.map((id) => [id, i] as const)));
}

/** Who dates whom by kind, from the masked graph: only pairs where both are public, each pair of kinds once. */
export function kindMatrix(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): KindPair[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = (k: KindId | "unsaid") => (k === "unsaid" ? KINDS.length : KIND_IDS.indexOf(k));
  const cells = new Map<string, KindPair>();
  for (const e of edges) {
    const [x, y] = [byId.get(e.a_id), byId.get(e.b_id)];
    if (e.masked || !x || !y || x.private || y.private) continue;
    const [a, b] = ([x.kind ?? "unsaid", y.kind ?? "unsaid"] as (KindId | "unsaid")[]).sort((p, q) => order(p) - order(q));
    const key = `${a}~${b}`;
    const cell = cells.get(key) ?? cells.set(key, { a, b, pairs: 0, dates: 0 }).get(key)!;
    cell.pairs++;
    cell.dates += e.dates;
  }
  return [...cells.values()].sort((p, q) => q.pairs - p.pairs || q.dates - p.dates || order(p.a) - order(q.a) || order(p.b) - order(q.b));
}

/**
 * "set_up" when the show or a blind draw paired them, "asked" when someone chose (lib/game.ts MetVia). A second date
 * is "asked" too (one of them booked the plan they made), so every recorded first public date has an answer and an
 * empty one only ever means "booked before it was recorded".
 */
const COARSE_MET: Record<string, MetVia> = {
  blind: "set_up",
  show: "set_up",
  match: "asked",
  proposal: "asked",
  chosen: "asked",
  own_date: "asked",
  second_date: "asked",
};
export const coarseMetVia = (raw: string | null | undefined): MetVia | null => (raw ? (COARSE_MET[raw] ?? null) : null);


/** A pair's public dates (oldest first) as a timeline with the stage after each: the latest TIMELINE_KEPT of them. */
export function publicTimeline(dates: readonly { at: string; ending: Ending }[]): PairTimeline {
  const endings: Ending[] = [];
  const steps = dates.map((d) => {
    endings.push(d.ending);
    const stage = stageOf(endings);
    return { at: d.at, ending: d.ending, stage: stage ? STAGE_LABELS[stage] : null };
  });
  return { timeline: steps.slice(-TIMELINE_KEPT), total: steps.length, truncated: steps.length > TIMELINE_KEPT };
}

/**
 * One pair's public timeline, for the panel when it's opened (it isn't in the page's payload). Null unless both are
 * public characters on the show with at least one public date: a pair touching a private character is existence only.
 * Read from the episodes, so a pair with more dates than the stored history keeps still starts at its first.
 */
export async function pairTimeline(db: Db, x: string, y: string): Promise<PairTimeline | null> {
  if (!(await publicPair(db, x, y))) return null;
  const [lo, hi] = x < y ? [x, y] : [y, x];
  const dates = await db.query<{ ending: Ending; at: string | Date }>(
    `select e.ending, e.revealed_at as at
       from episodes e
      where ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1)) and e.ending is not null
        and ${publicDateSql("e", "$3")}
      order by e.created_at, e.id`,
    [lo, hi, REPORT_HIDE_THRESHOLD],
  );
  if (!dates.rows.length) return null;
  return publicTimeline(dates.rows.map((d) => ({ at: new Date(d.at).toISOString(), ending: d.ending })));
}

/** Both are public characters still on the show: the cheap check (two primary keys) before any of their dates is read. */
export async function publicPair(db: Db, x: string, y: string): Promise<boolean> {
  if (x === y) return false;
  const { rows } = await db.query<{ id: string }>(
    `select id from characters where id = any($1) and visibility is distinct from 'private' and owner_id is distinct from $2`,
    [[x, y], DELETED_OWNER],
  );
  return rows.length === 2;
}

type NodeRow = Omit<GraphNode, "origin" | "kind" | "kind_label" | "community"> & { origin: Origin; kind: string | null; kind_label: string | null };
type EdgeRow = {
  a_id: string;
  b_id: string;
  dates: number;
  second_dates: number;
  public_stage: Stage | null;
  last_at: string | Date | null;
};
export type PublicDateRow = {
  character_a: string;
  character_b: string;
  revealed_at: string | Date;
  met_via: string | null;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
};
type PairFacts = Pick<GraphEdge, "first_at" | "met_via"> & { turned_down: { a: number; b: number }; left_first: { a: number; b: number; together: number } };

/**
 * What a pair's aired public dates say, given oldest first: when the first one aired and how it came about, who turned
 * whom down and who left first. Only public dates go in, so nothing here can tell that a private date happened.
 */
export function publicPairFacts(rows: readonly PublicDateRow[]): Map<string, PairFacts> {
  const facts = new Map<string, PairFacts>();
  for (const d of rows) {
    const [lo, hi] = d.character_a < d.character_b ? [d.character_a, d.character_b] : [d.character_b, d.character_a];
    const key = `${lo}~${hi}`;
    let f = facts.get(key);
    if (!f) {
      f = { first_at: new Date(d.revealed_at).toISOString(), met_via: coarseMetVia(d.met_via), turned_down: { a: 0, b: 0 }, left_first: { a: 0, b: 0, together: 0 } };
      facts.set(key, f);
    }
    if (!d.drama_question || !d.drama_answer) continue;
    // "a" and "b" are the episode's two, in its order; the edge's are lo and hi.
    const who = d.drama_answer === "a" ? d.character_a : d.drama_answer === "b" ? d.character_b : null;
    if (d.drama_question === "rejected" && who) {
      const rejecter = who === d.character_a ? d.character_b : d.character_a;
      f.turned_down[rejecter === lo ? "a" : "b"]++;
    } else if (d.drama_question === "leaves_first") {
      if (who) f.left_first[who === lo ? "a" : "b"]++;
      else f.left_first.together++;
    }
  }
  return facts;
}

/** The whole public constellation in one read (the page caches it: lib/graph-cache.ts). */
export async function constellation(db: Db, now = new Date()): Promise<GraphData> {
  await healRelationships(db);
  const [nodeRows, edgeRows, dateRows] = await Promise.all([
    db.query<NodeRow>(
      `select c.id, c.name, c.avatar_hue as hue, ${originSql("c")} as origin, ${portraitPathSql("c")} as portrait,
              c.visibility = 'private' as private, 0 as degree, c.extras->>'kind' as kind, c.extras->>'kind_label' as kind_label
         from characters c
        where c.owner_id is distinct from $1
        order by c.created_at, c.id`,
      [DELETED_OWNER],
    ),
    // The public layer's columns only: the stored detail (history, facts, jokes, plans) is never read here.
    db.query<EdgeRow>(
      `select r.character_a as a_id, r.character_b as b_id, r.public_dates as dates,
              r.public_second_dates as second_dates, r.public_stage, r.public_last_at as last_at
         from relationships r
         join characters ca on ca.id = r.character_a and ca.owner_id is distinct from $1
         join characters cb on cb.id = r.character_b and cb.owner_id is distinct from $1
        where r.public_dates > 0
        order by r.public_last_at desc nulls last`,
      [DELETED_OWNER],
    ),
    // The aired public dates themselves (the same dates the public layer counts), oldest first: when each pair's first
    // one aired and how it came about (one JSON path of the setup), and the drama answers (who got turned down, who
    // left first), which air with the date on its public page.
    db.query<PublicDateRow>(
      `select e.character_a, e.character_b, e.revealed_at, e.setup->>'met_via' as met_via, e.drama_question, e.drama_answer
         from episodes e
        where ${publicDateSql("e", "$1")}
        order by e.created_at, e.id`,
      [REPORT_HIDE_THRESHOLD],
    ),
  ]);
  const facts = publicPairFacts(dateRows.rows);

  const names = new Map(nodeRows.rows.map((n) => [n.id, n.name]));
  const privateIds = new Set(nodeRows.rows.filter((n) => n.private).map((n) => n.id));
  // Degree counts only edges that survive the deleted-owner filter (the joins above), so nodes and edges agree.
  const degrees = new Map<string, number>();
  for (const e of edgeRows.rows) {
    degrees.set(e.a_id, (degrees.get(e.a_id) ?? 0) + 1);
    degrees.set(e.b_id, (degrees.get(e.b_id) ?? 0) + 1);
  }
  const kindOf = (k: string | null): KindId | null => ((KIND_IDS as readonly string[]).includes(k ?? "") ? (k as KindId) : null);
  const withDegree: GraphNode[] = nodeRows.rows.map((n) => {
    const kind = kindOf(n.kind);
    return { ...n, degree: degrees.get(n.id) ?? 0, kind, kind_label: kind ? kindLabel({ kind, kind_label: n.kind_label }) : null, community: null };
  });
  const raw: GraphEdge[] = edgeRows.rows.map((e) => {
    const last_at = e.last_at ? new Date(e.last_at).toISOString() : null;
    const f = facts.get(`${e.a_id}~${e.b_id}`);
    return {
      a_id: e.a_id,
      b_id: e.b_id,
      masked: false,
      dates: e.dates,
      second_dates: e.second_dates,
      stage: e.public_stage ? STAGE_LABELS[e.public_stage] : null,
      last_at,
      weight: publicWeight({ dates: e.dates, second_dates: e.second_dates, last_at }, now),
      first_at: f?.first_at ?? null,
      turned_down: f?.turned_down ?? { a: 0, b: 0 },
      left_first: f?.left_first ?? { a: 0, b: 0, together: 0 },
      met_via: f?.met_via ?? null,
    };
  });

  // Stats come from the raw (pre-mask) rows: aggregates only, nothing attributed to a private pair.
  const most = withDegree.filter((n) => !n.private && n.degree > 0).sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))[0] ?? null;
  const deepestEdge = raw.filter((e) => !privateIds.has(e.a_id) && !privateIds.has(e.b_id)).sort((a, b) => b.dates - a.dates)[0] ?? null;
  const stats: GraphStats = {
    characters: withDegree.length,
    couples: raw.length,
    dates: raw.reduce((sum, e) => sum + e.dates, 0),
    singles: withDegree.filter((n) => n.degree === 0).length,
    most_connected: most ? { id: most.id, name: most.name, degree: most.degree } : null,
    deepest: deepestEdge ? { a: names.get(deepestEdge.a_id) ?? "?", b: names.get(deepestEdge.b_id) ?? "?", dates: deepestEdge.dates } : null,
    cross_kind: 0,
    triangles: 0,
    communities: 0,
    kind_coverage: null,
  };

  // Everything below reads the masked graph only, so nothing about a private pair feeds it.
  const edges = raw.map((e) => maskEdge(e, privateIds));
  const clusters = communities(edges);
  const nodes = withDegree.map((n) => maskNode({ ...n, community: clusters.get(n.id) ?? null }));
  const kindOfNode = new Map(nodes.map((n) => [n.id, n.kind]));
  stats.cross_kind = edges.filter((e) => {
    const [x, y] = [kindOfNode.get(e.a_id), kindOfNode.get(e.b_id)];
    return !e.masked && x && y && x !== y;
  }).length;
  stats.triangles = triangles(edges);
  const sizes = new Map<number, number>();
  for (const c of clusters.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  stats.communities = [...sizes.values()].filter((s) => s >= 2).length;
  const made = nodes.filter((n) => !n.private && n.origin !== "cast");
  stats.kind_coverage = made.length ? Math.round((made.filter((n) => n.kind).length / made.length) * 100) / 100 : null;
  return { nodes, edges, stats, kinds: kindMatrix(nodes, edges) };
}
