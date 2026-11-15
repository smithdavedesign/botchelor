import { castingLead, castingNote } from "@/lib/casting";
import { getDb } from "@/lib/db";
import { handle, json, userIdFromRequest } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Open casting (lib/casting.ts), read-only. `?episode=<id>`: the verdict card's line for the owner of a casting date
 * (whose rose is at stake and when the roses are handed out), null for any other date or viewer. Without it: who a new
 * character's first date goes to right now (the lead and the phase), null while casting is closed.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const episode = new URL(req.url).searchParams.get("episode")?.slice(0, 64);
  if (episode) return json({ note: await castingNote(db, episode, userIdFromRequest(req)).catch(() => null) });
  const casting = await castingLead(db).catch(() => null);
  return json({ casting: casting ? { phase: casting.phase, month: casting.month, lead: casting.lead, roses_at: casting.roses_at } : null });
});
