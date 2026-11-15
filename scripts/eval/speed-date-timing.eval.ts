/**
 * Where a speed date's seconds go (docs/date-quality.md "Round: the fast first date"): a few speed dates generated
 * in-process by the real pipeline (lib/pipeline.ts generateDate) with every model call timed, on an OpenRouter key and
 * never the live show's quota. Built in memory like lib/eval.ts: no database, nothing stored, so what it prints is the
 * model's share of a date (production adds about a second of pickup and database work before the first call).
 *
 *   SPEED_TIMING_KEY="$(security find-generic-password -s vault/botchelor/OPENROUTER_LOOP_KEY -w)" \
 *   SPEED_TIMING_OUT=<dir> SPEED_TIMING_LABEL=haiku \
 *     npx vitest run --config scripts/eval/vitest.eval.mts scripts/eval/speed-date-timing.eval.ts
 *
 * It prints, per date and as medians: the first line, the last line, the verdict (onOutcome) and the finished date, in
 * seconds from the start, and each kind of call (plan, line, answers, recap, texts, reflection) with how long it took.
 * The file it writes (<label>.json) has the living-dates eval's arm shape, so two arms can be scored against each other
 * with `LIVING_EVAL_MODE=score` (scripts/eval/living-dates.eval.ts).
 *
 * Options (environment): SPEED_TIMING_MODEL (default anthropic/claude-haiku-5.5, what the show's dates run on),
 * SPEED_TIMING_N (3 dates, at most the six pairs below), SPEED_TIMING_TIMEOUT_MS (25000, the show's own per-call
 * limit), SPEED_TIMING_MAX_USD (0.1: stops before going past it), SPEED_TIMING_REASONING (a thinking level to send;
 * none by default, like the show's paid model). FAST_FIRST_LINE is read as the show reads it (lib/fast-date.ts): =0 is
 * the arm from before. SPEED_DATE_MODEL and SPEED_DATE_REASONING are the job's (lib/jobs.ts): to try a value here, set
 * SPEED_TIMING_MODEL or SPEED_TIMING_REASONING (every call of the date then runs on it, the recap included).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { Character } from "@/lib/character";
import { deterministicEngine } from "@/lib/engine";
import { buildEvalDate, type EvalCase } from "@/lib/eval";
import { fastStartOn } from "@/lib/fast-date";
import { formatContextOf } from "@/lib/formats";
import { fallbackHotTakes } from "@/lib/hot-takes";
import { openAICompatibleModel, REASONING_EFFORTS, type ChatMessage, type Model, type ReasoningEffort, type Usage } from "@/lib/model";
import { generateDate } from "@/lib/pipeline";

const env = process.env;
const KEY = env.SPEED_TIMING_KEY ?? "";
const OUT = env.SPEED_TIMING_OUT ?? "";
const LABEL = env.SPEED_TIMING_LABEL || "arm";
const MODEL = env.SPEED_TIMING_MODEL || "anthropic/claude-haiku-5.5";
const N = Math.max(1, Number(env.SPEED_TIMING_N || 3));
const TIMEOUT_MS = Math.max(1000, Number(env.SPEED_TIMING_TIMEOUT_MS || 25_000));
const MAX_USD = Number(env.SPEED_TIMING_MAX_USD || 0.1);
const REASONING = (REASONING_EFFORTS as readonly string[]).includes(env.SPEED_TIMING_REASONING ?? "") ? (env.SPEED_TIMING_REASONING as ReasoningEffort) : undefined;
const GATEWAY = "https://openrouter.ai/api/v1";

/** Six fixed speed dates: a thin visitor sheet and a full one against the house, and four house pairings. */
const CASES: readonly EvalCase[] = (
  [
    ["eval-thin-oc", "house-juniper", 11],
    ["house-kaz", "house-nell", 13],
    ["eval-rich-oc", "house-dex", 3],
    ["house-teo", "house-ines", 5],
    ["house-sable", "house-wally", 102],
    ["house-imogen", "house-boaz", 103],
  ] as const
).map(([a, b, seed]) => ({ id: `speed-${a.slice(a.indexOf("-") + 1)}-${b.slice(b.indexOf("-") + 1)}`, a, b, format: "speed_date" as const, seed, why: "a speed date, timed" }));

/** Which of a date's calls this is, from its system prompt's opening words (content-free). */
function kindOf(messages: ChatMessage[]): string {
  const s = messages[0]?.content ?? "";
  if (s.startsWith("You are the story editor")) return "plan";
  if (s.startsWith("You are one fictional adult on a date")) return messages.some((m) => m.role === "user" && m.content.startsWith("Revise that line")) ? "line_revision" : "line";
  if (s.startsWith("You are one fictional adult who has just finished a date")) return "answer";
  if (s.startsWith("You are the showrunner")) return "recap";
  if (s.startsWith("You are one fictional adult character the morning after")) return "text";
  if (s.startsWith("You are one fictional adult who just went on a blind date")) return "reflection";
  return "other";
}

type Call = { kind: string; at: number; ms: number; ok: boolean; error?: string; in_chars: number; out_chars: number; out_tokens?: number; cost?: number };

let spent = 0;

/** The model, with every call timed against `t0` and its cost added to the run's. */
function timed(t0: number, calls: Call[]): Model {
  const inner = openAICompatibleModel({ baseUrl: GATEWAY, apiKey: KEY, model: MODEL, timeoutMs: TIMEOUT_MS, reasoning: REASONING, extraBody: { usage: { include: true } } });
  return {
    async complete(messages, options) {
      if (spent >= MAX_USD) throw new Error(`timing budget spent ($${spent.toFixed(3)} of $${MAX_USD})`);
      const start = Date.now();
      const call: Call = { kind: kindOf(messages), at: start - t0, ms: 0, ok: false, in_chars: messages.reduce((n, m) => n + m.content.length, 0), out_chars: 0 };
      calls.push(call);
      try {
        const raw = await inner.complete(messages, {
          ...options,
          onUsage: (u: Usage) => {
            spent += u.cost ?? 0;
            call.cost = u.cost;
            call.out_tokens = u.output;
            options?.onUsage?.(u);
          },
        });
        call.ok = true;
        call.out_chars = raw.length;
        return raw;
      } catch (err) {
        call.error = err instanceof Error ? err.message.slice(0, 80) : "unknown";
        throw err;
      } finally {
        call.ms = Date.now() - start;
      }
    },
  };
}

const median = (xs: number[]): number | null => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? Math.round(((s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2) * 10) / 10 : null;
};
const secs = (ms: number | null | undefined): number | null => (typeof ms === "number" ? Math.round(ms / 100) / 10 : null);

/** One speed date, written and timed. */
async function timeOne(c: EvalCase) {
  const built = buildEvalDate(c);
  // Hot takes as the show's fallback gives them (no call): the derivation is a once-per-character cost, timed apart.
  for (const ch of built.characters as Character[]) ch.hotTakes = fallbackHotTakes(ch);
  const version = built.setup.engine_version;
  const outcome = deterministicEngine.decide(built.input, built.seed, version as never);
  const calls: Call[] = [];
  const t0 = Date.now();
  const model = timed(t0, calls);
  const lineAt: number[] = [];
  let verdictAt: number | null = null;
  const gen = await generateDate({ actor: model, director: model }, built, outcome, {
    // As the job decides it (lib/jobs.ts): FAST_FIRST_LINE=0 is the arm from before.
    fast: fastStartOn(c.format),
    formatId: c.format,
    formatCtx: formatContextOf(built),
    conversation: true,
    afterglow: true,
    reflection: true,
    wishes: true,
    engineVersion: version,
    onTurn: (lines) => {
      while (lineAt.length < lines.length) lineAt.push(Date.now() - t0);
    },
    onOutcome: () => {
      verdictAt = Date.now() - t0;
    },
  });
  const total = Date.now() - t0;
  const characters = built.characters as [Character, Character];
  const byKind: Record<string, { n: number; failed: number; ms: number[] }> = {};
  for (const k of calls) {
    const row = (byKind[k.kind] ??= { n: 0, failed: 0, ms: [] });
    row.n++;
    if (!k.ok) row.failed++;
    row.ms.push(k.ms);
  }
  const row = {
    case: c.id,
    characters: characters.map((x) => x.name),
    engine_ending: outcome.ending,
    ending: gen.outcome.ending,
    plan: gen.plan?.source ?? null,
    transcript: gen.transcript.map((t) => ({ side: t.side, act: t.act, dialogue: t.dialogue, action: t.action, emotion: t.emotion })),
    first_line_s: secs(lineAt[0]),
    last_line_s: secs(lineAt[lineAt.length - 1]),
    verdict_s: secs(verdictAt),
    total_s: secs(total),
    calls: calls.map((k) => ({ ...k, at: secs(k.at), ms: undefined, s: secs(k.ms) })),
    by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { n: v.n, failed: v.failed, median_s: secs(median(v.ms)), sum_s: secs(v.ms.reduce((a, b) => a + b, 0)) }])),
    model_calls: gen.modelCalls,
    cost_usd: Math.round(calls.reduce((n, k) => n + (k.cost ?? 0), 0) * 1e6) / 1e6,
    conversation_error: gen.conversationError ? String(gen.conversationError).slice(0, 200) : null,
  };
  console.log(
    `[${LABEL}] ${c.id}: plan ${row.plan}, first line ${row.first_line_s}s, last line ${row.last_line_s}s, verdict ${row.verdict_s}s, done ${row.total_s}s, ${row.transcript.length} lines, ${row.model_calls} calls, $${row.cost_usd} (run $${spent.toFixed(3)})`,
  );
  console.log(`    ${calls.map((k) => `${k.kind}${k.ok ? "" : "!"}@${secs(k.at)}+${secs(k.ms)}`).join("  ")}`);
  return row;
}

// Skipped without its own key, so a run of the other evals in this folder doesn't trip over it.
it.skipIf(!KEY)("speed date timing", async () => {
  if (!OUT) throw new Error("SPEED_TIMING_OUT must be set");
  const results: Awaited<ReturnType<typeof timeOne>>[] = [];
  // One at a time: the show writes one date per job, and a small sequential run can't crowd a shared quota.
  for (const c of CASES.slice(0, N)) {
    results.push(await timeOne(c));
    if (spent >= MAX_USD) break;
  }
  const kinds = [...new Set(results.flatMap((r) => Object.keys(r.by_kind)))];
  const summary = {
    label: LABEL,
    model: MODEL,
    timeout_ms: TIMEOUT_MS,
    fast: fastStartOn("speed_date"),
    reasoning: REASONING ?? "(the model's default)",
    dates: results.length,
    median_first_line_s: median(results.map((r) => r.first_line_s ?? NaN)),
    median_last_line_s: median(results.map((r) => r.last_line_s ?? NaN)),
    median_verdict_s: median(results.map((r) => r.verdict_s ?? NaN)),
    median_total_s: median(results.map((r) => r.total_s ?? NaN)),
    max_first_line_s: Math.max(...results.map((r) => r.first_line_s ?? 0)),
    max_verdict_s: Math.max(...results.map((r) => r.verdict_s ?? 0)),
    plans: Object.fromEntries(["director", "rules"].map((p) => [p, results.filter((r) => r.plan === p).length])),
    per_call_median_s: Object.fromEntries(kinds.map((k) => [k, median(results.flatMap((r) => r.calls.filter((x) => x.kind === k).map((x) => x.s ?? NaN)))])),
    failed_calls: results.reduce((n, r) => n + r.calls.filter((x) => !x.ok).length, 0),
    mean_cost_usd: results.length ? Math.round((results.reduce((n, r) => n + r.cost_usd, 0) / results.length) * 1e5) / 1e5 : null,
    spent_usd: Math.round(spent * 1e4) / 1e4,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
});
