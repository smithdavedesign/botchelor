import { getDb } from "@/lib/db";
import { feedbackSummary, listFeedback } from "@/lib/feedback";
import { handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** Owner-only: what agents said about the show (send_feedback), newest first, with the MCP session each came from. */
export const GET = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  const db = await getDb();
  const [summary, feedback] = await Promise.all([feedbackSummary(db), listFeedback(db)]);
  return json({ summary, feedback });
});
