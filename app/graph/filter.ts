/**
 * What the Constellation's filters leave on the sky (ConstellationApp's toolbar). Pure, so vitest covers it without a
 * browser. Edges are always cut down to pairs whose both ends survived (the canvas relies on that alignment).
 */
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { inOriginGroup, type OriginGroup } from "@/lib/origin-group";
import type { KindId } from "@/lib/kinds";

export type OriginFilter = "all" | OriginGroup;
/** "all", a kind, or "unsaid" for characters that haven't said what they are. */
export type KindFilter = "all" | KindId | "unsaid";

export type SkyFilter = {
  origin: OriginFilter;
  /**
   * With a group picked, whoever its characters dated comes too (lib/graph.ts groupSky): "the cast" is the cast's love
   * lives, as the Characters page's preview draws them. Off, only pairs inside the group (and private characters, whose
   * origin isn't public).
   */
  partners: boolean;
  kind: KindFilter;
  /** 2: only pairs with two or more public dates (a private pair always stays: its count is hidden). */
  minDates: number;
  /** The orbit: characters with no line left on the sky. */
  showSingles: boolean;
};

export const DEFAULT_FILTER: SkyFilter = { origin: "all", partners: true, kind: "all", minDates: 0, showSingles: true };

export function filterSky(data: { nodes: GraphNode[]; edges: GraphEdge[] }, f: SkyFilter): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const group = f.origin === "all" ? null : f.origin;
  const members = group ? new Set(data.nodes.filter((n) => inOriginGroup(n.origin, group)).map((n) => n.id)) : null;
  let ns = data.nodes;
  if (members && !f.partners) ns = ns.filter((n) => n.private || members.has(n.id));
  // A private character has no public kind, so a kind filter leaves it out.
  if (f.kind !== "all") ns = ns.filter((n) => !n.private && (f.kind === "unsaid" ? n.kind === null : n.kind === f.kind));
  const ids = new Set(ns.map((n) => n.id));
  const touchesGroup = (e: GraphEdge) => !members || !f.partners || members.has(e.a_id) || members.has(e.b_id);
  const es = data.edges.filter((e) => (e.masked || e.dates >= f.minDates) && ids.has(e.a_id) && ids.has(e.b_id) && touchesGroup(e));
  if (members && f.partners) {
    // A partner is on the sky for a date with the group: one whose dates with it all fell to another filter goes too.
    const linked = new Set(es.flatMap((e) => [e.a_id, e.b_id]));
    ns = ns.filter((n) => members.has(n.id) || linked.has(n.id));
  }
  if (!f.showSingles) {
    const connected = new Set(es.flatMap((e) => [e.a_id, e.b_id]));
    ns = ns.filter((n) => connected.has(n.id));
  }
  return { nodes: ns, edges: es };
}
