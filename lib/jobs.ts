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
import { track, trackDateQuality, trackEpisodeCost } from "./analytics";
import { ConversationError } from "./conversation";
import { generationPaused } from "./compute";
import { isConversationEnabled } from "./conversation";
import { isAfterglowEnabled } from "./afterglow";
import { isReflectionEnabled } from "./reflection";
import { generateDate } from "./pipeline";
import type { Db } from "./db";
import { safeEqual } from "./http";

/** Each side's owner (null for a house character) and talk setting (lib/talk.ts), in side order. */
async function sideSettings(
  db: Db,
  aId: string,
  bId: string,
): Promise<{ owners: [string | null, string | null]; talk: [TalkLevel | null, TalkLevel | null] }> {
  const { rows } = await db.query<{ id: string; owner_id: string | null; talk: string | null }>(
    `select id, owner_id, talk from characters where id = any($1)`,
    [[aId, bId]],
  );
  const row = (id: string) => rows.find((r) => r.id === id);
  const talk = (id: string) => {
    const t = row(id)?.talk;
    return isTalkLevel(t) ? t : null;
  };
  return { owners: [row(aId)?.owner_id ?? null, row(bId)?.owner_id ?? null], talk: [talk(aId), talk(bId)] };
}
import { getEngine, type CharacterSheet } from "./engine";
import { DEFAULT_FORMAT, format as showFormat } from "./formats";
import { claimPaidDate } from "./limits";
import { frontierConfigured, getDirectorModel, getFrontierModel, getModel, roleReasoning } from "./model";
import { buildKeyForSide } from "./keys";
import { isTalkLevel, talkFor, type TalkLevel } from "./talk";
import { soulText } from "./souls";
import {
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
} from "./rules";
import { markProposed, pendingSuggestion, settleSuggestions } from "./scene-suggestions";
import { ensureSet } from "./sets";
import { logSceneRequests, trackMoves } from "./scenes";
import { buildDate, rememberDate, type CharacterForDate, type DateRequest } from "./simulation";
import { ShowrunnerError } from "./showrunner";
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
export const JOB_LEASE_SECONDS = 330;
/**
 * A date has to finish inside one function run (maxDuration 300s) with time left for the recap, the morning after and
 * the reflections: its conversation wraps up by DATE_DEADLINE_MS after the job starts, and no new move is proposed after
 * MOVE_CUTOFF_MS (a move adds up to a dozen lines). The lease outlasts the run, so a slow date is never run twice.
 */
export const DATE_DEADLINE_MS = 210_000;
export const MOVE_CUTOFF_MS = 150_000;
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
  a_id: string; a_name: string; a_age: number; a_bio: string; a_traits: string[]; a_want: string; a_dealbreaker: string; a_house: boolean; a_appearance: string | null; a_pronouns: string | null; a_voice: string | null;
  b_id: string; b_name: string; b_age: number; b_bio: string; b_traits: string[]; b_want: string; b_dealbreaker: string; b_house: boolean; b_appearance: string | null; b_pronouns: string | null; b_voice: string | null;
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
  pronouns: r[`${p}_pronouns`] ?? undefined,
  voice: r[`${p}_voice`] ?? undefined,
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
            a.dealbreaker a_dealbreaker, a.is_house a_house, a.appearance a_appearance, a.pronouns a_pronouns, a.voice a_voice,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
            b.dealbreaker b_dealbreaker, b.is_house b_house, b.appearance b_appearance, b.pronouns b_pronouns, b.voice b_voice
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
    // The sheets POST decided with (snapshotted on the setup), so an edit made while the job waited can't change it.
    const forDate = (p: "a" | "b"): CharacterForDate => ({ id: row![`${p}_id`], sheet: row!.setup?.[`sheet_${p}`] ?? sheet(row!, p) });
    // Re-decide on the EXACT signals POST stored (M14 part 2 snapshot), so a character's memory drifting
    // between POST and this worker can't change the canonical outcome the narration is steered toward.
    const signalsSnapshot =
      row.setup?.signals_a && row.setup?.signals_b ? { a: row.setup.signals_a, b: row.setup.signals_b } : undefined;
    // ...and on the pair's history as POST stored it (a date between them since can't change tonight's start).
    const built = await buildDate(db, episodeId, forDate("a"), forDate("b"), dateRequest, seed, signalsSnapshot, {
      creatorId: row.creator_id,
      followupOf: row.setup?.followup_of ?? null,
      historyOverride: row.setup?.history ?? null,
      nudges: { a: row.setup?.nudge_a ?? null, b: row.setup?.nudge_b ?? null },
      avoidVenues: row.setup?.avoid_venues ?? [],
      venueOverride: row.setup?.venue,
      agreedPlan: row.setup?.agreed_plan ?? null,
    });
    // Moves as booked: a date stored before them (no flag) runs without, like the format that keeps one table.
    built.setup.moves = row.setup?.moves === true;
    // Re-decide under the calibration POST stored (a deploy between POST and this worker can't change it).
    const decided = getEngine().decide(built.input, built.seed, row.setup?.engine_version ?? 1);

    // Dates on the show's model always use the frontier when it's configured (David 2026-10-18, after
    // Cass×Dex's ten dates: no free model for a show date — the show always uses a capable paid model). The
    // daily cap stays as a stat (claimPaidDate still ticks for the admin's spend view) but no longer gates the
    // switch, so a busy day never silently drops into the free model. If the frontier isn't configured
    // (local dev, visitor sims), free is still used — the alternative is the show breaking everywhere a paid
    // key isn't set up — and the fall-through logs show_date_free so prod can alert.
    const useFrontier = Boolean(row.use_frontier) || frontierConfigured();
    const frontier = useFrontier ? getFrontierModel() : null;
    if (frontier && !row.use_frontier) await claimPaidDate(db).catch(() => false);
    const models = frontier
      ? { actor: frontier, director: frontier }
      : { actor: getModel(undefined, false), director: getDirectorModel(process.env, undefined, false) };
    if (!frontier) track("show_date_free", { episode_id: episodeId, configured: frontierConfigured() });
    const fmtCtx = { chaperone: built.setup.chaperone, ex: built.setup.ex };
    // BYOK: a creator's own saved key runs their side's lines (and a soulless partner's), never the plan or
    // recap (those see both souls). Off on an admin-approved A/B run (`row.use_frontier`) because that run
    // isolates the frontier model, but on by default on the show's regular frontier path — the owner's key
    // still reduces the show's spend on that side.
    let keyForSide: ((side: "a" | "b") => ReturnType<typeof getModel> | null) | undefined;
    const sides = await sideSettings(db, row.a_id, row.b_id);
    if (!row.use_frontier) {
      const owners = sides.owners;
      const reachable = built.characters.map((c) => Boolean(c.soul && !c.soul.local_only && (soulText(c.soul) ?? "").trim())) as [boolean, boolean];
      keyForSide = await buildKeyForSide(db, owners, reachable, roleReasoning("actor"));
    }
    // How long they talk (lib/talk.ts): the longer owner setting; marathon only with both sides on owners' keys.
    const talk = talkFor(sides.talk, Boolean(keyForSide?.("a") && keyForSide?.("b")), showFormat(formatId).turns);
    // A place they planned by text with no set yet: draw it while the date is filmed (lib/sets.ts). Never awaited.
    void ensureSet(db, built.setup.venue);
    const gen = await generateDate(models, built, decided, {
      formatId,
      talk,
      formatCtx: fmtCtx,
      conversation: isConversationEnabled(),
      afterglow: isAfterglowEnabled(),
      reflection: isReflectionEnabled(),
      keyForSide,
      moves: built.setup.moves,
      moveCutoff: t0 + MOVE_CUTOFF_MS,
      deadline: t0 + DATE_DEADLINE_MS,
      // Set the scene (lib/scene-suggestions.ts): the creator's paid place, read before each line that could propose it.
      suggestion: () => pendingSuggestion(db, episodeId),
      onSuggestionProposed: (id) => markProposed(db, id),
      // David 2026-10-20: each character's own last read of the other weighs in on how it ends (lib/wishes.ts).
      wishes: true,
      // The creator's theater plays the date while it's filmed: each line is saved as it's written (only the
      // creator sees a transcript before it airs, lib/game.ts), and the finished date overwrites it below.
      onTurn: (lines) => {
        // A move somewhere new: start drawing its set now, so it's there by the time they arrive (lib/sets.ts).
        const to = lines[lines.length - 1]?.move?.to;
        if (to) void ensureSet(db, to);
        return db.query(`update episodes set transcript = $2::jsonb where id = $1 and status = 'generating'`, [episodeId, JSON.stringify(lines)]).then(() => {});
      },
    });
    if (gen.conversationError) {
      track("conversation_failed", { episode_id: episodeId, where: "job", reason: failureReason(gen.conversationError) });
    }
    if (gen.quality) trackDateQuality(episodeId, "job", gen.plan?.source ?? null, gen.quality);
    const { draft, transcript, afterglow, reflections, outcome } = gen;

    // The ending as it stands once the wishes weighed in (the engine's own, unless they tipped it), with its drama and sides.
    const saved = await db.query<{ id: string }>(
      `update episodes
          set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6,
              best_line = $7, confessionals = $8::jsonb, transcript = $9::jsonb, afterglow = $10::jsonb,
              reflections = $11::jsonb, generated_with = $12::jsonb, status = 'ready',
              ending = $13, drama_question = $14, drama_answer = $15, sides = $16::jsonb, wishes = $17::jsonb
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
        JSON.stringify(reflections),
        // Which models actually wrote it (by role, fallbacks included) and the prompt version: traceable quality.
        JSON.stringify(row.use_frontier ? { ...gen.generatedWith, frontier: true } : gen.generatedWith),
        outcome.ending,
        outcome.drama_question,
        outcome.drama_answer,
        JSON.stringify(outcome.sides),
        gen.wishes ? JSON.stringify(gen.wishes) : null,
      ],
    );
    if (saved.rows.length) {
      await rememberDate(db, row.a_id, row.b_id).catch(() => {});
      await logSceneRequests(db, episodeId, built.setup, transcript);
      await settleSuggestions(db, episodeId, transcript);
      trackMoves(episodeId, transcript, "show");
      // M14: learned memory is recomputed when a date AIRS (the reveal route / the watch room), not here —
      // a generated date is not yet revealed, and its arc is public, so counting it would spoil predictions.
      await db.query(`update generation_jobs set status = 'succeeded', error = null, updated_at = now() where episode_id = $1`, [episodeId]);
      trackEpisodeCost({
        episode_id: episodeId,
        where: "job",
        model: row.use_frontier ? "frontier" : "free",
        model_calls: gen.modelCalls,
        ms: Date.now() - t0,
        transcript_turns: transcript.length,
        usage: gen.usage,
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
    // A scene they set and never reached: its token back before the episode (and the suggestion with it) goes.
    await settleSuggestions(db, episodeId, []);
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

/**
 * #253: a date whose generation died (the after() worker crashed or the function was cut off) only got the daily
 * cron. Anyone waiting on it now restarts it: a job still queued after a minute and a half, or running past its
 * lease, is run again. claim() makes a second runner a no-op, so it's safe to call from every wait.
 */
export async function rescueStuckJob(db: Db, episodeId: string, now: Date = new Date()): Promise<boolean> {
  const stuck = (
    await db.query(
      `select 1 from generation_jobs
        where episode_id = $1
          and ((status = 'queued' and created_at < $2) or (status = 'running' and leased_until < $3))`,
      [episodeId, new Date(now.getTime() - 90_000).toISOString(), now.toISOString()],
    )
  ).rows.length > 0;
  if (!stuck) return false;
  const run = () => runGenerationJob(db, episodeId).catch(() => {});
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    void run(); // outside a request (a script, a test): just run it
  }
  return true;
}
