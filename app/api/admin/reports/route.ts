import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { listOpenReports, REVIEW_DECISIONS, reviewReports } from "@/lib/moderation";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** Owner-only: episodes with reports nobody has reviewed, with enough of each to judge it (lib/moderation.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ episodes: await listOpenReports(await getDb()) });
});

const Review = z.object({ episode_id: z.string().min(1).max(100), decision: z.enum(REVIEW_DECISIONS) });

/** Owner-only: clear an episode's reports (it comes back) or take it down (private to its creator). */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Review, await readJson(req), "invalid_review");
  const reviewed = await reviewReports(await getDb(), input.episode_id, input.decision);
  if (!reviewed) return json({ error: "nothing_to_review", message: "That episode has no open reports." }, 404);
  return json({ episode_id: input.episode_id, decision: input.decision, reviewed });
});
