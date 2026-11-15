/**
 * The fast first date (2026-11-15): the first line on screen in seconds, a speed date's verdict in under a minute.
 *
 * Where a speed date's 111 seconds went (production, 14 days, 74 jobs; per-line times from episodes.turn_meta, the job's
 * claim and the verdict from generation_jobs.leased_until; the same split measured call by call with
 * scripts/eval/speed-date-timing.eval.ts):
 *
 *   pickup (after() → claim)                 0.4-1 s
 *   setup (hot takes, the date's loads)      1-3 s
 *   the director's plan                      50 s    two tries, each cut off at the 25 s call limit (MODEL_TIMEOUT_MS):
 *                                                    the show's model thinks for ~7,500 tokens (37-40 s) on a plan, so
 *                                                    in 30 days 387 of 397 dates had no line before 40 s (none before
 *                                                    20 s) and then played from the rules plan anyway
 *   six lines                                22-25 s one call each (~3.8 s), about one critic revision a date
 *   the two answers                          2 s     in parallel already
 *   -- the verdict (onOutcome) --            ~77 s after the booking
 *   recap, four texts, two reflections       24-29 s one after another (10 s + 4 x 2.7 s + 3 s)
 *
 * So the first line took 57 s, and nine tenths of that was a plan that never came. A fast date:
 *
 *   1. plays from the rules plan at once (lib/beats.ts rulesPlan: the plan those dates were getting), no director call;
 *   2. waits at most HOT_TAKES_WAIT_MS (2.5 s) for a new character's hot takes (lib/hot-takes.ts), then plays this one date on
 *      its fallback takes while the derivation finishes behind it;
 *   3. writes the recap, the morning-after texts and the reflections side by side once the ending stands: none reads
 *      another's output, and every one of them is still checked exactly as before.
 *
 * Nothing here decides anything: the engine's outcome, the characters' answers (lib/choices.ts), the checks on every
 * line (lib/conversation.ts parseTurnResult, the critic) and the lease rules (lib/jobs.ts renewLease) are untouched,
 * and lines are still written one at a time, each after the last was checked and saved.
 *
 * Since the plan at night (lib/night-plans.ts, DATE_PLAN_AT_NIGHT, on by default) step 1 holds for every format: no
 * date asks the director in front of line 1. What stays particular to a fast date is steps 2 and 3. Only with
 * DATE_PLAN_AT_NIGHT=0 does a date that isn't fast ask the director first again.
 *
 * Switches (the show's app; no deploy of code to change one):
 *   FAST_FIRST_LINE    unset: speed dates only. "0"/"off": none (hot takes awaited, the recap, texts and reflections
 *                      one after another; the plan first too when DATE_PLAN_AT_NIGHT=0). "all": every format. Or a
 *                      comma list of format ids ("speed_date,classic").
 *   SPEED_DATE_MODEL   unset: speed dates run on the show's model. A model id at the show's paid endpoint
 *                      (FRONTIER_LLM_BASE_URL/KEY) puts a speed date's actor calls (lines, answers, texts,
 *                      reflections) on it; the recap stays on the show's model. A call it fails falls back to the
 *                      show's model, so a wrong id can't cost a first date.
 *   HOT_TAKES_WAIT_MS  unset: 2500. How long a fast date waits for a new character's hot takes, in milliseconds.
 *   SPEED_DATE_REASONING  unset: the model's own default. minimal|low|medium|high: the thinking level a speed date's
 *                      actor calls ask for (on SPEED_DATE_MODEL, or on the show's model when that's unset).
 */
import { FORMAT_IDS, type FormatId } from "./formats";
import { fallbackModel, openAICompatibleModel, REASONING_EFFORTS, type Model, type ReasoningEffort } from "./model";

type Env = Record<string, string | undefined>;

/** The formats that start fast when FAST_FIRST_LINE says nothing: the newcomer's first date (lib/first-date.ts). */
export const FAST_FORMATS_DEFAULT: readonly FormatId[] = ["speed_date"];

/** Whether a date in this format starts fast (pure). An unknown value reads as the default, never as "all". */
export function fastStartOn(formatId: FormatId | null | undefined, env: Env = process.env): boolean {
  const raw = (env.FAST_FIRST_LINE ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false" || raw === "no") return false;
  if (raw === "all") return true;
  const named = raw.split(",").map((s) => s.trim()).filter((s): s is FormatId => (FORMAT_IDS as readonly string[]).includes(s));
  return (named.length ? named : FAST_FORMATS_DEFAULT).includes(formatId ?? "classic");
}

/**
 * How long a fast date waits for a new character's hot takes before it starts without the model's (lib/jobs.ts). The
 * derivation is one small call on the free model, usually about a second; its 25 s limit and its rate-limit backoff
 * would otherwise sit in front of a newcomer's first line. HOT_TAKES_WAIT_MS changes it (0: never wait).
 */
export const HOT_TAKES_WAIT_MS = 2_500;
export function hotTakesWaitMs(env: Env = process.env): number {
  const n = Number((env.HOT_TAKES_WAIT_MS ?? "").trim() || NaN);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 25_000) : HOT_TAKES_WAIT_MS;
}

/** Resolves true when `work` settled within `ms`, false when the time ran out first (`work` goes on either way). */
export function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    work.then(done, done);
  });
}

/** SPEED_DATE_REASONING as a thinking level, or undefined (unset, or a word that isn't one). */
export function speedDateReasoning(env: Env = process.env): ReasoningEffort | undefined {
  const raw = (env.SPEED_DATE_REASONING ?? "").trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(raw) ? (raw as ReasoningEffort) : undefined;
}

/**
 * The actor for a speed date when SPEED_DATE_MODEL or SPEED_DATE_REASONING is set, at the show's paid endpoint with the
 * show's key, falling back to `show` (the show's own model) call by call. Null when neither is set (today's model, as
 * it is), when the format isn't the speed date, or when no paid endpoint is configured.
 */
export function speedDateActor(formatId: FormatId | null | undefined, show: Model, env: Env = process.env, fetchImpl?: typeof fetch): Model | null {
  if (formatId !== "speed_date") return null;
  const model = (env.SPEED_DATE_MODEL ?? "").trim();
  const reasoning = speedDateReasoning(env);
  if (!model && !reasoning) return null;
  const { FRONTIER_LLM_BASE_URL: baseUrl, FRONTIER_LLM_API_KEY: apiKey, FRONTIER_LLM_MODEL: showModel } = env;
  if (!baseUrl || !apiKey || !(model || showModel)) return null;
  return fallbackModel(openAICompatibleModel({ baseUrl, apiKey, model: model || showModel!, fetchImpl, reasoning }), show);
}

/**
 * When each part of a written date happened, stored on the episode (generated_with.timing) so the next measurement is
 * one query: `queued_ms` from the booking to the job's claim (the database's clock), the rest from the claim.
 */
export type DateTiming = {
  fast: boolean;
  queued_ms: number | null;
  /** The date built and its models picked: the first model call starts here. */
  setup_ms: number;
  first_line_ms: number | null;
  last_line_ms: number | null;
  /** The ending stood (onOutcome): the creator's verdict card. */
  verdict_ms: number | null;
  /** Everything written, just before the date is saved ready. */
  written_ms: number;
};
