import { getDb } from "@/lib/db";
import { handle, json, userIdFromRequest } from "@/lib/http";
import { getLeague } from "@/lib/leagues";
import { tryCloseDueSeasons } from "@/lib/seasons";

/**
 * This week's board, plus the podiums of past seasons. Anyone with the invite link can look; only
 * members are on it. A season that ended since the last read is closed first (idempotent, M4).
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  await tryCloseDueSeasons(db);
  const league = await getLeague(db, id, userIdFromRequest(req));
  if (!league) return json({ error: "league_not_found" }, 404);
  return json(league);
});
