import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { decidePost, moderationQueue, reratePost } from "@/lib/showcase-moderation";
import { isAdmin, isSignedInAdmin } from "@/lib/admins";
import type { Db } from "@/lib/db";
import { mediaRefusal } from "@/lib/adult/place";
import { bestOf, creatorProfile, publishBest, twinBest, twinCandidates } from "@/lib/showcase";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";
// A batch of SFW twins (twinBest): a few edits of a minute or so each, drawn together.
export const maxDuration = 300;

/** Admin only: showcase posts held by a report, then reported ones still up (lib/showcase-moderation.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  // And their own best work, ready to publish in one go (lib/showcase.ts bestOf), with their handle if they have one.
  const me = authFromRequest(req)?.userId ?? null;
  const best = me ? await bestOf(db, me) : { after_dark: [], pg: [] };
  const live = me ? (await db.query<{ n: number }>(`select count(*)::int as n from showcase_posts where owner_id = $1`, [me])).rows[0].n : 0;
  const twins = me ? (await twinCandidates(db, me)).length : 0;
  return json({ posts: await moderationQueue(db), mine: { profile: me ? await creatorProfile(db, me) : null, best: { after_dark: best.after_dark.length, pg: best.pg.length }, posted: live, twins } });
});

const Decision = z.union([
  z.object({ post_id: z.string().min(1).max(64), decision: z.enum(["release", "remove"]) }),
  // Which side it's on, corrected: to After Dark at once, or the PG check again (lib/showcase-moderation.ts reratePost).
  z.object({ post_id: z.string().min(1).max(64), rerate: z.enum(["after_dark", "check"]) }),
  // Their own best work, published in one go (lib/showcase.ts publishBest).
  // `owner` on these: whose, with the admin password only, and only an admin's (ownerOf).
  z.object({ action: z.literal("publish_best"), owner: z.string().min(1).max(64).optional() }),
  // The next few SFW twins of their best (twinBest).
  z.object({ action: z.literal("twin_best"), skip: z.array(z.string().min(1).max(64)).max(500).default([]), owner: z.string().min(1).max(64).optional() }),
]);

/** Whose best work: a signed-in admin's own, or (with the admin password) the admin named. Never anyone else's. */
async function ownerOf(db: Db, req: Request, named: string | undefined): Promise<string | null> {
  if (named) return frontierAuthorized(req) && (await isAdmin(db, named)) ? named : null;
  const me = authFromRequest(req);
  return me && (await isSignedInAdmin(db, me)) ? me.userId : null;
}

/** Admin only: release a held post, or remove one for good. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Decision, await readJson(req), "invalid_request");
  const admin = authFromRequest(req)?.userId ?? "admin";
  if ("action" in input) {
    const db = await getDb();
    const owner = await ownerOf(db, req, input.owner);
    if (!owner) return json({ error: "not_found", message: "Whose best work? An admin's own, or an admin's id with the admin password." }, 404);
    if (input.action === "twin_best") {
      const refused = await mediaRefusal(db, owner);
      if (refused) return refused;
      return json(await twinBest(db, owner, requestBase(req), input.skip));
    }
    const r = await publishBest(db, owner);
    return r.ok ? json(r) : json({ error: r.error, message: r.message }, r.status);
  }
  if ("rerate" in input) {
    const r = await reratePost(await getDb(), input.post_id, input.rerate);
    return r.ok ? json(r) : json({ error: "not_rerated", message: r.message }, r.status);
  }
  return (await decidePost(await getDb(), admin, input.post_id, input.decision)) ? json({ ok: true }) : json({ error: "not_found" }, 404);
});
