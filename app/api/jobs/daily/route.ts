import { track } from "@/lib/analytics";
import { backfillTranscripts } from "@/lib/backfill";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized, runQueuedJobs } from "@/lib/jobs";
import { refreshLobby } from "@/lib/watch";

// A fresh template date (~10 model calls) plus a few backfilled conversations (~8 calls each).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** How many old dates one run backfills: small, to stay inside the free tier's per-minute limit. */
const DEFAULT_BACKFILL = 2;
const MAX_BACKFILL = 6;

/**
 * The daily job (Vercel Cron, see vercel.json): keep the watch lobby alive with a fresh house-vs-house room
 * that plays line by line, backfill the conversation for a few dates that lack one, and run the generation
 * backstop. All free model, $0. Same gate as the backstop route (404 unless authorized); a manual trigger
 * may pass ?backfill=N (capped) to catch up faster.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const asked = Number(new URL(req.url).searchParams.get("backfill") ?? DEFAULT_BACKFILL);
  const limit = Number.isFinite(asked) ? Math.max(0, Math.min(MAX_BACKFILL, Math.floor(asked))) : DEFAULT_BACKFILL;

  const db = await getDb();
  const lobby = await refreshLobby(db).catch(() => ({ created: null, reason: "error" }));
  const backfill = await backfillTranscripts(db, limit);
  const jobsRan = await runQueuedJobs(db, new Date(), 3);
  track("daily_job", {
    room_created: Boolean(lobby.created),
    lobby_reason: lobby.reason ?? null,
    backfilled: backfill.filled.length,
    backfill_failed: backfill.failed.length,
    rate_limited: backfill.rate_limited ?? false,
    jobs_ran: jobsRan,
  });
  return json({ lobby, backfill, jobs_ran: jobsRan });
}

// Vercel Cron sends GET; POST is for a manual trigger.
export const GET = handle(run);
export const POST = handle(run);
