import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { relationshipMetrics } from "@/lib/relationship-metrics";

export const dynamic = "force-dynamic";

/**
 * Owner-only: is the long game working (lib/relationship-metrics.ts)? Second-date conversion, how deep couples go,
 * what happens between dates, and whether owners come back. Counts only, no content, no ids. A signed-in admin account,
 * or the admin key (x-frontier-key) for scripts (lib/admin-auth.ts).
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await relationshipMetrics(await getDb()));
});
