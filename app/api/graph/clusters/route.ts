import { handle, json } from "@/lib/http";
import { cachedLoveClusterNames } from "@/lib/social/cluster-sky";

export const dynamic = "force-dynamic";

/**
 * The Love view's clusters named after their places (lib/social/cluster-sky.ts): "Regulars at the dive bar", "The Leeds
 * lot", for /graph's colour key and a star's panel. Fetched when someone colours Love by cluster, so it adds nothing to
 * /graph's first load. The same for everyone, cached a minute under the Constellation's tag. 404 with SOCIAL_TIES or
 * SOCIAL_LENSES off.
 */
export const GET = handle(async () => {
  const named = await cachedLoveClusterNames();
  if (!named) return json({ error: "not_found" }, 404);
  const res = json(named);
  res.headers.set("cache-control", "public, max-age=60");
  return res;
});
