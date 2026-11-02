/**
 * Living dates, measured (docs/date-quality.md "Round: living dates"): twenty fixed dates generated in-process by the
 * real pipeline (lib/pipeline.ts generateDate), on an OpenRouter key, never the live show's Gemini quota (an eval on the
 * shared quota once took the show down, 2026-10-15). Built in memory like lib/eval.ts: no database, nothing stored.
 *
 *   # generate one arm (the code checked out is the arm)
 *   LIVING_EVAL_KEY="$(security find-generic-password -s vault/botchelor/OPENROUTER_LOOP_KEY -w)" \
 *   LIVING_EVAL_MODE=generate LIVING_EVAL_LABEL=before LIVING_EVAL_OUT=<dir> \
 *     npx vitest run --config scripts/eval/vitest.eval.mts
 *   # judge two arms blind, both orders (A = the first file, B = the second)
 *   LIVING_EVAL_KEY=… LIVING_EVAL_MODE=judge LIVING_EVAL_A=<dir>/before.json LIVING_EVAL_B=<dir>/after.json LIVING_EVAL_OUT=<dir> \
 *     npx vitest run --config scripts/eval/vitest.eval.mts
 *
 * Options (environment): LIVING_EVAL_MODEL (default anthropic/claude-haiku-5.5, what the show's dates run on),
 * LIVING_EVAL_JUDGE (default deepseek/deepseek-chat-v3.1: another family, so it doesn't favour its own style),
 * LIVING_EVAL_CASES (a comma list of case ids), LIVING_EVAL_CONCURRENCY (3), LIVING_EVAL_MAX_USD (2: stops before
 * going past it, counting what OpenRouter reports each call cost).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { Character } from "@/lib/character";
import { deterministicEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES, type EvalCase } from "@/lib/eval";
import { formatContextOf } from "@/lib/formats";
import { openAICompatibleModel, type ChatMessage, type Model, type Usage } from "@/lib/model";
import { generateDate } from "@/lib/pipeline";
import { transcriptQuality } from "@/lib/quality";
import { qualityContext } from "@/lib/pipeline";

const env = process.env;
const MODE = env.LIVING_EVAL_MODE ?? "";
const KEY = env.LIVING_EVAL_KEY ?? "";
const OUT = env.LIVING_EVAL_OUT ?? "";
const MODEL = env.LIVING_EVAL_MODEL || "anthropic/claude-haiku-5.5";
const JUDGE = env.LIVING_EVAL_JUDGE || "deepseek/deepseek-chat-v3.1";
const MAX_USD = Number(env.LIVING_EVAL_MAX_USD || 2);
const CONCURRENCY = Math.max(1, Number(env.LIVING_EVAL_CONCURRENCY || 3));
const GATEWAY = "https://openrouter.ai/api/v1";

/** The six standing eval cases and fourteen more house pairings: twenty dates, the same seeds every run. */
export const LIVING_CASES: readonly EvalCase[] = [
  ...EVAL_CASES,
  ...(
    [
      ["house-dex", "house-marisol", 101],
      ["house-sable", "house-wally", 102],
      ["house-imogen", "house-boaz", 103],
      ["house-perpetua", "house-lior", 104],
      ["house-vesper", "house-odalys", 105],
      ["house-juniper", "house-teo", 106],
      ["house-nell", "house-rafe", 107],
      ["house-marisol", "house-orin", 108],
      ["house-ines", "house-kaz", 109],
      ["house-boaz", "house-sable", 110],
      ["house-lior", "house-imogen", 111],
      ["house-odalys", "house-dex", 112],
      ["house-wally", "house-perpetua", 113],
      ["eval-rich-oc", "house-vesper", 114],
    ] as const
  ).map(([a, b, seed]) => ({ id: `${a.slice(a.indexOf("-") + 1)}-${b.slice(b.indexOf("-") + 1)}`, a, b, format: "classic" as const, seed, why: "a house pairing" })),
];

let spent = 0;
/** A model that adds what OpenRouter says each call cost, and refuses once the run's budget is spent. */
function paid(model: string): Model {
  const inner = openAICompatibleModel({ baseUrl: GATEWAY, apiKey: KEY, model, timeoutMs: 90_000, extraBody: { usage: { include: true } } });
  return {
    async complete(messages: ChatMessage[], options) {
      if (spent >= MAX_USD) throw new Error(`eval budget spent ($${spent.toFixed(3)} of $${MAX_USD})`);
      return inner.complete(messages, {
        ...options,
        onUsage: (u: Usage) => {
          spent += u.cost ?? 0;
          options?.onUsage?.(u);
        },
      });
    },
  };
}

/** A date's cost: what OpenRouter reported for its calls. */
function costing(model: Model): { model: Model; cost: () => number } {
  let c = 0;
  return {
    model: { complete: (m, o) => model.complete(m, { ...o, onUsage: (u) => ((c += u.cost ?? 0), o?.onUsage?.(u)) }) },
    cost: () => Math.round(c * 1e6) / 1e6,
  };
}

async function pool<T, R>(items: readonly T[], n: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i]);
      }
    }),
  );
  return out;
}

async function generate(): Promise<void> {
  const label = env.LIVING_EVAL_LABEL || "arm";
  const pick = env.LIVING_EVAL_CASES ? new Set(env.LIVING_EVAL_CASES.split(",")) : null;
  const cases = LIVING_CASES.filter((c) => !pick || pick.has(c.id));
  // The living-dates arm derives each character's hot takes once (lib/hot-takes.ts), cached across runs; an arm from
  // before it has no such module and plays without.
  const takes = await import("@/lib/hot-takes").catch(() => null);
  // ...and a house character carries this season's secrets, to guard or let slip (lib/cast-secrets.ts): the pool's.
  const secrets = await import("@/lib/cast-secrets").catch(() => null);
  const carriesSecrets = Boolean(secrets && "secretsForDate" in secrets);
  const takesFile = join(OUT, "hot-takes.json");
  const cache: Record<string, string[]> = existsSync(takesFile) ? JSON.parse(readFileSync(takesFile, "utf8")) : {};
  const results = await pool(cases, CONCURRENCY, async (c) => {
    const built = buildEvalDate(c);
    if (takes) {
      for (const ch of built.characters as Character[]) {
        if (!cache[ch.id]) cache[ch.id] = (await takes.deriveHotTakes(paid(MODEL), ch).catch(() => null)) ?? takes.fallbackHotTakes(ch);
        ch.hotTakes = cache[ch.id];
      }
    }
    if (carriesSecrets && secrets) {
      for (const ch of built.characters as Character[]) {
        if (ch.house) (ch as Character & { secrets?: unknown }).secrets = secrets.dealtSecrets(ch.id, "eval").map((secret, idx) => ({ season_id: "eval", idx, secret }));
      }
    }
    const version = built.setup.engine_version;
    const outcome = deterministicEngine.decide(built.input, built.seed, version as never);
    const actor = costing(paid(MODEL));
    const t0 = Date.now();
    const gen = await generateDate({ actor: actor.model, director: actor.model }, built, outcome, {
      formatId: c.format,
      formatCtx: formatContextOf(built),
      conversation: true,
      afterglow: env.LIVING_EVAL_AFTERGLOW === "1",
      reflection: false,
      wishes: true,
      ...({ engineVersion: version } as object),
    });
    const characters = built.characters as [Character, Character];
    const metrics = gen.quality ?? transcriptQuality(gen.transcript, characters, qualityContext(built, gen.draft.setting));
    const g = gen as unknown as Record<string, unknown>;
    console.log(`[${label}] ${c.id}: ${outcome.ending} → ${gen.outcome.ending}${(gen.outcome as { detail?: string }).detail ? ` (${(gen.outcome as { detail?: string }).detail})` : ""}, ${gen.transcript.length} lines, $${actor.cost()}, total $${spent.toFixed(3)}`);
    return {
      case: c.id,
      characters: characters.map((x) => x.name),
      engine_ending: outcome.ending,
      ending: gen.outcome.ending,
      detail: (gen.outcome as { detail?: string }).detail ?? null,
      transcript: gen.transcript.map((t) => ({ side: t.side, act: t.act, dialogue: t.dialogue, action: t.action, emotion: t.emotion })),
      inner: g.inner ?? null,
      slips: g.slips ?? [],
      afterglow: gen.afterglow,
      recap: { setting: gen.draft.setting, best_line: gen.draft.best_line },
      genuineness: metrics.index ?? null,
      metrics,
      calls: gen.modelCalls,
      cost_usd: actor.cost(),
      ms: Date.now() - t0,
      conversation_error: gen.conversationError ? String(gen.conversationError).slice(0, 200) : null,
    };
  });
  mkdirSync(OUT, { recursive: true });
  if (takes) writeFileSync(takesFile, JSON.stringify(cache, null, 2));
  const n = results.length;
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);
  const mix = (k: "engine_ending" | "ending") => Object.fromEntries(["second_date", "friends", "disaster"].map((e) => [e, results.filter((r) => r[k] === e).length]));
  const summary = {
    label,
    model: MODEL,
    dates: n,
    failed: results.filter((r) => r.conversation_error || !r.transcript.length).length,
    mean_cost_usd: mean(results.map((r) => r.cost_usd)),
    mean_calls: mean(results.map((r) => r.calls)),
    mean_lines: mean(results.map((r) => r.transcript.length)),
    mean_genuineness: mean(results.map((r) => Number(r.genuineness)).filter(Number.isFinite)),
    engine_mix: mix("engine_ending"),
    final_mix: mix("ending"),
    secrets_slipped: results.reduce((n, r) => n + ((r.slips as unknown[]) ?? []).length, 0),
    with_thoughts: results.filter((r) => (r.inner as { lines?: ({ thought?: string } | null)[] } | null)?.lines?.some((l) => l?.thought)).length,
    choices: results.map((r) => (r.inner as { choices?: { a: { see_again: string }; b: { see_again: string } } } | null)?.choices).filter(Boolean).map((c) => `${c!.a.see_again}/${c!.b.see_again}`),
    details: Object.fromEntries([...new Set(results.map((r) => r.detail ?? "none"))].map((d) => [d, results.filter((r) => (r.detail ?? "none") === d).length])),
    spent_usd: Math.round(spent * 1e4) / 1e4,
  };
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

type Arm = { summary: unknown; results: { case: string; characters: string[]; transcript: { side: string; dialogue: string; action: string }[] }[] };

const JUDGE_SYSTEM = `You compare two versions of the same blind date between the same two fictional characters on a TV dating show. You are an exacting script editor and hard to impress. Judge only the dialogue as written.
Read both and decide:
1. "better": which one you would rather watch: truer to who these two are, more specific and less generic, the better scene.
2. "alive": which one feels more like two real people rather than two performers. Real people hold opinions and push back, notice what the other says (and doubt it when it doesn't add up), carry how they feel from one line to the next, and get to their goodbye because of what happened, not because the scene needed one.
Answer "1", "2" or "tie" for each, and give one short reason each. Reply with ONLY a JSON object: {"better":"1|2|tie","alive":"1|2|tie","why_better":"","why_alive":""}`;

const asText = (t: Arm["results"][number], names: string[]) =>
  t.transcript.map((l) => `${names[l.side === "a" ? 0 : 1]}: ${l.dialogue}${l.action ? ` [${l.action}]` : ""}`).join("\n");

async function judge(): Promise<void> {
  const A = JSON.parse(readFileSync(env.LIVING_EVAL_A!, "utf8")) as Arm;
  const B = JSON.parse(readFileSync(env.LIVING_EVAL_B!, "utf8")) as Arm;
  const model = paid(JUDGE);
  const pairs = A.results.flatMap((a) => {
    const b = B.results.find((x) => x.case === a.case);
    return b && a.transcript.length && b.transcript.length ? [{ a, b }] : [];
  });
  const verdicts = await pool(pairs, CONCURRENCY, async ({ a, b }) => {
    const names = a.characters;
    const ask = async (first: Arm["results"][number], second: Arm["results"][number]) => {
      const raw = await model
        .complete(
          [
            { role: "system", content: JUDGE_SYSTEM },
            { role: "user", content: `The characters: ${names.join(" and ")}.\n\nVERSION 1:\n${asText(first, names)}\n\nVERSION 2:\n${asText(second, names)}` },
          ],
          { temperature: 0.2 },
        )
        .catch(() => "");
      try {
        const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, string>;
        return j;
      } catch {
        return null;
      }
    };
    // Both orders: B +1, A −1, tie 0 per pass; summed, so a split (each pass picked whichever came first) is a tie.
    const p1 = await ask(a, b); // 1 = A, 2 = B
    const p2 = await ask(b, a); // 1 = B, 2 = A
    const vote = (j: Record<string, string> | null, key: string, bIs: "1" | "2") => (!j ? 0 : j[key] === bIs ? 1 : j[key] === "tie" ? 0 : j[key] === (bIs === "1" ? "2" : "1") ? -1 : 0);
    const better = vote(p1, "better", "2") + vote(p2, "better", "1");
    const alive = vote(p1, "alive", "2") + vote(p2, "alive", "1");
    const firstPicked = [p1, p2].filter((j) => j?.better === "1").length;
    return { case: a.case, better, alive, firstPicked, why: [p1?.why_better, p2?.why_better, p1?.why_alive, p2?.why_alive].filter(Boolean) };
  });
  const tally = (k: "better" | "alive") => {
    const w = verdicts.filter((v) => v[k] > 0).length;
    const l = verdicts.filter((v) => v[k] < 0).length;
    const t = verdicts.length - w - l;
    // The exact two-sided sign test on the decided cases.
    const n = w + l;
    let p = 0;
    const choose = (nn: number, kk: number) => { let r = 1; for (let i = 1; i <= kk; i++) r = (r * (nn - kk + i)) / i; return r; };
    for (let i = 0; i <= n; i++) if (Math.abs(i - n / 2) >= Math.abs(w - n / 2)) p += choose(n, i) / 2 ** n;
    return { b_wins: w, a_wins: l, ties: t, b_win_rate: verdicts.length ? Math.round(((w + t / 2) / verdicts.length) * 1000) / 1000 : null, sign_test_p: n ? Math.round(Math.min(1, p) * 1000) / 1000 : null };
  };
  const report = { judge: JUDGE, cases: verdicts.length, better: tally("better"), alive: tally("alive"), first_position_picked: verdicts.reduce((n, v) => n + v.firstPicked, 0), spent_usd: Math.round(spent * 1e4) / 1e4, verdicts };
  writeFileSync(join(OUT, "judge.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, verdicts: undefined }, null, 2));
}

it("living dates eval", async () => {
  if (!KEY || !OUT) throw new Error("LIVING_EVAL_KEY and LIVING_EVAL_OUT must be set");
  if (MODE === "generate") await generate();
  else if (MODE === "judge") await judge();
  else throw new Error("LIVING_EVAL_MODE is generate or judge");
});
