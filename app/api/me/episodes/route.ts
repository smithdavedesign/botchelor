import { getDb } from "@/lib/db";
import { listMyEpisodeCards } from "@/lib/game";
import { handle, json, userIdFromRequest } from "@/lib/http";

/** The current session's own dates (every visibility — this is the owner's private view), for /account. */
export const GET = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ episodes: [] });
  return json({ episodes: await listMyEpisodeCards(await getDb(), userId) });
});
