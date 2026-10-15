import { z } from "zod";
import { EVAL_CASES, rejudgeCase, runEvalCase } from "@/lib/eval";
import { handle, json, readJson } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { getDirectorModel, getModel, modelFromEnv, namedModel } from "@/lib/model";

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
 * Body: { case, actor?, director?, judge? } — optional model names for the A/B arms.
 * Or { case, judge, transcript } — judge a saved transcript again, generating nothing (eval-rejudge.mjs).
 */
export const POST = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const body = ((await readJson(req)) ?? {}) as { case?: string; actor?: string; director?: string; judge?: string; transcript?: unknown };
  const c = EVAL_CASES.find((x) => x.id === body.case);
  if (!c) return json({ error: "unknown_case", cases: EVAL_CASES.map((x) => x.id) }, 400);
  for (const name of [body.actor, body.director, body.judge]) {
    if (name !== undefined && !MODEL_NAME.test(name)) return json({ error: "bad_model_name" }, 400);
  }
  if (body.transcript !== undefined) {
    const transcript = SavedTranscript.safeParse(body.transcript);
    if (!body.judge || !transcript.success) return json({ error: "bad_rejudge", message: "rejudging needs a judge model and a saved transcript" }, 400);
    return json({ case: c.id, ...(await rejudgeCase(c, transcript.data, namedModel(body.judge, evalEnv()))), models: { judge: body.judge } });
  }
  const env = evalEnv();
  const actor = body.actor ? namedModel(body.actor, env) : env === process.env ? getModel() : modelFromEnv(env);
  const director = body.director ? namedModel(body.director, env) : body.actor ? actor : getDirectorModel(env);
  const judge = body.judge ? namedModel(body.judge, env) : null;
  const result = await runEvalCase(c, { actor, director }, judge);
  return json({ ...result, models: { actor: body.actor ?? "default", director: body.director ?? body.actor ?? "default", judge: body.judge ?? null } });
});
