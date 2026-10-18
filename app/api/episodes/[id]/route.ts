import { airIfDue } from "@/lib/air";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { handle, json, userIdFromRequest } from "@/lib/http";
import { HIDDEN_EPISODE_MESSAGE } from "@/lib/rules";

/** One episode as the viewer may see it. Creator names appear only after every creator consents. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  // Dates air by default once their prediction window closes (lib/air.ts): opening one that's due airs it.
  await airIfDue(db, id).catch(() => null);
  const episode = await getEpisodeView(db, id, userIdFromRequest(req));
  if (!episode) return json({ error: "episode_not_found" }, 404);
  if (episode.hidden && !episode.is_creator) {
    return json({ error: "episode_hidden", message: HIDDEN_EPISODE_MESSAGE }, 404);
  }
  return json(episode);
});
