/**
 * Backfill the line-by-line conversation for dates that don't have one: dates made before the turn-by-turn
 * conversation existed (M9), or whose best-effort conversation failed at generation time. Without it a date
 * can't play line by line in a watch room or replay — only its act summaries show.
 *
 * Fairness is the point of the design: the conversation is steered onto the date's STORED outcome (the ending,
 * the box score and each side's private verdict already on the episode), never a re-decided one. So a
 * backfill can't change an ending, a box score or a single scored prediction, even for an old date whose
 * characters' souls or learned memory have changed since. The characters speak without their learned memory
 * too, so an old date doesn't "remember" dates that happened after it.
 *
 * Run by the daily job a few dates at a time (free model, $0). Each date is tried at most
 * BACKFILL_MAX_ATTEMPTS times (rate limits excepted), so one the model keeps failing on stops costing calls.
 */
import { track, trackEpisodeCost } from "./analytics";
import type { Character } from "./character";
import { generationPaused } from "./compute";
import { ConversationError, isConversationEnabled, simulateConversation, type Turn } from "./conversation";
import type { Db } from "./db";
import type { CharacterSheet, Outcome, SideOutcome, VariableArc } from "./engine";
import { DEFAULT_FORMAT } from "./formats";
import type { DateSetup } from "./game";
import { failureReason } from "./jobs";
import { claimPaidDate } from "./limits";
import { getDirectorModel, getModel, paidDefaultOn, type Model } from "./model";
import { PROMPT_VERSION, countingModel } from "./pipeline";
import { summarizeUsage } from "./pricing";
import { planDate } from "./beats";
import {
  DATE_VARIABLES,
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
  type DateVariable,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
} from "./rules";
import { buildDate, type CharacterForDate, type DateRequest } from "./simulation";

export const BACKFILL_MAX_ATTEMPTS = 3;

type Row = {
  id: string;
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  ending: Ending;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  box_score: Record<DateVariable, VariableArc> | null;
  sides: [SideOutcome, SideOutcome] | null;
  a_id: string; a_name: string; a_age: number; a_bio: string; a_traits: string[]; a_want: string; a_dealbreaker: string; a_house: boolean; a_appearance: string | null; a_pronouns: string | null; a_voice: string | null;
  b_id: string; b_name: string; b_age: number; b_bio: string; b_traits: string[]; b_want: string; b_dealbreaker: string; b_house: boolean; b_appearance: string | null; b_pronouns: string | null; b_voice: string | null;
};

const sheet = (r: Row, p: "a" | "b"): CharacterSheet => ({
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

/** For dates stored before per-side verdicts existed: both sides feel the way the shared ending went. */
function sidesFromEnding(ending: Ending): [SideOutcome, SideOutcome] {
  const keen = ending === "second_date";
  const side: SideOutcome = { wants_another: keen, agenda_met: keen, satisfied: ending !== "disaster", dealbreaker_hit: null, want_met: null, note_followed: null };
  return [side, { ...side }];
}

/** The outcome as it was stored and aired — the only thing a backfilled conversation may land on. */
export function storedOutcome(r: Row, seed: number): Outcome {
  const flat = (n: number): VariableArc => ({ start: n, delta: 0, final: n });
  const variables =
    r.box_score ?? (Object.fromEntries(DATE_VARIABLES.map((v) => [v, flat(50)])) as Record<DateVariable, VariableArc>);
  return {
    ending: r.ending,
    drama_question: r.drama_question ?? "leaves_first",
    drama_answer: r.drama_answer ?? "neither",
    variables,
    sides: r.sides ?? sidesFromEnding(r.ending),
    seed,
  };
}

/** Produce the missing conversation for one stored date, steered to its stored outcome. Throws on failure. */
async function conversationFor(db: Db, r: Row, actor: Model, director: Model): Promise<Turn[]> {
  const seed = r.seed === null ? undefined : Number(r.seed);
  const format = r.setup?.format ?? DEFAULT_FORMAT;
  const req: DateRequest = {
    autonomy: r.setup?.autonomy ?? DEFAULT_AUTONOMY,
    strategy: r.setup?.strategy ?? DEFAULT_STRATEGY,
    gameBudget: r.setup?.game_budget_a ?? DEFAULT_GAME_BUDGET,
    agendaId: r.setup?.agenda_a ?? null,
    note: r.note,
    format,
  };
  const forDate = (p: "a" | "b"): CharacterForDate => ({ id: r[`${p}_id`], sheet: sheet(r, p) });
  const snapshot = r.setup?.signals_a && r.setup?.signals_b ? { a: r.setup.signals_a, b: r.setup.signals_b } : undefined;
  // An old date re-decides on the history it ran on: its snapshot, or (before snapshots) dates and last ending only.
  const built = await buildDate(db, r.id, forDate("a"), forDate("b"), req, seed, snapshot, { historyOverride: r.setup?.history, legacyHistory: true, nudges: { a: r.setup?.nudge_a ?? null, b: r.setup?.nudge_b ?? null }, avoidVenues: r.setup?.avoid_venues ?? [], venueOverride: r.setup?.venue });
  // An old date's characters speak as they were then: no memory of dates that came after it.
  const characters = built.characters.map((c) => ({ ...c, memory: null })) as [Character, Character];
  const outcome = storedOutcome(r, built.seed);
  const producer = r.setup?.producer ?? built.setup.producer;
  const venueId = r.setup?.venue ?? built.setup.venue;
  const formatCtx = { chaperone: r.setup?.chaperone, ex: r.setup?.ex };
  // Played from a beat sheet of the STORED outcome, like a fresh date (lib/beats.ts).
  const plan = await planDate(director, built.input, outcome, characters, producer, venueId, format, formatCtx);
  return simulateConversation(actor, built.input, outcome, characters, producer, venueId, format, undefined, formatCtx, plan);
}

/** The free tier said "slow down" (a 429 that outlasted the model client's own short backoff). */
export function isRateLimited(err: unknown): boolean {
  return err instanceof ConversationError && err.reasons.some((r) => r.includes("HTTP 429"));
}

export type BackfillResult = { filled: string[]; failed: string[]; rate_limited?: boolean };

/**
 * Backfill up to `limit` dates that have no conversation, newest first. Only the transcript is written, and
 * only while it is still empty, so a concurrent fill or a re-run is a no-op. A rate limit is not the date's
 * fault: it costs the date no try and ends this batch (pushing on would only hit the same quota), so the
 * next run picks up where this one stopped.
 */
export async function backfillTranscripts(db: Db, limit = 2): Promise<BackfillResult> {
  const filled: string[] = [];
  const failed: string[] = [];
  if (limit <= 0 || generationPaused() || !isConversationEnabled()) return { filled, failed };

  const { rows } = await db.query<Row>(
    `select e.id, e.seed::text as seed, e.setup, e.note, e.ending, e.drama_question, e.drama_answer, e.box_score, e.sides,
            a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want,
            a.dealbreaker a_dealbreaker, a.is_house a_house, a.appearance a_appearance, a.pronouns a_pronouns, a.voice a_voice,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
            b.dealbreaker b_dealbreaker, b.is_house b_house, b.appearance b_appearance, b.pronouns b_pronouns, b.voice b_voice
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.status = 'ready' and jsonb_array_length(e.transcript) = 0 and e.backfill_failures < $1
      order by e.created_at desc, e.id
      limit $2`,
    [BACKFILL_MAX_ATTEMPTS, limit],
  );

  for (const r of rows) {
    const t0 = Date.now();
    // Backfills share the paid default's daily cap with everyone's dates (lib/limits.ts).
    const paid = paidDefaultOn() ? await claimPaidDate(db) : false;
    const actor = countingModel(getModel(undefined, paid));
    const director = countingModel(getDirectorModel(process.env, undefined, paid));
    try {
      const transcript = await conversationFor(db, r, actor.model, director.model);
      // The transcript was written later, by these models: recorded beside whatever wrote the rest (lib/pipeline.ts).
      const backfilledWith = { actor: actor.served(), director: director.served(), prompts: PROMPT_VERSION };
      await db.query(
        `update episodes set transcript = $2::jsonb,
                generated_with = coalesce(generated_with, '{}'::jsonb) || jsonb_build_object('transcript_backfill', $3::jsonb)
          where id = $1 and jsonb_array_length(transcript) = 0`,
        [r.id, JSON.stringify(transcript), JSON.stringify(backfilledWith)],
      );
      filled.push(r.id);
      const calls = actor.calls() + director.calls();
      trackEpisodeCost({
        episode_id: r.id,
        where: "backfill",
        model: "free",
        model_calls: calls,
        ms: Date.now() - t0,
        transcript_turns: transcript.length,
        usage: summarizeUsage([...actor.usage(), ...director.usage()], calls),
      });
    } catch (err) {
      track("conversation_failed", { episode_id: r.id, where: "backfill", reason: failureReason(err) });
      if (isRateLimited(err)) return { filled, failed, rate_limited: true };
      await db.query(`update episodes set backfill_failures = backfill_failures + 1 where id = $1`, [r.id]);
      failed.push(r.id);
    }
  }
  return { filled, failed };
}
