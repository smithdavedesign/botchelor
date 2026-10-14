import { EVAL_CASES, runEvalCase } from "@/lib/eval";
import { handle, json, readJson } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";
import { getDirectorModel, getModel, namedModel } from "@/lib/model";

// One eval date: ~10-17 model calls on the free tier, plus the judge.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Model names the eval may request: Google models at the configured endpoint only (no arbitrary strings). */
const MODEL_NAME = /^gemini-[a-z0-9.-]{1,40}$/;

/**
 * Internal: generate ONE date from the fixed quality-eval set (lib/eval.ts) and return it with its metrics and
 * (optionally) the rubric judge's scores. Built entirely in memory — it reads and writes no stored data — so
 * it can run against production's model key without touching a real date. Same gate as the job routes
 * (404 unless authorized). scripts/eval-dates.mjs drives it over the whole set and writes the report.
 *
 * Body: { case, actor?, director?, judge? } — optional model names for the A/B arms.
 */
export const POST = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const body = ((await readJson(req)) ?? {}) as { case?: string; actor?: string; director?: string; judge?: string };
  const c = EVAL_CASES.find((x) => x.id === body.case);
  if (!c) return json({ error: "unknown_case", cases: EVAL_CASES.map((x) => x.id) }, 400);
  for (const name of [body.actor, body.director, body.judge]) {
    if (name !== undefined && !MODEL_NAME.test(name)) return json({ error: "bad_model_name" }, 400);
  }
  const actor = body.actor ? namedModel(body.actor) : getModel();
  const director = body.director ? namedModel(body.director) : body.actor ? actor : getDirectorModel();
  const judge = body.judge ? namedModel(body.judge) : null;
  const result = await runEvalCase(c, { actor, director }, judge);
  return json({ ...result, models: { actor: body.actor ?? "default", director: body.director ?? body.actor ?? "default", judge: body.judge ?? null } });
});
