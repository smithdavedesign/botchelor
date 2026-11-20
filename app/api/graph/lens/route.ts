import { handle, json } from "@/lib/http";
import { cachedLensSky } from "@/lib/social/lens-sky";
import { isSkyLens, SKY_LENSES } from "@/lib/social/types";

export const dynamic = "force-dynamic";

/**
 * One of the Constellation's social views, shaped for /graph's canvas (lib/social/lens-sky.ts): `?lens=friends`,
 * `rivals`, `gossip` or `all`. The page fetches a view when it's first picked, so none of them adds to /graph's first
 * load. The same for everyone, cached a minute like /api/graph/sky; /api/social/sky has the same ties unshaped. 400 for
 * an unknown view, 404 with SOCIAL_TIES or SOCIAL_LENSES off.
 */
export const GET = handle(async (req: Request) => {
  const lens = new URL(req.url).searchParams.get("lens") ?? "";
  if (!isSkyLens(lens)) return json({ error: "unknown_lens", lenses: SKY_LENSES }, 400);
  const sky = await cachedLensSky(lens);
  if (!sky) return json({ error: "not_found" }, 404);
  const res = json(sky);
  res.headers.set("cache-control", "public, max-age=60");
  return res;
});
