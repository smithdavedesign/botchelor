import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { advanceReel, approveShot, archiveShot, drawReelFrames, filmReel, listReels, makeReel, planReel, redrawShot, REEL_SCOPES, reelNight, stopReel } from "@/lib/adult/reels";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// Drawing, checking and queueing six shots' keyframes takes a minute or so.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
// scope: one chapter, or the whole night (every chapter since it began; the default, the same as one when there is one).
// action: make it all at once (the default), or plan it as a storyboard (docs/PRDs/reel-storyboard.md).
const Input = z.object({ a: id, b: id, night_id: id.optional(), scope: z.enum(REEL_SCOPES).optional(), action: z.enum(["make", "plan"]).optional() });
// A stage of a draft storyboard (`id` is the reel): draw its keyframes, or film it.
const StageInput = z.object({ action: z.enum(["draw", "film"]), id });
// Reviewing a draft storyboard's shots: approve a shot's picture (media_id null = all), or redraw one to the owner's words.
const ApproveInput = z.object({ action: z.literal("approve"), id, media_id: id.nullable(), approved: z.boolean() });
const RedrawInput = z.object({ action: z.literal("redraw"), id, media_id: id, custom: z.string().max(400).optional() });
// One shot of a video (`media_id`, the shot itself) into the Archive, or back out (`archived` false).
const ArchiveInput = z.object({ id, media_id: id, archived: z.boolean() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);
const fail = (r: { error: string; message: string; status: number; busy?: unknown }) => json({ error: r.error, message: r.message, ...(r.busy ? { busy: r.busy } : {}) }, r.status);

/**
 * Make a video of the night (lib/adult/reels.ts): of the running scene, or one of their saved chapters (`night_id`); of
 * that chapter alone, or of the whole night it's part of (`scope`, "night" unless asked). `action` "plan" saves it as a
 * storyboard draft instead of filming; "draw"/"film" (with the draft's `id`) draw its pictures and film it in turn.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const body = await readJson(req);
  const act = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  // A draft's own stages and shot-review act on the stored reel, not a night.
  if (act === "draw" || act === "film") {
    const input = parseBody(StageInput, body, "invalid_request");
    const r = input.action === "draw" ? await drawReelFrames(db, viewer, input.id, requestBase(req)) : await filmReel(db, viewer, input.id, requestBase(req));
    return r.ok ? json({ reel: r.reel }) : fail(r);
  }
  if (act === "approve") {
    const input = parseBody(ApproveInput, body, "invalid_request");
    const r = await approveShot(db, viewer, input.id, input.media_id, input.approved);
    return r.ok ? json({ reel: r.reel }) : fail(r);
  }
  if (act === "redraw") {
    const input = parseBody(RedrawInput, body, "invalid_request");
    const r = await redrawShot(db, viewer, input.id, input.media_id, input.custom, requestBase(req));
    return r.ok ? json({ reel: r.reel }) : fail(r);
  }
  const input = parseBody(Input, body, "invalid_request");
  const night = await reelNight(db, viewer, input.a, input.b, input.night_id, input.scope ?? "night");
  if (!night) return hidden();
  const r =
    input.action === "plan"
      ? await planReel(db, viewer, input.a, input.b, night.lines, { where: night.where, night })
      : await makeReel(db, viewer, input.a, input.b, night.lines, requestBase(req), { where: night.where, night });
  return r.ok ? json({ reel: r.reel }) : fail(r);
});

/** One reel, advanced (?id=), or the pair's reels (?a=&b=). */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const reelId = q.get("id");
  if (reelId) {
    const reel = await advanceReel(db, viewer, reelId);
    return reel ? json({ reel }) : hidden();
  }
  return json({ reels: await listReels(db, viewer, q.get("a") ?? "", q.get("b") ?? "") });
});

/** Stop a reel that's still being made (?id=): the shots already in are kept, the rest's tokens come back. */
export const DELETE = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const reel = await stopReel(db, viewer, new URL(req.url).searchParams.get("id") ?? "");
  return reel ? json({ reel }) : hidden();
});

/**
 * Move a shot out of its video into the Archive, or put it back (lib/adult/reels.ts archiveShot): it's kept either way,
 * never deleted, and plays only from the Archive while it's there.
 */
export const PATCH = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(ArchiveInput, await readJson(req), "invalid_request");
  const r = await archiveShot(db, viewer, input.id, input.media_id, input.archived);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ reel: r.reel });
});
