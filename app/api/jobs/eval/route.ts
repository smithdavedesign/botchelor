import { z } from "zod";
import { EVAL_CASES, EVAL_SAGAS, rejudgeCase, runEvalCase, runSagaStep } from "@/lib/eval";
import { handle, json, readJson } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { getDirectorModel, getModel, modelFromEnv, namedModel, REASONING_EFFORTS, roleReasoning, type ReasoningEffort } from "@/lib/model";

// One eval date: ~10-17 model calls on the free tier, plus the judge.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Model names the eval may request: Google models at the configured endpoint only (no arbitrary strings). */
const MODEL_NAME = /^gemini-[a-z0-9.-]{1,40}$/;

/**
 * The eval's own Google key when one is configured (EVAL_GOOGLE_API_KEY, from a separate free project), so an
 * eval never spends the live show's free daily quota. Without it the eval shares production's key: a full
 * run is ~90 calls, so run it sparingly (docs/date-quality.md).
 */
function evalEnv(): Record<string, string | undefined> {
  const key = process.env.EVAL_GOOGLE_API_KEY;
  return key ? { ...process.env, GOOGLE_API_KEY: key, LLM_API_KEY: undefined, LLM_BASE_URL: undefined } : process.env;
}

/** A saved transcript to judge again (scripts/eval-rejudge.mjs): the shape lib/conversation.ts produces. */
const SavedTranscript = z
  .array(
    z.object({
      side: z.enum(["a", "b"]),
      act: z.number().int().min(0).max(2),
      dialogue: z.string().max(600),
      action: z.string().max(200).default(""),
      emotion: z.string().max(80).default(""),
      interest: z.number().min(0).max(1).default(0.5),
    }),
  )
  .min(1)
  .max(40);

/**
 * Internal: generate ONE date from the fixed quality-eval set (lib/eval.ts) and return it with its metrics and
 * (optionally) the rubric judge's scores. Built entirely in memory — it reads and writes no stored data — so
 * it can run against production's model key without touching a real date. Same gate as the job routes
 * (404 unless authorized). scripts/eval-dates.mjs drives it over the whole set and writes the report.
 *
 * Body: { case, actor?, director?, judge?, actor_reasoning?, director_reasoning? } — optional model names and
 * thinking levels ("minimal" | "low" | "medium" | "high" | "default") for the A/B arms.
 * Or { case, judge, transcript } — judge a saved transcript again, generating nothing (eval-rejudge.mjs).
 */
/**
 * Internal: which quota an eval would spend here ("eval" with EVAL_GOOGLE_API_KEY, else "shared" with the live
 * show) and the cases, so the scripts can refuse to drain the live show's quota by accident.
 */
export const GET = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  return json({
    quota: process.env.EVAL_GOOGLE_API_KEY ? "eval" : "shared",
    cases: EVAL_CASES.map((x) => x.id),
    sagas: EVAL_SAGAS.map((x) => ({ id: x.id, steps: x.steps.length })),
  });
});

export const POST = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const body = ((await readJson(req)) ?? {}) as {
    case?: string;
    saga?: string;
    step?: number;
    prior?: unknown;
    actor?: string;
    director?: string;
    judge?: string;
    transcript?: unknown;
    actor_reasoning?: string;
    director_reasoning?: string;
  };
  // A saga step (continuity): { saga, step, prior: [transcript of each earlier step] }.
  const saga = body.saga !== undefined ? EVAL_SAGAS.find((x) => x.id === body.saga) : undefined;
  if (body.saga !== undefined && !saga) return json({ error: "unknown_saga", sagas: EVAL_SAGAS.map((x) => x.id) }, 400);
  let prior: z.infer<typeof SavedTranscript>[] = [];
  if (saga) {
    const step = Number(body.step);
    if (!Number.isInteger(step) || step < 0 || step >= saga.steps.length) return json({ error: "bad_step", steps: saga.steps.length }, 400);
    const parsed = z.array(SavedTranscript).length(step).safeParse(body.prior ?? []);
    if (!parsed.success) return json({ error: "bad_prior", message: `step ${step} needs the transcripts of the ${step} steps before it` }, 400);
    prior = parsed.data;
  }
  const c = saga ? null : EVAL_CASES.find((x) => x.id === body.case);
  if (!saga && !c) return json({ error: "unknown_case", cases: EVAL_CASES.map((x) => x.id) }, 400);
  for (const name of [body.actor, body.director, body.judge]) {
    if (name !== undefined && !MODEL_NAME.test(name)) return json({ error: "bad_model_name" }, 400);
  }
  if (body.transcript !== undefined && c) {
    const transcript = SavedTranscript.safeParse(body.transcript);
    if (!body.judge || !transcript.success) return json({ error: "bad_rejudge", message: "rejudging needs a judge model and a saved transcript" }, 400);
    return json({ case: c.id, ...(await rejudgeCase(c, transcript.data, namedModel(body.judge, evalEnv()))), models: { judge: body.judge } });
  }
  const env = evalEnv();
  // A thinking level per role: the configured one, or an arm's override ("default" sends none).
  const level = (asked: string | undefined, role: "actor" | "director"): ReasoningEffort | undefined | null =>
    asked === undefined ? roleReasoning(role, env) : asked === "default" ? undefined : (REASONING_EFFORTS as readonly string[]).includes(asked) ? (asked as ReasoningEffort) : null;
  const actorLevel = level(body.actor_reasoning, "actor");
  const directorLevel = level(body.director_reasoning, "director");
  if (actorLevel === null || directorLevel === null) return json({ error: "bad_reasoning", allowed: [...REASONING_EFFORTS, "default"] }, 400);
  const actor = body.actor ? namedModel(body.actor, env, actorLevel) : env === process.env ? getModel(actorLevel) : modelFromEnv(env, undefined, actorLevel);
  // An actor arm also directs (as before), unless the arm sets the director's thinking level separately.
  const director = body.director
    ? namedModel(body.director, env, directorLevel)
    : body.actor
      ? body.director_reasoning === undefined ? actor : namedModel(body.actor, env, directorLevel)
      : getDirectorModel(env, directorLevel);
  const judge = body.judge ? namedModel(body.judge, env) : null;
  const result = saga ? await runSagaStep(saga, Number(body.step), prior, { actor, director }, judge) : await runEvalCase(c!, { actor, director }, judge);
  return json({
    ...result,
    models: {
      actor: body.actor ?? "default",
      director: body.director ?? body.actor ?? "default",
      judge: body.judge ?? null,
      actor_reasoning: actorLevel ?? "default",
      director_reasoning: directorLevel ?? "default",
    },
  });
});
