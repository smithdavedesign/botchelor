import { agentAnalytics } from "@/lib/agent-analytics";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** Owner-only: who connects over MCP and what they do (lib/agent-analytics.ts). ?days= is the window, 1 to 60. */
export const GET = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  const days = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 7));
  return json(await agentAnalytics(await getDb(), days));
});
