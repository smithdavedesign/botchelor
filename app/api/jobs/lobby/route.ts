import { after } from "next/server";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { internalJobAuthorized, runQueuedJobs } from "@/lib/jobs";
import { refreshLobby } from "@/lib/watch";
import { airDueDates } from "@/lib/air";
import { autoplayQuietOwnDates } from "@/lib/own-date";
import { runDueScheduledDates } from "@/lib/scheduled-dates";
import { runDueMixers } from "@/lib/group-dates-run";
import { drawQueuedSets, retryDueSets } from "@/lib/sets";
import { runWhileAway } from "@/lib/away";
import { portraitSweep } from "@/lib/default-portraits";
import { playVotedSituation } from "@/lib/situations";
import { judgePendingDares } from "@/lib/dare-verdict";
import { settleDueDares } from "@/lib/dare-points";
import { runDueRecoupling } from "@/lib/recoupling";
import { ensureCastSecrets } from "@/lib/cast-secrets";
import { ensureCastChat } from "@/lib/cast-chat";

// One template date (~10 model calls) when the lobby has no open room left to start.
export const maxDuration = 300;
export const dynamic = "force-dynamic";
/** Stuck generations the hourly job runs again, at most (each is a whole date, ~10–20 model calls). */
const STUCK_PER_HOUR = 5;

/**
 * The hourly lobby job (a DigitalOcean scheduled job in .do/app.yaml calls it, since Vercel's free plan runs cron only
 * daily): keeps one open room nobody has started yet, so the watch page always has something to start live (an open
 * room's clock starts with its first viewer, then it becomes a replay). At most FRESH_ROOMS_PER_DAY a UTC day. It also
 * airs agents' dates whose prediction window has closed (lib/air.ts), and moves two-agent dates stalled on a quiet agent's move (lib/own-date.ts autoplayQuietOwnDates). Same gate as the other jobs: 404 unless authorized.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const started = Date.now();
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
  // Tonight's situation (lib/situations.ts): once yesterday's vote has closed, its date is made, once. Before the lobby's
  // own refresh, so the voted room is the open one and the refresh doesn't make another beside it.
  const situation = await playVotedSituation(db).catch(() => null);
  // A dare night whose verdict didn't land when its date was made (lib/dare-verdict.ts): judged now, once.
  const dareVerdicts = await judgePendingDares(db).catch(() => []);
  // An aired dare night whose winning voters haven't scored yet (lib/dare-points.ts): settled now, once.
  const darePoints = await settleDueDares(db).catch(() => []);
  // The recoupling night (lib/recoupling.ts): opens the vote when a night is close, runs it at the fill hour.
  const recoupling = await runDueRecoupling(db).catch(() => null);
  // This season's cast secrets (lib/cast-secrets.ts): written once a season each on the show's cheap model; a no-op after.
  const secrets = await ensureCastSecrets(db).catch(() => null);
  // Leaked from the cast group chat (lib/cast-chat.ts): yesterday's, written once, the first pass after midnight UTC.
  const castChat = await ensureCastChat(db).catch(() => null);
  // Dates whose generation died (a deploy swapped the container mid-date: the 2026-11-02 20:20 mixer's five sat
  // "generating" for hours): run again after the response, so the scheduler's call doesn't wait on the model. Only
  // the daily job did this before.
  const stuck = (await db.query<{ n: number }>(`select count(*)::int as n from generation_jobs where status = 'queued' or (status = 'running' and leased_until < now())`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0;
  if (stuck) {
    const rerun = () => runQueuedJobs(db, new Date(), STUCK_PER_HOUR).catch(() => 0);
    try {
      after(rerun);
    } catch {
      void rerun(); // outside a request (a test): just run it
    }
  }
  const lobby = await refreshLobby(db, new Date(), { ensureFresh: true });
  // Every character has a headshot (lib/default-portraits.ts): a few of those still without one are drawn each hour,
  // unless the run is already long (a template date above takes most of the 300 s).
  const portraits = Date.now() - started > 150_000 ? { drawn: 0, failed: 0, left: -1 } : await portraitSweep(db).catch(() => ({ drawn: 0, failed: 0, left: -1 }));
  return json({ ...lobby, portraits, situation, dare_verdicts: dareVerdicts.length, dare_points_settled: darePoints.reduce((n, d) => n + d.voters, 0), recoupling, secrets, cast_chat: castChat, aired, stuck_generations: stuck, handed_over, sets_rechecked, sets_drawn, scheduled_dates: scheduled, mixers, ...away });
}

export const GET = handle(run);
export const POST = handle(run);
