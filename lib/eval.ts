/**
 * The date-quality eval (Phase 2, docs/date-quality.md). A fixed set of dates — the same characters, formats
 * and seeds every run, so the engine decides the same outcomes — generated with whatever pipeline and models
 * are under test, then scored by the deterministic metrics (lib/quality.ts) and the rubric judge
 * (lib/judge.ts). Comparing two runs answers "did that change make dates more genuine?" with numbers.
 *
 * Dates are built in memory from the house cast plus two synthetic visitor characters (never real user data):
 * nothing is read from or written to the database, so an eval can run against production's model key
 * (POST /api/jobs/eval) without touching a stored date.
 */
import type { Character } from "./character";
import type { Turn } from "./conversation";
import { deterministicEngine, type CharacterSheet, type Outcome } from "./engine";
import type { FormatId } from "./formats";
import { ALL_HOUSE_CHARACTERS } from "./house";
import { judgeDate, judgeMean, type JudgeScores } from "./judge";
import type { Model } from "./model";
import { generateDate, qualityContext, type DateModels } from "./pipeline";
import { transcriptQuality, type QualityMetrics } from "./quality";
import { ENDING_LABELS } from "./rules";
import { assembleDate, DEFAULT_DATE_REQUEST, type BuiltDate, type CharacterForDate } from "./simulation";
import type { StoredSoul } from "./souls";
import { venue } from "./venues";

type EvalCharacter = { forDate: CharacterForDate; soul: StoredSoul | null };

const EMPTY_SOUL = { values: "", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "" };

/** Synthetic visitor characters: one as thin as real sign-ups often are, one fully written with a soul. */
const FIXTURES: Record<string, EvalCharacter> = {
  "eval-thin-oc": {
    forDate: {
      id: "eval-thin-oc",
      sheet: {
        name: "Jordan Pike",
        age: 22,
        bio: "a dude",
        traits: ["hot", "cool", "naughty"],
        want: "fun",
        dealbreaker: "boring people",
        house: false,
        appearance: "a cool blue palette, dark and vivid",
        pronouns: "he/him",
      },
    },
    soul: null,
  },
  "eval-rich-oc": {
    forDate: {
      id: "eval-rich-oc",
      sheet: {
        name: "Mira Quell",
        age: 27,
        bio: "A cartographer who maps cities that only exist on Tuesdays.",
        traits: ["curious", "stubborn", "warm"],
        want: "Someone who can read a map upside down",
        dealbreaker: "People who hate surprises",
        house: false,
        appearance: "ink-stained cuffs, a compass on a chain",
        pronouns: "she/her",
      },
    },
    soul: {
      values: "Honesty even when it's awkward; leaving places better than she found them.",
      insecurities: "Worries she's only interesting on paper.",
      humor: "Geography puns; laughs at her own joke before the punchline.",
      boundaries: "Doesn't talk about her family on a first date.",
      romantic: "Falls for people who get lost on purpose.",
      communication: "Talks with her hands; draws maps on napkins when she can't find the word.",
      local_only: false,
      signals: null,
    },
  },
};

function houseCharacter(id: string): EvalCharacter | null {
  const c = ALL_HOUSE_CHARACTERS.find((h) => h.id === id);
  if (!c) return null;
  const sheet: CharacterSheet = {
    name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker,
    house: true, appearance: c.appearance, pronouns: c.pronouns, voice: c.voice,
  };
  // As stored: a house soul is engine-only signals, no text.
  return { forDate: { id: c.id, sheet }, soul: { ...EMPTY_SOUL, local_only: true, signals: c.signals } };
}

export function evalCharacter(id: string): EvalCharacter {
  const c = FIXTURES[id] ?? houseCharacter(id);
  if (!c) throw new Error(`unknown eval character ${id}`);
  return c;
}

export type EvalCase = { id: string; a: string; b: string; format: FormatId; seed: number; why: string };

/** The fixed eval set: each case stresses a different way a date can feel fake. Seeds chosen for a mix of endings. */
export const EVAL_CASES: readonly EvalCase[] = [
  { id: "thin-oc-juniper", a: "eval-thin-oc", b: "house-juniper", format: "classic", seed: 11, why: "a thin visitor sheet against a rich house voice; misgendering; profile-reading" },
  { id: "rafe-juniper", a: "house-rafe", b: "house-juniper", format: "classic", seed: 7, why: "two strong, opposite voices (showman vs deadpan)" },
  { id: "mira-dex", a: "eval-rich-oc", b: "house-dex", format: "classic", seed: 3, why: "a visitor with a full private soul" },
  { id: "teo-ines", a: "house-teo", b: "house-ines", format: "classic", seed: 5, why: "flirt vs earnest optimist" },
  { id: "orin-sable", a: "house-orin", b: "house-sable", format: "meet_the_parents", seed: 9, why: "a show format with a named chaperone" },
  { id: "kaz-nell", a: "house-kaz", b: "house-nell", format: "speed_date", seed: 13, why: "a speed date (fewer turns) must still reach its ending" },
];

/** Builds an eval case's date in memory (no database), exactly as the live pipeline would assemble it. */
export function buildEvalDate(c: EvalCase): BuiltDate {
  const a = evalCharacter(c.a);
  const b = evalCharacter(c.b);
  return assembleDate({
    episodeId: `eval-${c.id}`,
    a: a.forDate,
    b: b.forDate,
    req: { ...DEFAULT_DATE_REQUEST, format: c.format },
    seed: c.seed,
    soulA: a.soul,
    soulB: b.soul,
    memoryA: null,
    memoryB: null,
    history: undefined,
    ex: c.format === "ex_returns" ? "an ex from two cities ago" : undefined,
  });
}

export type EvalResult = {
  case: string;
  format: FormatId;
  ending: string;
  wants_another: [boolean, boolean];
  characters: [string, string];
  transcript: Turn[];
  recap: { setting: string; scenes: string[]; best_line: string };
  plan: { source: string; spine: string; acts: { scene: string; a: string; b: string }[] } | null;
  metrics: QualityMetrics;
  judge: JudgeScores | null;
  judge_mean: number | null;
  model_calls: number;
  ms: number;
  conversation_error: string | null;
};

const errorText = (err: unknown): string | null =>
  err ? (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 200) : null;

/** Generates, measures and (optionally) judges one eval date. */
export async function runEvalCase(c: EvalCase, models: DateModels, judge: Model | null): Promise<EvalResult> {
  const built = buildEvalDate(c);
  const outcome: Outcome = deterministicEngine.decide(built.input, built.seed);
  const t0 = Date.now();
  const gen = await generateDate(models, built, outcome, {
    formatId: c.format,
    formatCtx: { chaperone: built.setup.chaperone, ex: built.setup.ex },
    conversation: true,
    afterglow: false,
  });
  const ms = Date.now() - t0;
  const characters = built.characters as [Character, Character];
  const venuePrompt = venue(built.setup.venue).prompt;
  const metrics = gen.quality ?? transcriptQuality(gen.transcript, characters, qualityContext(built, gen.draft.setting));
  const verdict = judge ? await judgeDate(judge, characters, outcome, gen.transcript, venuePrompt) : null;
  return {
    case: c.id,
    format: c.format,
    ending: ENDING_LABELS[outcome.ending],
    wants_another: [outcome.sides[0].wants_another, outcome.sides[1].wants_another],
    characters: [characters[0].name, characters[1].name],
    transcript: gen.transcript,
    recap: { setting: gen.draft.setting, scenes: gen.draft.scenes, best_line: gen.draft.best_line },
    plan: gen.plan,
    metrics,
    judge: verdict,
    judge_mean: verdict ? judgeMean(verdict) : null,
    model_calls: gen.modelCalls,
    ms,
    conversation_error: errorText(gen.conversationError),
  };
}

/**
 * Re-scores a saved result with today's metrics (scripts/eval-report.mjs --rescore), so runs measured by
 * different versions of lib/quality.ts still compare like for like. The case rebuilds exactly, so the
 * characters and private notes are the ones the date was generated with.
 */
export function rescoreResult(r: Pick<EvalResult, "case" | "transcript" | "recap">): QualityMetrics {
  const c = EVAL_CASES.find((x) => x.id === r.case);
  if (!c) throw new Error(`unknown eval case ${r.case}`);
  const built = buildEvalDate(c);
  return transcriptQuality(r.transcript, built.characters as [Character, Character], qualityContext(built, r.recap.setting));
}
