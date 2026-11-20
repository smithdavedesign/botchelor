import { afterDarkOnly } from "@/lib/after-dark-host";
import { claimNextClip, clipWorkerAuthorized } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The Mac's next clip to render (scripts/clips/clip-queue.mjs; lib/clip-requests.ts claimNextClip): the oldest queued
 * request, leased to this attempt, with the date as a stranger sees it once aired and the credit and caption to use.
 * `{ request: null }` when there's none (or CLIP_REQUESTS is off). Needs `Authorization: Bearer $CLIP_WORKER_SECRET`;
 * anything else is a 404, so the route isn't a public surface.
 */
export const POST = handle(async (req: Request) => {
  if (afterDarkOnly() || !clipWorkerAuthorized(req)) return json({ error: "not_found" }, 404);
  return json({ request: await claimNextClip(await getDb()) });
});
