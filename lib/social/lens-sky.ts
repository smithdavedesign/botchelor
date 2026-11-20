/**
 * The Constellation's social views, built for its canvas (docs/PRDs/social-network.md section 9, Phase 3): one view of
 * the public social sky (lib/social/read.ts publicSky: its strongest public ties, the places its public cast share, the
 * pairs masked to existence on Everything) shaped as /graph draws it. Its characters come as the Constellation's nodes
 * (who made them, what they are, their size and cluster in this view), its ties fold into one line a pair and group
 * (lib/social/lenses.ts foldTies), its places become stars with a spoke to each member (a group, never pairs), and its
 * numbers line is counted over the whole view.
 *
 * Privacy is publicSky's: public ties between listed characters only, never a person's ties, the owner layers, the
 * private relationship layer, opinions, what anyone heard or wants. A private character keeps its name and id (as
 * lib/graph.ts maskNode), its pairs their existence, on Everything only. A private character is never named in a
 * numbers line.
 *
 * Capped for the canvas, whose layout is O(n²) a frame: the strongest LENS_TIES ties, LENS_PLACES places of at most
 * LENS_PLACE_MEMBERS members each, and LENS_NODES characters in all. Cached for a minute under the Constellation's tag,
 * like the Constellation, so whatever takes something off the public sky (invalidateGraph) takes it off these at once.
 */
import { unstable_cache } from "next/cache";
import { getDb, type Db } from "../db";
import { communities, MASKED_WEIGHT, type GraphNode } from "../graph";
import { GRAPH_TAG, GRAPH_TTL_SECONDS } from "../graph-cache";
import { KIND_IDS, kindLabel, type KindId } from "../kinds";
import { originSql, type Origin } from "../origin";
import { withinWindow, type Stamped } from "./cache";
import { foldTies, lensNumbers, type LensPair, type LensPlace, type LensSky } from "./lenses";
import { publicSky, SHARED } from "./read";
import { socialTiesOn } from "./switch";
import type { SkyLens } from "./types";

type Env = Record<string, string | undefined>;

/** The Constellation's social views, "X's world" and the pair panel's every tie (PRD section 11). Off whenever SOCIAL_TIES is. */
export const socialLensesOn = (env: Env = process.env): boolean => socialTiesOn(env) && env.SOCIAL_LENSES?.trim() !== "0";

/** The most ties a view draws: its strongest. */
export const LENS_TIES = 400;
/** The most places a view draws as stars, biggest first, and the members each shows (`count` has them all). */
export const LENS_PLACES = 30;
export const LENS_PLACE_MEMBERS = 24;
/** The most characters a view's sky holds: a place whose new members would take it past this is left off. */
export const LENS_NODES = 500;

type NodeRow = { id: string; origin: Origin; kind: string | null; kind_label: string | null };

const kindOf = (k: string | null): KindId | null => ((KIND_IDS as readonly string[]).includes(k ?? "") ? (k as KindId) : null);

/** A place's star's id on the sky: one place can be shared in more than one role (its coworkers, its regulars). */
export const placeNodeId = (placeId: string, role: string): string => `place:${placeId}:${role}`;

/** One view of the public social sky, shaped for the canvas; null when SOCIAL_TIES or SOCIAL_LENSES is off. */
export async function lensSky(db: Db, lens: SkyLens, o: { env?: Env } = {}): Promise<LensSky | null> {
  const env = o.env ?? process.env;
  if (!socialLensesOn(env)) return null;
  const sky = await publicSky(db, lens, { limit: LENS_TIES, env });
  if (!sky) return null;

  const pairs: LensPair[] = foldTies(lens, sky.ties);
  for (const m of sky.masked) pairs.push({ a: m.a, b: m.b, w: MASKED_WEIGHT, lines: [], masked: true });

  // The places, biggest first, while the sky has room for their members.
  const onSky = new Set(pairs.flatMap((p) => [p.a, p.b]));
  const places: LensPlace[] = [];
  for (const p of sky.places) {
    if (places.length >= LENS_PLACES) break;
    const members = p.members.slice(0, LENS_PLACE_MEMBERS);
    if (members.length < 2) continue;
    const added = members.filter((m) => !onSky.has(m)).length;
    if (onSky.size + added > LENS_NODES) continue;
    for (const m of members) onSky.add(m);
    const shared = SHARED[p.role];
    places.push({
      id: placeNodeId(p.id, p.role),
      place_id: p.id,
      name: p.name,
      words: p.words,
      kind: p.kind,
      role: p.role,
      group: shared.layer,
      w: shared.closeness,
      count: p.count,
      members,
      community: null,
    });
  }

  // Who made them and what they are, for the public ones (the filters and the kind colours), in one read.
  const nodeRows = sky.nodes.filter((n) => onSky.has(n.id));
  const publicIds = nodeRows.filter((n) => !n.private).map((n) => n.id);
  const facts = publicIds.length
    ? new Map(
        (
          await db.query<NodeRow>(
            `select c.id, ${originSql("c")} as origin, c.extras->>'kind' as kind, c.extras->>'kind_label' as kind_label
               from characters c where c.id = any($1::text[]) and c.visibility = 'public'`,
            [publicIds],
          )
        ).rows.map((r) => [r.id, r]),
      )
    : new Map<string, NodeRow>();

  // Each one's size in this view: their lines (a masked pair's too: it's on the sky anyway) and their places.
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const p of pairs) {
    bump(p.a);
    bump(p.b);
  }
  for (const pl of places) for (const m of pl.members) bump(m);

  // Clusters over the lines that aren't all bad feeling (a feud doesn't make two people a circle) and the places' spokes,
  // with a masked pair at its faint weight, as the Love view counts it.
  const clusterEdges: { a_id: string; b_id: string; weight: number }[] = [];
  for (const p of pairs) if (p.masked || p.lines.some((l) => l.v >= 0)) clusterEdges.push({ a_id: p.a, b_id: p.b, weight: p.w });
  for (const pl of places) for (const m of pl.members) clusterEdges.push({ a_id: pl.id, b_id: m, weight: pl.w });
  const clusters = communities(clusterEdges);
  for (const pl of places) pl.community = clusters.get(pl.id) ?? null;

  const nodes: GraphNode[] = nodeRows.map((n) => {
    if (n.private) {
      return { id: n.id, name: n.name, hue: null, origin: null, portrait: null, private: true, degree: degree.get(n.id) ?? 0, kind: null, kind_label: null, community: null };
    }
    const f = facts.get(n.id);
    const kind = kindOf(f?.kind ?? null);
    return {
      id: n.id,
      name: n.name,
      hue: n.hue,
      origin: f?.origin ?? null,
      portrait: n.portrait,
      private: false,
      degree: degree.get(n.id) ?? 0,
      kind,
      kind_label: kind ? kindLabel({ kind, kind_label: f?.kind_label ?? null }) : null,
      community: clusters.get(n.id) ?? null,
    };
  });

  const names = new Map(nodes.filter((n) => !n.private).map((n) => [n.id, n.name]));
  const numbers = lensNumbers(lens, { byKind: sky.stats.byKind, ties: sky.ties, names, places: places.length, characters: nodes.length });
  return { lens, nodes, pairs, places, numbers, ties: sky.stats.ties, shown: sky.stats.shown };
}

// v1: the first shape (2026-11-20). A new shape takes a new version, so an entry built before it is never served.
const lensEntry = unstable_cache(async (lens: SkyLens): Promise<Stamped<LensSky | null>> => ({ at: Date.now(), data: await lensSky(await getDb(), lens) }), ["social-lens", "v1"], {
  revalidate: GRAPH_TTL_SECONDS,
  tags: [GRAPH_TAG],
});

/** One view, at most GRAPH_STALE_SECONDS old (GRAPH_TTL_SECONDS once anyone's looked); null when it's switched off. */
export async function cachedLensSky(lens: SkyLens, db?: Db): Promise<LensSky | null> {
  if (!socialLensesOn()) return null;
  return withinWindow(
    () => lensEntry(lens),
    async () => lensSky(db ?? (await getDb()), lens),
  );
}
