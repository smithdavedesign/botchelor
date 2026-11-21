/**
 * The Love view's clusters named after their places (lib/social/cluster-names.ts), for /graph's colour key and a star's
 * panel under "Colour by: Cluster". Love's clusters are the Constellation's (lib/graph.ts, over who dated whom) and its
 * payload has no places, so the names are made here, from the cached Constellation and the places the public cast share
 * (lib/social/read.ts publicPlaces), and /api/graph/clusters serves them only when someone colours Love by cluster:
 * nothing is added to /graph's first load. A social view names its own in the browser, from its payload's places.
 */
import { unstable_cache } from "next/cache";
import { getDb, type Db } from "../db";
import type { GraphData } from "../graph";
import { cachedConstellation, GRAPH_TAG, GRAPH_TTL_SECONDS } from "../graph-cache";
import { withinWindow, type Stamped } from "./cache";
import { membersByCommunity, nameClusters, type ClusterName } from "./cluster-names";
import { socialLensesOn } from "./lens-sky";
import { publicPlaces } from "./read";
import type { SkyPlace } from "./types";

/** Love's named clusters, by their numbers on the Constellation that named them. */
export type LoveClusterNames = { names: ClusterName[] };

/**
 * Love's clusters named from the Constellation and the shared places. Each cluster's members go in best connected
 * first, so a name's anchors are the stars likeliest to be on a first sky (lib/graph.ts firstSky), where the browser
 * checks them (namesThatFit).
 */
export function loveNamesFrom(data: Pick<GraphData, "nodes">, places: readonly SkyPlace[]): ClusterName[] {
  const nodes = [...data.nodes].sort((x, y) => y.degree - x.degree || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const named = nameClusters(
    membersByCommunity(nodes),
    places.map((p) => ({ key: `${p.id}:${p.role}`, role: p.role, name: p.name, members: p.members })),
  );
  return [...named.values()].sort((x, y) => x.community - y.community);
}

/** Love's named clusters now; null when SOCIAL_TIES or SOCIAL_LENSES is off. */
export async function loveClusterNames(db: Db, o: { data?: GraphData } = {}): Promise<LoveClusterNames | null> {
  if (!socialLensesOn()) return null;
  const [data, places] = await Promise.all([o.data ?? cachedConstellation(db), publicPlaces(db)]);
  return { names: loveNamesFrom(data, places) };
}

const cachedBuild = unstable_cache(
  async (): Promise<Stamped<LoveClusterNames | null>> => ({ at: Date.now(), data: await loveClusterNames(await getDb()) }),
  ["social-cluster-names", "v1"],
  { tags: [GRAPH_TAG], revalidate: GRAPH_TTL_SECONDS },
);

/** Love's named clusters as /graph's key shows them, at most a few minutes old. */
export async function cachedLoveClusterNames(db?: Db): Promise<LoveClusterNames | null> {
  if (!socialLensesOn()) return null;
  return withinWindow(cachedBuild, async () => loveClusterNames(db ?? (await getDb())));
}
