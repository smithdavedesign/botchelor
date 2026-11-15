/**
 * The plan at night on real dates (lib/night-plans.ts; docs/date-quality.md "Round: the plan at night"): does a date
 * played from a plan the producer wrote the night before read better than the same date played from the rules plan?
 * Fixed first dates between house characters, each side carrying a seeded story state (what it heard about the other,
 * a want), each generated twice in-process by the real pipeline: once from the rules plan (what every date gets with no
 * stored plan) and once from a night plan written by the cheap model exactly as the producer asks for it (no extended
 * thinking, a small output, a 90 s limit). Each date is scored by the repo's judge (lib/judge.ts) and its free metrics
 * (lib/quality.ts). On an OpenRouter key, never the live show's quota (docs/date-quality.md), one call at a time, and
 * it stops before NIGHT_EVAL_MAX_USD (default 0.25).
 *
 *   NIGHT_EVAL_KEY="$(security find-generic-password -s vault/botchelor/OPENROUTER_LOOP_KEY -w)" NIGHT_EVAL_OUT=<dir> \
 *     npx vitest run --config scripts/eval/vitest.eval.mts scripts/eval/night-plan.eval.ts
 *
 * Writes <dir>/night-plan.json (each plan with how long it took and what it cost, both arms' transcripts and scores)
 * and prints a summary. NIGHT_EVAL_CASES picks cases; NIGHT_EVAL_MODEL the dates' model; NIGHT_EVAL_PLAN_MODEL the
 * plan's.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { DatePlan } from "@/lib/beats";
import type { Character } from "@/lib/character";
import { deterministicEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { formatContextOf } from "@/lib/formats";
import { judgeDate, judgeMean } from "@/lib/judge";
import { openAICompatibleModel, type ChatMessage, type Model, type Usage } from "@/lib/model";
import { NIGHT_PLAN_TIMEOUT_MS, writeNightPlan } from "@/lib/night-plans";
import { generateDate, qualityContext } from "@/lib/pipeline";
import type { Beat } from "@/lib/producer";
import { transcriptQuality } from "@/lib/quality";
import type { Heard, Opinion, StoryState } from "@/lib/story-state";
import { venue } from "@/lib/venues";

const env = process.env;
const KEY = env.NIGHT_EVAL_KEY ?? "";
const OUT = env.NIGHT_EVAL_OUT ?? "";
const MODEL = env.NIGHT_EVAL_MODEL || "anthropic/claude-haiku-5.5";
const PLAN_MODEL = env.NIGHT_EVAL_PLAN_MODEL || "google/gemini-3.5-flash-lite";
const MAX_USD = Number(env.NIGHT_EVAL_MAX_USD || 0.25);
const GATEWAY = "https://openrouter.ai/api/v1";
const AT = "2026-11-14T20:00:00.000Z";

type Seed = { take: string; trust: number; heard: { claim: string; by: string | null }[]; want: string };
/** What each side carries into the date ([a about b, b about a]) and the day's beat. Claims are made up for the eval. */
const SEEDS: Record<string, { sides: [Seed, Seed]; going_around: string }> = {
  "rafe-juniper": {
    going_around: "Rafe found out what Juniper has been saying about why she came on the show.",
    sides: [
      { take: "Dex told me: Juniper said she only came on the show to settle a bet.", trust: -1, heard: [{ claim: "Juniper said she only came on the show to settle a bet.", by: "Dex Okafor" }], want: "Find out whether Juniper really said it, and hear it from Juniper." },
      { take: "Sable told me: Rafe rehearses his 'spontaneous' toasts in the mirror.", trust: 0, heard: [{ claim: "Rafe rehearses his 'spontaneous' toasts in the mirror.", by: "Sable Quist" }], want: "Rafe knows what you said. Decide whether you stand by it." },
    ],
  },
  "teo-ines": {
    going_around: "Ines and Teo heard two different stories about each other.",
    sides: [
      { take: "Nell told me: Ines keeps a spreadsheet of everyone she has dated, with scores.", trust: 0, heard: [{ claim: "Ines keeps a spreadsheet of everyone she has dated, with scores.", by: "Nell Abiodun" }], want: "Find out the real story about Ines, from Ines if you can." },
      { take: "Marisol told me: Teo used the same line about constellations on three dates in a week.", trust: -1, heard: [{ claim: "Teo used the same line about constellations on three dates in a week.", by: "Marisol Pine" }], want: "Ask Teo about what you heard, and watch how Teo takes it." },
    ],
  },
  "mira-dex": {
    going_around: "Mira heard why Dex left his last date early.",
    sides: [
      { take: "Juniper told me: Dex left his last date early to feed a stranger's parking meter.", trust: 1, heard: [{ claim: "Dex left his last date early to feed a stranger's parking meter.", by: "Juniper Vale" }], want: "Ask Dex about what you heard, and watch how Dex takes it." },
      { take: "I haven't made up my mind about her.", trust: 0, heard: [{ claim: "Mira and Orin's first date at the tide pools: they parted as friends.", by: null }], want: "Prove that a date with you can end well." },
    ],
  },
};

function seeded(me: Character, them: Character, s: Seed, n: number): StoryState {
  const opinion: Opinion = { holder_id: me.id, about_id: them.id, about_name: them.name, trust: s.trust, attraction: null, take: s.take, basis: "heard", source: `eval:${n}`, source_at: AT, updated_at: AT };
  const heard: Heard[] = s.heard.map((h, i) => ({
    id: `eval-h-${n}-${i}`, holder_id: me.id, about_id: them.id, about_name: them.name, about_b_id: null, about_b_name: null, claim: h.claim,
    told_by: h.by ? `eval-teller-${i}` : null, told_by_name: h.by, source: `eval:${n}:${i}`, is_true: true, heard_at: AT, used_at: null, used_in: null,
  }));
  return { holder_id: me.id, with_id: them.id, opinions: [opinion], heard, want: { holder_id: me.id, season_id: "2026-11-01", week_id: "2026-11-09", want: s.want, about_id: them.id, kind: "prove", set_by: "producer" } };
}

let spent = 0;
function paid(model: string, opts: { reasoning?: "minimal"; timeoutMs?: number } = {}): Model {
  const inner = openAICompatibleModel({ baseUrl: GATEWAY, apiKey: KEY, model, timeoutMs: opts.timeoutMs ?? 90_000, reasoning: opts.reasoning, extraBody: { usage: { include: true } } });
  return {
    async complete(messages: ChatMessage[], options) {
      if (spent >= MAX_USD) throw new Error(`eval budget spent ($${spent.toFixed(3)} of $${MAX_USD})`);
      return inner.complete(messages, { ...options, onUsage: (u: Usage) => ((spent += u.cost ?? 0), options?.onUsage?.(u)) });
    },
  };
}

it.skipIf(!KEY || !OUT)("the plan at night: the same dates from the rules plan and from a stored plan", async () => {
  mkdirSync(OUT, { recursive: true });
  const pick = env.NIGHT_EVAL_CASES ? new Set(env.NIGHT_EVAL_CASES.split(",")) : null;
  const cases = EVAL_CASES.filter((c) => SEEDS[c.id] && (!pick || pick.has(c.id)));
  const results: unknown[] = [];
  const plans: unknown[] = [];
  const save = () => writeFileSync(join(OUT, "night-plan.json"), JSON.stringify({ model: MODEL, plan_model: PLAN_MODEL, spent_usd: Math.round(spent * 1e4) / 1e4, plans, results }, null, 2));
  for (const c of cases) {
    const fresh = () => {
      const built = buildEvalDate(c);
      const [a, b] = built.characters as [Character, Character];
      a.story = seeded(a, b, SEEDS[c.id].sides[0], 0);
      b.story = seeded(b, a, SEEDS[c.id].sides[1], 1);
      const version = built.setup.engine_version;
      return { built, a, b, version, outcome: deterministicEngine.decide(built.input, built.seed, version as never) };
    };
    // The night before: the plan, on the cheap model, sized to finish (lib/night-plans.ts writeNightPlan).
    let plan: DatePlan | null = null;
    try {
      const d = fresh();
      const beat = { who: [d.a.id, d.b.id], previously: `Previously: ${SEEDS[c.id].going_around}` } as unknown as Beat;
      const usage: Usage[] = [];
      const before = spent;
      const t0 = Date.now();
      plan = await writeNightPlan(paid(PLAN_MODEL, { reasoning: "minimal", timeoutMs: NIGHT_PLAN_TIMEOUT_MS }), d.built, d.outcome, beat, (u) => usage.push(u));
      const ms = Date.now() - t0;
      const tokens = usage.reduce((s, u) => ({ input: s.input + u.input, output: s.output + u.output, thinking: s.thinking + u.thinking }), { input: 0, output: 0, thinking: 0 });
      console.log(`[plan] ${c.id}: ${plan ? "written" : "NONE PASSED"} in ${(ms / 1000).toFixed(1)}s, ${usage.length} call(s), ${tokens.input} in / ${tokens.output} out (${tokens.thinking} thinking), $${(spent - before).toFixed(5)}`);
      if (plan) for (const [i, act] of plan.acts.entries()) console.log(`    act ${i + 1}: ${act.scene}\n      a: ${act.a}\n      b: ${act.b}`);
      plans.push({ case: c.id, ok: Boolean(plan), ms, calls: usage.length, tokens, cost_usd: Math.round((spent - before) * 1e6) / 1e6, plan });
      save();
    } catch (err) {
      console.log(`[plan] ${c.id}: failed (${err instanceof Error ? err.message : err})`);
    }
    for (const arm of ["rules", "night"] as const) {
      if (arm === "night" && !plan) continue;
      try {
        const d = fresh();
        const model = paid(MODEL);
        const before = spent;
        const t0 = Date.now();
        let firstLineMs: number | null = null;
        const gen = await generateDate({ actor: model, director: model }, d.built, d.outcome, {
          formatId: c.format,
          formatCtx: formatContextOf(d.built),
          conversation: true,
          afterglow: false,
          reflection: false,
          wishes: false,
          plan: arm === "night" ? plan! : "rules",
          onTurn: () => void (firstLineMs ??= Date.now() - t0),
          ...({ engineVersion: d.version } as object),
        });
        const dateCost = spent - before;
        const lines = gen.inner?.lines ?? [];
        const brought = gen.transcript.flatMap((t, i) => (lines[i]?.heard ? [{ line: i + 1, who: t.side === "a" ? d.a.name : d.b.name, said: t.dialogue }] : []));
        const metrics = gen.quality ?? transcriptQuality(gen.transcript, [d.a, d.b], qualityContext(d.built, gen.draft.setting));
        const verdict = await judgeDate(paid(MODEL), [d.a, d.b], gen.outcome, gen.transcript, venue(d.built.setup.venue).prompt, d.built.input.date_number).catch(() => null);
        const mean = verdict ? judgeMean(verdict) : null;
        console.log(`[${arm}] ${c.id}: ${gen.outcome.ending}, ${gen.transcript.length} lines, first line ${firstLineMs === null ? "?" : (firstLineMs / 1000).toFixed(1)}s, index ${metrics.index}, judge ${mean ?? "none"}, brought up ${brought.length}, date $${dateCost.toFixed(4)} (total $${spent.toFixed(3)})`);
        results.push({
          case: c.id,
          arm,
          plan_source: gen.plan?.source,
          ending: gen.outcome.ending,
          first_line_ms: firstLineMs,
          index: metrics.index,
          judge: verdict,
          judge_mean: mean,
          brought_up: brought,
          cost_usd: Math.round(dateCost * 1e5) / 1e5,
          transcript: gen.transcript.map((t, i) => ({ n: i + 1, who: t.side === "a" ? d.a.name : d.b.name, said: t.dialogue, ...(t.action ? { did: t.action } : {}) })),
        });
        save();
      } catch (err) {
        console.log(`[${arm}] ${c.id}: failed (${err instanceof Error ? err.message : err})`);
      }
    }
  }
  save();
  console.log(`total $${spent.toFixed(4)}`);
});
