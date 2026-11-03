/**
 * The Constellation's payload, cached (Next's data cache: `unstable_cache`, since this app doesn't run Cache
 * Components). /graph is in the sitemap, so crawlers hit it, and every visit used to rebuild the whole graph from the
 * database. Now a build is fresh for GRAPH_TTL_SECONDS; after that the next visit still gets it at once while Next
 * rebuilds it in the background, up to GRAPH_STALE_SECONDS, past which a visit waits for a fresh build (2026-11-03: the
 * first visitor after each minute used to wait ~1.8 s for that). Anything that can take something off the public sky
 * drops it at once (`invalidateGraph`): a character's edit, visibility or deletion (over MCP too), a date's visibility, a
 * report, a moderation decision, an admin removal, a deleted account. Anything that doesn't call it (a date airing)
 * shows within GRAPH_STALE_SECONDS.
 *
 * A pair's timeline (the panel's "Show what happened") is cached the same way, per pair, under the same tag.
 */
import { revalidateTag, unstable_cache } from "next/cache";
import { getDb, type Db } from "./db";
import { clearSharedCache } from "./shared-cache";
import { constellation, pairTimeline, publicPair, type GraphData, type PairTimeline } from "./graph";

export const GRAPH_TAG = "constellation";
export const GRAPH_TTL_SECONDS = 60;
/** The oldest build a visit is served while a fresh one is made behind it. */
export const GRAPH_STALE_SECONDS = 600;

type Stamped<T> = { at: number; data: T };

const cachedSky = unstable_cache(async (): Promise<Stamped<GraphData>> => ({ at: Date.now(), data: await constellation(await getDb()) }), ["constellation", "v2"], {
  revalidate: GRAPH_TTL_SECONDS,
  tags: [GRAPH_TAG],
});
const cachedPair = unstable_cache(
  async (lo: string, hi: string): Promise<Stamped<PairTimeline | null>> => ({ at: Date.now(), data: await pairTimeline(await getDb(), lo, hi) }),
  ["constellation-pair", "v1"],
  { revalidate: GRAPH_TTL_SECONDS, tags: [GRAPH_TAG] },
);

/** Outside a Next request (vitest, scripts) there's no data cache: unstable_cache throws this invariant. */
const noCacheHere = (err: unknown): boolean => err instanceof Error && /incrementalCache missing/.test(err.message);

/** The cached value if it's no older than GRAPH_STALE_SECONDS; else (or with no cache at all) a fresh build. */
async function withinWindow<T>(read: () => Promise<Stamped<T>>, build: () => Promise<T>): Promise<T> {
  let hit: Stamped<T>;
  try {
    hit = await read();
  } catch (err) {
    if (noCacheHere(err)) return build();
    throw err;
  }
  // Past GRAPH_TTL_SECONDS Next serves the entry it has and refreshes it in the background; one that went unrefreshed
  // that long (no visits) is built now instead.
  if (Date.now() - hit.at > GRAPH_STALE_SECONDS * 1000) return build();
  return hit.data;
}

/** The public constellation, at most GRAPH_STALE_SECONDS old (GRAPH_TTL_SECONDS once anyone's visited). */
export async function cachedConstellation(db?: Db): Promise<GraphData> {
  return withinWindow(cachedSky, async () => constellation(db ?? (await getDb())));
}

/**
 * One pair's public timeline, at most GRAPH_STALE_SECONDS old. Whether both are still public is checked live first (two
 * primary keys), so a pair that went private is a 404 at once, and ids that aren't a public pair never make an entry.
 */
export async function cachedPairTimeline(a: string, b: string, db?: Db): Promise<PairTimeline | null> {
  const conn = db ?? (await getDb());
  if (!(await publicPair(conn, a, b))) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return withinWindow(
    () => cachedPair(lo, hi),
    () => pairTimeline(conn, lo, hi),
  );
}

/**
 * Drop the cached constellation now (the next visit rebuilds it), and the signed-out pages' shared copies with it
 * (lib/shared-cache.ts): whatever takes something off the public sky takes it off those too. Safe anywhere: outside a
 * request there's nothing to drop.
 */
export function invalidateGraph(): void {
  clearSharedCache();
  try {
    revalidateTag(GRAPH_TAG, { expire: 0 });
  } catch {
    /* not in a route handler or server action (tests, scripts, a render): no cache to drop */
  }
}
