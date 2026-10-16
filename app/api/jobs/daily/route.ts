import { track } from "@/lib/analytics";
import { backfillTranscripts } from "@/lib/backfill";
import { sendDailyTexts } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { recentPublicUrls, submitIndexNow } from "@/lib/indexnow";
import { internalJobAuthorized, runQueuedJobs } from "@/lib/jobs";
import { pruneRateHits } from "@/lib/limits";
import { getModel } from "@/lib/model";
import { clearStaleOwnDates } from "@/lib/own-date";
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
  const t0 = Date.now();
  const asked = Number(new URL(req.url).searchParams.get("backfill") ?? DEFAULT_BACKFILL);
  const limit = Number.isFinite(asked) ? Math.max(0, Math.min(MAX_BACKFILL, Math.floor(asked))) : DEFAULT_BACKFILL;

  const db = await getDb();
  const lobby = await refreshLobby(db).catch(() => ({ created: null, reason: "error" }));
  const backfill = await backfillTranscripts(db, limit);
  const jobsRan = await runQueuedJobs(db, new Date(), 3);
  // Self-performed dates an agent started and never finished (never visible; lib/own-date.ts).
  const ownDatesCleared = await clearStaleOwnDates(db).catch(() => 0);
  // Couples keep texting between dates (lib/between-dates.ts): free model only, capped, inside what's left of the run.
  const texts = await sendDailyTexts(db, getModel(undefined, false), new Date(), { budgetMs: Math.max(0, 240_000 - (Date.now() - t0)), gapMs: 1500 }).catch(
    () => ({ couples: 0, texts: 0, failed: 0 }),
  );
  // Rate-limit rows only live as long as their longest window (lib/limits.ts).
  await pruneRateHits(db).catch(() => {});
  // Push the last day's newly public pages to IndexNow (Bing → ChatGPT search, Copilot; Yandex). Opt-in by key.
  const indexnow = await recentPublicUrls(db, new Date(Date.now() - 26 * 60 * 60 * 1000))
    .then((urls) => submitIndexNow(urls))
    .catch(() => ({ submitted: 0, status: null }));
  track("daily_job", {
    room_created: Boolean(lobby.created),
    lobby_reason: lobby.reason ?? null,
    backfilled: backfill.filled.length,
    backfill_failed: backfill.failed.length,
    rate_limited: backfill.rate_limited ?? false,
    jobs_ran: jobsRan,
    own_dates_cleared: ownDatesCleared,
    indexnow_submitted: indexnow.submitted,
    indexnow_status: indexnow.status,
    texted_couples: texts.couples,
    texts_failed: texts.failed,
  });
  return json({ lobby, backfill, jobs_ran: jobsRan, own_dates_cleared: ownDatesCleared, indexnow, texts });
}

// Vercel Cron sends GET; POST is for a manual trigger.
export const GET = handle(run);
export const POST = handle(run);
