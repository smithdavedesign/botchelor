import { handle, json } from "@/lib/http";
import { cachedTenseSky } from "@/lib/social/tense";

export const dynamic = "force-dynamic";

/**
 * The public network's tense triangles (lib/social/tense.ts): two at odds who are both close to a third, or three all
 * at odds, the ones that moved last first, as /graph's section lists them. Fetched when that section nears the screen,
 * so it adds nothing to /graph's first load. The same for everyone, cached a minute under the Constellation's tag. 404
 * with SOCIAL_TIES or SOCIAL_LENSES off.
 */
export const GET = handle(async () => {
  const sky = await cachedTenseSky();
  if (!sky) return json({ error: "not_found" }, 404);
  const res = json(sky);
  res.headers.set("cache-control", "public, max-age=60");
  return res;
});
