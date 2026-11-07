import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { agentCastStatus, checkPortraits, checkSheets, closeAgentCastMember } from "@/lib/adult/agent-cast";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
// A sheet check is one model call: 157 of them in a row stay well inside this.
export const maxDuration = 300;

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check_sheets"), dry_run: z.boolean().optional(), recheck_failed: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() }),
  z.object({ action: z.literal("check_portraits"), max: z.number().int().min(1).max(60).optional() }),
  z.object({ action: z.literal("close"), character_id: z.string().min(1) }),
]);

/**
 * Admin only: After Dark's agent cast (lib/adult/agent-cast.ts). GET is where it stands; POST checks the sheets (dry_run
 * counts first), asks Hive about some portraits now (After Dark's daily job asks 30 a day on its own), or takes one out.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await agentCastStatus(await getDb()), 200);
});

export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.action === "check_sheets") return json(await checkSheets(db, { dryRun: input.dry_run, limit: input.limit, recheckFailed: input.recheck_failed }), 200);
  if (input.action === "check_portraits") return json(await checkPortraits(db, { max: input.max }), 200);
  return (await closeAgentCastMember(db, input.character_id)) ? json({ closed: true }, 200) : json({ error: "not_found" }, 404);
});
