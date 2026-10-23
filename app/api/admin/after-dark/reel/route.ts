import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { advanceReel, listReels, makeReel, REEL_SCOPES, reelNight, stopReel } from "@/lib/adult/reels";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// Drawing, checking and queueing six shots' keyframes takes a minute or so.
export const maxDuration = 300;

const id = z.string().min(1).max(64);
// scope: one chapter, or the whole night (every chapter since it began; the default, the same as one when there is one).
const Input = z.object({ a: id, b: id, night_id: id.optional(), scope: z.enum(REEL_SCOPES).optional() });

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Make a video of the night (lib/adult/reels.ts): of the running scene, or one of their saved chapters (`night_id`);
 * of that chapter alone, or of the whole night it's part of (`scope`, "night" unless asked).
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const night = await reelNight(db, viewer, input.a, input.b, input.night_id, input.scope ?? "night");
  if (!night) return hidden();
  const r = await makeReel(db, viewer, input.a, input.b, night.lines, requestBase(req), { where: night.where, night });
  if (!r.ok) return json({ error: r.error, message: r.message, ...(r.busy ? { busy: r.busy } : {}) }, r.status);
  return json({ reel: r.reel });
});

/** One reel, advanced (?id=), or the pair's reels (?a=&b=). */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
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
  const reel = await stopReel(db, viewer, new URL(req.url).searchParams.get("id") ?? "");
  return reel ? json({ reel }) : hidden();
});
