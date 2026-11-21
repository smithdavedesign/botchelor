/**
 * Clusters named after their places (docs/PRDs/social-network.md section 9, Phase 3): when enough of a cluster share a
 * place, /graph's colour key and a star's panel call it after the place, "Regulars at the dive bar" or "The Leeds lot",
 * instead of "Cluster 3". Pure and browser-safe (types only from the rest of lib/social): a social view names its
 * clusters in the browser from its own payload, whose places are stars in their members' clusters; the Love view's
 * payload has no places, so lib/social/cluster-sky.ts names Love's on the server and /api/graph/clusters serves them
 * when someone colours by cluster.
 */
import { bareName, midSentence } from "./place-name";
import type { SharedRole } from "./types";

/** A place a group of characters share, and how: lib/social/read.ts SkyPlace, a view's LensPlace. `key` is the place's and role's. */
export type PlaceGroup = { key: string; role: SharedRole; name: string; members: readonly string[] };

/**
 * A cluster's name: its words, the place and role behind it (`key`), how many of the cluster share it of how many are in
 * it, and up to CLUSTER_NAME_ANCHORS of those who share it, the cluster's first in the order it was given (Love's: the
 * best connected), by which the browser checks a name made on the server still fits the sky it has (`namesThatFit`).
 */
export type ClusterName = { community: number; words: string; key: string; shared: number; size: number; anchors: string[] };

/** At least this many of a cluster share the place... */
export const CLUSTER_NAME_MEMBERS = 2;
/** ...and at least this share of it, so a name says something true of most of the cluster, not a corner of it. */
export const CLUSTER_NAME_SHARE = 0.4;
/** The members a name carries to be checked by. */
export const CLUSTER_NAME_ANCHORS = 3;

/** A cluster's name from the place its people share, by how they share it: "Regulars at the dive bar", "The Leeds lot". */
export function clusterWords(role: SharedRole, place: string): string {
  const name = midSentence(place.trim());
  const bare = bareName(place);
  switch (role) {
    case "regular":
      return `Regulars at ${name}`;
    case "works":
      return `The ${bare} crew`;
    case "studied":
      return `Classmates from ${name}`;
    case "lives":
    case "from":
      return `The ${bare} lot`;
  }
}

/**
 * Each cluster's name, where a place fits it: the place most of its members share (at least CLUSTER_NAME_MEMBERS of
 * them, and CLUSTER_NAME_SHARE of the cluster). A place names one cluster only, the one it fits best: the most members
 * sharing it, then the biggest share of the cluster, then the most of the place's own people in it. A cluster whose best
 * place went to another takes its next best, or keeps its number.
 */
export function nameClusters(byCommunity: ReadonlyMap<number, readonly string[]>, places: readonly PlaceGroup[]): Map<number, ClusterName> {
  const at = new Map<string, number>();
  for (const [community, ids] of byCommunity) for (const id of ids) at.set(id, community);
  type Candidate = { community: number; place: PlaceGroup; words: string; sharing: Set<string>; size: number; fit: number };
  const candidates: Candidate[] = [];
  for (const place of places) {
    const everyone = new Set(place.members);
    const counts = new Map<number, Set<string>>();
    for (const id of everyone) {
      const c = at.get(id);
      if (c === undefined) continue;
      const had = counts.get(c);
      if (had) had.add(id);
      else counts.set(c, new Set([id]));
    }
    for (const [community, sharing] of counts) {
      const size = byCommunity.get(community)?.length ?? 0;
      if (sharing.size < CLUSTER_NAME_MEMBERS || size === 0 || sharing.size / size < CLUSTER_NAME_SHARE) continue;
      candidates.push({ community, place, words: clusterWords(place.role, place.name), sharing, size, fit: sharing.size / everyone.size });
    }
  }
  candidates.sort(
    (x, y) =>
      y.sharing.size - x.sharing.size ||
      y.sharing.size / y.size - x.sharing.size / x.size ||
      y.fit - x.fit ||
      (x.words < y.words ? -1 : x.words > y.words ? 1 : 0) ||
      x.community - y.community,
  );
  const named = new Map<number, ClusterName>();
  const used = new Set<string>();
  for (const c of candidates) {
    if (named.has(c.community) || used.has(c.place.key)) continue;
    used.add(c.place.key);
    const anchors = (byCommunity.get(c.community) ?? []).filter((id) => c.sharing.has(id)).slice(0, CLUSTER_NAME_ANCHORS);
    named.set(c.community, { community: c.community, words: c.words, key: c.place.key, shared: c.sharing.size, size: c.size, anchors });
  }
  return named;
}

/** Members by cluster, in the stars' order: characters only (a view's place stars are the places), never a private one. */
export function membersByCommunity(nodes: readonly { id: string; community: number | null; private?: boolean; place?: unknown }[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const n of nodes) {
    if (n.community === null || n.private || n.place !== undefined) continue;
    const list = out.get(n.community);
    if (list) list.push(n.id);
    else out.set(n.community, [n.id]);
  }
  return out;
}

/**
 * The names made on the server that still fit the sky in the browser (its clusters can be renumbered by a newer build):
 * a name stays while at least one of its anchors is on the sky and every one that is sits in the cluster it names.
 */
export function namesThatFit(names: readonly ClusterName[], nodes: readonly { id: string; community: number | null }[]): Map<number, ClusterName> {
  const at = new Map(nodes.map((n) => [n.id, n.community]));
  const out = new Map<number, ClusterName>();
  for (const x of names) {
    const seen = x.anchors.filter((id) => at.has(id));
    if (seen.length && seen.every((id) => at.get(id) === x.community)) out.set(x.community, x);
  }
  return out;
}

/** What the key calls a cluster: its place's name, or its number. */
export const clusterLabel = (community: number, names?: ReadonlyMap<number, Pick<ClusterName, "words">> | null): string =>
  names?.get(community)?.words ?? `Cluster ${community + 1}`;

/**
 * A star's panel's line for its cluster: "Their cluster: Regulars at the dive bar", since the name is most of the
 * cluster's, not necessarily theirs; or "Cluster 3".
 */
export const clusterLine = (community: number, names?: ReadonlyMap<number, Pick<ClusterName, "words">> | null): string => {
  const named = names?.get(community);
  return named ? `Their cluster: ${named.words}` : `Cluster ${community + 1}`;
};
