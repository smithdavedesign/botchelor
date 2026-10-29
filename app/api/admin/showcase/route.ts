import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { decidePost, moderationQueue } from "@/lib/showcase-moderation";

export const dynamic = "force-dynamic";

/** Admin only: showcase posts held by a report, then reported ones still up (lib/showcase-moderation.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ posts: await moderationQueue(await getDb()) });
});

const Decision = z.object({ post_id: z.string().min(1).max(64), decision: z.enum(["release", "remove"]) });

/** Admin only: release a held post, or remove one for good. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Decision, await readJson(req), "invalid_request");
  const admin = authFromRequest(req)?.userId ?? "admin";
  return (await decidePost(await getDb(), admin, input.post_id, input.decision)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
});
