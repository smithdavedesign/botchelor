import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { agentAnalytics, MCP_WINDOW_MAX_DAYS } from "@/lib/agent-analytics";
import { addDays, isDay, isoDay } from "@/lib/chart";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Owner-only: who connects over MCP and what they do (lib/agent-analytics.ts). ?days= is the window, 1 to 365. ?to= (a
 * UTC day, today at the latest) makes it the page's date range: the `days` UTC days ending that day, midnight to
 * midnight, so the Agents tab counts the same days as the overview. ?include_ours=1 counts our own checks too. The
 * admin password (x-frontier-key) or a signed-in admin account.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const params = new URL(req.url).searchParams;
  const days = Math.min(MCP_WINDOW_MAX_DAYS, Math.max(1, Number(params.get("days")) || 7));
  const to = params.get("to");
  const rangeEnd = isDay(to) && to <= isoDay(new Date()) ? Date.parse(`${addDays(to, 1)}T00:00:00.000Z`) : null;
  // A millisecond before the range's end, so its last day is the last one listed and the window starts at a midnight.
  const now = rangeEnd === null ? new Date() : new Date(rangeEnd - 1);
  const until = rangeEnd === null ? null : new Date(rangeEnd);
  return json(await agentAnalytics(await getDb(), days, now, { until, includeOurs: params.get("include_ours") === "1" }));
});
