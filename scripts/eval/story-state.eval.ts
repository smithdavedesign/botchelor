/**
 * The story state on real dates (lib/story-state.ts; docs/character-depth.md "Story state"): does a date still read
 * well with each side's private block in its prompt, and does gossip come up occasionally, not on every line? Three
 * fixed first dates between house characters, each generated twice in-process by the real pipeline: once as before
 * (no story state) and once with a seeded one (what each has heard about the other, its opinion from that, a want).
 * On an OpenRouter key, never the live show's quota (docs/date-quality.md), one date at a time, and it stops before
 * STORY_EVAL_MAX_USD (default 0.25).
 *
 *   STORY_EVAL_KEY="$(security find-generic-password -s vault/botchelor/OPENROUTER_LOOP_KEY -w)" STORY_EVAL_OUT=<dir> \
 *     npx vitest run --config scripts/eval/vitest.eval.mts scripts/eval/story-state.eval.ts
 *
 * Writes <dir>/story-state.json (both arms' transcripts, and which lines brought a heard claim up, as the date's own
 * check counted them) and prints a summary. STORY_EVAL_CASES picks cases; STORY_EVAL_MODEL the model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { Character } from "@/lib/character";
import { deterministicEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { formatContextOf } from "@/lib/formats";
import { openAICompatibleModel, type ChatMessage, type Model, type Usage } from "@/lib/model";
import { generateDate } from "@/lib/pipeline";
import type { Heard, Opinion, StoryState } from "@/lib/story-state";

const env = process.env;
const KEY = env.STORY_EVAL_KEY ?? "";
const OUT = env.STORY_EVAL_OUT ?? "";
const MODEL = env.STORY_EVAL_MODEL || "anthropic/claude-haiku-5.5";
const MAX_USD = Number(env.STORY_EVAL_MAX_USD || 0.25);
const GATEWAY = "https://openrouter.ai/api/v1";
const AT = "2026-11-14T20:00:00.000Z";

type Seed = { take: string; trust: number; heard: { claim: string; by: string | null }[]; want: string };
/** What each side carries into the date, by case: [side a about b, side b about a]. Claims are made up for the eval. */
const SEEDS: Record<string, [Seed, Seed]> = {
  "rafe-juniper": [
    {
      take: "Dex told me: Juniper said she only came on the show to settle a bet.",
      trust: -1,
      heard: [
        { claim: "Juniper said she only came on the show to settle a bet.", by: "Dex Okafor" },
        { claim: "Juniper and Teo's first date at the rooftop bar: Teo turned Juniper down.", by: null },
      ],
      want: "Meet someone new and see whether it sticks.",
    },
    { take: "Sable told me: Rafe rehearses his 'spontaneous' toasts in the mirror.", trust: 0, heard: [{ claim: "Rafe rehearses his 'spontaneous' toasts in the mirror.", by: "Sable Quist" }], want: "Prove that a date with you can end well." },
  ],
  "teo-ines": [
    { take: "Nell told me: Ines keeps a spreadsheet of everyone she has dated, with scores.", trust: 0, heard: [{ claim: "Ines keeps a spreadsheet of everyone she has dated, with scores.", by: "Nell Abiodun" }], want: "Get closer to someone who doesn't fall for the easy line." },
    {
      take: "Marisol told me: Teo used the same line about constellations on three dates in a week.",
      trust: -1,
      heard: [
        { claim: "Teo used the same line about constellations on three dates in a week.", by: "Marisol Pine" },
        { claim: "Teo and Sable's second date at the night market: Sable walked out.", by: null },
      ],
      want: "Steer clear of charm until you know whether what you heard is true.",
    },
  ],
  "mira-dex": [
    { take: "Juniper told me: Dex left his last date early to feed a stranger's parking meter.", trust: 1, heard: [{ claim: "Dex left his last date early to feed a stranger's parking meter.", by: "Juniper Vale" }], want: "Meet someone new and see whether it sticks." },
    { take: "I haven't made up my mind about her.", trust: 0, heard: [{ claim: "Mira and Orin's first date at the tide pools: they parted as friends.", by: null }], want: "Prove that a date with you can end well." },
  ],
};

function seeded(me: Character, them: Character, s: Seed, n: number): StoryState {
  const opinion: Opinion = { holder_id: me.id, about_id: them.id, about_name: them.name, trust: s.trust, attraction: null, take: s.take, basis: "heard", source: `eval:${n}`, source_at: AT, updated_at: AT };
  const heard: Heard[] = s.heard.map((h, i) => ({
    id: `eval-h-${n}-${i}`,
    holder_id: me.id,
    about_id: them.id,
    about_name: them.name,
    about_b_id: null,
    about_b_name: null,
    claim: h.claim,
    told_by: h.by ? `eval-teller-${i}` : null,
    told_by_name: h.by,
    source: `eval:${n}:${i}`,
    is_true: true,
    heard_at: AT,
    used_at: null,
    used_in: null,
  }));
  return { holder_id: me.id, with_id: them.id, opinions: [opinion], heard, want: { holder_id: me.id, season_id: "2026-11-01", week_id: "2026-11-09", want: s.want, about_id: null, kind: "pursue", set_by: "rules" } };
}

let spent = 0;
function paid(): Model {
  const inner = openAICompatibleModel({ baseUrl: GATEWAY, apiKey: KEY, model: MODEL, timeoutMs: 90_000, extraBody: { usage: { include: true } } });
  return {
    async complete(messages: ChatMessage[], options) {
      if (spent >= MAX_USD) throw new Error(`eval budget spent ($${spent.toFixed(3)} of $${MAX_USD})`);
      return inner.complete(messages, { ...options, onUsage: (u: Usage) => ((spent += u.cost ?? 0), options?.onUsage?.(u)) });
    },
  };
}

it.skipIf(!KEY || !OUT)("story state: dates before and after, on a paid model", async () => {
  mkdirSync(OUT, { recursive: true });
  const pick = env.STORY_EVAL_CASES ? new Set(env.STORY_EVAL_CASES.split(",")) : null;
  const arms = (env.STORY_EVAL_ARMS ?? "before,after").split(",") as ("before" | "after")[];
  const cases = EVAL_CASES.filter((c) => SEEDS[c.id] && (!pick || pick.has(c.id)));
  const results: unknown[] = [];
  for (const c of cases) {
    for (const arm of arms) {
      const built = buildEvalDate(c);
      const [a, b] = built.characters as [Character, Character];
      if (arm === "after") {
        a.story = seeded(a, b, SEEDS[c.id][0], 0);
        b.story = seeded(b, a, SEEDS[c.id][1], 1);
      }
      const version = built.setup.engine_version;
      const outcome = deterministicEngine.decide(built.input, built.seed, version as never);
      const model = paid();
      const before = spent;
      const gen = await generateDate({ actor: model, director: model }, built, outcome, {
        formatId: c.format,
        formatCtx: formatContextOf(built),
        conversation: true,
        afterglow: false,
        reflection: false,
        wishes: false,
        ...({ engineVersion: version } as object),
      });
      const lines = gen.inner?.lines ?? [];
      const brought = gen.transcript.flatMap((t, i) => (lines[i]?.heard ? [{ line: i + 1, who: t.side === "a" ? a.name : b.name, said: t.dialogue, heard: lines[i]!.heard }] : []));
      console.log(`[${arm}] ${c.id}: ${gen.outcome.ending}, ${gen.transcript.length} lines, brought up ${brought.length}, $${(spent - before).toFixed(4)} (total $${spent.toFixed(3)})`);
      for (const x of brought) console.log(`    line ${x.line} ${x.who}: ${x.said}`);
      results.push({
        case: c.id,
        arm,
        ending: gen.outcome.ending,
        cost_usd: Math.round((spent - before) * 1e5) / 1e5,
        brought_up: brought,
        transcript: gen.transcript.map((t, i) => ({ n: i + 1, who: t.side === "a" ? a.name : b.name, said: t.dialogue, ...(t.action ? { did: t.action } : {}), ...(lines[i]?.thought ? { thought: lines[i]!.thought } : {}) })),
      });
      writeFileSync(join(OUT, "story-state.json"), JSON.stringify({ model: MODEL, spent_usd: Math.round(spent * 1e4) / 1e4, results }, null, 2));
    }
  }
  console.log(`total $${spent.toFixed(4)}`);
});
