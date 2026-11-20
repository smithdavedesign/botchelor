/**
 * One of the Constellation's social views (lib/social/lenses.ts, served by /api/graph/lens) as the canvas takes it: the
 * view's characters as stars, its places as stars of their own with a spoke to each member, and its pairs as lines that
 * carry one line a group (`lines`). Then what the filters leave of it, as ./filter.ts does for the Love view: who made
 * them, what they are, the view's chips and one character's corner. Pure and browser-safe: lib/graph.ts and the social
 * modules are imported for their types only (tests/graph-teaser.test.ts).
 */
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { groupMember } from "@/lib/origin-group";
import type { GroupChoice, LensLine, LensPlace, LensSky } from "@/lib/social/lenses";
import { worldOf, type KindFilter, type OriginFilter } from "./filter";

/** A star: a character, or (with `place`) a place two or more of them share, drawn as a pin with its name. */
export type SkyNode = GraphNode & { place?: Pick<LensPlace, "place_id" | "words" | "kind" | "role" | "group" | "count"> };

/**
 * A line: the Love view's pairs as they always were; a social view's carry `lines` (one a group, drawn side by side),
 * and a place's spoke to one of its members is `spoke` (`a_id` the place).
 */
export type SkyEdge = GraphEdge & { lines?: LensLine[]; spoke?: true };

const NO_DATES = { dates: 0, second_dates: 0, stage: null, stage_id: null, last_at: null, first_at: null, turned_down: null, left_first: null, met_via: null } as const;

/** A view's payload as stars and lines. */
export function lensGraph(sky: LensSky): { nodes: SkyNode[]; edges: SkyEdge[] } {
  const nodes: SkyNode[] = [...sky.nodes];
  const edges: SkyEdge[] = sky.pairs.map((p) => ({ a_id: p.a, b_id: p.b, masked: Boolean(p.masked), weight: p.w, ...NO_DATES, lines: p.lines }));
  for (const pl of sky.places) {
    nodes.push({
      id: pl.id,
      name: pl.name,
      hue: null,
      origin: null,
      portrait: null,
      private: false,
      degree: pl.members.length,
      kind: null,
      kind_label: null,
      community: pl.community,
      place: { place_id: pl.place_id, words: pl.words, kind: pl.kind, role: pl.role, group: pl.group, count: pl.count },
    });
    const line: LensLine = { g: pl.group, s: pl.group === "work" ? "work" : "place", k: [], v: 1, d: 0 };
    for (const m of pl.members) edges.push({ a_id: pl.id, b_id: m, masked: false, weight: pl.w, ...NO_DATES, lines: [line], spoke: true });
  }
  return { nodes, edges };
}

export const isPlace = (n: { place?: unknown }): boolean => n.place !== undefined;

/** What narrows a view: who made them, what they are, the view's chips, and one character's corner of it. */
export type LensFilter = { origin: OriginFilter; kind: KindFilter; groups: GroupChoice; world: string | null };

/**
 * What a view's filters leave. Who made them works as the Love view's does with "who they dated" on: the group and
 * whoever they're tied to (a line or a place's spoke touching the group stays). A kind keeps only characters of that
 * kind (a private one has no public kind). The chips cut lines to their groups (a masked pair, in no group, goes when
 * any chip is off, as the Love view's private pairs do). A place stays while two or more of its members do. Their corner
 * is everyone within two steps of them along what's left. Every star left has a line, but the corner's centre, who
 * stays to say that nothing's left.
 */
export function filterLens(
  g: { nodes: SkyNode[]; edges: SkyEdge[] },
  f: LensFilter,
  mine?: ReadonlySet<string>,
): { nodes: SkyNode[]; edges: SkyEdge[] } {
  const kindOk = (n: SkyNode) => f.kind === "all" || (!n.private && (f.kind === "unsaid" ? n.kind === null : n.kind === f.kind));
  const keep = new Set(g.nodes.filter((n) => isPlace(n) || kindOk(n)).map((n) => n.id));
  const group = f.origin === "all" ? null : f.origin;
  const members = group ? new Set(g.nodes.filter((n) => !isPlace(n) && groupMember(group, mine)(n)).map((n) => n.id)) : null;
  let edges: SkyEdge[] = [];
  for (const e of g.edges) {
    if (!keep.has(e.a_id) || !keep.has(e.b_id)) continue;
    if (members && !members.has(e.a_id) && !members.has(e.b_id)) continue;
    if (f.groups) {
      const lines = (e.lines ?? []).filter((l) => f.groups!.has(l.g));
      if (!lines.length) continue;
      edges.push(lines.length === e.lines!.length ? e : { ...e, lines });
    } else edges.push(e);
  }
  // A place is shared by two or more: one left with fewer goes, its spokes with it.
  const spokes = new Map<string, number>();
  for (const e of edges) if (e.spoke) spokes.set(e.a_id, (spokes.get(e.a_id) ?? 0) + 1);
  edges = edges.filter((e) => !e.spoke || (spokes.get(e.a_id) ?? 0) >= 2);
  const near = f.world ? worldOf(edges, f.world) : null;
  if (near) edges = edges.filter((e) => near.has(e.a_id) && near.has(e.b_id));
  const linked = new Set(edges.flatMap((e) => [e.a_id, e.b_id]));
  const nodes = g.nodes.filter((n) => linked.has(n.id) || (n.id === f.world && keep.has(n.id)));
  return { nodes, edges };
}

/** How many lines of each group a view's sky holds, for its chips: a place counts once, not once a member. */
export function lensCounts(groups: readonly { id: string }[], g: { nodes: SkyNode[]; edges: SkyEdge[] }): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(groups.map((x) => [x.id, 0]));
  for (const e of g.edges) {
    if (e.spoke) continue;
    for (const l of e.lines ?? []) if (l.g in counts) counts[l.g]++;
  }
  for (const n of g.nodes) if (n.place && n.place.group in counts) counts[n.place.group]++;
  return counts;
}

/** A place's mark, on its star and in its panel. */
export const PLACE_GLYPH: Record<string, string> = {
  venue: "📍",
  workplace: "💼",
  school: "🎓",
  club: "🎵",
  hangout: "☕",
  neighbourhood: "🏘️",
  city: "🌆",
  house: "🏠",
  hometown: "🏡",
};
export const placeGlyph = (kind: string): string => PLACE_GLYPH[kind] ?? "📍";
