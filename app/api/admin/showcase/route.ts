import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { decidePost, moderationQueue } from "@/lib/showcase-moderation";
import { bestOf, creatorProfile, publishBest } from "@/lib/showcase";

export const dynamic = "force-dynamic";

/** Admin only: showcase posts held by a report, then reported ones still up (lib/showcase-moderation.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  // And their own best work, ready to publish in one go (lib/showcase.ts bestOf), with their handle if they have one.
  const me = authFromRequest(req)?.userId ?? null;
  const best = me ? await bestOf(db, me) : { after_dark: [], pg: [] };
  const live = me ? (await db.query<{ n: number }>(`select count(*)::int as n from showcase_posts where owner_id = $1`, [me])).rows[0].n : 0;
  return json({ posts: await moderationQueue(db), mine: { profile: me ? await creatorProfile(db, me) : null, best: { after_dark: best.after_dark.length, pg: best.pg.length }, posted: live } });
});

const Decision = z.union([
  z.object({ post_id: z.string().min(1).max(64), decision: z.enum(["release", "remove"]) }),
  // Their own best work, published in one go (lib/showcase.ts publishBest).
  z.object({ action: z.literal("publish_best") }),
]);

/** Admin only: release a held post, or remove one for good. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Decision, await readJson(req), "invalid_request");
  const admin = authFromRequest(req)?.userId ?? "admin";
  if ("action" in input) {
    const r = await publishBest(await getDb(), admin);
    return r.ok ? json(r) : json({ error: r.error, message: r.message }, r.status);
  }
  return (await decidePost(await getDb(), admin, input.post_id, input.decision)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
});
