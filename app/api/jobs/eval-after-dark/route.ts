import { z } from "zod";
import { allowedModels, EVAL_MAX_STEPS, EVAL_RUN_MAX_USD, evalDailyBudget, evalSpentToday, MEMORY_MODES, runAfterDarkEval } from "@/lib/adult/eval";
import { PROMPT_VERSIONS } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { internalJobAuthorized } from "@/lib/jobs";

// Up to eight scene steps, one after another, each a call (two at most), plus "extracted"'s extraction calls; the run
// stops starting calls well before this (lib/adult/eval.ts).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  a: z.string().min(1).max(64),
  b: z.string().min(1).max(64),
  promptVersion: z.enum(PROMPT_VERSIONS),
  model: z.string().min(1).max(120).optional(),
  temperature: z.number().min(0).max(2).optional(),
  steps: z.number().int().min(1).max(EVAL_MAX_STEPS),
  memory: z.enum(MEMORY_MODES),
  direction: z.array(z.string().max(300)).max(EVAL_MAX_STEPS).optional(),
});

/**
 * Internal: After Dark's A/B (lib/adult/eval.ts). Runs `steps` steps of the production scene step from an empty scene
 * for a pair, on a prompt version, model, temperature and memory mode, and returns the lines with their private notes,
 * the metrics (lib/adult/quality.ts), what was dropped, the refusals and what it cost. Writes nothing but its spend, and
 * keeps to a budget: at most $0.25 a run and AD_EVAL_DAILY_USD (else $2) a UTC day, then 429 eval_budget. Same gate as
 * the job routes and /api/jobs/eval (404 unless authorized: Authorization: Bearer CRON_SECRET).
 *
 * Body: { a, b, promptVersion: "v1" | "v2", model?, temperature?, steps: 1..8, memory: "live" | "none" | "extracted",
 * direction?: string[] }. GET lists the models, memory modes and versions it takes, and today's budget.
 */
export const GET = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const db = await getDb();
  const today = await evalSpentToday(db, new Date());
  return json({
    models: await allowedModels(db),
    memory: MEMORY_MODES,
    prompt_versions: PROMPT_VERSIONS,
    max_steps: EVAL_MAX_STEPS,
    budget: { run_usd: EVAL_RUN_MAX_USD, daily_usd: evalDailyBudget(), spent_today_usd: today.usd, runs_today: today.runs, day: today.day },
  });
});

export const POST = handle(async (req: Request) => {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  const body = parseBody(Body, await readJson(req), "invalid_request");
  const db = await getDb();
  const r = await runAfterDarkEval(db, body);
  if (!r.ok) return json({ error: r.error, message: r.message, ...(r.allowed ? { allowed: r.allowed } : {}) }, r.status);
  return json(r.result);
});
