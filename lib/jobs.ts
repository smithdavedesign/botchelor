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
import { ensureHotTakes, fallbackHotTakes } from "./hot-takes";
import { fastStartOn, hotTakesWaitMs, settledWithin, speedDateActor, type DateTiming } from "./fast-date";
import { datePlanAtNightOn } from "./night-plans";
import { recordSlips } from "./cast-secrets";
import type { Db } from "./db";
import { safeEqual } from "./http";
import { pairNames } from "./names";
import { notify } from "./notifications";

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
import { decideTraced, type CharacterSheet } from "./engine";
import { DEFAULT_FORMAT, format as showFormat, formatContextOf } from "./formats";
import { claimPaidDate } from "./limits";
import { frontierConfigured, getDirectorModel, getFrontierModel, getModel, roleReasoning } from "./model";
import { buildKeyForSide } from "./keys";
import { isTalkLevel, talkFor, type TalkLevel } from "./talk";
import { soulText } from "./souls";
import {
  dateNumberOf,
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
import { logTurnDraft } from "./turn-drafts";

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
 * MOVE_CUTOFF_MS (a move adds up to a dozen lines). The lease outlasts the run, so a slow date is never run twice. A date
 * the deadline catches early still plays MIN_CLOCK_LINES (lib/conversation.ts, #1445) before it wraps up.
 */
export const DATE_DEADLINE_MS = 210_000;
/**
 * The heartbeat (2026-11-14 feedback: a date stalled at 3 lines for 11 minutes). A worker that dies mid-date (a deploy
 * restarting the server) held its job for the whole JOB_LEASE_SECONDS, and only the cron then picked it up. Once lines
 * are coming, each saved line renews the lease for this long instead (turns land seconds apart, a retried one well
 * inside this), so a dead writer is retaken a couple of minutes after its last line. Once the ending is decided, the
 * recap, texts and reflections that follow get the longer AFTER_OUTCOME_LEASE_SECONDS.
 */
export const TURN_LEASE_SECONDS = 150;
export const AFTER_OUTCOME_LEASE_SECONDS = 240;

/** Renew this run's lease (only while this attempt still holds the job, so a retaken job's lease is left alone). */
export async function renewLease(db: Db, episodeId: string, attempt: number, seconds: number, now: Date = new Date()): Promise<void> {
  await db.query(
    `update generation_jobs set leased_until = $3 where episode_id = $1 and status = 'running' and attempts = $2`,
    [episodeId, attempt, new Date(now.getTime() + seconds * 1000).toISOString()],
  );
}
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
  /** From the booking to this claim, on the database's clock (generated_with.timing). */
  queued_ms: number | null;
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
            round(extract(epoch from (j.updated_at - j.created_at)) * 1000)::int as queued_ms,
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
    // Living dates: a character with no hot takes yet gets them derived once, on the cheap default model, before its first
    // date that needs them (lib/hot-takes.ts). Never fails the date.
    // A fast date (lib/fast-date.ts) waits only so long for them: past that it plays this one date on the fallback takes
    // while the derivation finishes behind it and is stored for the next.
    const fast = fastStartOn(formatId);
    const takes = ensureHotTakes(db, [row.a_id, row.b_id], getModel("minimal", false)).catch(() => {});
    let takesInTime = true;
    if (fast) takesInTime = await settledWithin(takes, hotTakesWaitMs());
    else await takes;
    const built = await buildDate(db, episodeId, forDate("a"), forDate("b"), dateRequest, seed, signalsSnapshot, {
      creatorId: row.creator_id,
      followupOf: row.setup?.followup_of ?? null,
      dateNumber: dateNumberOf(row.setup),
      historyOverride: row.setup?.history ?? null,
      nudges: { a: row.setup?.nudge_a ?? null, b: row.setup?.nudge_b ?? null },
      avoidVenues: row.setup?.avoid_venues ?? [],
      venueOverride: row.setup?.venue,
      agreedPlan: row.setup?.agreed_plan ?? null,
      table: row.setup?.table ?? null,
      roleplay: row.setup?.roleplay ?? null,
    });
    if (!takesInTime) for (const c of built.characters) if (!c.hotTakes?.length) c.hotTakes = fallbackHotTakes(c);
    // Moves as booked: a date stored before them (no flag) runs without, like the format that keeps one table.
    built.setup.moves = row.setup?.moves === true;
    // Re-decide under the calibration POST stored (a deploy between POST and this worker can't change it).
    const { outcome: decided, trace } = decideTraced(built.input, built.seed, row.setup?.engine_version ?? 1);

    // Dates on the show's model always use the frontier when it's configured (David 2026-10-18, after
    // Cass×Dex's ten dates: no free model for a show date — the show always uses a capable paid model). The
    // daily cap stays as a stat (claimPaidDate still ticks for the admin's spend view) but no longer gates the
    // switch, so a busy day never silently drops into the free model. If the frontier isn't configured
    // (local dev, visitor sims), free is still used — the alternative is the show breaking everywhere a paid
    // key isn't set up — and the fall-through logs show_date_free so prod can alert.
    const useFrontier = Boolean(row.use_frontier) || frontierConfigured();
    const frontier = useFrontier ? getFrontierModel() : null;
    if (frontier && !row.use_frontier) await claimPaidDate(db).catch(() => false);
    // SPEED_DATE_MODEL / SPEED_DATE_REASONING (lib/fast-date.ts; both unset by default): a speed date's lines, answers,
    // texts and reflections on a faster model, the recap still on the show's. Never on an admin's A/B run.
    const speedActor = frontier && !row.use_frontier ? speedDateActor(formatId, frontier) : null;
    const models = frontier
      ? { actor: speedActor ?? frontier, director: frontier }
      : { actor: getModel(undefined, false), director: getDirectorModel(process.env, undefined, false) };
    if (!frontier) track("show_date_free", { episode_id: episodeId, configured: frontierConfigured() });
    const fmtCtx = formatContextOf(built);
    // BYOK: a creator's own saved key runs their side's lines (and a soulless partner's), never the plan or
    // recap (those see both souls). Off on an admin-approved A/B run (`row.use_frontier`) because that run
    // isolates the frontier model, but on by default on the show's regular frontier path — the owner's key
    // still reduces the show's spend on that side.
    let keyForSide: ((side: "a" | "b") => ReturnType<typeof getModel> | null) | undefined;
    const sides = await sideSettings(db, row.a_id, row.b_id);
    if (!row.use_frontier) {
      const owners = sides.owners;
      const reachable = built.characters.map((c) => Boolean(c.soul && !c.soul.local_only && (soulText(c.soul) ?? "").trim())) as [boolean, boolean];
      // A key at its cap, or failing mid-date, hands its side to the show's model (Connections M3): a date is never lost to a key.
      keyForSide = await buildKeyForSide(db, owners, reachable, roleReasoning("actor"), process.env, { fallback: models.actor });
    }
    // How long they talk (lib/talk.ts): the longer owner setting; marathon only with both sides on owners' keys.
    const talk = talkFor(sides.talk, Boolean(keyForSide?.("a") && keyForSide?.("b")), showFormat(formatId).turns);
    // A place they planned by text with no set yet: draw it while the date is filmed (lib/sets.ts). Never awaited.
    void ensureSet(db, built.setup.venue);
    // When each line was written (episodes.turn_meta), stamped as the theater saves it.
    const lineAt: string[] = [];
    // Set once the ending stands (onOutcome): the lease then covers the recap and texts still to come.
    let endingStands = false;
    // Per line, aligned with the transcript: when, and whether the show's model or an owner's own key spoke it. Every
    // write of the transcript writes this beside it, so the two are always the same length.
    const metaOf = (lines: readonly { side?: string }[], at: string) =>
      lines.map((t, i) => ({ at: lineAt[i] ?? at, by: keyForSide?.(t.side === "b" ? "b" : "a") ? "byok" : "show" }));
    // Lines the critic sent back and a revision replaced: stored as turn_drafts once the date is saved.
    const drafts: { turn_index: number; side: "a" | "b"; reason: string; rejected: string }[] = [];
    // When each part happened, from the claim (generated_with.timing): the next "where do the seconds go" is one query.
    const timing: DateTiming = { fast, queued_ms: row.queued_ms ?? null, setup_ms: Date.now() - t0, first_line_ms: null, last_line_ms: null, verdict_ms: null, written_ms: 0 };
    const gen = await generateDate(models, built, decided, {
      fast,
      // The plan at night (lib/night-plans.ts): a booked date has no stored plan, so it plays from the rules plan at
      // once, whatever its format. DATE_PLAN_AT_NIGHT=0 leaves this out, and the director is asked first as before.
      ...(datePlanAtNightOn() ? { plan: "rules" as const } : {}),
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
      // David 2026-10-20: each character's own say weighs in on how it ends (lib/wishes.ts); under engine v5 their own
      // answers decide, the engine the guardrail (lib/choices.ts, David 2026-11-01).
      wishes: true,
      engineVersion: row.setup?.engine_version ?? 1,
      onDraft: (d) => void drafts.push(d),
      // The early verdict (the 2026-11-14 core plan, PR3): the ending as it will stand, saved the moment the characters'
      // answers weighed in, so the creator's stage shows the verdict card while the recap, afterglow and reflections are
      // still being written. setup.ending_final tells the stage this ending is the real one (the booked ending on the row
      // was only the engine's first word). The finished date's write below still wins; a failed date is still deleted.
      onOutcome: (outcome, lines) => {
        endingStands = true;
        timing.verdict_ms = Date.now() - t0;
        void renewLease(db, episodeId, row!.attempts, AFTER_OUTCOME_LEASE_SECONDS).catch(() => {});
        return db
          .query(
            `update episodes
                set ending = $2, drama_question = $3, drama_answer = $4, sides = $5::jsonb,
                    transcript = coalesce($6::jsonb, transcript), turn_meta = coalesce($7::jsonb, turn_meta),
                    setup = coalesce(setup, '{}'::jsonb) || '{"ending_final":true}'::jsonb
              where id = $1 and status = 'generating'`,
            [
              episodeId,
              outcome.ending,
              outcome.drama_question,
              outcome.drama_answer,
              JSON.stringify(outcome.sides),
              // A conversation that failed has no lines here: the ones onTurn saved (and the backfill finishes from) stay.
              lines.length ? JSON.stringify(lines) : null,
              lines.length ? JSON.stringify(metaOf(lines, new Date().toISOString())) : null,
            ],
          )
          .then(() => {});
      },
      // The creator's theater plays the date while it's filmed: each line is saved as it's written (only the
      // creator sees a transcript before it airs, lib/game.ts), and the finished date overwrites it below.
      onTurn: (lines) => {
        while (lineAt.length < lines.length) lineAt.push(new Date().toISOString());
        timing.first_line_ms ??= Date.now() - t0;
        timing.last_line_ms = Date.now() - t0;
        // A move somewhere new: start drawing its set now, so it's there by the time they arrive (lib/sets.ts).
        const to = lines[lines.length - 1]?.move?.to;
        if (to) void ensureSet(db, to);
        // The heartbeat: this line renews the lease (a dead writer is retaken soon after its last line).
        void renewLease(db, episodeId, row!.attempts, endingStands ? AFTER_OUTCOME_LEASE_SECONDS : TURN_LEASE_SECONDS).catch(() => {});
        return db
          .query(`update episodes set transcript = $2::jsonb, turn_meta = $3::jsonb where id = $1 and status = 'generating'`, [
            episodeId,
            JSON.stringify(lines),
            JSON.stringify(metaOf(lines, new Date().toISOString())),
          ])
          .then(() => {});
      },
    });
    if (gen.conversationError) {
      track("conversation_failed", { episode_id: episodeId, where: "job", reason: failureReason(gen.conversationError) });
    }
    if (gen.quality) trackDateQuality(episodeId, "job", gen.plan?.source ?? null, gen.quality);
    const { draft, transcript, afterglow, reflections, outcome } = gen;
    // J1: when the conversation failed (even after picking up once), the lines already said stay on the date, flagged,
    // and the backfill finishes it from them (lib/backfill.ts) rather than the creator losing what they watched.
    const partial = !transcript.length && gen.partialTranscript.length > 0;
    const kept = partial ? gen.partialTranscript : transcript;
    // The stored lines' (empty when nothing came out, like the transcript; a backfill fills both later).
    const turnMeta = metaOf(kept, new Date().toISOString());
    timing.written_ms = Date.now() - t0;
    const generatedWith = { ...gen.generatedWith, ...(row.use_frontier ? { frontier: true } : {}), ...(partial ? { transcript_partial: true } : {}), plan: gen.plan?.source ?? null, timing };

    // The ending as it stands once the wishes weighed in (the engine's own, unless they tipped it), with its drama and sides.
    const saved = await db.query<{ id: string }>(
      `update episodes
          set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6,
              best_line = $7, confessionals = $8::jsonb, transcript = $9::jsonb, afterglow = $10::jsonb,
              reflections = $11::jsonb, generated_with = $12::jsonb, status = 'ready',
              ending = $13, drama_question = $14, drama_answer = $15, sides = $16::jsonb, wishes = $17::jsonb,
              engine_trace = coalesce(engine_trace, $18::jsonb), turn_meta = $19::jsonb, inner_life = $20::jsonb,
              ending_detail = $21
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
        JSON.stringify(kept),
        JSON.stringify(afterglow),
        JSON.stringify(reflections),
        // Which models actually wrote it (by role, fallbacks included) and the prompt version: traceable quality.
        JSON.stringify(generatedWith),
        outcome.ending,
        outcome.drama_question,
        outcome.drama_answer,
        JSON.stringify(outcome.sides),
        gen.wishes ? JSON.stringify(gen.wishes) : null,
        // A date booked before traces existed gets one now (same inputs, same outcome); a stored one is kept.
        trace ? JSON.stringify(trace) : null,
        JSON.stringify(turnMeta),
        // Living dates: each line's private feeling and thought, and each side's own answer (shown only once it airs).
        gen.inner && !partial ? JSON.stringify(gen.inner) : null,
        // More endings: which kind of its ending it had (lib/ending-detail.ts), decided before it's ready.
        partial ? null : gen.endingDetail,
      ],
    );
    if (saved.rows.length) {
      for (const d of drafts) await logTurnDraft(db, { episodeId, turnIndex: d.turn_index, side: d.side, source: "critic", reason: d.reason, rejected: d.rejected });
      await rememberDate(db, row.a_id, row.b_id).catch(() => {});
      // A cast secret a line let slip (living dates): out once this date airs publicly (lib/cast-secrets.ts).
      if (!partial && gen.slips.length) await recordSlips(db, episodeId, gen.slips).catch(() => {});
      await logSceneRequests(db, episodeId, built.setup, transcript);
      await settleSuggestions(db, episodeId, transcript);
      trackMoves(episodeId, transcript, "show");
      // M14: learned memory is recomputed when a date AIRS (the reveal route / the watch room), not here —
      // a generated date is not yet revealed, and its arc is public, so counting it would spoil predictions.
      await db.query(`update generation_jobs set status = 'succeeded', error = null, updated_at = now() where episode_id = $1`, [episodeId]);
      await notifyIfAsked(db, episodeId, row.a_name, row.b_name).catch(() => {});
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

/**
 * The creator asked to hear when it's filmed (POST /api/episodes/[id]/notify-ready, offered when a date runs long):
 * one notification, kind date_filmed, linking the theater. Only when they asked: most creators are watching it live.
 */
export async function notifyIfAsked(db: Db, episodeId: string, aName: string, bName: string): Promise<boolean> {
  const { rows } = await db.query<{ creator_id: string | null }>(
    `select creator_id from episodes where id = $1 and status = 'ready' and coalesce((setup->>'notify_ready')::boolean, false)`,
    [episodeId],
  );
  const creator = rows[0]?.creator_id;
  if (!creator) return false;
  const [a, b] = pairNames(aName, bName);
  await notify(db, creator, { kind: "date_filmed", title: `${a} and ${b}'s date is filmed`, body: "It's ready to watch, ending and all.", link: `/episodes/${episodeId}?play=1` });
  return true;
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
 * Gate for the internal job routes: the scheduled job's `Authorization: Bearer $CRON_SECRET`, or the internal admin
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
