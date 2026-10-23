import { adultViewer } from "@/lib/adult/mode";
import { settleCall, shortOutcome } from "@/lib/adult/predictions";
import { watchShort } from "@/lib/adult/shorts";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

/**
 * Pressing play on a Short (lib/adult/shorts.ts): the view is recorded once, which closes calls on it, and the viewer's
 * call settles there and then from the recorded night (lib/adult/predictions.ts). The night comes back (its chapters,
 * its video) with the call and what happened. For an entitled viewer only; everyone else, and every bot, gets not found.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  if (detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const { id } = await params;
  const short = await watchShort(db, viewer, id);
  if (!short) return json({ error: "not_found" }, 404);
  const call = await settleCall(db, viewer, id);
  return json({ short, call, outcome: call?.settled?.outcome ?? (await shortOutcome(db, id)) });
});
