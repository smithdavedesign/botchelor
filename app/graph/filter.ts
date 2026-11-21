/**
 * What the Constellation's filters leave on the sky (ConstellationApp's toolbar). Pure, so vitest covers it without a
 * browser. Edges are always cut down to pairs whose both ends survived (the canvas relies on that alignment).
 */
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { groupMember, type SkyGroup } from "@/lib/origin-group";
import type { KindId } from "@/lib/kinds";
import { showsCloseness } from "@/lib/relationship-stages";
import { seasonWindow } from "@/lib/season-window";
import { STAGE_GROUPS, stageGroup, type StageChoice, type StageGroup } from "./stages";

/** Everyone, a group by who made them, or the viewer's own ("yours"). */
export type OriginFilter = "all" | SkyGroup;
/** "all", a kind, or "unsaid" for characters that haven't said what they are. */
export type KindFilter = "all" | KindId | "unsaid";

/** When a pair last dated, for "When": any time, this season (lib/season-window.ts), or the last 30 days. */
export const WHENS = ["all", "season", "30d"] as const;
export type When = (typeof WHENS)[number];
export const WHEN_LABEL: Record<When, string> = { all: "All time", season: "This season", "30d": "Last 30 days" };

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back "Last 30 days" and "Still seeing each other" look. */
export const RECENT_DAYS = 30;

export type SkyFilter = {
  origin: OriginFilter;
  /**
   * With a group picked, whoever its characters dated comes too (lib/graph.ts groupSky): "the cast" is the cast's love
   * lives, as the Characters page's preview draws them. Off, only pairs inside the group (and, for a group by origin,
   * private characters, whose origin isn't public).
   */
  partners: boolean;
  kind: KindFilter;
  /** The orbit: characters with no public date yet, on the outer ring. */
  showSingles: boolean;
  /**
   * The kinds of pair whose lines are drawn (./stages.ts); null for every kind. A narrower choice leaves out private
   * pairs too, whose stage isn't public: it's the same for every private pair, so it says nothing about any of them.
   */
  stages: StageChoice;
  /** Only pairs whose last public date falls in this window (a private pair's dates aren't public, so it goes too). */
  when: When;
  /** Still seeing each other (stillSeeing): it replaced "2+ dates", whose pairs the First date chip now covers. */
  still: boolean;
  /**
   * "Just their corner of the sky" (worldOf): one character's id, and only they and everyone within WORLD_STEPS of them
   * stay on the sky; null for everyone.
   */
  world: string | null;
};

export const DEFAULT_FILTER: SkyFilter = { origin: "all", partners: true, kind: "all", showSingles: true, stages: null, when: "all", still: false, world: null };

/** ?when= (a shared, filtered sky): "all" for anything it doesn't know. */
export function parseWhen(v: unknown): When {
  const s = (Array.isArray(v) ? v[0] : v) as unknown;
  const w = typeof s === "string" ? s.trim().toLowerCase() : "";
  return (WHENS as readonly string[]).includes(w) ? (w as When) : "all";
}

/** The address's ?when=, or null for all time (the default needs none). */
export const whenParam = (w: When): string | null => (w === "all" ? null : w);

/** ?still=1. */
export const parseStill = (v: unknown): boolean => (Array.isArray(v) ? v[0] : v) === "1";

/** ?world=<id>: the character whose world the sky opens on, or null. Whether they're on the sky is the app's to check. */
export function parseWorld(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const id = s.trim();
  return id && id.length <= 200 ? id : null;
}

/** How far "Just their corner of the sky" reaches: them, who they dated, and who those dated. */
export const WORLD_STEPS = 2;

/**
 * Everyone within `steps` lines of `id` along `edges`, `id` included. A private pair's line counts: it's on the sky
 * already, so walking it shows nothing the sky doesn't.
 */
export function worldOf(edges: readonly { a_id: string; b_id: string }[], id: string, steps = WORLD_STEPS): Set<string> {
  const next = new Map<string, string[]>();
  const link = (x: string, y: string) => {
    const list = next.get(x);
    if (list) list.push(y);
    else next.set(x, [y]);
  };
  for (const e of edges) {
    link(e.a_id, e.b_id);
    link(e.b_id, e.a_id);
  }
  const seen = new Set([id]);
  let ring = [id];
  for (let step = 0; step < steps && ring.length > 0; step++) {
    const out: string[] = [];
    for (const x of ring) {
      for (const y of next.get(x) ?? []) {
        if (seen.has(y)) continue;
        seen.add(y);
        out.push(y);
      }
    }
    ring = out;
  }
  return seen;
}

/** The earliest last date (ms) a pair needs under `when`; null for all time. "This season" is the season `now` is in. */
export function whenSince(when: When, now: number): number | null {
  if (when === "season") return seasonWindow(new Date(now)).start.getTime();
  if (when === "30d") return now - RECENT_DAYS * DAY_MS;
  return null;
}

/**
 * Still seeing each other: more than one public date, the last one in the last 30 days, and not over. One date isn't
 * seeing someone, and a pair whose stage ends it isn't still: showsCloseness (lib/relationship-stages.ts) is false for
 * exactly those (didn't click, bad blood, exes, broke up, divorced). A private pair's dates aren't public.
 */
export function stillSeeing(e: GraphEdge, now: number): boolean {
  if (e.masked || e.dates < 2 || !e.last_at) return false;
  if (!showsCloseness(e.stage_id)) return false;
  return Date.parse(e.last_at) >= now - RECENT_DAYS * DAY_MS;
}

/** The stage choice narrows the sky: some groups are off (all of them on, or a null choice, draws every line). */
export const stagesNarrowed = (stages: StageChoice): boolean => stages !== null && stages.size < STAGE_GROUPS.length;

/**
 * A filter on the lines themselves (their stage, when they last dated, whether they're still seeing each other), as
 * opposed to one on who's on the sky. Under one, a character none of whose lines is left goes too: a sky of couples is
 * the couples, not every star with its lines cut. Characters with no public date at all stay on the orbit (that's The
 * orbit's call, not the lines').
 */
export const linesNarrowed = (f: SkyFilter): boolean => stagesNarrowed(f.stages) || f.when !== "all" || f.still;

/**
 * How many of the filters behind the phone's Filters button are set (the stage chips sit on the sky, and their corner
 * has its own line over it, so not those).
 */
export function activeFilters(f: SkyFilter): number {
  return [f.origin !== "all", f.origin !== "all" && !f.partners, f.kind !== "all", f.when !== "all", f.still, !f.showSingles].filter(Boolean).length;
}

/** Whether one pair's line passes the line filters. */
function lineKept(e: GraphEdge, f: SkyFilter, now: number): boolean {
  if (stagesNarrowed(f.stages)) {
    const group = e.masked ? null : stageGroup(e.stage_id);
    if (!group || !f.stages!.has(group)) return false;
  }
  const since = whenSince(f.when, now);
  if (since !== null && (e.masked || !e.last_at || Date.parse(e.last_at) < since)) return false;
  if (f.still && !stillSeeing(e, now)) return false;
  return true;
}

/** `mine`: the viewer's character ids, for "yours". `now`: the page's clock (the server's, so both render the same). */
export function filterSky(
  data: { nodes: GraphNode[]; edges: GraphEdge[] },
  f: SkyFilter,
  mine?: ReadonlySet<string>,
  now: number = Date.now(),
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const group = f.origin === "all" ? null : f.origin;
  const members = group ? new Set(data.nodes.filter(groupMember(group, mine)).map((n) => n.id)) : null;
  let ns = data.nodes;
  if (members && !f.partners) ns = ns.filter((n) => members.has(n.id) || (n.private && group !== "yours"));
  // A private character has no public kind, so a kind filter leaves it out.
  if (f.kind !== "all") ns = ns.filter((n) => !n.private && (f.kind === "unsaid" ? n.kind === null : n.kind === f.kind));
  const ids = new Set(ns.map((n) => n.id));
  const touchesGroup = (e: GraphEdge) => !members || !f.partners || members.has(e.a_id) || members.has(e.b_id);
  const onSky = data.edges.filter((e) => ids.has(e.a_id) && ids.has(e.b_id) && touchesGroup(e));
  // Their world is walked before the line filters, so it's the same people whichever lines are drawn: the chips count,
  // and turn on and off, the lines among them.
  const near = f.world ? worldOf(onSky, f.world) : null;
  if (near) ns = ns.filter((n) => near.has(n.id));
  const es = onSky.filter((e) => (!near || (near.has(e.a_id) && near.has(e.b_id))) && lineKept(e, f, now));
  const linked = (): Set<string> => new Set(es.flatMap((e) => [e.a_id, e.b_id]));
  // The centre of a world stays when none of their lines is left: "nobody this season" is what the sky then says.
  const centre = (n: GraphNode) => n.id === f.world;
  // A partner is on the sky for a date with the group: one whose dates with it all fell to another filter goes too.
  if (members && f.partners) {
    const on = linked();
    ns = ns.filter((n) => members.has(n.id) || on.has(n.id) || centre(n));
  }
  if (linesNarrowed(f)) {
    const on = linked();
    ns = ns.filter((n) => on.has(n.id) || n.degree === 0 || centre(n));
  }
  if (!f.showSingles) {
    const on = linked();
    ns = ns.filter((n) => on.has(n.id) || centre(n));
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
