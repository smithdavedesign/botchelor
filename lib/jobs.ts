/**
 * M10 part 2 — async episode generation.
 *
 * POST /api/episodes writes the engine's outcome synchronously (instant, no model) and leaves the episode
 * 'generating'. The slow part — narration + the turn-by-turn conversation — runs here, in the background,
 * driven by Next's after() hook on the request and, as a backstop, a cron-invokable worker route. When it
 * finishes, the episode flips to 'ready' and the page (which polls) shows the finished date.
 *
 * The job is self-contained: it rebuilds the date from the stored episode (seed-deterministic, the same
 * way Sliding Doors replays), so it needs nothing from the original request. A lease stops the after()
 * hook and the cron from double-running the same job.
 */
import { releaseEpisode, type Reservation } from "./allowance";
import { track, trackEpisodeCost } from "./analytics";
import { ConversationError } from "./conversation";
import { generationPaused } from "./compute";
import { isConversationEnabled, simulateConversation, type Turn } from "./conversation";
import { isAfterglowEnabled, simulateAfterglow, type AfterglowLine } from "./afterglow";
import type { Db } from "./db";
import { safeEqual } from "./http";
import { getEngine, type CharacterSheet } from "./engine";
import { DEFAULT_FORMAT } from "./formats";
import { getFrontierModel, getModel } from "./model";
import {
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
} from "./rules";
import { buildDate, rememberDate, type CharacterForDate, type DateRequest } from "./simulation";
import { narrateEpisode, ShowrunnerError } from "./showrunner";
import type { DateSetup } from "./game";

/**
 * Production defers generation to after(); tests (and anywhere without the request lifecycle) run it
 * inline so the episode is ready by the time the response returns. The shared harness turns this on.
 */
let inlineGeneration = false;
export function setInlineGenerationForTests(on: boolean): void {
  inlineGeneration = on;
}
/** Inline when a test asked for it, or when BOTCHELOR_INLINE_GENERATION=1 (the seed/e2e/screenshot runs,
 *  so their episodes are ready the instant they're created, with no after() race). Production: async. */
export function inlineGenerationEnabled(): boolean {
  return inlineGeneration || process.env.BOTCHELOR_INLINE_GENERATION === "1";
}

/** How long a worker holds a job before another may retake it (generation is ~20s; a margin on top). */
export const JOB_LEASE_SECONDS = 120;
/** How many times a failed job is retried before it is marked failed for good. */
export const MAX_JOB_ATTEMPTS = 3;

/** Queue one episode for background generation. creatorId + reservation let the worker give the date back. */
export async function enqueueGeneration(
  db: Db,
  episodeId: string,
  useFrontier: boolean,
  creatorId: string,
  reservation: Reservation | null,
): Promise<void> {
  await db.query(
    `insert into generation_jobs (episode_id, status, use_frontier, creator_id, reservation)
     values ($1, 'queued', $2, $3, $4::jsonb) on conflict (episode_id) do nothing`,
    [episodeId, useFrontier, creatorId, reservation ? JSON.stringify(reservation) : null],
  );
}

type GenRow = {
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  use_frontier: boolean;
  creator_id: string;
  reservation: Reservation | null;
  attempts: number;
  a_id: string; a_name: string; a_age: number; a_bio: string; a_traits: string[]; a_want: string; a_dealbreaker: string; a_house: boolean; a_appearance: string | null;
  b_id: string; b_name: string; b_age: number; b_bio: string; b_traits: string[]; b_want: string; b_dealbreaker: string; b_house: boolean; b_appearance: string | null;
};

const sheet = (r: GenRow, p: "a" | "b"): CharacterSheet => ({
  name: r[`${p}_name`],
  age: r[`${p}_age`],
  bio: r[`${p}_bio`],
  traits: r[`${p}_traits`],
  want: r[`${p}_want`],
  dealbreaker: r[`${p}_dealbreaker`],
  house: r[`${p}_house`],
  appearance: r[`${p}_appearance`] ?? undefined,
});

/**
 * Atomically claim the job for this episode: mark it running with a fresh lease, but only if it is queued,
 * or running under an expired lease (a crashed worker), and still has attempts left. Returns the claimed
 * row (with the data to rebuild the date) or null if someone else holds it / it's done / out of attempts.
 */
async function claim(db: Db, episodeId: string, now: Date): Promise<GenRow | null> {
  const leaseUntil = new Date(now.getTime() + JOB_LEASE_SECONDS * 1000).toISOString();
  const claimed = (
    await db.query<{ episode_id: string }>(
      `update generation_jobs
          set status = 'running', attempts = attempts + 1, leased_until = $2, updated_at = now()
        where episode_id = $1
          and status in ('queued', 'running')
          and (leased_until is null or leased_until < $3)
          and attempts < $4
        returning episode_id`,
      [episodeId, leaseUntil, now.toISOString(), MAX_JOB_ATTEMPTS],
    )
  ).rows[0];
  if (!claimed) return null;
  const { rows } = await db.query<GenRow>(
    `select e.seed::text as seed, e.setup, e.note, j.use_frontier, j.creator_id, j.reservation, j.attempts,
            a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want,
            a.dealbreaker a_dealbreaker, a.is_house a_house, a.appearance a_appearance,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
            b.dealbreaker b_dealbreaker, b.is_house b_house, b.appearance b_appearance
       from episodes e
       join generation_jobs j on j.episode_id = e.id
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId],
  );
  return rows[0] ?? null;
}

/**
 * Generate one episode's content in the background: claim it, rebuild the date from the seed, narrate and
 * run the conversation, then flip the episode to 'ready'. Safe to call more than once (the lease makes a
 * second caller a no-op). Never throws: a failure marks the job for retry, and the cron backstop re-runs it.
 */
export async function runGenerationJob(db: Db, episodeId: string, now: Date = new Date()): Promise<void> {
  if (generationPaused()) return; // a paused system leaves the job queued for when it resumes
  let row: GenRow | null;
  try {
    row = await claim(db, episodeId, now);
  } catch (err) {
    console.error("[jobs] could not claim", episodeId, err instanceof Error ? err.message : "unknown");
    return;
  }
  if (!row) return; // someone else holds it, or it's done / out of attempts

  const t0 = Date.now();
  try {
    const seed = row.seed === null ? undefined : Number(row.seed);
    const formatId = row.setup?.format ?? DEFAULT_FORMAT;
    const dateRequest: DateRequest = {
      autonomy: row.setup?.autonomy ?? DEFAULT_AUTONOMY,
      strategy: row.setup?.strategy ?? DEFAULT_STRATEGY,
      gameBudget: row.setup?.game_budget_a ?? DEFAULT_GAME_BUDGET,
      agendaId: row.setup?.agenda_a ?? null,
      note: row.note,
      format: formatId,
    };
    const forDate = (p: "a" | "b"): CharacterForDate => ({ id: row![`${p}_id`], sheet: sheet(row!, p) });
    // Re-decide on the EXACT signals POST stored (M14 part 2 snapshot), so a character's memory drifting
    // between POST and this worker can't change the canonical outcome the narration is steered toward.
    const signalsSnapshot =
      row.setup?.signals_a && row.setup?.signals_b ? { a: row.setup.signals_a, b: row.setup.signals_b } : undefined;
    const built = await buildDate(db, episodeId, forDate("a"), forDate("b"), dateRequest, seed, signalsSnapshot);
    // Re-decide under the calibration POST stored (a deploy between POST and this worker can't change it).
    const decided = getEngine().decide(built.input, built.seed, row.setup?.engine_version ?? 1);

    const model = row.use_frontier ? getFrontierModel() ?? getModel() : getModel();
    const fmtCtx = { chaperone: built.setup.chaperone, ex: built.setup.ex };
    const draft = await narrateEpisode(model, built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, fmtCtx);

    let transcript: Turn[] = [];
    if (isConversationEnabled()) {
      try {
        transcript = await simulateConversation(model, built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, undefined, fmtCtx);
      } catch (err) {
        transcript = [];
        track("conversation_failed", { episode_id: episodeId, where: "job", reason: failureReason(err) });
      }
    }

    // The afterglow (best-effort, like the conversation): a failure just leaves it empty.
    let afterglow: AfterglowLine[] = [];
    if (isAfterglowEnabled()) {
      try {
        afterglow = await simulateAfterglow(model, built.input, decided, built.characters, built.setup.venue, formatId, undefined, fmtCtx);
      } catch {
        afterglow = [];
      }
    }

    const saved = await db.query<{ id: string }>(
      `update episodes
          set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6,
              best_line = $7, confessionals = $8::jsonb, transcript = $9::jsonb, afterglow = $10::jsonb, status = 'ready'
        where id = $1 and status = 'generating'
        returning id`,
      [
        episodeId,
        draft.setting,
        JSON.stringify(draft.goals),
        JSON.stringify(draft.scenes),
        draft.twist,
        draft.finale,
        draft.best_line,
        JSON.stringify(draft.confessionals),
        JSON.stringify(transcript),
        JSON.stringify(afterglow),
      ],
    );
    if (saved.rows.length) {
      await rememberDate(db, row.a_id, row.b_id, decided.ending).catch(() => {});
      // M14: learned memory is recomputed when a date AIRS (the reveal route / the watch room), not here —
      // a generated date is not yet revealed, and its arc is public, so counting it would spoil predictions.
      await db.query(`update generation_jobs set status = 'succeeded', error = null, updated_at = now() where episode_id = $1`, [episodeId]);
      trackEpisodeCost({
        episode_id: episodeId,
        model: row.use_frontier ? "frontier" : "free",
        model_calls: 1 + transcript.length + afterglow.length,
        ms: Date.now() - t0,
        transcript_turns: transcript.length,
      });
    } else {
      // The episode was already filled (another worker won) — leave it; mark the job done.
      await db.query(`update generation_jobs set status = 'succeeded', updated_at = now() where episode_id = $1`, [episodeId]);
    }
  } catch (err) {
    const reason = err instanceof ShowrunnerError ? err.reasons.join(", ") : err instanceof Error ? err.message : "unknown";
    console.warn("[jobs] generation failed for", episodeId, reason);
    track("generation_failed", { reason: "job", episode_id: episodeId });
    // A caught failure is terminal: narrateEpisode already retried internally, so a deterministic bad
    // output won't improve on another run. A failed date stores nothing and costs nothing — give the date
    // back, then delete the episode (which cascades its job). The poller sees it gone and offers a retry.
    // (Only a process crash *before* this catch leaves the job 'running'; the cron re-runs that once.)
    if (row.reservation) await releaseEpisode(db, row.creator_id, row.reservation).catch(() => {});
    await db.query(`delete from episodes where id = $1 and status = 'generating'`, [episodeId]);
  }
}

/** The cron backstop: claim and run up to `limit` stuck jobs (queued, or running past their lease). */
export async function runQueuedJobs(db: Db, now: Date = new Date(), limit = 5): Promise<number> {
  const { rows } = await db.query<{ episode_id: string }>(
    `select episode_id from generation_jobs
      where status = 'queued' or (status = 'running' and leased_until < $1)
      order by created_at
      limit $2`,
    [now.toISOString(), limit],
  );
  let ran = 0;
  for (const r of rows) {
    await runGenerationJob(db, r.episode_id, now);
    ran++;
  }
  return ran;
}

/** A short, content-free reason for a failed conversation (model error codes / which turn), for the logs. */
export function failureReason(err: unknown): string {
  if (err instanceof ConversationError) return err.reasons.slice(0, 4).join(", ").slice(0, 160);
  return err instanceof Error ? err.message.slice(0, 160) : "unknown";
}

/**
 * Gate for the internal job routes: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or the internal admin
 * token (x-jobs-token), both constant-time. Callers answer 404 when this is false, so they aren't public.
 */
export function internalJobAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.WATCH_ADMIN_TOKEN;
  const okCron = Boolean(cronSecret) && safeEqual(req.headers.get("authorization") ?? "", `Bearer ${cronSecret}`);
  const okAdmin = Boolean(adminToken) && safeEqual(req.headers.get("x-jobs-token") ?? "", adminToken ?? "");
  return okCron || okAdmin;
}
