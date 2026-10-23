import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { trainingReadiness } from "@/lib/training-readiness";

export const dynamic = "force-dynamic";

/**
 * Owner-only: whether the roadmap's learning items can start (lib/training-readiness.ts): fine-tuning on our own data
 * (#577) and learning from outcomes (#578), each gate as "x of y". Counts only, no money.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await trainingReadiness(await getDb()));
});
