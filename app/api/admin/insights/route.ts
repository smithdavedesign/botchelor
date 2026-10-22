import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { cachedInsights, parseInsightsQuery } from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * Owner-only: the insights overview on /admin/analytics (lib/insights.ts), for ?from=&to= (UTC days, both included;
 * the last 30 days by default, a year at most), ?segment=all|people|agents|house and ?include_ours=1. Reused for a
 * minute per query; ?fresh=1 recomputes it.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const params = new URL(req.url).searchParams;
  return json(await cachedInsights(await getDb(), parseInsightsQuery(params), { fresh: params.get("fresh") === "1" }));
});
