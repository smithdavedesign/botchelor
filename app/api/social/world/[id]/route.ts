import { handle, json, userIdFromRequest } from "@/lib/http";
import { cachedWorld } from "@/lib/social/cache";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * "X's world" (docs/PRDs/social-network.md section 9; lib/social/read.ts egoNetwork): a character's ties to characters
 * and to its people, the pairs masked to existence, its places and who shares them, and its rings. The public build is
 * cached a minute like the Constellation (lib/social/cache.ts); someone who owns the character, or a character tied to
 * it, gets their own (owner-only ties, proposals waiting), never cached. 404 for an unknown, deleted or persona
 * character, and with SOCIAL_TIES off.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!ID.test(id)) return json({ error: "not_found" }, 404);
  const world = await cachedWorld(id, userIdFromRequest(req));
  return world ? json(world) : json({ error: "not_found" }, 404);
});
