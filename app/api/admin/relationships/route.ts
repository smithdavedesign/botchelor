import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { relationshipMetrics } from "@/lib/relationship-metrics";

export const dynamic = "force-dynamic";

/**
 * Owner-only: is the long game working (lib/relationship-metrics.ts)? Second-date conversion, how deep couples go,
 * what happens between dates, and whether owners come back. Counts only, no content, no ids. Same admin password as
 * the other admin tools (x-frontier-key).
 */
export const GET = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  return json(await relationshipMetrics(await getDb()));
});
