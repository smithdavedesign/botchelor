import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { refreshLobby } from "@/lib/watch";
import { airDueDates } from "@/lib/air";
import { autoplayQuietOwnDates } from "@/lib/own-date";
import { runDueScheduledDates } from "@/lib/scheduled-dates";
import { runDueMixers } from "@/lib/group-dates-run";
import { drawQueuedSets, retryDueSets } from "@/lib/sets";
import { runWhileAway } from "@/lib/away";

// One template date (~10 model calls) when the lobby has no open room left to start.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The hourly lobby job (Vercel Cron, vercel.json): keeps one open room nobody has started yet, so the watch page always
 * has something to start live (an open room's clock starts with its first viewer, then it becomes a replay). At most
 * FRESH_ROOMS_PER_DAY a UTC day. It also airs agents' dates whose prediction window has closed (lib/air.ts), and moves
 * two-agent dates stalled on a quiet agent's move (lib/own-date.ts autoplayQuietOwnDates). Same gate as the other jobs: 404 unless authorized.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const db = await getDb();
  // Agents' dates whose prediction window has closed (lib/air.ts) air here, if their host didn't come back for them.
  const aired = (await airDueDates(db).catch(() => [])).length;
  // Two-agent dates nobody is reading, waiting on a move quiet past the hand-over: the show's model takes that side.
  const handed_over = await autoplayQuietOwnDates(db).catch(() => 0);
  // Drawn sets whose check couldn't run (a Hive 429): their kept pictures are checked again, a few at a time (lib/sets.ts).
  const sets_rechecked = (await retryDueSets(db, 3).catch(() => [])).length;
  // The places scenes went whose set never landed (a draw cut off, a passing failure due again): drawn a couple at a time.
  const sets_drawn = (await drawQueuedSets(db, 2).catch(() => [])).length;
  // While they're away (lib/away.ts): likes and match questions on characters whose owners are gone get the character's
  // own answer, the crowd's are backed up when David's Mac is off, and agents gone a week have their characters played.
  const away = await runWhileAway(db).catch(() => ({}));
  // Dates booked for later (lib/scheduled-dates.ts): run the due ones through the normal booking route.
  const scheduled = await runDueScheduledDates(db).catch(() => ({ ran: 0, booked: 0, waiting: 0, failed: 0 }));
  // The speed-dating mixer (lib/group-dates-run.ts): runs once enough singles joined, through the normal booking route.
  const mixers = await runDueMixers(db).catch(() => ({ ran: 0, booked: 0, failed: 0, cancelled: 0, waiting: 0 }));
  return json({ ...(await refreshLobby(db, new Date(), { ensureFresh: true })), aired, handed_over, sets_rechecked, sets_drawn, scheduled_dates: scheduled, mixers, ...away });
}

export const GET = handle(run);
export const POST = handle(run);
