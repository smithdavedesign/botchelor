/**
 * Earned endings (lib/date-turn.ts; docs/date-quality.md "Round: endings the dialogue earns"): does a date the engine
 * decided will end badly read as motivated when its rules plan carries a turn, without reading less natural? A fixed set
 * of dates the engine decides as a disaster or "just friends" (and two it decides well, for the wobble), each generated
 * in-process by the real pipeline from the rules plan, once with EARNED_ENDINGS off ("before") and once with it on
 * ("after"), and scored by the repo's judge (lib/judge.ts: its "motivated" and "natural" scores are the ones this round
 * is about) and the free metrics (lib/quality.ts). The same harness as scripts/eval/night-plan.eval.ts, whose rules arm
 * found the problem (motivated 2.0 of 5).
 *
 * On an OpenRouter key, never the live show's quota, one call at a time; it stops before EARNED_EVAL_MAX_USD.
 *
 *   EARNED_EVAL_KEY="$(security find-generic-password -s vault/botchelor/OPENROUTER_LOOP_KEY -w)" EARNED_EVAL_OUT=<dir> \
 *     npx vitest run --config scripts/eval/vitest.eval.mts scripts/eval/earned-endings.eval.ts
 *
 * EARNED_EVAL_ARMS=before|after|before,after (default both); EARNED_EVAL_CASES picks cases by id; EARNED_EVAL_MODEL the
 * dates' and the judge's model; EARNED_EVAL_TAG names the output file (earned-endings-<tag>.json), so a second run
 * doesn't overwrite the first. EARNED_EVAL_LIST=1 needs no key: it prints what the engine decides for a grid of house
 * pairs and seeds (how the cases below were picked) and each case's turn.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { rulesPlan } from "@/lib/beats";
import { turnStart, withTurn } from "@/lib/date-turn";
import { format } from "@/lib/formats";
import { CONVERSATION_TURNS } from "@/lib/rules";
import type { Character } from "@/lib/character";
import { askChoices, choiceEnding } from "@/lib/choices";
import { deterministicEngine } from "@/lib/engine";
import { buildEvalDate, type EvalCase } from "@/lib/eval";
import { formatContextOf } from "@/lib/formats";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { judgeDate, judgeMean } from "@/lib/judge";
import { openAICompatibleModel, type ChatMessage, type Model, type Usage } from "@/lib/model";
import { generateDate, qualityContext } from "@/lib/pipeline";
import { transcriptQuality } from "@/lib/quality";
import type { Heard, Opinion, StoryState } from "@/lib/story-state";
import { venue } from "@/lib/venues";

const env = process.env;
const KEY = env.EARNED_EVAL_KEY ?? "";
const OUT = env.EARNED_EVAL_OUT ?? "";
const MODEL = env.EARNED_EVAL_MODEL || "anthropic/claude-haiku-5.5";
const MAX_USD = Number(env.EARNED_EVAL_MAX_USD || 0.25);
const TAG = env.EARNED_EVAL_TAG || "run";
const GATEWAY = "https://openrouter.ai/api/v1";
const AT = "2026-11-15T20:00:00.000Z";

type Seed = { take: string; trust: number; heard: { claim: string; by: string | null }[]; want: string };
/**
 * The cases: seeds picked (EARNED_EVAL_LIST=1) so the engine decides four disasters, three "just friends" and two second
 * dates across different voices. One carries a seeded story state (what each heard about the other, a want for the
 * week), as a date on the live show can; the claims are made up for the eval (the night-plan eval's).
 */
export const EARNED_CASES: readonly (EvalCase & { story?: [Seed | null, Seed | null] })[] = [
  // Disasters.
  {
    id: "rafe-juniper", a: "house-rafe", b: "house-juniper", format: "classic", seed: 7, why: "the date the night-plan eval scored 2.0 from the rules plan; each has heard something about the other",
    story: [
      { take: "Dex told me: Juniper said she only came on the show to settle a bet.", trust: -1, heard: [{ claim: "Juniper said she only came on the show to settle a bet.", by: "Dex Okafor" }], want: "Find out whether Juniper really said it, and hear it from Juniper." },
      { take: "Sable told me: Rafe rehearses his 'spontaneous' toasts in the mirror.", trust: 0, heard: [{ claim: "Rafe rehearses his 'spontaneous' toasts in the mirror.", by: "Sable Quist" }], want: "Rafe knows what you said. Decide whether you stand by it." },
    ],
  },
  { id: "mira-dex", a: "eval-rich-oc", b: "house-dex", format: "classic", seed: 3, why: "a visitor with a full private soul; nothing heard, no history" },
  { id: "wally-perpetua", a: "house-wally", b: "house-perpetua", format: "classic", seed: 2, why: "one agenda pays off and one doesn't; she leaves first" },
  { id: "kaz-nell", a: "house-kaz", b: "house-nell", format: "speed_date", seed: 13, why: "a speed date: six lines to turn in" },
  // Just friends.
  { id: "teo-nell", a: "house-teo", b: "house-nell", format: "classic", seed: 2, why: "friends, her agenda missed" },
  { id: "sable-orin", a: "house-sable", b: "house-orin", format: "classic", seed: 3, why: "friends, neither agenda pays off" },
  { id: "imogen-kaz", a: "house-imogen", b: "house-kaz", format: "classic", seed: 8, why: "friends with both agendas met: nothing in the facts says why it isn't romance" },
  // Second dates: one with nothing to wobble on (both arms get the same prompts: the noise between two runs), one with a missed agenda.
  { id: "dex-marisol", a: "house-dex", b: "house-marisol", format: "classic", seed: 4, why: "a second date with both agendas met: no turn either way (the noise)" },
  { id: "sable-orin-2", a: "house-sable", b: "house-orin", format: "classic", seed: 4, why: "a second date where one agenda misses: the wobble" },
];

function seeded(me: Character, them: Character, s: Seed, n: number): StoryState {
  const opinion: Opinion = { holder_id: me.id, about_id: them.id, about_name: them.name, trust: s.trust, attraction: null, take: s.take, basis: "heard", source: `eval:${n}`, source_at: AT, updated_at: AT };
  const heard: Heard[] = s.heard.map((h, i) => ({
    id: `eval-h-${n}-${i}`, holder_id: me.id, about_id: them.id, about_name: them.name, about_b_id: null, about_b_name: null, claim: h.claim,
    told_by: h.by ? `eval-teller-${i}` : null, told_by_name: h.by, source: `eval:${n}:${i}`, is_true: true, heard_at: AT, used_at: null, used_in: null,
  }));
  return { holder_id: me.id, with_id: them.id, opinions: [opinion], heard, want: { holder_id: me.id, season_id: "2026-11-01", week_id: "2026-11-09", want: s.want, about_id: them.id, kind: "prove", set_by: "producer" } };
}

function fresh(c: (typeof EARNED_CASES)[number]) {
  const built = buildEvalDate(c);
  const [a, b] = built.characters as [Character, Character];
  if (c.story?.[0]) a.story = seeded(a, b, c.story[0], 0);
  if (c.story?.[1]) b.story = seeded(b, a, c.story[1], 1);
  const version = built.setup.engine_version;
  return { built, a, b, version, outcome: deterministicEngine.decide(built.input, built.seed, version as never) };
}

let spent = 0;
function paid(model: string): Model {
  const inner = openAICompatibleModel({ baseUrl: GATEWAY, apiKey: KEY, model, timeoutMs: 90_000, extraBody: { usage: { include: true } } });
  return {
    async complete(messages: ChatMessage[], options) {
      if (spent >= MAX_USD) throw new Error(`eval budget spent ($${spent.toFixed(3)} of $${MAX_USD})`);
      return inner.complete(messages, { ...options, onUsage: (u: Usage) => ((spent += u.cost ?? 0), options?.onUsage?.(u)) });
    },
  };
}

it.skipIf(env.EARNED_EVAL_LIST !== "1")("what the engine decides for house pairs and seeds (how the cases were picked)", () => {
  const ids = ALL_HOUSE_CHARACTERS.slice(0, 14).map((h) => h.id);
  for (let i = 0; i < ids.length; i += 2) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const c: EvalCase = { id: `${ids[i]}-${ids[i + 1]}-${seed}`, a: ids[i], b: ids[i + 1], format: "classic", seed, why: "" };
      const d = fresh(c);
      const o = d.outcome;
      console.log(`${c.id}: ${o.ending} wants ${o.sides.map((s) => (s.wants_another ? "y" : "n")).join("")} agenda ${o.sides.map((s) => (s.agenda_met ? "y" : "n")).join("")} dealbreaker ${o.sides.map((s) => s.dealbreaker_hit ?? "-").join("/")} want ${o.sides.map((s) => s.want_met ?? "-").join("/")} ${o.drama_question}:${o.drama_answer}`);
    }
  }
  for (const c of EARNED_CASES) {
    const d = fresh(c);
    const plan = withTurn(rulesPlan(d.built.input, d.outcome, [d.a, d.b], d.built.setup.producer, d.built.setup.venue), d.built.input, d.outcome, [d.a, d.b]);
    const total = format(c.format).turns ?? CONVERSATION_TURNS;
    console.log(`\n== ${c.id}: ${d.outcome.ending}, ${total} lines, the turn starts on line ${plan.turn ? (turnStart(plan.turn, total) ?? -1) + 1 : "(none)"}\n${JSON.stringify(plan.turn ?? null, null, 2)}`);
  }
});

it.skipIf(!KEY || !OUT)("earned endings: the same dates from the rules plan, with and without the turn", async () => {
  mkdirSync(OUT, { recursive: true });
  const pick = env.EARNED_EVAL_CASES ? new Set(env.EARNED_EVAL_CASES.split(",")) : null;
  const arms = (env.EARNED_EVAL_ARMS || "before,after").split(",").filter((a): a is "before" | "after" => a === "before" || a === "after");
  const cases = EARNED_CASES.filter((c) => !pick || pick.has(c.id));
  const results: unknown[] = [];
  const save = () => writeFileSync(join(OUT, `earned-endings-${TAG}.json`), JSON.stringify({ model: MODEL, spent_usd: Math.round(spent * 1e4) / 1e4, results }, null, 2));
  for (const c of cases) {
    for (const arm of arms) {
      // The switch as the live show reads it (lib/date-turn.ts earnedEndingsOn): the rules plan carries the turn or not.
      env.EARNED_ENDINGS = arm === "after" ? "1" : "0";
      try {
        const d = fresh(c);
        const model = paid(MODEL);
        const before = spent;
        const gen = await generateDate({ actor: model, director: model }, d.built, d.outcome, {
          formatId: c.format,
          formatCtx: formatContextOf(d.built),
          conversation: true,
          afterglow: false,
          reflection: false,
          wishes: false,
          plan: "rules",
          ...({ engineVersion: d.version } as object),
        });
        const dateCost = spent - before;
        const metrics = gen.quality ?? transcriptQuality(gen.transcript, [d.a, d.b], qualityContext(d.built, gen.draft.setting));
        const verdict = await judgeDate(paid(MODEL), [d.a, d.b], gen.outcome, gen.transcript, venue(d.built.setup.venue).prompt, d.built.input.date_number).catch(() => null);
        const mean = verdict ? judgeMean(verdict) : null;
        // Each side's own "see them again?" (lib/choices.ts), asked as the live show asks it but not applied here (the
        // judge scores the engine's ending in both arms): would their answers have kept the ending the engine decided?
        const choices = await askChoices(paid(MODEL), [d.a, d.b], gen.transcript).catch(() => null);
        const wouldEnd = choices ? choiceEnding(d.outcome.ending, choices.a.see_again, choices.b.see_again, d.outcome.margin) : null;
        const own = choices ? `${choices.a.see_again}/${choices.b.see_again} -> ${wouldEnd}` : "?";
        console.log(`[${arm}] ${c.id}: ${gen.outcome.ending}, ${gen.transcript.length} lines, index ${metrics.index}, judge ${mean ?? "none"} (motivated ${verdict?.motivated ?? "?"}, natural ${verdict?.natural ?? "?"}), own answers ${own}, date $${dateCost.toFixed(4)} (total $${spent.toFixed(3)})`);
        results.push({
          case: c.id,
          arm,
          decided: d.outcome.ending,
          ending: gen.outcome.ending,
          index: metrics.index,
          judge: verdict,
          judge_mean: mean,
          own_answers: choices ? { a: choices.a.see_again, b: choices.b.see_again, would_end: wouldEnd } : null,
          model_calls: gen.modelCalls,
          cost_usd: Math.round(dateCost * 1e5) / 1e5,
          turn: (gen.plan as { turn?: unknown } | null)?.turn ?? null,
          transcript: gen.transcript.map((t, i) => ({ n: i + 1, who: t.side === "a" ? d.a.name : d.b.name, said: t.dialogue, ...(t.action ? { did: t.action } : {}) })),
          feelings: (gen.inner?.lines ?? []).map((l) => l?.feeling ?? null),
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
