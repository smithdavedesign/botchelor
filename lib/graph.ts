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
import { healRelationships, tieStrength, type Stage, STAGE_LABELS } from "./relationships";
import { DELETED_OWNER, type Ending } from "./rules";

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
};

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
};

export type GraphStats = {
  characters: number;
  couples: number;
  /** Publicly aired dates across all pairs (an aggregate: attributes nothing to any private pair). */
  dates: number;
  /** Characters still waiting for their first public date (the orbit ring). */
  singles: number;
  most_connected: { id: string; name: string; degree: number } | null;
  deepest: { a: string; b: string; dates: number } | null;
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats };

/** The faint weight a masked edge renders at: present, never informative. */
export const MASKED_WEIGHT = 0.15;

/** Tie strength for one public edge as of `now` (second dates stand in for reciprocity on the public layer). */
export function publicWeight(e: { dates: number; second_dates: number; last_at: string | null }, now: Date): number {
  return tieStrength({ dates: e.dates, second_dates: e.second_dates, mutual_yes: 0, chemistry: null, last_at: e.last_at }, now, true);
}

/** A private character keeps its name and id only (the directory's rule), and its degree (its edges are visible anyway). */
export function maskNode(n: GraphNode): GraphNode {
  return n.private ? { ...n, hue: null, origin: null, portrait: null } : n;
}

/** An edge touching a private character keeps the pair's existence only. */
export function maskEdge(e: GraphEdge, privateIds: Set<string>): GraphEdge {
  if (!privateIds.has(e.a_id) && !privateIds.has(e.b_id)) return e;
  return { ...e, masked: true, dates: 0, second_dates: 0, last_ending: null, stage: null, last_at: null, weight: MASKED_WEIGHT };
}

type NodeRow = Omit<GraphNode, "origin"> & { origin: Origin };
type EdgeRow = {
  a_id: string;
  b_id: string;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  public_stage: Stage | null;
  last_at: string | Date | null;
};

/** The whole public constellation in one read. */
export async function constellation(db: Db, now = new Date()): Promise<GraphData> {
  await healRelationships(db);
  const [nodeRows, edgeRows] = await Promise.all([
    db.query<NodeRow>(
      `select c.id, c.name, c.avatar_hue as hue, ${originSql("c")} as origin, ${portraitPathSql("c")} as portrait,
              c.visibility = 'private' as private, 0 as degree
         from characters c
        where c.owner_id is distinct from $1
        order by c.created_at, c.id`,
      [DELETED_OWNER],
    ),
    db.query<EdgeRow>(
      `select r.character_a as a_id, r.character_b as b_id, r.public_dates as dates,
              r.public_second_dates as second_dates, r.public_last_ending as last_ending, r.public_stage,
              r.public_last_at as last_at
         from relationships r
         join characters ca on ca.id = r.character_a and ca.owner_id is distinct from $1
         join characters cb on cb.id = r.character_b and cb.owner_id is distinct from $1
        where r.public_dates > 0
        order by r.public_last_at desc nulls last`,
      [DELETED_OWNER],
    ),
  ]);

  const names = new Map(nodeRows.rows.map((n) => [n.id, n.name]));
  const privateIds = new Set(nodeRows.rows.filter((n) => n.private).map((n) => n.id));
  // Degree counts only edges that survive the deleted-owner filter (the joins above), so nodes and edges agree.
  const degrees = new Map<string, number>();
  for (const e of edgeRows.rows) {
    degrees.set(e.a_id, (degrees.get(e.a_id) ?? 0) + 1);
    degrees.set(e.b_id, (degrees.get(e.b_id) ?? 0) + 1);
  }
  const withDegree = nodeRows.rows.map((n) => ({ ...n, degree: degrees.get(n.id) ?? 0 }));
  const raw = edgeRows.rows.map((e) => ({
    a_id: e.a_id,
    b_id: e.b_id,
    masked: false,
    dates: e.dates,
    second_dates: e.second_dates,
    last_ending: e.last_ending,
    stage: e.public_stage ? STAGE_LABELS[e.public_stage] : null,
    last_at: e.last_at ? new Date(e.last_at).toISOString() : null,
    weight: publicWeight({ dates: e.dates, second_dates: e.second_dates, last_at: e.last_at ? new Date(e.last_at).toISOString() : null }, now),
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
  };

  return { nodes: withDegree.map(maskNode), edges: raw.map((e) => maskEdge(e, privateIds)), stats };
}
