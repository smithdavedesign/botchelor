/**
 * The Constellation's payload, cached (Next's data cache: `unstable_cache`, since this app doesn't run Cache
 * Components). /graph is in the sitemap, so crawlers hit it, and every visit used to rebuild the whole graph from the
 * database. Now a build serves everyone for GRAPH_TTL_SECONDS, and anything that can take something off the public sky
 * drops it at once (`invalidateGraph`): a character's edit, visibility or deletion, a date's visibility, a report, a
 * moderation decision, an admin removal, a deleted account. Anything that doesn't call it (a date airing, an agent's
 * deletion over MCP) shows within the window: an entry older than that is never served, even once.
 */
import { revalidateTag, unstable_cache } from "next/cache";
import { getDb, type Db } from "./db";
import { constellation, type GraphData } from "./graph";

export const GRAPH_TAG = "constellation";
export const GRAPH_TTL_SECONDS = 60;

type Stamped = { at: number; data: GraphData };

const cached = unstable_cache(async (): Promise<Stamped> => ({ at: Date.now(), data: await constellation(await getDb()) }), ["constellation", "v2"], {
  revalidate: GRAPH_TTL_SECONDS,
  tags: [GRAPH_TAG],
});

/** Outside a Next request (vitest, scripts) there's no data cache: unstable_cache throws this invariant. */
const noCacheHere = (err: unknown): boolean => err instanceof Error && /incrementalCache missing/.test(err.message);

/** The public constellation, at most GRAPH_TTL_SECONDS old. */
export async function cachedConstellation(db?: Db): Promise<GraphData> {
  let hit: Stamped;
  try {
    hit = await cached();
  } catch (err) {
    if (noCacheHere(err)) return constellation(db ?? (await getDb()));
    throw err;
  }
  // Next serves an expired entry once while it refreshes in the background; past the window, build it now instead.
  if (Date.now() - hit.at > GRAPH_TTL_SECONDS * 1000) return constellation(db ?? (await getDb()));
  return hit.data;
}

/** Drop the cached constellation now (the next visit rebuilds it). Safe anywhere: outside a request there's nothing to drop. */
export function invalidateGraph(): void {
  try {
    revalidateTag(GRAPH_TAG, { expire: 0 });
  } catch {
    /* not in a route handler or server action (tests, scripts, a render): no cache to drop */
  }
}
