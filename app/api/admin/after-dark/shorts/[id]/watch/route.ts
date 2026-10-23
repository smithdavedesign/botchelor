import { adultViewer } from "@/lib/adult/mode";
import { watchShort } from "@/lib/adult/shorts";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/**
 * Pressing play on a Short (lib/adult/shorts.ts): the view is recorded once, and the night comes back (its chapters, its
 * video). For an entitled viewer only; everyone else, and every bot, gets not found.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  if (detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const { id } = await params;
  const short = await watchShort(db, viewer, id);
  return short ? json({ short }) : json({ error: "not_found" }, 404);
});
