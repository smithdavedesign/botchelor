import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { handle, json, session } from "@/lib/http";
import { episodeCreatorIds } from "@/lib/people";

/**
 * M11 — the afterglow (the private morning-after thread) for one of the episode's owners. Owners read it, and
 * whether the interest was mutual, as soon as it exists; nobody has to agree first (David, 2026-10-16). This used
 * to record one owner's consent toward a mutual unlock; it's kept (and the open_afterglow MCP tool with it) so
 * existing clients still work, and now just answers with the thread. Spectators never get it.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();

  const creators = await episodeCreatorIds(db, id);
  if (!creators) return json({ error: "episode_not_found" }, 404, sess);
  if (!creators.includes(sess.userId)) {
    return json({ error: "not_creator", message: "Only the episode's creators can read the afterglow." }, 403, sess);
  }

  const view = await getEpisodeView(db, id, sess.userId);
  return json(
    { episode_id: id, afterglow_revealed: true, thread: view?.afterglow?.thread ?? [], ...(view?.afterglow?.verdict ? { verdict: view.afterglow.verdict } : {}) },
    200,
    sess,
  );
});
