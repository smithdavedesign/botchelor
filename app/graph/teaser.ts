/**
 * The Constellation in miniature, for the Characters page (2026-11-17, David: the plain "See it as a constellation →"
 * link under "The relationship graph" wanted the graph itself, matching the tab above it). One group's corner of the sky
 * (lib/graph.ts groupSky): its strongest pairs, laid out by the same force simulation /graph runs (./sim.ts), settled
 * here on the server, then fitted into a small box. Pure: no DOM, so the page renders it as plain SVG and HTML, with no
 * script, and vitest covers it.
 */
import { groupSky, strongestFirst, triangles, type GraphData } from "@/lib/graph";
import { inOriginGroup, type OriginGroup } from "@/lib/origin-group";
import { createSim, settle } from "./sim";

/** The preview's box, in viewBox units: 16:10, like the card's sky. */
export const TEASER_W = 640;
export const TEASER_H = 400;
/** The strongest pairs drawn: enough to tangle, few enough to read at a glance. */
export const TEASER_PAIRS = 40;
/** At most this many more: one each for the group's own whose pairs weren't among the strongest. */
export const TEASER_EXTRA_PAIRS = 12;
/** The group's own characters still waiting for a first date, on the orbit ring. */
export const TEASER_SINGLES = 10;
/** The world the simulation runs in (about /graph's canvas, whose forces are tuned in these units). */
const SIM_W = 900;
const SIM_H = 560;
const PAD = 16;
/** A small sky isn't blown up past this, so a few stars stay stars. */
const MAX_SCALE = 1.25;

export type TeaserStar = {
  id: string;
  name: string;
  hue: number | null;
  portrait: string | null;
  x: number;
  y: number;
  r: number;
  /** One of the group's own (a face on the preview); otherwise someone they dated (a star). */
  member: boolean;
  private: boolean;
};
export type TeaserLine = { x1: number; y1: number; x2: number; y2: number; weight: number; masked: boolean };
export type GraphTeaser = {
  stars: TeaserStar[];
  lines: TeaserLine[];
  /** The whole group's numbers, not only what's drawn. */
  members: number;
  pairs: number;
  dates: number;
  triangles: number;
};

const round = (v: number) => Math.round(v * 10) / 10;

/** One group's preview, or null when nobody in it has a public date yet (the page keeps a plain link then). */
export function graphTeaser(
  data: GraphData,
  group: OriginGroup,
  { pairs = TEASER_PAIRS, extra = TEASER_EXTRA_PAIRS, singles = TEASER_SINGLES } = {},
): GraphTeaser | null {
  const sky = groupSky(data, group);
  const open = sky.edges.filter((e) => !e.masked);
  if (open.length === 0) return null;
  const member = (origin: GraphData["nodes"][number]["origin"]) => inOriginGroup(origin, group);
  const members = new Set(sky.nodes.filter((n) => member(n.origin)).map((n) => n.id));
  // The strongest pairs, then, for a group small enough to draw whole (the cast), the best pair of each of its own still
  // left out (up to `extra`), so the orbit ring holds only those with no date at all, never someone whose dates just
  // weren't the strongest. Then every other line between the characters drawn, as on /graph's first sky.
  const ranked = [...open].sort(strongestFirst);
  const linked = new Set(ranked.slice(0, pairs).flatMap((e) => [e.a_id, e.b_id]));
  let added = members.size <= pairs ? 0 : extra;
  for (const e of ranked.slice(pairs)) {
    if (added >= extra) break;
    if ((members.has(e.a_id) && !linked.has(e.a_id)) || (members.has(e.b_id) && !linked.has(e.b_id))) {
      linked.add(e.a_id).add(e.b_id);
      added++;
    }
  }
  const edges = sky.edges.filter((e) => linked.has(e.a_id) && linked.has(e.b_id));
  const degree = new Map<string, number>();
  for (const e of sky.edges) for (const id of [e.a_id, e.b_id]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nodes = [
    ...sky.nodes.filter((n) => linked.has(n.id)),
    ...sky.nodes.filter((n) => members.has(n.id) && !degree.has(n.id)).slice(0, singles),
  ];
  const drawnDegree = new Map<string, number>();
  for (const e of edges) for (const id of [e.a_id, e.b_id]) drawnDegree.set(id, (drawnDegree.get(id) ?? 0) + 1);
  const sim = createSim(
    nodes.map((n) => ({ id: n.id, degree: drawnDegree.get(n.id) ?? 0 })),
    edges.map((e) => ({ a_id: e.a_id, b_id: e.b_id, weight: e.weight })),
    SIM_W,
    SIM_H,
  );
  settle(sim, 400);

  // Fit what settled into the box: the whole of it, centred.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const n of sim.nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  const scale = Math.min((TEASER_W - 2 * PAD) / Math.max(1, maxX - minX), (TEASER_H - 2 * PAD) / Math.max(1, maxY - minY), MAX_SCALE);
  const ox = TEASER_W / 2 - ((minX + maxX) / 2) * scale;
  const oy = TEASER_H / 2 - ((minY + maxY) / 2) * scale;
  const at = new Map(sim.nodes.map((s) => [s.id, { x: round(ox + s.x * scale), y: round(oy + s.y * scale), r: round(s.r * scale) }]));

  const stars: TeaserStar[] = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    hue: n.hue,
    portrait: n.portrait,
    ...at.get(n.id)!,
    member: member(n.origin),
    private: n.private,
  }));
  const lines: TeaserLine[] = edges.map((e) => {
    const a = at.get(e.a_id)!;
    const b = at.get(e.b_id)!;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, weight: round(e.weight * 100) / 100, masked: e.masked };
  });
  return {
    stars,
    lines,
    members: members.size,
    pairs: open.length,
    dates: open.reduce((sum, e) => sum + e.dates, 0),
    triangles: triangles(open),
  };
}
