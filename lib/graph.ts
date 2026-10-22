/**
 * The Constellation (/graph): the whole public social graph in one payload — every listed character as a node,
 * every pair with publicly aired dates as an edge, weighted by tie strength (lib/relationships.ts tieNow on the
 * public layer). Built only from the `relationships` public_* columns and the characters table, so it can never
 * leak a private date, a match, a swipe or a text. Privacy follows the directory's rules (lib/directory.ts):
 * a private character keeps its name and id only (no portrait, hue or origin), an edge touching one keeps the
 * pair's existence only (the cast tab already lists those by name), and a deleted account's characters vanish.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { originSql, type Origin } from "./origin";
import { KIND_IDS, KINDS, kindLabel, type KindId } from "./kinds";
import { healRelationships, stageOf, tieStrength, type HistoryItem, type Stage, STAGE_LABELS } from "./relationships";
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

export type GraphEdge = {
  a_id: string;
  b_id: string;
  /** True when either character is private: the pair's existence is public (the cast tab lists it by name), the rest isn't. */
  masked: boolean;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  /** The public stage's label (STAGE_LABELS), or null while masked/unknown. */
  stage: string | null;
  /** ISO timestamp of the last publicly aired date; null while masked. */
  last_at: string | null;
  /** Tie strength 0..1 (tieNow on the public layer); a fixed faint weight while masked. */
  weight: number;
  /** When their first public date aired; null while masked. */
  first_at: string | null;
  /**
   * The only directional signals that are public: each aired public date's drama answer (lib/rules.ts DRAMA_QUESTIONS).
   * `turned_down.a`: times a turned b down ("who gets rejected?"); `left_first.a`: times a walked out first. Never a
   * wish, a match or a line's interest. Null while masked.
   */
  turned_down: { a: number; b: number } | null;
  left_first: { a: number; b: number; together: number } | null;
  /** Their public dates in order, with the stage after each. Empty while masked. */
  timeline: TimelineStep[];
  /**
   * How they met, coarsely (DateSetup.met_via): "set_up" (a blind date or a show room) or "asked" (someone picked the
   * other). Null when unknown, when their first public date wasn't their first date, or while masked: a match or a
   * proposal is its owners' business, and a later first public date would hint at an earlier private one.
   */
  met_via: "set_up" | "asked" | null;
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
    last_ending: null,
    stage: null,
    last_at: null,
    weight: MASKED_WEIGHT,
    first_at: null,
    turned_down: null,
    left_first: null,
    timeline: [],
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

/**
 * Clusters by label propagation (Raghavan et al.), deterministic: ids in order, ties to the smallest label, at most 30
 * rounds. Returns each connected character's cluster, numbered by size (0 the biggest; ties by the smallest member id).
 */
export function communities(edges: readonly { a_id: string; b_id: string; weight: number }[]): Map<string, number> {
  const adj = new Map<string, Map<string, number>>();
  const link = (x: string, y: string, w: number) => (adj.get(x) ?? adj.set(x, new Map()).get(x)!).set(y, w);
  for (const e of edges) {
    link(e.a_id, e.b_id, e.weight);
    link(e.b_id, e.a_id, e.weight);
  }
  const ids = [...adj.keys()].sort();
  const label = new Map(ids.map((id) => [id, id]));
  for (let round = 0; round < 30; round++) {
    let changed = false;
    for (const id of ids) {
      const score = new Map<string, number>();
      for (const [other, w] of adj.get(id)!) score.set(label.get(other)!, (score.get(label.get(other)!) ?? 0) + w);
      const best = [...score].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0][0];
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) (groups.get(label.get(id)!) ?? groups.set(label.get(id)!, []).get(label.get(id)!)!).push(id);
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

/** "set_up" when the show or a blind draw paired them, "asked" when someone chose (lib/game.ts MetVia). */
const COARSE_MET: Record<string, "set_up" | "asked"> = { blind: "set_up", show: "set_up", match: "asked", proposal: "asked", chosen: "asked", own_date: "asked" };

/** A pair's public timeline, first public date and coarse "how they met", from its stored history (server-side only). */
export function publicStory(history: readonly HistoryItem[], allDates: number): Pick<GraphEdge, "timeline" | "first_at" | "met_via"> {
  const pub = history.filter((h) => h.public);
  const endings: Ending[] = [];
  const timeline = pub.map((h) => {
    endings.push(h.ending);
    const stage = stageOf(endings);
    return { at: h.aired_at ?? h.at, ending: h.ending, stage: stage ? STAGE_LABELS[stage] : null };
  });
  // Only when their first public date was their first date of all (the history kept is the whole run, and nothing
  // came before it): otherwise "how they met" would describe a later date, or hint that a private one came first.
  const first = pub[0];
  const whole = history.length === allDates;
  const met = first && whole && history[0] === first && !first.followup_of && first.met_via ? (COARSE_MET[first.met_via] ?? null) : null;
  return { timeline, first_at: timeline[0]?.at ?? null, met_via: met };
}

type NodeRow = Omit<GraphNode, "origin" | "kind" | "kind_label" | "community"> & { origin: Origin; kind: string | null; kind_label: string | null };
type EdgeRow = {
  a_id: string;
  b_id: string;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  public_stage: Stage | null;
  last_at: string | Date | null;
  /** Every date they've had, private ones included: server-side only, to tell whether the history kept is the whole run. */
  all_dates: number;
  history: HistoryItem[] | null;
};
type DramaRow = { character_a: string; character_b: string; drama_question: DramaQuestion; drama_answer: DramaAnswer };

/** The whole public constellation in one read. */
export async function constellation(db: Db, now = new Date()): Promise<GraphData> {
  await healRelationships(db);
  const [nodeRows, edgeRows, dramaRows] = await Promise.all([
    db.query<NodeRow>(
      `select c.id, c.name, c.avatar_hue as hue, ${originSql("c")} as origin, ${portraitPathSql("c")} as portrait,
              c.visibility = 'private' as private, 0 as degree, c.extras->>'kind' as kind, c.extras->>'kind_label' as kind_label
         from characters c
        where c.owner_id is distinct from $1
        order by c.created_at, c.id`,
      [DELETED_OWNER],
    ),
    db.query<EdgeRow>(
      `select r.character_a as a_id, r.character_b as b_id, r.public_dates as dates,
              r.public_second_dates as second_dates, r.public_last_ending as last_ending, r.public_stage,
              r.public_last_at as last_at, r.dates as all_dates, r.detail->'history' as history
         from relationships r
         join characters ca on ca.id = r.character_a and ca.owner_id is distinct from $1
         join characters cb on cb.id = r.character_b and cb.owner_id is distinct from $1
        where r.public_dates > 0
        order by r.public_last_at desc nulls last`,
      [DELETED_OWNER],
    ),
    // The drama answers of aired public dates only (the same dates the public layer counts): who got turned down, who
    // left first. They air with the date, on its public page.
    db.query<DramaRow>(
      `select e.character_a, e.character_b, e.drama_question, e.drama_answer
         from episodes e
        where e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null and e.varies_episode_id is null
          and e.drama_question is not null and e.drama_answer is not null
          and (select count(*)::int from reports r where r.episode_id = e.id) < $1`,
      [REPORT_HIDE_THRESHOLD],
    ),
  ]);
  const drama = new Map<string, { turned_down: { a: number; b: number }; left_first: { a: number; b: number; together: number } }>();
  for (const d of dramaRows.rows) {
    const [lo, hi] = d.character_a < d.character_b ? [d.character_a, d.character_b] : [d.character_b, d.character_a];
    const key = `${lo}~${hi}`;
    const tally = drama.get(key) ?? drama.set(key, { turned_down: { a: 0, b: 0 }, left_first: { a: 0, b: 0, together: 0 } }).get(key)!;
    // "a" and "b" are the episode's two, in its order; the edge's are lo and hi.
    const who = d.drama_answer === "a" ? d.character_a : d.drama_answer === "b" ? d.character_b : null;
    if (d.drama_question === "rejected" && who) {
      const rejecter = who === d.character_a ? d.character_b : d.character_a;
      tally.turned_down[rejecter === lo ? "a" : "b"]++;
    } else if (d.drama_question === "leaves_first") {
      if (who) tally.left_first[who === lo ? "a" : "b"]++;
      else tally.left_first.together++;
    }
  }

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
  const raw: GraphEdge[] = edgeRows.rows.map((e) => ({
    a_id: e.a_id,
    b_id: e.b_id,
    masked: false,
    dates: e.dates,
    second_dates: e.second_dates,
    last_ending: e.last_ending,
    stage: e.public_stage ? STAGE_LABELS[e.public_stage] : null,
    last_at: e.last_at ? new Date(e.last_at).toISOString() : null,
    weight: publicWeight({ dates: e.dates, second_dates: e.second_dates, last_at: e.last_at ? new Date(e.last_at).toISOString() : null }, now),
    ...(drama.get(`${e.a_id}~${e.b_id}`) ?? { turned_down: { a: 0, b: 0 }, left_first: { a: 0, b: 0, together: 0 } }),
    ...publicStory(e.history ?? [], e.all_dates),
  }));

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
  stats.communities = new Set(clusters.values()).size;
  const made = nodes.filter((n) => !n.private && n.origin !== "cast");
  stats.kind_coverage = made.length ? Math.round((made.filter((n) => n.kind).length / made.length) * 100) / 100 : null;
  return { nodes, edges, stats, kinds: kindMatrix(nodes, edges) };
}
