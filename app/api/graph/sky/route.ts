import { cachedConstellation } from "@/lib/graph-cache";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The whole Constellation, for /graph's "Show the whole sky" (2026-11-07 audit, item 17: the page now opens on the
 * strongest pairs, lib/graph.ts firstSky). The same cached build the page renders from, public layer only: masked pairs
 * stay masked and private characters stay as the page itself would have sent them.
 */
export const GET = handle(async () => {
  const res = json(await cachedConstellation());
  res.headers.set("cache-control", "public, max-age=60");
  return res;
});
