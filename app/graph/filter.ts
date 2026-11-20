/**
 * What the Constellation's filters leave on the sky (ConstellationApp's toolbar). Pure, so vitest covers it without a
 * browser. Edges are always cut down to pairs whose both ends survived (the canvas relies on that alignment).
 */
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { groupMember, type SkyGroup } from "@/lib/origin-group";
import type { KindId } from "@/lib/kinds";
import { STAGE_GROUPS, stageGroup, type StageChoice, type StageGroup } from "./stages";

/** Everyone, a group by who made them, or the viewer's own ("yours"). */
export type OriginFilter = "all" | SkyGroup;
/** "all", a kind, or "unsaid" for characters that haven't said what they are. */
export type KindFilter = "all" | KindId | "unsaid";

export type SkyFilter = {
  origin: OriginFilter;
  /**
   * With a group picked, whoever its characters dated comes too (lib/graph.ts groupSky): "the cast" is the cast's love
   * lives, as the Characters page's preview draws them. Off, only pairs inside the group (and, for a group by origin,
   * private characters, whose origin isn't public).
   */
  partners: boolean;
  kind: KindFilter;
  /** 2: only pairs with two or more public dates (a private pair always stays: its count is hidden). */
  minDates: number;
  /** The orbit: characters with no public date yet, on the outer ring. */
  showSingles: boolean;
  /**
   * The kinds of pair whose lines are drawn (./stages.ts); null for every kind. A narrower choice leaves out private
   * pairs too, whose stage isn't public: it's the same for every private pair, so it says nothing about any of them.
   */
  stages: StageChoice;
};

export const DEFAULT_FILTER: SkyFilter = { origin: "all", partners: true, kind: "all", minDates: 0, showSingles: true, stages: null };

/** The stage choice narrows the sky: some groups are off (all of them on, or a null choice, draws every line). */
export const stagesNarrowed = (stages: StageChoice): boolean => stages !== null && stages.size < STAGE_GROUPS.length;

/**
 * A filter on the lines themselves (their stage, their number of dates), as opposed to one on who's on the sky. Under
 * one, a character none of whose lines is left goes too: a sky of couples is the couples, not every star with its
 * lines cut. Characters with no public date at all stay on the orbit (that's The orbit's call, not the lines').
 */
export const linesNarrowed = (f: SkyFilter): boolean => stagesNarrowed(f.stages) || f.minDates >= 2;

/** Whether one pair's line passes the line filters. */
function lineKept(e: GraphEdge, f: SkyFilter): boolean {
  if (!e.masked && e.dates < f.minDates) return false;
  if (stagesNarrowed(f.stages)) {
    const group = e.masked ? null : stageGroup(e.stage_id);
    if (!group || !f.stages!.has(group)) return false;
  }
  return true;
}

/** `mine`: the viewer's character ids, for "yours". */
export function filterSky(
  data: { nodes: GraphNode[]; edges: GraphEdge[] },
  f: SkyFilter,
  mine?: ReadonlySet<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const group = f.origin === "all" ? null : f.origin;
  const members = group ? new Set(data.nodes.filter(groupMember(group, mine)).map((n) => n.id)) : null;
  let ns = data.nodes;
  if (members && !f.partners) ns = ns.filter((n) => members.has(n.id) || (n.private && group !== "yours"));
  // A private character has no public kind, so a kind filter leaves it out.
  if (f.kind !== "all") ns = ns.filter((n) => !n.private && (f.kind === "unsaid" ? n.kind === null : n.kind === f.kind));
  const ids = new Set(ns.map((n) => n.id));
  const touchesGroup = (e: GraphEdge) => !members || !f.partners || members.has(e.a_id) || members.has(e.b_id);
  const es = data.edges.filter((e) => ids.has(e.a_id) && ids.has(e.b_id) && touchesGroup(e) && lineKept(e, f));
  const linked = (): Set<string> => new Set(es.flatMap((e) => [e.a_id, e.b_id]));
  // A partner is on the sky for a date with the group: one whose dates with it all fell to another filter goes too.
  if (members && f.partners) {
    const on = linked();
    ns = ns.filter((n) => members.has(n.id) || on.has(n.id));
  }
  if (linesNarrowed(f)) {
    const on = linked();
    ns = ns.filter((n) => on.has(n.id) || n.degree === 0);
  }
  if (!f.showSingles) {
    const on = linked();
    ns = ns.filter((n) => on.has(n.id));
  }
  return { nodes: ns, edges: es };
}

/** How many of `edges` are in each stage group, for the chips (a private pair, whose stage isn't public, is in none). */
export function stageCounts(edges: readonly GraphEdge[]): Record<StageGroup, number> {
  const counts = Object.fromEntries(STAGE_GROUPS.map((g) => [g, 0])) as Record<StageGroup, number>;
  for (const e of edges) {
    const group = e.masked ? null : stageGroup(e.stage_id);
    if (group) counts[group]++;
  }
  return counts;
}
