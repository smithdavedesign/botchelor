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
import { continuity, type Continuity, type Recall } from "./continuity";
import type { Turn } from "./conversation";
import { deterministicEngine, type CharacterSheet, type Outcome } from "./engine";
import { formatContextOf, type FormatId } from "./formats";
import { ALL_HOUSE_CHARACTERS } from "./house";
import { judgeDate, judgeMean, type JudgeScores } from "./judge";
import { computeMemory, metBefore, type CharacterMemory, type MemoryEpisode } from "./memory";
import type { Model } from "./model";
import { generateDate, qualityContext, type DateModels } from "./pipeline";
import type { DateUsage } from "./pricing";
import { transcriptQuality, type QualityMetrics } from "./quality";
import { ENDING_LABELS } from "./rules";
import { assembleDate, DEFAULT_DATE_REQUEST, type BuiltDate, type CharacterForDate } from "./simulation";
import type { StoredSoul } from "./souls";
import { venue, type PlaceId } from "./venues";

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
  /** Tokens (thinking included) and the paid-tier cost of the date (lib/pricing.ts). */
  usage: DateUsage;
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
    formatCtx: formatContextOf(built),
    conversation: true,
    afterglow: false,
    reflection: false,
  });
  const ms = Date.now() - t0;
  const characters = built.characters as [Character, Character];
  const venuePrompt = venue(built.setup.venue).prompt;
  const metrics = gen.quality ?? transcriptQuality(gen.transcript, characters, qualityContext(built, gen.draft.setting));
  const verdict = judge ? await judgeDate(judge, characters, outcome, gen.transcript, venuePrompt, built.input.date_number) : null;
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
    usage: gen.usage,
    ms,
    conversation_error: errorText(gen.conversationError),
  };
}

/**
 * Judges a saved transcript again with today's judge (scripts/eval-rejudge.mjs), so runs scored by different
 * versions of the judge's prompt still compare like for like. The case rebuilds exactly, so the judge sees the
 * same characters and decided outcome the date was generated from.
 */
export async function rejudgeCase(c: EvalCase, transcript: Turn[], judge: Model): Promise<{ judge: JudgeScores | null; judge_mean: number | null }> {
  const built = buildEvalDate(c);
  const outcome = deterministicEngine.decide(built.input, built.seed);
  const verdict = await judgeDate(judge, built.characters as [Character, Character], outcome, transcript, venue(built.setup.venue).prompt, built.input.date_number);
  return { judge: verdict, judge_mean: verdict ? judgeMean(verdict) : null };
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

/* ------------------------------------------ sagas: continuity ------------------------------------------ */

/**
 * A saga: one character's run of dates, generated in order, with what it learned from each earlier date carried
 * into the next — the continuity test the memory work needs (docs/character-depth.md). Each step is one request,
 * so the earlier steps' transcripts are passed back in; memory is computed from them in memory (lib/memory.ts
 * computeMemory), never read from or written to the database. Each step airs a day after the last.
 */
export type EvalSaga = { id: string; hero: string; steps: readonly { partner: string; seed: number; format: FormatId }[]; why: string };

export const EVAL_SAGAS: readonly EvalSaga[] = [
  {
    id: "mira-saga",
    hero: "eval-rich-oc",
    steps: [
      { partner: "house-dex", seed: 3, format: "classic" },
      { partner: "house-nell", seed: 21, format: "classic" },
      { partner: "house-dex", seed: 33, format: "classic" },
    ],
    why: "one character, three dates: it carries its dating life between them, and the rematch with Dex should remember last time",
  },
];

/** Step 0 of every saga airs on this Monday evening; each later step a day after. */
const SAGA_START = Date.UTC(2026, 0, 5, 20);

type Aired = { id: string; a: string; b: string; outcome: Outcome; transcript: Turn[]; venue: PlaceId; at: string };

/** One character's memory of a saga's aired steps (as lib/memory.ts would compute it from the database). */
function sagaMemory(characterId: string, aired: Aired[]): CharacterMemory | null {
  const rows: MemoryEpisode[] = aired
    .filter((x) => x.a === characterId || x.b === characterId)
    .map((x) => {
      const isA = x.a === characterId;
      const other = evalCharacter(isA ? x.b : x.a).forDate;
      return {
        id: x.id,
        ending: x.outcome.ending,
        sides: x.outcome.sides,
        transcript: x.transcript,
        reflections: null,
        is_a: isA,
        revealed_at: x.at,
        drama_question: x.outcome.drama_question,
        drama_answer: x.outcome.drama_answer,
        venue: x.venue,
        other_id: other.id,
        other_name: other.sheet.name,
        other_house: other.sheet.house,
      };
    });
  if (!rows.length) return null;
  const sheet = evalCharacter(characterId).forDate.sheet;
  return computeMemory(rows, { want: sheet.want, dealbreaker: sheet.dealbreaker });
}

/**
 * Builds step `k` of a saga exactly as the live pipeline would, with each character's memory and the pair's
 * history taken from the earlier steps (whose words are `prior[i]`). Deterministic: the engine decides every step
 * from fixed seeds, so a step's outcome never depends on how the earlier dates were worded.
 */
export function buildSagaStep(saga: EvalSaga, k: number, prior: Turn[][]): { built: BuiltDate; outcome: Outcome; aired: Aired[] } {
  const aired: Aired[] = [];
  for (let i = 0; ; i++) {
    const step = saga.steps[i];
    const hero = evalCharacter(saga.hero);
    const partner = evalCharacter(step.partner);
    const together = aired.filter((x) => x.b === step.partner);
    const built = assembleDate({
      episodeId: `eval-${saga.id}-${i}`,
      a: hero.forDate,
      b: partner.forDate,
      req: { ...DEFAULT_DATE_REQUEST, format: step.format },
      seed: step.seed,
      soulA: hero.soul,
      soulB: partner.soul,
      memoryA: sagaMemory(saga.hero, aired),
      memoryB: sagaMemory(step.partner, aired),
      history: together.length ? { dates: together.length, last_ending: together[together.length - 1].outcome.ending } : undefined,
    });
    const outcome = deterministicEngine.decide(built.input, built.seed);
    if (i === k) return { built, outcome, aired };
    aired.push({
      id: `eval-${saga.id}-${i}`,
      a: saga.hero,
      b: step.partner,
      outcome,
      transcript: prior[i] ?? [],
      venue: built.setup.venue,
      at: new Date(SAGA_START + i * 86_400_000).toISOString(),
    });
  }
}

export type SagaResult = EvalResult & { saga: string; step: number; partner: string; continuity: Continuity };

/** What each side could recall of the pair's last date (its place, what the other said, and its own old lines); null between strangers. */
function lastTimeText(built: BuiltDate): { a: Recall; b: Recall } | null {
  const [a, b] = built.characters;
  const recall = (me: Character, other: Character): Recall | null => {
    const m = metBefore(me.memory, other.id);
    if (!m) return null;
    return {
      recall: [m.last_time, m.something_they_said].filter(Boolean).join(" "),
      own: [String(m.something_you_said ?? ""), ...(me.memory?.memorable_lines ?? [])].filter(Boolean),
    };
  };
  const ra = recall(a, b);
  const rb = recall(b, a);
  return ra === null && rb === null ? null : { a: ra ?? { recall: "", own: [] }, b: rb ?? { recall: "", own: [] } };
}

/** Generates, measures and (optionally) judges step `k` of a saga, given the earlier steps' transcripts. */
export async function runSagaStep(saga: EvalSaga, k: number, prior: Turn[][], models: DateModels, judge: Model | null): Promise<SagaResult> {
  const { built, outcome } = buildSagaStep(saga, k, prior);
  const step = saga.steps[k];
  const t0 = Date.now();
  const gen = await generateDate(models, built, outcome, {
    formatId: step.format,
    formatCtx: formatContextOf(built),
    conversation: true,
    afterglow: false,
    reflection: false,
  });
  const characters = built.characters as [Character, Character];
  const metrics = gen.quality ?? transcriptQuality(gen.transcript, characters, qualityContext(built, gen.draft.setting));
  const verdict = judge ? await judgeDate(judge, characters, outcome, gen.transcript, venue(built.setup.venue).prompt, built.input.date_number) : null;
  return {
    case: `${saga.id}-${k}`,
    saga: saga.id,
    step: k,
    partner: step.partner,
    format: step.format,
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
    usage: gen.usage,
    ms: Date.now() - t0,
    conversation_error: errorText(gen.conversationError),
    continuity: stepContinuity(built, gen.transcript),
  };
}

/** One saga step's continuity, from its built date (each side's memory) and what was said. */
function stepContinuity(built: BuiltDate, transcript: Turn[]): Continuity {
  const [a, b] = built.characters;
  return continuity(transcript, lastTimeText(built), { a: a.memory?.memorable_lines ?? [], b: b.memory?.memorable_lines ?? [] });
}

/**
 * Re-scores a saved saga run's continuity with today's lib/continuity.ts (like rescoreResult for the metrics): the
 * steps rebuild exactly from the saved transcripts, so runs measured by different versions compare like for like.
 */
export function sagaContinuity(saga: EvalSaga, transcripts: Turn[][]): Continuity[] {
  return transcripts.map((tr, k) => stepContinuity(buildSagaStep(saga, k, transcripts.slice(0, k)).built, tr));
}
