import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { portraitBatch } from "@/lib/agent-portraits";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
// A batch of portraits (lib/agent-portraits.ts): a few Venice pictures, each through the PG check.
export const maxDuration = 300;

/** Admin only: the show's own portrait for the next few public agent-made characters who have none. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await portraitBatch(await getDb()));
});
