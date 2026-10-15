/**
 * The date-generation pipeline: everything that turns a built date + the engine's decided outcome into the
 * episode's words. One place for it, used by the async generation job (lib/jobs.ts), the template rooms
 * (lib/watch.ts) and the quality eval (lib/eval.ts), so all three produce dates the same way.
 *
 * Order (M15, docs/date-quality.md):
 *   1. plan       — the director turns the engine's reasons into a beat sheet (lib/beats.ts). Best-effort:
 *                   falls back to the deterministic rules plan.
 *   2. conversation — the two agents play the date turn by turn from their beats (lib/conversation.ts).
 *                   Best-effort: a failure leaves it empty.
 *   3. recap      — the narration, written FROM the conversation when there is one, so the recap and the lines
 *                   agree and the best line is a line that was actually said. Fails closed: no recap, no episode.
 *   4. afterglow  — the morning-after texts, which now remember the date. Best-effort.
 *
 * The engine has already decided the outcome; nothing here can change it.
 */
import { simulateAfterglow, type AfterglowLine } from "./afterglow";
import { planDate, type DatePlan } from "./beats";
import type { Character } from "./character";
import { simulateConversation, type Turn } from "./conversation";
import type { Outcome } from "./engine";
import type { FormatContext, FormatId } from "./formats";
import type { ChatMessage, Model, ModelOptions } from "./model";
import { transcriptQuality, type QualityMetrics } from "./quality";
import { agenda } from "./rules";
import { narrateEpisode, type EpisodeDraft } from "./showrunner";
import type { BuiltDate } from "./simulation";
import { venue } from "./venues";

/** The models a date is generated with: the actor speaks the turns, the director plans and narrates. */
export type DateModels = { actor: Model; director: Model };

export type GenerateOptions = {
  formatId: FormatId;
  formatCtx: FormatContext;
  /** Run the turn-by-turn conversation (best-effort). */
  conversation: boolean;
  /** Run the morning-after texts (best-effort). */
  afterglow: boolean;
};

export type GeneratedDate = {
  draft: EpisodeDraft;
  transcript: Turn[];
  afterglow: AfterglowLine[];
  /** The beat sheet the conversation was played from (null when there was no conversation). */
  plan: DatePlan | null;
  /** The free genuineness metrics for the conversation (lib/quality.ts); null without one. */
  quality: QualityMetrics | null;
  /** Exactly how many model calls this date took (retries included): the unit-economics number. */
  modelCalls: number;
  /** Why the conversation came back empty, when it did (content-free; for the logs). */
  conversationError: unknown;
  afterglowError: unknown;
};

/** Wraps a model so every call (retries included) is counted. */
export function countingModel(model: Model): { model: Model; calls: () => number } {
  let n = 0;
  return {
    model: {
      complete(messages: ChatMessage[], options?: ModelOptions) {
        n++;
        return model.complete(messages, options);
      },
    },
    calls: () => n,
  };
}

/** Generates the words for one date. Throws (ShowrunnerError) only when the recap fails on every model. */
export async function generateDate(
  models: DateModels,
  built: BuiltDate,
  outcome: Outcome,
  opts: GenerateOptions,
): Promise<GeneratedDate> {
  const actor = countingModel(models.actor);
  const director = models.director === models.actor ? actor : countingModel(models.director);
  const characters: [Character, Character] = built.characters;
  const { producer, venue: venueId } = built.setup;

  let plan: DatePlan | null = null;
  let transcript: Turn[] = [];
  let conversationError: unknown = null;
  if (opts.conversation) {
    // A director that is down (a stronger free model at its quota) costs nothing: planDate falls back to rules.
    plan = await planDate(director.model, built.input, outcome, characters, producer, venueId, opts.formatId, opts.formatCtx);
    try {
      transcript = await simulateConversation(actor.model, built.input, outcome, characters, producer, venueId, opts.formatId, undefined, opts.formatCtx, plan);
    } catch (err) {
      conversationError = err;
    }
  }

  // The recap: on the director, from what was actually said; on the actor's model if the director can't.
  const story = { transcript, plan };
  let draft: EpisodeDraft;
  try {
    draft = await narrateEpisode(director.model, built.input, outcome, characters, producer, venueId, opts.formatId, opts.formatCtx, story);
  } catch (err) {
    if (director === actor) throw err;
    draft = await narrateEpisode(actor.model, built.input, outcome, characters, producer, venueId, opts.formatId, opts.formatCtx, story);
  }

  let afterglow: AfterglowLine[] = [];
  let afterglowError: unknown = null;
  if (opts.afterglow) {
    try {
      afterglow = await simulateAfterglow(actor.model, built.input, outcome, characters, venueId, opts.formatId, undefined, opts.formatCtx, transcript);
    } catch (err) {
      afterglowError = err;
    }
  }

  const quality = transcript.length
    ? transcriptQuality(transcript, characters, {
        pronouns: [characters[0].pronouns, characters[1].pronouns],
        shared: `${venue(venueId).prompt} ${draft.setting}`,
        secrets: [
          [agenda(built.input.a.agendaId).label, built.input.a.note ?? ""].filter(Boolean),
          [agenda(built.input.b.agendaId).label, built.input.b.note ?? ""].filter(Boolean),
        ],
      })
    : null;

  const modelCalls = actor.calls() + (director === actor ? 0 : director.calls());
  return { draft, transcript, afterglow, plan, quality, modelCalls, conversationError, afterglowError };
}
