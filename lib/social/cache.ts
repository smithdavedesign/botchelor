/**
 * The social network's public reads, cached like the Constellation (lib/graph-cache.ts, Next's data cache): fresh for
 * GRAPH_TTL_SECONDS, served up to GRAPH_STALE_SECONDS while Next rebuilds behind it, and under the same tag, so
 * whatever takes something off the public sky (`invalidateGraph`: a character's visibility or deletion, a date's
 * visibility, a report, moderation) takes it off these at once.
 *
 * A world and a pair are checked live first (lib/social/read.ts worldAccess, pairAccess: one statement): an unlisted
 * character is a 404 at once, a world is cached apart by whether its centre is private (so a build from before it
 * changed is never served), and a viewer who owns the character or one tied to it gets a build of their own, never
 * cached. Everyone else shares the public one.
 */
import { unstable_cache } from "next/cache";
import { getDb, type Db } from "../db";
import { GRAPH_STALE_SECONDS, GRAPH_TAG, GRAPH_TTL_SECONDS } from "../graph-cache";
import { egoNetwork, pairAccess, pairTies, publicSky, worldAccess } from "./read";
import { socialTiesOn } from "./switch";
import type { EgoNetwork, PairTies, SkyLens, SocialSky } from "./types";

type Stamped<T> = { at: number; data: T };

const OPTIONS = { revalidate: GRAPH_TTL_SECONDS, tags: [GRAPH_TAG] };
const worldEntry = unstable_cache(
  // `_centrePrivate` is only in the key: a world cached while its centre was public is never served once it isn't.
  async (id: string, _centrePrivate: boolean): Promise<Stamped<EgoNetwork | null>> => ({ at: Date.now(), data: await egoNetwork(await getDb(), id) }),
  ["social-world", "v1"],
  OPTIONS,
);
const pairEntry = unstable_cache(
  async (lo: string, hi: string): Promise<Stamped<PairTies | null>> => ({ at: Date.now(), data: await pairTies(await getDb(), lo, hi) }),
  ["social-pair", "v1"],
  OPTIONS,
);
const skyEntry = unstable_cache(
  async (lens: SkyLens): Promise<Stamped<SocialSky | null>> => ({ at: Date.now(), data: await publicSky(await getDb(), lens) }),
  ["social-sky", "v1"],
  OPTIONS,
);

/** Outside a Next request (vitest, scripts) there's no data cache: unstable_cache throws this invariant. */
const noCacheHere = (err: unknown): boolean => err instanceof Error && /incrementalCache missing/.test(err.message);

/** The cached value if it's no older than GRAPH_STALE_SECONDS; else (or with no cache at all) a fresh build. As lib/graph-cache.ts. */
async function withinWindow<T>(read: () => Promise<Stamped<T>>, build: () => Promise<T>): Promise<T> {
  let hit: Stamped<T>;
  try {
    hit = await read();
  } catch (err) {
    if (noCacheHere(err)) return build();
    throw err;
  }
  if (Date.now() - hit.at > GRAPH_STALE_SECONDS * 1000) return build();
  return hit.data;
}

/** "X's world" for this viewer (null: no one): the shared public build, or theirs when they own an end of something in it. */
export async function cachedWorld(id: string, viewer: string | null, db?: Db): Promise<EgoNetwork | null> {
  const conn = db ?? (await getDb());
  const access = await worldAccess(conn, id, viewer);
  if (!access) return null;
  if (access.personal) return egoNetwork(conn, id, { viewer });
  return withinWindow(
    () => worldEntry(id, access.private),
    () => egoNetwork(conn, id),
  );
}

/**
 * Every tie between two characters for this viewer. A pair touching a private character is null unless the viewer owns
 * one of them (the sky shows its existence only), as /api/graph/[a]/[b] is.
 */
export async function cachedPairTies(a: string, b: string, viewer: string | null, db?: Db): Promise<PairTies | null> {
  const conn = db ?? (await getDb());
  const access = await pairAccess(conn, a, b, viewer);
  if (!access) return null;
  if (access.personal) return pairTies(conn, a, b, { viewer });
  if (access.masked) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return withinWindow(
    () => pairEntry(lo, hi),
    () => pairTies(conn, lo, hi),
  );
}

/** One lens of the public sky, at most GRAPH_STALE_SECONDS old. */
export async function cachedSocialSky(lens: SkyLens, db?: Db): Promise<SocialSky | null> {
  if (!socialTiesOn()) return null;
  return withinWindow(
    () => skyEntry(lens),
    async () => publicSky(db ?? (await getDb()), lens),
  );
}
