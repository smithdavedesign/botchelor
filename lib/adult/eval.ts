/**
 * The After Dark A/B (David, 2026-10-21: "do 1-3 and prove they work"). POST /api/jobs/eval-after-dark runs a few steps
 * of exactly the step production runs (lib/adult/scenes.ts writeSceneStep), from an empty scene where the pair's latest
 * date ended, on a chosen prompt, model, temperature and memory, and measures the lines (lib/adult/quality.ts).
 *
 * It writes NOTHING but its own spend: no scene, no facts, no pictures, no sets to draw, no usage count; a cited fact's
 * uses go up in memory only, as production's would. It does spend, on After Dark's own OpenRouter key like production:
 * one call a step (two at most, when every line had to go), and with memory "extracted" one more per chunk of stored
 * lines. So it has a budget (botchelor-41, 2026-10-21: "so a run can't drain the balance that live scenes need"): at
 * most EVAL_RUN_MAX_USD a run, and all of a day's runs (UTC) together at most AD_EVAL_DAILY_USD, else $2. A run holds
 * its share of the day before its first call (adult_eval_spend), so runs side by side can't overshoot together, stops
 * starting calls once it has spent what it holds, and books what it really cost when it's done.
 *
 * Memory:
 *  - "none": nothing remembered (no memories, no facts);
 *  - "live": what production would show now: their memories (sceneMemories) and their stored facts (adult_facts);
 *  - "extracted": their memories, plus facts pulled out of their stored nights by the very extraction a chapter's close
 *    runs (lib/adult/facts.ts), kept in memory. Production has no adult_facts rows until a chapter closes, so this is
 *    the way to see v2's memory with something in it.
 */
import type { Db } from "../db";
import type { Usage } from "../model";
import type { Price } from "../pricing";
import { checkAdultText } from "../safety";
import { readySetResolver } from "../sets";
import { extractFacts, factLabels, mergeFacts, MIN_LINES_TO_EXTRACT, type AdultFact } from "./facts";
import { adultModel, adultTextReady } from "./mode";
import { refusalIn, sceneQuality, sideOfCharacter, type CitationStatus, type SceneQuality } from "./quality";
import { CHAPTER_LINES, eligiblePair, emptyScene, samplingOf, stepContext, writeSceneStep, type DroppedLine, type SceneLine, type SceneState } from "./scenes";
import { getAdultSettings, type PromptVersion } from "./settings";

/**
 * The OpenRouter models an eval may run besides the current setting (David's shortlist, 2026-10-21), Dolphin among them
 * since After Dark moved to DeepSeek V3.1 (2026-10-22), so the two can still be run side by side.
 */
export const EVAL_MODELS = [
  "cognitivecomputations/dolphin-mistral-24b-venice-edition",
  "nousresearch/hermes-3-llama-3.1-70b",
  "sao10k/l3.1-euryale-70b",
  "deepseek/deepseek-chat-v3.1",
  "mistralai/mistral-large-2512",
  "nousresearch/hermes-4-405b",
] as const;

/**
 * OpenRouter's list prices, USD per 1M tokens (openrouter.ai/api/v1/models, read 2026-10-21): the fallback when a reply
 * doesn't say what it cost (OpenRouter's usage accounting normally does).
 */
export const EVAL_PRICES: Record<string, Price> = {
  "cognitivecomputations/dolphin-mistral-24b-venice-edition": { input: 0.2, output: 0.9 },
  "nousresearch/hermes-3-llama-3.1-70b": { input: 0.7, output: 0.7 },
  "sao10k/l3.1-euryale-70b": { input: 0.85, output: 0.85 },
  "deepseek/deepseek-chat-v3.1": { input: 0.25, output: 0.95 },
  "mistralai/mistral-large-2512": { input: 0.5, output: 1.5 },
  "nousresearch/hermes-4-405b": { input: 1.0, output: 3.0 },
};

export const MEMORY_MODES = ["live", "none", "extracted"] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];
export const EVAL_MAX_STEPS = 8;
/** The newest chunks of stored lines "extracted" reads (a chunk is a chapter, CHAPTER_LINES lines at most). */
export const EXTRACT_CHUNKS = 3;
/** Each call's patience, and when no new call starts: inside the route's 300 s even if the last one runs its full time. */
const CALL_TIMEOUT_MS = 90_000;
const START_BY_MS = 200_000;
/** The budget (see the top of this file): what one run may spend, a day's default, and too little left to start on. */
export const EVAL_RUN_MAX_USD = 0.25;
export const EVAL_DAILY_USD = 2;
const EVAL_MIN_HOLD_USD = 0.01;

/** The day's budget: AD_EVAL_DAILY_USD when it's a number of dollars (0 stops the eval), else EVAL_DAILY_USD. */
export function evalDailyBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AD_EVAL_DAILY_USD?.trim();
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : EVAL_DAILY_USD;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** What the eval has spent today (UTC), held runs included, and how many runs started. */
export async function evalSpentToday(db: Db, now: Date): Promise<{ day: string; usd: number; runs: number }> {
  const day = dayOf(now);
  const row = (await db.query<{ usd: number; runs: number }>(`select usd, runs from adult_eval_spend where day = $1`, [day])).rows[0];
  return { day, usd: Number(row?.usd ?? 0), runs: Number(row?.runs ?? 0) };
}

export type EvalHold = { day: string; held: number };

/** Holds up to EVAL_RUN_MAX_USD of today's budget for one run, atomically; null when too little of it is left. */
export async function holdEvalBudget(db: Db, budget: number, now: Date): Promise<EvalHold | null> {
  const { day, usd } = await evalSpentToday(db, now);
  const held = Math.round(Math.min(EVAL_RUN_MAX_USD, budget - usd) * 1e6) / 1e6;
  if (held < EVAL_MIN_HOLD_USD) return null;
  await db.query(`insert into adult_eval_spend (day) values ($1) on conflict (day) do nothing`, [day]);
  const { rows } = await db.query(`update adult_eval_spend set usd = round((usd + $2)::numeric, 6)::float8, runs = runs + 1 where day = $1 and usd + $2 <= $3 returning usd`, [day, held, budget + 1e-9]);
  return rows.length ? { day, held } : null;
}

/** Books a run's real cost in place of what it held. */
export async function settleEvalBudget(db: Db, hold: EvalHold, spent: number): Promise<void> {
  await db.query(`update adult_eval_spend set usd = greatest(0, round((usd - $2 + $3)::numeric, 6))::float8 where day = $1`, [hold.day, hold.held, spent]);
}

export type EvalRequest = {
  a: string;
  b: string;
  promptVersion: PromptVersion;
  model?: string;
  temperature?: number;
  steps: number;
  memory: MemoryMode;
  /** A steer per step, in order (as the admin's would be: a nudge); "" for none. */
  direction?: string[];
};

export type EvalLine = { step: number; who: "a" | "b"; name: string; text: string; action: string; why: string | null; memory: string | null; stage: number; cites: string[] };
export type EvalFact = { id: string; label: string; of: "a" | "b"; kind: string; fact: string; quote: string | null; uses: number; cited: number };

export type EvalResult = {
  pair: { a: { id: string; name: string }; b: { id: string; name: string } };
  prompt_version: PromptVersion;
  model: string;
  temperature: number;
  sampling: { temperature: number; frequency_penalty: number | null; presence_penalty: number | null; repetition_penalty: number | null };
  memory: MemoryMode;
  steps: { step: number; added: number; dropped: number; retried: boolean; error: string | null }[];
  lines: EvalLine[];
  /** The facts the run could draw on (none for "none"), with how often its lines cited each. */
  facts: EvalFact[];
  metrics: SceneQuality;
  dropped: (DroppedLine & { step: number })[];
  refusals: { step: number; kind: "reply" | "line"; text: string }[];
  usage: { calls: number; input_tokens: number; output_tokens: number; cost_usd: number | null; cost_source: "openrouter" | "price_table" | null };
  /** Why it stopped short of the steps asked for: time (the route's limit), the model not answering, or its budget. */
  stopped: null | "time" | "model_error" | "budget";
  /** Extraction calls that failed ("extracted" only). */
  extraction_errors: string[];
  /** What this run could spend, the day's budget, and what's been spent today with this run booked. */
  budget: { run_usd: number; daily_usd: number; spent_today_usd: number };
};

export type EvalOutcome = { ok: true; result: EvalResult } | { ok: false; status: number; error: string; message: string; allowed?: string[] };

/** The models a run may ask for: the current setting first, then the shortlist. */
export async function allowedModels(db: Db): Promise<string[]> {
  return [...new Set([(await getAdultSettings(db)).text_model, ...EVAL_MODELS])];
}

/** The account After Dark's scenes run under when no one's signed in (MCP's too): the first admin. */
async function firstAdmin(db: Db): Promise<string | null> {
  return (await db.query<{ user_id: string }>(`select user_id from admins order by user_id limit 1`)).rows[0]?.user_id ?? null;
}

const iso = (d: string | Date) => new Date(d).toISOString();

/** The pair's stored lines, read-only, as chapters (saved nights, then the running scene), the newest EXTRACT_CHUNKS. */
async function storedChunks(db: Db, ownerId: string, aId: string, bId: string): Promise<{ lines: SceneLine[]; at: string }[]> {
  const nights = (await db.query<{ lines: SceneLine[] | null; created_at: string | Date }>(`select lines, created_at from adult_nights where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at`, [ownerId, aId, bId])).rows;
  const scene = (await db.query<{ lines: SceneLine[] | null; updated_at: string | Date }>(`select lines, updated_at from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [ownerId, aId, bId])).rows[0];
  const all = [...nights.map((n) => ({ lines: n.lines ?? [], at: iso(n.created_at) })), ...(scene ? [{ lines: scene.lines ?? [], at: iso(scene.updated_at) }] : [])];
  // A night from before chapters (one long scroll) is read a chapter's worth at a time, like a chapter closing.
  const pieces = all.flatMap((c) => Array.from({ length: Math.ceil(c.lines.length / CHAPTER_LINES) }, (_, i) => ({ lines: c.lines.slice(i * CHAPTER_LINES, (i + 1) * CHAPTER_LINES), at: c.at })));
  return pieces.filter((p) => p.lines.length >= MIN_LINES_TO_EXTRACT).slice(-EXTRACT_CHUNKS);
}

const sum = (xs: readonly number[]) => xs.reduce((x, y) => x + y, 0);

/** What a run cost: OpenRouter's own figure when every call reported one, else its tokens at the list price. */
export function evalCost(usage: readonly Usage[], model: string): EvalResult["usage"] {
  const input_tokens = sum(usage.map((u) => u.input));
  const output_tokens = sum(usage.map((u) => u.output));
  const reported = usage.length > 0 && usage.every((u) => typeof u.cost === "number");
  const price = EVAL_PRICES[model];
  const cost = reported ? sum(usage.map((u) => u.cost!)) : price && usage.length ? (input_tokens * price.input + output_tokens * price.output) / 1e6 : null;
  return {
    calls: 0,
    input_tokens,
    output_tokens,
    cost_usd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
    cost_source: reported ? "openrouter" : cost !== null ? "price_table" : null,
  };
}

/** A kept line as the eval shows it: the action apart from the speech, the private notes, and the facts it cited by label. */
function evalLine(step: number, l: SceneLine, names: { a: string; b: string }, labels: Map<string, string>): EvalLine {
  const m = /^\*([^*]+)\*\s*([\s\S]*)$/.exec(l.text);
  return {
    step,
    who: l.who,
    name: l.who === "a" ? names.a : names.b,
    text: (m ? m[2] : l.text).trim(),
    action: m ? m[1].trim() : "",
    why: l.why ?? null,
    memory: l.memory ?? null,
    stage: l.stage ?? 0,
    cites: (l.fact_ids ?? []).map((id) => labels.get(id) ?? id),
  };
}

/** Runs one eval (see the top of this file). Reads, calls the model, and returns; writes only its spend. */
export async function runAfterDarkEval(db: Db, req: EvalRequest, clock: () => number = Date.now): Promise<EvalOutcome> {
  const started = clock();
  const owner = await firstAdmin(db);
  if (!owner) return { ok: false, status: 409, error: "no_admin", message: "After Dark's scenes run under the first admin, and there's no admin yet." };
  // David's line: this season's cast and the characters the admin switched on, never anyone else's (lib/adult/characters.ts).
  const pair = await eligiblePair(db, owner, req.a, req.b);
  if (!pair) return { ok: false, status: 404, error: "not_in_after_dark", message: "Pick two characters who are in After Dark: this season's cast, or ones the admin switched on." };
  const settings = await getAdultSettings(db);
  const allowed = await allowedModels(db);
  const modelId = req.model?.trim() || settings.text_model;
  if (!allowed.includes(modelId)) return { ok: false, status: 400, error: "model_not_allowed", message: `The eval runs only these models: ${allowed.join(", ")}.`, allowed };
  const steers = (req.direction ?? []).map((d) => d.trim().slice(0, 300));
  if (steers.some((d) => d && !checkAdultText({ direction: d }).ok)) return { ok: false, status: 422, error: "steer_refused", message: "A steer crosses one of the two lines (nobody under 18, no real people)." };
  if (!(await adultTextReady(db))) return { ok: false, status: 503, error: "no_model", message: "After Dark has no OpenRouter key saved here, so there's no model to run." };
  const daily = evalDailyBudget();
  const hold = await holdEvalBudget(db, daily, new Date(clock()));
  if (!hold) {
    const today = await evalSpentToday(db, new Date(clock()));
    return {
      ok: false,
      status: 429,
      error: "eval_budget",
      message: `The eval's budget for today is spent: $${today.usd.toFixed(2)} of $${daily.toFixed(2)} over ${today.runs} runs (UTC days; AD_EVAL_DAILY_USD sets it). It starts again at midnight UTC.`,
    };
  }
  const usage: Usage[] = [];
  // OpenRouter says what every call cost (usage accounting) and the price table covers the shortlist, so a call with
  // neither is the local model's (ADULT_MODE, no key), which is free.
  const spent = () => evalCost(usage, modelId).cost_usd ?? 0;
  try {
    return await evalRun(db, req, { owner, pair, settings, modelId, steers, usage, spent, hold, daily }, clock, started);
  } finally {
    await settleEvalBudget(db, hold, spent()).catch(() => {});
  }
}

/** The run itself, once its budget is held: steps until done, out of time, out of its budget, or the model's gone. */
async function evalRun(
  db: Db,
  req: EvalRequest,
  run: {
    owner: string;
    pair: [string, string];
    settings: Awaited<ReturnType<typeof getAdultSettings>>;
    modelId: string;
    steers: string[];
    usage: Usage[];
    spent: () => number;
    hold: EvalHold;
    daily: number;
  },
  clock: () => number,
  started: number,
): Promise<EvalOutcome> {
  const { owner, pair, settings, modelId, steers, usage, spent, hold } = run;
  // On the admin's own machine with no OpenRouter key (ADULT_MODE=1), this is the local model whatever `model` says.
  const model = await adultModel(db, process.env, { model: modelId, timeoutMs: CALL_TIMEOUT_MS, retryDelaysMs: [] });

  const [aId, bId] = pair;
  const ctx = await stepContext(db, owner, aId, bId, { memories: req.memory !== "none", facts: req.memory === "live" });
  if (!ctx.a || !ctx.b) return { ok: false, status: 404, error: "not_in_after_dark", message: "One of them isn't a character any more." };
  const names = { a: ctx.a.name, b: ctx.b.name };
  let calls = 0;
  let stopped: EvalResult["stopped"] = null;
  const extraction_errors: string[] = [];
  let facts: AdultFact[] = req.memory === "live" ? ctx.facts : [];
  if (req.memory === "extracted") {
    let n = 0;
    for (const chunk of await storedChunks(db, owner, aId, bId)) {
      if (clock() - started > START_BY_MS) break;
      if (spent() >= hold.held) {
        stopped = "budget";
        break;
      }
      calls++;
      const incoming = await extractFacts(model, ctx.a, ctx.b, chunk.lines, {
        onUsage: (u) => usage.push(u),
        onError: (err) => extraction_errors.push(err instanceof Error ? err.message.slice(0, 200) : "error"),
      });
      facts = mergeFacts(facts, incoming, () => `x${++n}`, chunk.at).all;
    }
  }
  const labels = factLabels(facts);
  const cited = new Map<string, number>();
  const sampling = { ...samplingOf(settings), temperature: req.temperature ?? settings.text_temperature };
  const resolveSet = await readySetResolver(db);

  let scene: SceneState = emptyScene();
  const kept: SceneLine[] = [];
  const citations: CitationStatus[] = [];
  const lines: EvalLine[] = [];
  const dropped: EvalResult["dropped"] = [];
  const refusals: EvalResult["refusals"] = [];
  const steps: EvalResult["steps"] = [];
  let refusedElsewhere = 0;
  // v2.1: lines its guard cut or dropped for a worn phrase, which the kept lines can't show (lib/adult/quality.ts worn_phrases_cut).
  let wornCut = 0;
  for (let i = 0; i < req.steps; i++) {
    if (clock() - started > START_BY_MS) {
      stopped = "time";
      break;
    }
    if (spent() >= hold.held) {
      stopped = "budget";
      break;
    }
    const step = await writeSceneStep({
      model,
      a: ctx.a,
      b: ctx.b,
      pair: { a: { id: aId, name: names.a }, b: { id: bId, name: names.b } },
      date: ctx.date,
      scene,
      steer: steers[i] || null,
      steerMode: "nudge",
      promptVersion: req.promptVersion,
      sampling,
      memories: ctx.memories,
      facts,
      styles: ctx.styles,
      cast: ctx.cast,
      resolveSet,
      now: new Date(clock()),
    });
    calls += step.flags.calls;
    wornCut += step.flags.worn_phrases;
    usage.push(...step.usage);
    dropped.push(...step.dropped.map((d) => ({ step: i + 1, ...d })));
    for (const d of step.dropped) {
      if (!d.reason.startsWith("out of the scene")) continue;
      refusedElsewhere++;
      refusals.push({ step: i + 1, kind: "line", text: d.text });
    }
    if (!step.ok) {
      steps.push({ step: i + 1, added: 0, dropped: step.dropped.length, retried: step.flags.retried, error: step.message });
      if (step.flags.refusal_reply) {
        refusedElsewhere++;
        refusals.push({ step: i + 1, kind: "reply", text: step.raw ?? "" });
      }
      if (step.status === 502) {
        stopped = "model_error";
        break;
      }
      continue;
    }
    // As production's bumpFacts: one more use for each fact these lines cited.
    const ids = new Set(step.lines.flatMap((l) => l.fact_ids ?? []));
    if (ids.size) facts = facts.map((f) => (ids.has(f.id) ? { ...f, uses: f.uses + 1, last_used_at: new Date(clock()).toISOString() } : f));
    step.lines.forEach((l, j) => {
      for (const id of l.fact_ids ?? []) cited.set(id, (cited.get(id) ?? 0) + 1);
      if (refusalIn(l.text) === "moralising") refusals.push({ step: i + 1, kind: "line", text: l.text });
      kept.push(l);
      citations.push(step.flags.citations[j]);
      lines.push(evalLine(i + 1, l, names, labels));
    });
    steps.push({ step: i + 1, added: step.lines.length, dropped: step.dropped.length, retried: step.flags.retried, error: null });
    scene = step.next;
  }

  const metrics = sceneQuality({
    a: sideOfCharacter(ctx.a),
    b: sideOfCharacter(ctx.b),
    lines: kept,
    citations,
    memories: ctx.memories,
    cast: ctx.cast,
    refusedElsewhere,
    start: ctx.date?.setting ?? null,
    wornCut,
  });
  // Today's spend with this run booked at what it cost rather than what it held (the route settles it just after).
  const today = await evalSpentToday(db, new Date(clock()));
  const budget = { run_usd: hold.held, daily_usd: run.daily, spent_today_usd: Math.round(Math.max(0, today.usd - hold.held + spent()) * 1e6) / 1e6 };
  return {
    ok: true,
    result: {
      pair: { a: { id: aId, name: names.a }, b: { id: bId, name: names.b } },
      prompt_version: req.promptVersion,
      model: modelId,
      temperature: sampling.temperature,
      sampling,
      memory: req.memory,
      steps,
      lines,
      facts: facts.map((f) => ({ id: f.id, label: labels.get(f.id) ?? f.id, of: f.character_id === aId ? "a" : "b", kind: f.kind, fact: f.fact, quote: f.quote, uses: f.uses, cited: cited.get(f.id) ?? 0 })),
      metrics,
      dropped,
      refusals,
      usage: { ...evalCost(usage, modelId), calls },
      stopped,
      extraction_errors,
      budget,
    },
  };
}
