import { z } from "zod";
import { adminAuthorized, adminOwnerOf, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { decidePost, moderationQueue, reratePost } from "@/lib/showcase-moderation";
import { mediaRefusal } from "@/lib/adult/place";
import { bestOf, creatorProfile, publishBest, twinBest, twinCandidates } from "@/lib/showcase";
import { requestBase } from "@/lib/site";
import { LOOP_USD, loopTargets } from "@/lib/showcase-loops";
import { checkCount } from "@/lib/showcase-check";
import { portraitTargets } from "@/lib/agent-portraits";
import { retwinBatch, retwinTargets } from "@/lib/showcase-retwin";

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
  // Living portraits still to make (lib/showcase-loops.ts): their safe pictures, and the agent-made characters'.
  const toLoop = me ? await loopTargets(db, me, requestBase(req), { agents: true }) : [];
  const loops = { mine: toLoop.filter((x) => x.source === "post").length, agents: toLoop.filter((x) => x.source === "portrait").length, usd: LOOP_USD };
  // After Dark posts still rated explicit, for the PG check (lib/showcase-check.ts): everyone's, as the hourly job.
  const checks = await checkCount(db);
  // Public agent-made characters with no portrait, for the show's own (lib/agent-portraits.ts).
  const portraits = (await portraitTargets(db)).length;
  // Their twins still in the first prompt's pose (lib/showcase-retwin.ts).
  const retwins = me ? (await retwinTargets(db, me)).length : 0;
  return json({ posts: await moderationQueue(db), mine: { profile: me ? await creatorProfile(db, me) : null, best: { after_dark: best.after_dark.length, pg: best.pg.length }, posted: live, twins, loops, checks, portraits, retwins } });
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
  // The next few older twins drawn again with today's prompt (lib/showcase-retwin.ts).
  z.object({ action: z.literal("retwin"), owner: z.string().min(1).max(64).optional() }),
]);


/** Admin only: release a held post, or remove one for good. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Decision, await readJson(req), "invalid_request");
  const admin = authFromRequest(req)?.userId ?? "admin";
  if ("action" in input) {
    const db = await getDb();
    const owner = await adminOwnerOf(db, req, input.owner);
    if (!owner) return json({ error: "not_found", message: "Whose best work? An admin's own, or an admin's id with the admin password." }, 404);
    if (input.action === "retwin") {
      const refused = await mediaRefusal(db, owner);
      if (refused) return refused;
      return json(await retwinBatch(db, owner, requestBase(req)));
    }
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
