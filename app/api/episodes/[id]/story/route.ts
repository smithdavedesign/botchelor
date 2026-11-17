import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { episodeStory } from "@/lib/stories";

/**
 * A finished date told as a story (lib/stories.ts): GET reads the kept one, POST makes it when there's none yet (it
 * costs STORY_TOKENS bought tokens, given back if it doesn't come). Admins only while it's tested; anyone else gets 404.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const r = await episodeStory(await getDb(), id, sess.userId, { make: false });
  return r.ok ? json({ story: r.story }, 200, sess) : json({ error: r.error, message: r.message }, r.status, sess);
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const r = await episodeStory(await getDb(), id, sess.userId, { make: true });
  return r.ok ? json({ story: r.story, made: r.made }, 200, sess) : json({ error: r.error, message: r.message }, r.status, sess);
});
