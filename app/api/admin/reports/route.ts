import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { listSceneReports, reviewSceneLine } from "@/lib/house-scenes";
import { listOpenReports, REVIEW_DECISIONS, reviewReports } from "@/lib/moderation";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/**
 * Owner-only: episodes with reports nobody has reviewed, with enough of each to judge it (lib/moderation.ts), and the
 * reported lines of house scenes (lib/house-scenes.ts).
 */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  return json({ episodes: await listOpenReports(db), scene_lines: await listSceneReports(db).catch(() => []) });
});

const Review = z.union([
  z.object({ episode_id: z.string().min(1).max(100), decision: z.enum(REVIEW_DECISIONS) }),
  z.object({ scene_id: z.string().min(1).max(100), line: z.number().int().min(1).max(40), decision: z.enum(REVIEW_DECISIONS) }),
]);

/**
 * Owner-only: clear an episode's reports (it comes back) or take it down (private to its creator). The same two
 * decisions for a reported line of a house scene: put it back (what it told is told again) or take it down for good.
 */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Review, await readJson(req), "invalid_review");
  if ("scene_id" in input) {
    const n = await reviewSceneLine(await getDb(), input.scene_id, input.line, input.decision);
    if (!n) return json({ error: "nothing_to_review", message: "That line has no open reports." }, 404);
    return json({ scene_id: input.scene_id, line: input.line, decision: input.decision, reviewed: n });
  }
  const reviewed = await reviewReports(await getDb(), input.episode_id, input.decision);
  if (!reviewed) return json({ error: "nothing_to_review", message: "That episode has no open reports." }, 404);
  return json({ episode_id: input.episode_id, decision: input.decision, reviewed });
});
