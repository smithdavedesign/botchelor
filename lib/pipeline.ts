/**
 * The date-generation pipeline: everything that turns a built date + the engine's decided outcome into the
 * episode's words. One place for it, used by the async generation job (lib/jobs.ts), the template rooms
 * (lib/watch.ts) and the quality eval (lib/eval.ts), so all three produce dates the same way.
 *
 * The engine has already decided the outcome; nothing here can change it. The narration is the reliable part
 * (it fails closed: no recap, no episode); the turn-by-turn conversation and the afterglow are best-effort
 * (a failure leaves them empty and the date still airs).
 */
import { simulateAfterglow, type AfterglowLine } from "./afterglow";
import type { Character } from "./character";
import { simulateConversation, type Turn } from "./conversation";
import type { Outcome } from "./engine";
import type { FormatContext, FormatId } from "./formats";
import type { ChatMessage, Model, ModelOptions } from "./model";
import { narrateEpisode, type EpisodeDraft } from "./showrunner";
import type { BuiltDate } from "./simulation";

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

/** Generates the words for one date. Throws (ShowrunnerError) only when the narration fails. */
export async function generateDate(
  models: DateModels,
  built: BuiltDate,
  outcome: Outcome,
  opts: GenerateOptions,
): Promise<GeneratedDate> {
  const actor = countingModel(models.actor);
  const director = models.director === models.actor ? actor : countingModel(models.director);
  const characters: [Character, Character] = built.characters;
  const { producer, venue } = built.setup;

  const draft = await narrateEpisode(director.model, built.input, outcome, characters, producer, venue, opts.formatId, opts.formatCtx);

  let transcript: Turn[] = [];
  let conversationError: unknown = null;
  if (opts.conversation) {
    try {
      transcript = await simulateConversation(actor.model, built.input, outcome, characters, producer, venue, opts.formatId, undefined, opts.formatCtx);
    } catch (err) {
      conversationError = err;
    }
  }

  let afterglow: AfterglowLine[] = [];
  let afterglowError: unknown = null;
  if (opts.afterglow) {
    try {
      afterglow = await simulateAfterglow(actor.model, built.input, outcome, characters, venue, opts.formatId, undefined, opts.formatCtx);
    } catch (err) {
      afterglowError = err;
    }
  }

  const modelCalls = actor.calls() + (director === actor ? 0 : director.calls());
  return { draft, transcript, afterglow, modelCalls, conversationError, afterglowError };
}
