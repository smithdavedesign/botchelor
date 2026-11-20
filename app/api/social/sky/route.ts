import { handle, json } from "@/lib/http";
import { cachedSocialSky } from "@/lib/social/cache";
import { isSkyLens, SKY_LENSES } from "@/lib/social/types";

export const dynamic = "force-dynamic";

/**
 * One lens of the public sky, beside the Constellation's Love (docs/PRDs/social-network.md section 9; lib/social/read.ts
 * publicSky): `?lens=friends` (kin, friendship, work, places), `rivals` (conflict), `gossip` (aired house-scene lines)
 * or `all` (the default). Its strongest public ties, the places its cast share, and counts for its numbers line; the
 * same for everyone, cached a minute like /api/graph/sky. 400 for an unknown lens, 404 with SOCIAL_TIES off.
 */
export const GET = handle(async (req: Request) => {
  const lens = new URL(req.url).searchParams.get("lens") ?? "all";
  if (!isSkyLens(lens)) return json({ error: "unknown_lens", lenses: SKY_LENSES }, 400);
  const sky = await cachedSocialSky(lens);
  if (!sky) return json({ error: "not_found" }, 404);
  const res = json(sky);
  res.headers.set("cache-control", "public, max-age=60");
  return res;
});
