import { agentClients, agentStats } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/**
 * Owner-only: who the agents are. The aggregate numbers (public on /agents) plus the per-client breakdown and
 * the most recent sessions — each client's self-declared name/version and a truncated user agent, nothing
 * personal. Gated by the same admin password as the frontier tool (x-frontier-key).
 */
export const GET = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  const db = await getDb();
  const [stats, detail] = await Promise.all([agentStats(db), agentClients(db)]);
  return json({ stats, ...detail });
});
