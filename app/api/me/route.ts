import { getDb } from "@/lib/db";
import { getPoints } from "@/lib/game";
import { handle, json, userIdFromRequest } from "@/lib/http";

/** Read-only points total. Points have no write route: they are derived from revealed predictions. */
export const GET = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ points: 0 });
  return json({ points: await getPoints(await getDb(), userId) });
});
