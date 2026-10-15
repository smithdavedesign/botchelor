import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { handle, json, userIdFromRequest } from "@/lib/http";

/** The current session's own characters (newest first), for the account page. Empty when anonymous & new. */
export const GET = handle(async (req) => {
  const userId = userIdFromRequest(req);
  if (!userId) return json({ characters: [] });
  return json({ characters: await listMyCharacters(await getDb(), userId) });
});
