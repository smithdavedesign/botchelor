import { handle, json, userIdFromRequest } from "@/lib/http";
import { cachedPairTies } from "@/lib/social/cache";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ a: string; b: string }> };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Every tie between two characters (docs/PRDs/social-network.md section 9's pair panel; lib/social/read.ts pairTies):
 * across layers and time, with each tie's evidence (the dates and scenes that made it), their history and the places
 * they share. Cached a minute like the Constellation's pair timeline; someone who owns either gets their own. 404 for a
 * pair touching a deleted or persona character, one touching a private character the asker doesn't own (the sky
 * shows that pair's existence only, as /api/graph/[a]/[b] does), a pair with nothing between them, and with
 * SOCIAL_TIES off.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { a, b } = await ctx.params;
  if (!ID.test(a) || !ID.test(b) || a === b) return json({ error: "not_found" }, 404);
  const pair = await cachedPairTies(a, b, userIdFromRequest(req));
  return pair ? json(pair) : json({ error: "not_found" }, 404);
});
