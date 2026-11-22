import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { agentClients, agentStats } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Owner-only: who the agents are. The aggregate numbers (public on /agents) plus the per-client breakdown and
 * the most recent sessions — each client's self-declared name/version and a truncated user agent, nothing
 * personal. A signed-in admin account, or the admin key (x-frontier-key) for scripts (lib/admin-auth.ts).
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  const [stats, detail] = await Promise.all([agentStats(db), agentClients(db)]);
  return json({ stats, ...detail });
});
