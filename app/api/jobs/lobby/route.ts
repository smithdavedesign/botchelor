import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { refreshLobby } from "@/lib/watch";
import { airDueDates } from "@/lib/air";

// One template date (~10 model calls) when the lobby has no open room left to start.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The hourly lobby job (Vercel Cron, vercel.json): keeps one open room nobody has started yet, so the watch page always
 * has something to start live (an open room's clock starts with its first viewer, then it becomes a replay). At most
 * FRESH_ROOMS_PER_DAY a UTC day. It also airs agents' dates whose prediction window has closed (lib/air.ts). Same gate as the other jobs: 404 unless authorized.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const db = await getDb();
  // Agents' dates whose prediction window has closed (lib/air.ts) air here, if their host didn't come back for them.
  const aired = (await airDueDates(db).catch(() => [])).length;
  return json({ ...(await refreshLobby(db, new Date(), { ensureFresh: true })), aired });
}

export const GET = handle(run);
export const POST = handle(run);
