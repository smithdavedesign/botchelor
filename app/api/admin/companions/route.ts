import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { openOurAgentCast } from "@/lib/companion";

export const dynamic = "force-dynamic";

const Input = z.object({ action: z.literal("open_ours"), dry_run: z.boolean().optional() });

/**
 * Admin only: opens the show's own agent-made cast as companions (lib/companion.ts openOurAgentCast), never an outside
 * agent's. `dry_run` counts first.
 */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const n = await openOurAgentCast(db, { dryRun: input.dry_run });
  return json({ [input.dry_run ? "would_open" : "opened"]: n }, 200);
});
