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
import type { ChatMessage, Model, ModelOptions, Usage } from "./model";
import { sharedHistory } from "./memory";
import { simulateReflections, type Reflections } from "./reflection";
import { summarizeUsage, type DateUsage } from "./pricing";
import { transcriptQuality, type QualityContext, type QualityMetrics } from "./quality";
import { agenda } from "./rules";
import { narrateEpisode, type EpisodeDraft } from "./showrunner";
import type { BuiltDate } from "./simulation";
import { venue } from "./venues";

/**
 * The version of the date's prompts (the actor, director, narrator, reflection and afterglow prompts, and what each
 * is handed). Recorded on every generated date with the models that wrote it, so a change in quality can be traced
 * to a prompt or a model. Bump it whenever a prompt or its data changes.
 */
export const PROMPT_VERSION = "2026-10-16.relationship-graph";

/** Which models wrote a date, by role (whichever actually answered, fallbacks included), and with which prompts. */
export type GeneratedWith = { actor: string[]; director: string[]; byok: string[]; prompts: string };

/** The models a date is generated with: the actor speaks the turns, the director plans and narrates. */
export type DateModels = { actor: Model; director: Model };

export type GenerateOptions = {
  formatId: FormatId;
  formatCtx: FormatContext;
  /** Run the turn-by-turn conversation (best-effort). */
  conversation: boolean;
  /** Run the morning-after texts (best-effort). */
  afterglow: boolean;
  /** Run each character's post-date reflection (best-effort; lib/reflection.ts). */
  reflection: boolean;
  /**
   * BYOK: the model for a given side's actor turns (and afterglow texts), or null for the platform model.
   * A side's prompt only ever carries that side's own soul, so a user's key never sees another user's
   * private soul. The plan and recap (which see both souls) always stay on the platform director.
   */
  keyForSide?: (side: "a" | "b") => Model | null;
  /** How long the date and the texts after run (lib/talk.ts); the format's own length (or the standard) when absent. */
  talk?: { date: number; texts: number };
};

export type GeneratedDate = {
  draft: EpisodeDraft;
  transcript: Turn[];
  afterglow: AfterglowLine[];
  /** Each character's post-date reflection (null per side when it couldn't be produced). */
  reflections: Reflections;
  /** The beat sheet the conversation was played from (null when there was no conversation). */
  plan: DatePlan | null;
  /** The free genuineness metrics for the conversation (lib/quality.ts); null without one. */
  quality: QualityMetrics | null;
  /** Exactly how many model calls this date took (retries included): the unit-economics number. */
  modelCalls: number;
  /** The tokens those calls used (thinking included) and what they'd cost at paid-tier prices (lib/pricing.ts). */
  usage: DateUsage;
  /** Which models actually wrote it (by role) and the prompt version: stored on the episode (generated_with). */
  generatedWith: GeneratedWith;
  /** Why the conversation came back empty, when it did (content-free; for the logs). */
  conversationError: unknown;
  afterglowError: unknown;
};

/** Wraps a model so every call (retries included) is counted, along with the tokens each one reports. */
export function countingModel(model: Model): { model: Model; calls: () => number; usage: () => Usage[]; served: () => string[] } {
  let n = 0;
  const usage: Usage[] = [];
  const served = new Set<string>();
  return {
    model: {
      complete(messages: ChatMessage[], options?: ModelOptions) {
        n++;
        return model.complete(messages, {
          ...options,
          onUsage: (u) => {
            usage.push(u);
            options?.onUsage?.(u);
          },
          onModel: (id) => {
            served.add(id);
            options?.onModel?.(id);
          },
        });
      },
    },
    calls: () => n,
    usage: () => usage,
    served: () => [...served],
  };
}

/** Wraps a BYOK side's model so the models that actually answered are recorded (never anything else about the key). */
function recording(model: Model, into: Set<string>): Model {
  return {
    complete: (messages, options) => model.complete(messages, { ...options, onModel: (id) => (into.add(id), options?.onModel?.(id)) }),
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
  const byokServed = new Set<string>();
  const keyForSide = opts.keyForSide
    ? (side: "a" | "b") => {
        const m = opts.keyForSide!(side);
        return m ? recording(m, byokServed) : null;
      }
    : undefined;
  const characters: [Character, Character] = built.characters;
  const { producer, venue: venueId } = built.setup;

  let plan: DatePlan | null = null;
  let transcript: Turn[] = [];
  let conversationError: unknown = null;
  if (opts.conversation) {
    // A director that is down (a stronger free model at its quota) costs nothing: planDate falls back to rules.
    plan = await planDate(director.model, built.input, outcome, characters, producer, venueId, opts.formatId, opts.formatCtx);
    try {
      transcript = await simulateConversation(actor.model, built.input, outcome, characters, producer, venueId, opts.formatId, opts.talk?.date, opts.formatCtx, plan, keyForSide);
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
      afterglow = await simulateAfterglow(actor.model, built.input, outcome, characters, venueId, opts.formatId, opts.talk?.texts, opts.formatCtx, transcript, keyForSide);
    } catch (err) {
      afterglowError = err;
    }
  }

  // Each character's own postmortem. Best-effort and never throws (nulls on failure), so it can't cost a date.
  const reflections: Reflections = opts.reflection
    ? await simulateReflections(actor.model, built.input, outcome, characters, venueId, opts.formatId, opts.formatCtx, transcript, keyForSide)
    : { a: null, b: null };

  const quality = transcript.length ? transcriptQuality(transcript, characters, qualityContext(built, draft.setting)) : null;

  const modelCalls = actor.calls() + (director === actor ? 0 : director.calls());
  const usage = summarizeUsage([...actor.usage(), ...(director === actor ? [] : director.usage())], modelCalls);
  const generatedWith: GeneratedWith = {
    actor: actor.served(),
    director: director.served(),
    byok: [...byokServed],
    prompts: PROMPT_VERSION,
  };
  return { draft, transcript, afterglow, reflections, plan, quality, modelCalls, usage, generatedWith, conversationError, afterglowError };
}

/** What the quality checks treat as shared (the venue, the recap's setting) and as each side's private notes. */
export function qualityContext(built: BuiltDate, setting: string): QualityContext {
  const [a, b] = built.characters;
  return {
    pronouns: [a.pronouns, b.pronouns],
    shared: `${venue(built.setup.venue).prompt} ${setting} ${sharedHistory(a.memory, b.id)} ${sharedHistory(b.memory, a.id)}`,
    secrets: [
      [agenda(built.input.a.agendaId).label, built.input.a.note ?? ""].filter(Boolean),
      [agenda(built.input.b.agendaId).label, built.input.b.note ?? ""].filter(Boolean),
    ],
  };
}
