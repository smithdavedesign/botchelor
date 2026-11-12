import { notifyWentWell } from "@/lib/air";
import { track } from "@/lib/analytics";
import { nudgeQuietWeek } from "@/lib/reengage";
import { backfillTranscripts } from "@/lib/backfill";
import { resolveExpiredArcs } from "@/lib/arcs";
import { settleDueBackings } from "@/lib/backing";
import { pickWeeklyCastDate } from "@/lib/cast-date";
import { sendDailyTexts } from "@/lib/between-dates";
import { sendDigests } from "@/lib/email";
import { sendRenewalReminders } from "@/lib/adult/billing";
import { prunePlanCheckouts, sendPlanReminders } from "@/lib/paid-plans";
import { pruneCompanionUsage } from "@/lib/companion-plan";
import { pruneExtrasUsage } from "@/lib/companion-extras";
import { pruneLiveCalls } from "@/lib/companion-live";
import { forgetUnusedVoices } from "@/lib/companion-voice";
import { nudgeLikesWaiting } from "@/lib/away";
import { getDb, type Db } from "@/lib/db";
import { handle, json, jsonWhenDone } from "@/lib/http";
import { recentPublicUrls, submitIndexNow } from "@/lib/indexnow";
import { internalJobAuthorized, runQueuedJobs } from "@/lib/jobs";
import { recordJobRun, startJobMeter } from "@/lib/job-meter";
import { pruneServerErrors } from "@/lib/errors";
import { pruneRateHits } from "@/lib/limits";
import { pruneMcpCalls } from "@/lib/agent-analytics";
import { markDay7Returns } from "@/lib/agent-funnel";
import { dailyMatchmakerPicks } from "@/lib/house-matchmaker";
import { pruneKeptData } from "@/lib/retention";
import { pruneExports } from "@/lib/media-tools/export";
import { getModel } from "@/lib/model";
import { relationshipMetrics } from "@/lib/relationship-metrics";
import { clearStaleOwnDates } from "@/lib/own-date";
import { refreshLobby } from "@/lib/watch";
import { seasonGenerationDue } from "@/lib/season-gen";
import { backfillEmbeddings } from "@/lib/originality-concept";

// A fresh template date (~10 model calls) plus a few backfilled conversations (~8 calls each).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** How many old dates one run backfills: small, to stay inside the free tier's per-minute limit. */
const DEFAULT_BACKFILL = 2;
const MAX_BACKFILL = 6;

/**
 * The daily job's parts, in the order they run. The scheduled job (.do/app.yaml) calls them one request at a time,
 * ?part=<name>, with a pause between: the whole job in one request held the show's only instance for minutes and
 * 504'd the site twice on 2026-11-11. A call without ?part runs all four in this order (manual triggers, tests).
 * - upkeep: retention and the other prunes (database deletes, a few bucket deletes).
 * - show: the lobby's fresh room, backfilled conversations, queued dates, arcs, backings, the weekly cast date.
 * - people: the couples' daily texts, then the digest (so today's texts are in it), reminders, nudges, matchmaker.
 * - growth: IndexNow, next season's candidates, concept embeddings, the relationship metrics.
 */
const PARTS = ["upkeep", "show", "people", "growth"] as const;
type Part = (typeof PARTS)[number];
const isPart = (s: string): s is Part => (PARTS as readonly string[]).includes(s);

type Meter = ReturnType<typeof startJobMeter>;
type Ctx = { db: Db; t0: number; backfillLimit: number; step: Meter["step"] };
/** What a part hands back: the response's fields, and the counts for the daily_job analytics line. */
type PartResult = { body: Record<string, unknown>; counts: Record<string, unknown> };

async function upkeep({ db, step }: Ctx): Promise<PartResult> {
  // The data plan's retention (lib/retention.ts), first, so a run that runs out of time later never skips it.
  await step("retention", () => pruneKeptData(db).catch(() => {}));
  // Exports past their day (lib/media-tools/export.ts): their files in the bucket, then their rows.
  await step("exports", () => pruneExports(db).catch(() => {}));
  // Self-performed dates an agent started and never finished (never visible; lib/own-date.ts).
  const ownDatesCleared = await step("own_dates", () => clearStaleOwnDates(db).catch(() => 0));
  // Rate-limit rows only live as long as their longest window (lib/limits.ts).
  await step("rate_hits", () => pruneRateHits(db).catch(() => {}));
  await step("mcp_calls", () => pruneMcpCalls(db).catch(() => {}));
  // Companion reply counts past last month, and Subscribe clicks past a week (lib/companion-plan.ts, lib/paid-plans.ts).
  await step("companion_usage", () => pruneCompanionUsage(db).catch(() => {}));
  // The plan's monthly voice notes past this month, and any voice file no reply points at (lib/companion-voice.ts).
  await step("extras_usage", () => pruneExtrasUsage(db).catch(() => {}));
  await step("live_calls", () => pruneLiveCalls(db).catch(() => {}));
  await step("voices", () => forgetUnusedVoices(db));
  await step("plan_checkouts", () => prunePlanCheckouts(db).catch(() => {}));
  await step("server_errors", () => pruneServerErrors(db).catch(() => {}));
  return { body: { own_dates_cleared: ownDatesCleared }, counts: { own_dates_cleared: ownDatesCleared } };
}

async function show({ db, step, backfillLimit }: Ctx): Promise<PartResult> {
  const lobby = await step("lobby", () => refreshLobby(db).catch(() => ({ created: null, reason: "error" })));
  const backfill = await step("backfill", () => backfillTranscripts(db, backfillLimit));
  const jobsRan = await step("queued_jobs", () => runQueuedJobs(db, new Date(), 3));
  // Arc predictions whose deadline passed (lib/arcs.ts).
  const arcsSettled = await step("arcs", () => resolveExpiredArcs(db).catch(() => 0));
  // Cast backings of a season that closed without its recap being read yet (lib/backing.ts): the backstop settle.
  const backingsSettled = await step("backings", () => settleDueBackings(db).catch(() => []));
  // The weekly earned slot (lib/cast-date.ts): last week's most active viewer gets a date with the cast, once a week.
  const castDate = await step("cast_date", () => pickWeeklyCastDate(db).catch(() => ({ picked: false as const, reason: "error" })));
  return {
    body: { lobby, backfill, jobs_ran: jobsRan, arcs_settled: arcsSettled },
    counts: {
      room_created: Boolean(lobby.created),
      lobby_reason: lobby.reason ?? null,
      backfilled: backfill.filled.length,
      backfill_failed: backfill.failed.length,
      rate_limited: backfill.rate_limited ?? false,
      jobs_ran: jobsRan,
      arcs_settled: arcsSettled,
      backings_settled: backingsSettled.reduce((s, b) => s + b.settled, 0),
      cast_date_picked: castDate.picked,
    },
  };
}

async function people({ db, step, t0 }: Ctx): Promise<PartResult> {
  // Couples keep texting between dates (lib/between-dates.ts): free model only, capped, inside what's left of the run.
  const texts = await step("texts", () =>
    sendDailyTexts(db, getModel(undefined, false), new Date(), { budgetMs: Math.max(0, 240_000 - (Date.now() - t0)), gapMs: 1500 }).catch(() => ({
      couples: 0,
      texts: 0,
      failed: 0,
    })),
  );
  // The daily email digest for players who opted in (lib/email.ts), after today's texts so they're in it.
  const digests = await step("digests", () => sendDigests(db).catch(() => 0));
  // The day after a date that went well: its owners hear so, with the share a tap away (lib/air.ts).
  const wentWell = await step("went_well", () => notifyWentWell(db).catch(() => 0));
  // After Dark subscribers' yearly renewal reminder on each anniversary (California's automatic renewal law;
  // lib/adult/billing.ts). Nothing while no payment processor is configured.
  const renewalReminders = await step("renewal_reminders", () => sendRenewalReminders(db).catch(() => 0));
  // The plans' yearly reminder (lib/paid-plans.ts), the same law.
  const planReminders = await step("plan_reminders", () => sendPlanReminders(db).catch(() => 0));
  // "Likes waiting" (never who) to owners away a day whose characters don't answer for themselves (lib/away.ts).
  const likesNudged = await step("likes_nudged", () => nudgeLikesWaiting(db).catch(() => 0));
  // A quiet week (lib/reengage.ts): the week's best date to opted-in people gone 7 days, once a month at most.
  const weekBest = await step("week_best", () => nudgeQuietWeek(db).catch(() => 0));
  // The agent funnel's day-7 return (lib/agent-funnel): agents back 6-8 days after their first date.
  const day7 = await step("day7", () => markDay7Returns(db).catch(() => 0));
  // The house matchmaker (lib/house-matchmaker.ts): a few deterministic pair picks a day, both owners told why.
  const matchmaker = await step("matchmaker", () => dailyMatchmakerPicks(db).catch(() => 0));
  return {
    body: { texts },
    counts: {
      texted_couples: texts.couples,
      texts_failed: texts.failed,
      email_digests: digests,
      went_well: wentWell,
      week_best: weekBest,
      ad_renewal_reminders: renewalReminders,
      plan_reminders: planReminders,
      likes_nudged: likesNudged,
      agent_day_7_returns: day7,
      matchmaker_picks: matchmaker,
    },
  };
}

async function growth({ db, step, t0 }: Ctx): Promise<PartResult> {
  // Push the last day's newly public pages to IndexNow (Bing → ChatGPT search, Copilot; Yandex). Opt-in by key.
  const indexnow = await step("indexnow", () =>
    recentPublicUrls(db, new Date(Date.now() - 26 * 60 * 60 * 1000))
      .then((urls) => submitIndexNow(urls))
      .catch(() => ({ submitted: 0, status: null })),
  );
  // Monthly seasons (lib/season-gen.ts): from the 20th, next month's candidates. The cast's After Dark baselines are made
  // on After Dark's own host, where its media is (app/api/jobs/after-dark-daily, #1009).
  const candidates = await step("season_candidates", () =>
    seasonGenerationDue(db).catch((e: unknown) => ({ season: "", made: [], errors: [e instanceof Error ? e.message : "error"] })),
  );
  // Concept embeddings (lib/originality-concept.ts): characters that have none from the current model yet. Off unless enabled.
  // It runs late, so it gets a deadline from the request's start: it stops in time to leave the report below (track, the
  // relationship metrics, the response) inside maxDuration, and on the first 429 or timeout. 270 s: maxDuration less 30 s.
  const embeddings = await step("embeddings", () =>
    backfillEmbeddings(db, { deadline: t0 + 270_000 }).catch(() => ({
      made: 0,
      failed: 0,
      skipped: 0,
      stopped: "error" as const,
      key_from: null,
    })),
  );
  // The long game's numbers, once a day, for the logs (counts only).
  const metrics = await step("relationship_metrics", () => relationshipMetrics(db).catch(() => null));
  if (metrics) {
    track("relationship_metrics", {
      mutual_dates_30d: metrics.second_dates.mutual,
      second_dates_booked_30d: metrics.second_dates.booked,
      second_date_conversion: metrics.second_dates.conversion,
      couples: metrics.couples.total,
      public_couples: metrics.couples.public,
      deepest_couple: metrics.couples.deepest,
      texts_7d: metrics.between_dates.texts_7d,
      follows: metrics.between_dates.follows,
      owner_cohort: metrics.owners.cohort,
      owner_d1_rate: metrics.owners.d1_rate,
      owner_d7_rate: metrics.owners.d7_rate,
      cross_species_pairs: metrics.north_star.cross_species_pairs,
      cross_kind_pairs: metrics.north_star.cross_kind_pairs,
      kind_coverage: metrics.north_star.kind_coverage,
    });
  }
  return {
    body: { indexnow, embeddings },
    counts: {
      season_candidates_made: candidates?.made.length ?? 0,
      season_candidate_errors: candidates?.errors.length ?? 0,
      embeddings_made: embeddings.made,
      embeddings_failed: embeddings.failed,
      embeddings_skipped: embeddings.skipped,
      embeddings_stopped: embeddings.stopped,
      // The name of the variable the embedding key comes from (never the value): EMBED_API_KEY once it's set.
      embeddings_key: embeddings.key_from,
      indexnow_submitted: indexnow.submitted,
      indexnow_status: indexnow.status,
    },
  };
}

const RUN: Record<Part, (ctx: Ctx) => Promise<PartResult>> = { upkeep, show, people, growth };

/**
 * The daily job (16:20 UTC, from the DigitalOcean scheduled job in .do/app.yaml): keep the watch lobby alive with a fresh house-vs-house room
 * that plays line by line, backfill the conversation for a few dates that lack one, and run the generation
 * backstop. All free model, $0. Same gate as the backstop route (404 unless authorized); a manual trigger
 * may pass ?backfill=N (capped) to catch up faster, and ?part=<name> to run one part (PARTS above).
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const t0 = Date.now();
  const params = new URL(req.url).searchParams;
  const partParam = params.get("part");
  if (partParam !== null && !isPart(partParam)) return json({ error: "unknown_part", parts: PARTS }, 400);
  const parts: readonly Part[] = partParam ? [partParam] : PARTS;
  const asked = Number(params.get("backfill") ?? DEFAULT_BACKFILL);
  const backfillLimit = Number.isFinite(asked) ? Math.max(0, Math.min(MAX_BACKFILL, Math.floor(asked))) : DEFAULT_BACKFILL;

  const db = await getDb();
  // Streamed: a part can take longer than the edge's 100 s idle cutoff, and the scheduled job must wait for it to
  // finish before it starts the next one (a 504 at 100 s used to end the call while the work went on).
  return jsonWhenDone(req, async () => {
    const meter = startJobMeter();
    const ctx: Ctx = { db, t0, backfillLimit, step: meter.step };
    const body: Record<string, unknown> = {};
    const counts: Record<string, unknown> = {};
    try {
      for (const part of parts) {
        const r = await RUN[part](ctx);
        Object.assign(body, r.body);
        Object.assign(counts, r.counts);
      }
    } finally {
      // What the run cost the instance, kept even when a step throws: the next outage says which step it was.
      const report = meter.finish();
      const label = partParam ?? "all";
      await recordJobRun(db, "daily", label, report);
      track("daily_job_load", {
        part: label,
        ms: report.ms,
        rss_mb_peak: report.rss_mb_peak,
        heap_mb_peak: report.heap_mb_peak,
        heap_limit_mb: report.heap_limit_mb,
        loop_max_ms: report.loop_max_ms,
        slowest: [...report.steps].sort((a, b) => b.ms - a.ms)[0]?.step ?? null,
      });
      body.load = report;
    }
    track("daily_job", { part: partParam ?? "all", ...counts });
    return body;
  });
}

// The scheduled job sends GET; POST is for a manual trigger.
export const GET = handle(run);
export const POST = handle(run);
