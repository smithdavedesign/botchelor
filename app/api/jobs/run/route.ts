import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized, runQueuedJobs } from "@/lib/jobs";

// May process several queued jobs, each up to ~25s of model calls.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The cron backstop for async episode generation: runs any job the request's after() hook missed (still
 * queued, or running past its lease because a worker crashed). The common path never needs this; it's the
 * reliability net. Gate: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or the internal admin token
 * (x-jobs-token), both constant-time. 404 when neither is configured/matched, so it isn't a public surface.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const ran = await runQueuedJobs(await getDb());
  return json({ ran });
}

// Vercel Cron sends GET; POST is for a manual/scripted trigger.
export const GET = handle(run);
export const POST = handle(run);
