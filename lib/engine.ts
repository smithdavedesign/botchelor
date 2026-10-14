/**
 * The simulation engine: the deterministic, seeded rules that decide what happens on a date.
 *
 * This is the "biggest change to the code" the PRD calls for. The showrunner model used to pick the
 * ending; now the engine does, from the two character sheets, each side's private soul, the owner's
 * date settings (autonomy, strategy, agenda, note, game budget) and a seed. The model only narrates
 * (lib/showrunner.ts) toward the outcome the engine already decided.
 *
 * Why deterministic: predictions are only fair if the outcome doesn't depend on model randomness, the
 * box score needs real numbers to show, and Sliding Doors needs a replay with one input changed to be
 * reproducible. Same input + same seed => same outcome, always. No Date.now, no Math.random, no I/O.
 */
import {
  AGENDAS,
  agenda,
  DATE_VARIABLES,
  ENDINGS,
  type AgendaId,
  type Autonomy,
  type DateVariable,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
  type GameBudget,
  type Strategy,
} from "./rules";

/** A character as the engine sees it. Defined here (not showrunner) so showrunner can import it. */
export type CharacterSheet = {
  name: string;
  age: number;
  bio: string;
  traits: readonly string[];
  want: string;
  dealbreaker: string;
  house: boolean;
};

/** Owner-only signals derived from the private soul. 0..1, where 0 means "absent / neutral". */
export type SoulSignals = { warmth: number; openness: number; guardedness: number; humor: number };
export const NEUTRAL_SIGNALS: SoulSignals = { warmth: 0, openness: 0, guardedness: 0, humor: 0 };

/** The raw private soul the owner writes. Owner-only; never returned to spectators (PRD guardrail). */
export type SoulProfile = {
  values: string;
  insecurities: string;
  humor: string;
  boundaries: string;
  romantic: string;
  communication: string;
};

/** One side's full setup for a date: their character, soul, and the owner's dials for this date. */
export type SideSetup = {
  sheet: CharacterSheet;
  signals: SoulSignals;
  autonomy: Autonomy;
  strategy: Strategy;
  agendaId: AgendaId;
  /** The owner's one sentence of advice (PRD "the note in the pocket"); null for no note / house side. */
  note: string | null;
  gameBudget: GameBudget;
};

/** What the pair remembers (PRD "a persistent relationship universe"); absent on a first date. */
export type DateHistory = { dates: number; last_ending: Ending | null };

export type DateInput = { a: SideSetup; b: SideSetup; history?: DateHistory };

/** How one game variable moved over the date: the box score is these four arcs. 0..100. */
export type VariableArc = { start: number; delta: number; final: number };

export type SideOutcome = {
  /** Does this AI want another date? The whole point: it may surprise its owner. */
  wants_another: boolean;
  agenda_met: boolean;
  satisfied: boolean;
  /** The cue word of the other character that tripped this side's dealbreaker, for the debrief; else null. */
  dealbreaker_hit: string | null;
  /** The cue word of the other character that met this side's want, for the debrief; else null. */
  want_met: string | null;
  /** Whether this side's AI took the owner's note; null when this side had no note. */
  note_followed: boolean | null;
};

export type Outcome = {
  ending: Ending;
  drama_question: DramaQuestion;
  drama_answer: DramaAnswer;
  variables: Record<DateVariable, VariableArc>;
  sides: [SideOutcome, SideOutcome];
  seed: number;
};

export interface Engine {
  decide(input: DateInput, seed: number): Outcome;
}

/* ---------------------------------- text cues ---------------------------------- */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "that", "this", "who",
  "whom", "whose", "will", "would", "can", "could", "is", "are", "be", "been", "being", "someone",
  "anyone", "people", "person", "them", "they", "their", "your", "you", "me", "my", "it", "its",
  "least", "one", "out", "loud", "before", "after", "just", "not", "no", "never", "always", "very",
  "really", "too", "more", "most", "some", "any", "every", "about", "into", "over", "up", "down",
  "but", "if", "when", "then", "than", "so", "as", "like", "hates", "hate", "loves", "love", "wants",
  "want", "needs", "need", "call", "calls", "called", "talk", "talks", "say", "says", "get", "gets",
]);

/** Normalise a token: lowercased, trailing 's' dropped on longer words so map/maps and surprise/surprises meet. */
function norm(token: string): string {
  const t = token.toLowerCase();
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

/** The meaningful, de-pluralised words in some text, stopwords removed. */
function cues(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const n = norm(raw);
    if (n.length >= 3 && !STOPWORDS.has(n)) out.add(n);
  }
  return out;
}

/** The first shared cue between a set and a list of texts, or null. Deterministic (insertion order). */
function firstShared(needle: Set<string>, haystackText: string): string | null {
  const hay = cues(haystackText);
  for (const word of needle) if (hay.has(word)) return word;
  return null;
}

/** Everything the *other* character visibly is: how one side reads the other for wants and dealbreakers. */
function surface(sheet: CharacterSheet): string {
  return `${sheet.traits.join(" ")} ${sheet.bio} ${sheet.want}`;
}

/* ---------------------------------- soul signals ---------------------------------- */

const LEXICON: Record<keyof SoulSignals, readonly string[]> = {
  warmth: ["warm", "kind", "gentle", "caring", "affectionate", "affection", "loyal", "devoted",
    "tender", "nurturing", "loving", "generous", "sweet", "patient", "supportive", "earnest", "soft"],
  openness: ["curious", "open", "adventurous", "spontaneous", "creative", "playful", "experimental",
    "bold", "wild", "free", "imaginative", "daring", "fearless"],
  guardedness: ["guarded", "cautious", "private", "reserved", "wary", "anxious", "insecure", "jealous",
    "defensive", "closed", "distant", "cynical", "suspicious", "shy", "fearful", "afraid", "controlling"],
  humor: ["funny", "witty", "humor", "humour", "humorous", "sarcastic", "silly", "goofy", "deadpan",
    "dry", "banter", "joke", "teasing", "wry", "playful"],
};
const SIGNAL_CAP = 3;

/** Turn a written soul into 0..1 signals by counting whole-word lexicon hits. Deterministic. */
export function deriveSoulSignals(soul: SoulProfile): SoulSignals {
  const words = cues(Object.values(soul).join(" "));
  const score = (key: keyof SoulSignals) => {
    let hits = 0;
    for (const w of LEXICON[key]) if (words.has(norm(w))) hits++;
    return Math.min(1, hits / SIGNAL_CAP);
  };
  return { warmth: score("warmth"), openness: score("openness"), guardedness: score("guardedness"), humor: score("humor") };
}

/* ---------------------------------- seeded rng ---------------------------------- */

/** mulberry32: a tiny, well-distributed, fully reproducible PRNG. Returns 0..1. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from strings, so a given pairing + setup replays identically (Sliding Doors). */
export function seedFrom(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/* ---------------------------------- the model (tunable constants) ---------------------------------- */

const START: Record<DateVariable, number> = { chemistry: 50, attraction: 48, trust: 45, awkwardness: 40 };
const BUDGET_BUMP: Record<GameBudget, number> = { 0: -4, 25: 0, 50: 3, 100: 6 };
/** How wide the seeded jitter is, by autonomy. Guided barely wobbles; unpredictable can swing a date. */
const JITTER: Record<Autonomy, number> = { guided: 3, balanced: 7, unpredictable: 16 };
/** Chance the AI actually takes the owner's note, by autonomy. */
const NOTE_FOLLOW_CHANCE: Record<Autonomy, number> = { guided: 1, balanced: 0.7, unpredictable: 0.4 };
/** Ending weights per the initiating side's strategy: [chemistry, attraction, trust, awkwardness-penalty]. */
const STRATEGY_WEIGHTS: Record<Strategy, [number, number, number, number]> = {
  genuine_chemistry: [0.45, 0.3, 0.2, 0.4],
  fun_adventure: [0.4, 0.35, 0.1, 0.55],
  long_term: [0.2, 0.2, 0.55, 0.3],
  unexpected: [0.3, 0.3, 0.25, 0.35],
};
const SECOND_DATE_AT = 56;
const FRIENDS_AT = 42;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const avg = (x: number, y: number) => (x + y) / 2;

type SideRead = {
  wantCue: string | null;
  dealbreakerCue: string | null;
  agendaMet: boolean;
  /** The other side has something this side's agenda wants to avoid: raises awkwardness. */
  agendaClash: boolean;
};

/** How one side reads the other: want met, dealbreaker tripped, agenda met or clashed. */
function readSide(self: SideSetup, other: SideSetup): SideRead {
  const otherSurface = surface(other.sheet);
  const a = agenda(self.agendaId);
  const seeks = new Set(a.seeks.map(norm));
  const avoids = new Set(a.avoids.map(norm));
  const seekHit = seeks.size > 0 && firstShared(seeks, otherSurface) !== null;
  const avoidHit = avoids.size > 0 && firstShared(avoids, otherSurface) !== null;
  return {
    wantCue: firstShared(cues(self.sheet.want), otherSurface),
    dealbreakerCue: firstShared(cues(self.sheet.dealbreaker), otherSurface),
    // seek-type agendas are met by a matching cue; avoid-type agendas are met when the thing stays absent.
    agendaMet: a.seeks.length > 0 ? seekHit : !avoidHit,
    agendaClash: avoidHit,
  };
}

/** The pure deterministic engine. Everything here is a function of (input, seed). */
export const deterministicEngine: Engine = {
  decide(input: DateInput, seed: number): Outcome {
    const rand = rng(seed);
    const jitter = (level: Autonomy) => (rand() - 0.5) * 2 * JITTER[level];

    const ra = readSide(input.a, input.b);
    const rb = readSide(input.b, input.a);

    const dealbreakers = (ra.dealbreakerCue ? 1 : 0) + (rb.dealbreakerCue ? 1 : 0);
    const wantsMet = (ra.wantCue ? 1 : 0) + (rb.wantCue ? 1 : 0);
    const agendasMet = (ra.agendaMet ? 1 : 0) + (rb.agendaMet ? 1 : 0);
    const clashes = (ra.agendaClash ? 1 : 0) + (rb.agendaClash ? 1 : 0);

    const traitResonance = (() => {
      const bCues = cues(input.b.sheet.traits.join(" "));
      let n = 0;
      for (const t of cues(input.a.sheet.traits.join(" "))) if (bCues.has(t)) n++;
      return n;
    })();

    const warmth = avg(input.a.signals.warmth, input.b.signals.warmth);
    const openness = avg(input.a.signals.openness, input.b.signals.openness);
    const guarded = avg(input.a.signals.guardedness, input.b.signals.guardedness);
    const humor = avg(input.a.signals.humor, input.b.signals.humor);
    const budget = avg(BUDGET_BUMP[input.a.gameBudget], BUDGET_BUMP[input.b.gameBudget]);

    // The note: did each side's AI take it? Only sides with a note; guided always, unpredictable rarely.
    const noteFollowed = (side: SideSetup): boolean | null =>
      side.note === null ? null : rand() < NOTE_FOLLOW_CHANCE[side.autonomy];
    const aNote = noteFollowed(input.a);
    const bNote = noteFollowed(input.b);
    const noteBump = (aNote ? 1 : 0) + (bNote ? 1 : 0); // a taken note smooths the date a little

    const strategyChem = input.a.strategy === "fun_adventure" || input.a.strategy === "genuine_chemistry" ? 4 : 0;
    const strategyTrust = input.a.strategy === "long_term" ? 6 : 0;

    // Familiarity: repeat dates build trust and ease awkwardness; a past disaster casts a shadow, a
    // past second date glows. First dates have no history and so no effect.
    const hist = input.history ?? { dates: 0, last_ending: null };
    const familiarity = Math.min(hist.dates, 4);
    const histChem = hist.last_ending === "disaster" ? -8 : hist.last_ending === "second_date" ? 6 : 0;

    const chemistry = clamp(
      START.chemistry + 6 * traitResonance + 12 * humor + 9 * warmth + budget + strategyChem +
        3 * noteBump - 13 * dealbreakers + histChem + jitter(input.a.autonomy),
    );
    const attraction = clamp(
      START.attraction + 11 * openness + 8 * wantsMet + 5 * agendasMet - 6 * dealbreakers + jitter(input.b.autonomy),
    );
    const trust = clamp(
      START.trust + 13 * warmth - 15 * guarded + strategyTrust + 3 * noteBump - 10 * dealbreakers +
        4 * familiarity + jitter(input.a.autonomy),
    );
    const awkwardness = clamp(
      START.awkwardness + 15 * dealbreakers + 12 * guarded + 7 * clashes - 11 * humor - 4 * noteBump -
        3 * familiarity + jitter(input.b.autonomy),
    );

    const variables: Record<DateVariable, VariableArc> = {
      chemistry: { start: START.chemistry, delta: chemistry - START.chemistry, final: chemistry },
      attraction: { start: START.attraction, delta: attraction - START.attraction, final: attraction },
      trust: { start: START.trust, delta: trust - START.trust, final: trust },
      awkwardness: { start: START.awkwardness, delta: awkwardness - START.awkwardness, final: awkwardness },
    };

    // Ending: the initiating side's strategy decides which variables matter. A tripped dealbreaker hurts.
    const [wc, wa, wt, wk] = STRATEGY_WEIGHTS[input.a.strategy];
    const score = wc * chemistry + wa * attraction + wt * trust - wk * awkwardness - 11 * dealbreakers;
    let ending: Ending = score >= SECOND_DATE_AT ? ENDINGS[0] : score >= FRIENDS_AT ? ENDINGS[1] : ENDINGS[2];

    // Per-side satisfaction, for who-wants-another and who-leaves/who-rejects.
    const satOf = (self: SideSetup, r: SideRead, mine: Autonomy): number =>
      (r.wantCue ? 16 : 0) + (r.agendaMet ? 8 : 0) + 14 * self.signals.warmth - (r.dealbreakerCue ? 28 : 0) +
      chemistry * 0.25 + trust * 0.1 - awkwardness * 0.2 + jitter(mine) * 0.5;
    const satA = satOf(input.a, ra, input.a.autonomy);
    const satB = satOf(input.b, rb, input.b.autonomy);

    // wants_another: satisfied and the date didn't blow up — but an "unpredictable" AI may flip, so it
    // surprises its owner either way (PRD: "an AI can ask for another date even when its owner expected
    // the opposite").
    const wantsAnother = (self: SideSetup, sat: number): boolean => {
      const base = sat > 8 && ending !== ENDINGS[2];
      return self.autonomy === "unpredictable" && rand() < 0.3 ? !base : base;
    };

    // Drama. A tripped dealbreaker means a rejection; otherwise someone leaves first (or they leave together).
    let drama_question: DramaQuestion;
    let drama_answer: DramaAnswer;
    if (dealbreakers > 0 && ending !== ENDINGS[0]) {
      drama_question = "rejected";
      // The side whose dealbreaker was tripped turns the *other* down, so the other is "rejected".
      if (ra.dealbreakerCue && rb.dealbreakerCue) drama_answer = satA <= satB ? "a" : "b";
      else drama_answer = ra.dealbreakerCue ? "b" : "a";
    } else {
      drama_question = "leaves_first";
      const gap = satA - satB;
      drama_answer = Math.abs(gap) < 10 ? "neither" : gap < 0 ? "a" : "b";
    }

    const sides: [SideOutcome, SideOutcome] = [
      {
        wants_another: wantsAnother(input.a, satA),
        agenda_met: ra.agendaMet,
        satisfied: satA > 8,
        dealbreaker_hit: ra.dealbreakerCue,
        want_met: ra.wantCue,
        note_followed: aNote,
      },
      {
        wants_another: wantsAnother(input.b, satB),
        agenda_met: rb.agendaMet,
        satisfied: satB > 8,
        dealbreaker_hit: rb.dealbreakerCue,
        want_met: rb.wantCue,
        note_followed: bNote,
      },
    ];

    return { ending, drama_question, drama_answer, variables, sides, seed };
  },
};

/* ---------------------------------- injection (mirrors lib/model.ts) ---------------------------------- */

let testEngine: Engine | null = null;

/** Tests can force an outcome, the same way setModelForTests swaps the model. Production always decides. */
export function setEngineForTests(engine: Engine | null): void {
  testEngine = engine;
}

export function getEngine(): Engine {
  return testEngine ?? deterministicEngine;
}

/** A fixed outcome, for integration tests that need a specific ending (see tests/helpers.ts). */
export function fixedEngine(partial: Partial<Outcome> & { ending: Ending }): Engine {
  return {
    decide(_input, seed) {
      const flat = (final: number): VariableArc => ({ start: final, delta: 0, final });
      const base: Outcome = {
        ending: partial.ending,
        drama_question: partial.drama_question ?? "leaves_first",
        drama_answer: partial.drama_answer ?? "neither",
        variables: partial.variables ?? {
          chemistry: flat(60), attraction: flat(55), trust: flat(50), awkwardness: flat(30),
        },
        sides: partial.sides ?? [
          { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
          { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null },
        ],
        seed,
      };
      return base;
    },
  };
}

export const ALL_AGENDA_IDS = AGENDAS.map((a) => a.id);
export { DATE_VARIABLES };
