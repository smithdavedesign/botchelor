import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { opsSummary } from "@/lib/ops-log";

export const dynamic = "force-dynamic";

/** Admin: the servers' own log (lib/ops-log.ts): what's running on each host, the last day in numbers, the latest rows. */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await opsSummary(await getDb()));
});
