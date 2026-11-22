import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { dailyStatus } from "@/lib/daily-parts";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { opsSummary } from "@/lib/ops-log";

export const dynamic = "force-dynamic";

/**
 * Admin: the servers' own log (lib/ops-log.ts): what's running on each host, the last day in numbers, the latest rows,
 * and how the latest day's daily job went, part by part (lib/daily-parts.ts).
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  const [summary, daily] = await Promise.all([opsSummary(db), dailyStatus(db)]);
  return json({ ...summary, daily });
});
