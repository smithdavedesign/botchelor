import { needsSignIn } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { authFromRequest, handle, json } from "@/lib/http";

/**
 * The current session's own characters (newest first), for the account page. Empty when anonymous & new, and for an
 * account's id without its sign-in (lib/auth needsSignIn).
 */
export const GET = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth) return json({ characters: [] });
  const db = await getDb();
  if (await needsSignIn(db, auth)) return json({ characters: [] });
  return json({ characters: await listMyCharacters(db, auth.userId) });
});
