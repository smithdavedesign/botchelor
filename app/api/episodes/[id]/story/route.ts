import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { episodeStory } from "@/lib/stories";

/**
 * A finished date told as a story (lib/stories.ts): GET reads the kept one (anyone who can see the date's lines), POST
 * makes it when there's none yet: for one of the date's own people, the Companion Plan's members and admins; included
 * with the plan, else STORY_TOKENS bought dates, given back if it doesn't come.
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
