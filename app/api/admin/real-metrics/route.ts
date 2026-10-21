import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { realUse } from "@/lib/real-metrics";

export const dynamic = "force-dynamic";

/** Owner-only: real people's and real agents' use, last 7 and 30 days, our own traffic left out (lib/real-metrics.ts). */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await realUse(await getDb()));
});
