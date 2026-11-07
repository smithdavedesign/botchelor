import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { COMPANION_REVIEW_DECISIONS, listCompanionReports, reviewCompanionReport } from "@/lib/companion-reports";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** Owner-only: companion replies people reported, each with the messages before it (lib/companion-reports.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ reports: await listCompanionReports(await getDb()) });
});

const Review = z.object({ message_id: z.string().min(1).max(64), decision: z.enum(COMPANION_REVIEW_DECISIONS) });

/** Owner-only: fine (nothing wrong) or fix (a real miss, for the prompt or the checks). */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Review, await readJson(req), "invalid_review");
  if (!(await reviewCompanionReport(await getDb(), input.message_id, input.decision))) {
    return json({ error: "nothing_to_review", message: "That reply has no open report." }, 404);
  }
  return json({ message_id: input.message_id, decision: input.decision });
});
