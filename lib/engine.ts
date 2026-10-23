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
  /** Optional appearance line (customization). Read for narration and for want/dealbreaker cue matching. */
  appearance?: string;
  /** How others refer to them ("she/her", "he/him", "they/them"). For the prompts only; the engine never reads it. */
  pronouns?: string;
  /** How they talk, in a line ("dry, short sentences; drifts to ghost stories"). Prompts only; never the engine. */
  voice?: string;
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

/**
 * What the pair remembers (PRD "a persistent relationship universe"); absent on a first date. `chemistry` and `trust`
 * are the running relationship state across their dates (lib/relationships.ts, 0..100), present on dates built since
 * the relationship graph: with them, the night starts where they left off instead of from the last ending alone.
 */
export type DateHistory = { dates: number; last_ending: Ending | null; chemistry?: number; trust?: number };

/**
 * `date_number`: which date this is for the couple (setup.date_number, set on a follow-up), for the words only: a happy
 * ending on their third date reads "A fourth date" (lib/rules endingLabel). The engine never reads it.
 */
export type DateInput = { a: SideSetup; b: SideSetup; history?: DateHistory; date_number?: number };

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
  /**
   * The deciding score relative to a perfectly neutral date under the same strategy (v2's yardstick): how
   * clearly the date landed where it did. For calibration and the date's beats; never stored or scored.
   * Absent on outcomes that weren't computed by the engine (tests' fixed outcomes).
   */
  margin?: number;
};

/**
 * Which calibration decided a date. The rules are the same; v2 re-centres where the endings fall. Every date
 * records the version it was decided with (DateSetup.engine_version), and replays (Sliding Doors, the chaos
 * timeline, the async worker's re-decide) use that same version, so an old date still reproduces exactly.
 *
 *   v1 (original): absolute ending thresholds. In practice no date could reach a second date (0% across
 *      ~31,000 simulated dates); a typical player's character met disaster ~95% of the time, and the
 *      adventurous strategies ~99%. Kept only to replay dates decided under it.
 *   v2 (2026-10-14): thresholds measured from the score of a perfectly neutral date *under the same strategy*,
 *      so a strategy changes what matters on the date rather than how doomed it is; and a character with no
 *      soul or trained image reads as an unremarkable temperament instead of a blank zero. Calibrated so a
 *      house-vs-house date at default settings ends roughly a third each way (docs/date-quality.md).
 *   v3 (2026-10-17): having met before is worth one step of familiarity, not one per date (up to four). Under v2 the
 *      bonus compounded: across 2,000 simulated couples, 93% of follow-up dates ended in another date (~100% by date
 *      5) and trust rose for 99% of five-date couples, whatever happened on them. Under v3 it's 87% and 82%, with as
 *      many couples reaching date 5 (tests/engine-arcs.test.ts, docs/relationship-sim-evidence.md). v3 also starts a couple's box score where
 *      they left off (their running chemistry and trust) instead of a stranger's baseline. First dates are unchanged.
 */
export type EngineVersion = 1 | 2 | 3;
export const CURRENT_ENGINE_VERSION: EngineVersion = 3;

export interface Engine {
  decide(input: DateInput, seed: number, version?: EngineVersion): Outcome;
  /** A test's forced outcome that stands exactly as given: the date's wishes don't weigh in on it (lib/wishes.ts). */
  exact?: boolean;
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

/** The meaningful, de-pluralised words in some text, stopwords removed (also how lib/chemistry-test.ts matches them). */
export function cues(text: string): Set<string> {
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
  return `${sheet.traits.join(" ")} ${sheet.bio} ${sheet.want} ${sheet.appearance ?? ""}`;
}

/* ---------------------------------- soul signals ---------------------------------- */

export const LEXICON: Record<keyof SoulSignals, readonly string[]> = {
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
/** Where an ordinary first date's four numbers start (read-only): lib/heading.ts weighs a date's numbers against it. */
export const NEUTRAL_START: Readonly<Record<DateVariable, number>> = START;
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
/** v2: how far above (or below) a perfectly neutral date's score the date must land, under its own strategy. */
export const V2_SECOND_DATE_REL = 12;
export const V2_FRIENDS_REL = 6.5;
/** v2: a character with no soul and no trained image is an unremarkable temperament, not an absence of one. */
export const UNREMARKABLE_SIGNALS: SoulSignals = { warmth: 0.4, openness: 0.4, guardedness: 0.3, humor: 0.4 };
const isBlank = (s: SoulSignals) => s.warmth === 0 && s.openness === 0 && s.guardedness === 0 && s.humor === 0;

/** The score a date with every variable at its starting value would get under a strategy (v2's zero point). */
function neutralScore(strategy: Strategy): number {
  const [wc, wa, wt, wk] = STRATEGY_WEIGHTS[strategy];
  return wc * START.chemistry + wa * START.attraction + wt * START.trust - wk * START.awkwardness;
}

/** What a tripped dealbreaker takes off a date's score. */
export const DEALBREAKER_PENALTY = 11;

/**
 * The number a v2+ ending is decided on, from where the four variables finished: the initiating side's
 * strategy-weighted score, minus the penalty for each tripped dealbreaker, measured against a perfectly ordinary date
 * under the same strategy (`rel`), with the marks it had to clear. decide() uses it, and so does the box score's
 * "why" (lib/why.ts), so the explanation can never drift from the decision.
 */
export function endingScore(
  strategy: Strategy,
  finals: Record<DateVariable, number>,
  dealbreakers: number,
): { rel: number; friendsAt: number; secondDateAt: number; weights: Record<DateVariable, number> } {
  const [wc, wa, wt, wk] = STRATEGY_WEIGHTS[strategy];
  const score = wc * finals.chemistry + wa * finals.attraction + wt * finals.trust - wk * finals.awkwardness - DEALBREAKER_PENALTY * dealbreakers;
  return {
    rel: score - neutralScore(strategy),
    friendsAt: V2_FRIENDS_REL,
    secondDateAt: V2_SECOND_DATE_REL,
    weights: { chemistry: wc, attraction: wa, trust: wt, awkwardness: wk },
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
/** n held within ±limit. */
const bounded = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
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

/**
 * Why the engine decided what it did (data plan Tier 1, episodes.engine_trace): the margin, reason codes and each
 * variable's terms, so a date's outcome can be explained and studied without re-running it. Never a cue word — a
 * dealbreaker is secret, so the trace says *that* one tripped (dealbreaker:a), never on what. Small (~1.5KB), versioned.
 */
export type EngineTrace = {
  v: 1;
  engine_version: number;
  strategy: Strategy;
  /** The engine's own ending (before any wishes tip it: lib/wishes.ts). */
  ending: Ending;
  margin: number;
  score: number;
  thresholds: { friends: number; second_date: number } | { friends_at: number; second_date_at: number };
  reasons: string[];
  counts: { dealbreakers: number; wants_met: number; agendas_met: number; clashes: number; trait_resonance: number; familiarity: number };
  signals: { warmth: number; openness: number; guardedness: number; humor: number };
  /** Each variable's raw sum, term by term (before clamping to 0..100). */
  terms: Record<DateVariable, Record<string, number>>;
  /** Each part of the deciding score (they sum to `margin`'s unrounded value on v2+). */
  contributions: { chemistry: number; attraction: number; trust: number; awkwardness: number; dealbreakers: number; neutral: number };
  sat: { a: number; b: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The deterministic engine's core: the outcome, and (when asked) the trace of how it got there. Same draws either way. */
function decideCore(input: DateInput, seed: number, version: EngineVersion, withTrace: boolean): { outcome: Outcome; trace: EngineTrace | null } {
    const v2 = version >= 2;
    // v2 reads a blank temperament (no soul, no trained image) as unremarkable rather than as zero.
    const sig = (side: SideSetup): SoulSignals => (v2 && isBlank(side.signals) ? UNREMARKABLE_SIGNALS : side.signals);
    const sigA = sig(input.a);
    const sigB = sig(input.b);
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

    const warmth = avg(sigA.warmth, sigB.warmth);
    const openness = avg(sigA.openness, sigB.openness);
    const guarded = avg(sigA.guardedness, sigB.guardedness);
    const humor = avg(sigA.humor, sigB.humor);
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
    const hist: DateHistory = input.history ?? { dates: 0, last_ending: null };
    // v3: having met is one step of familiarity; v2 gave one per date (up to four), which made later dates a formality.
    const familiarity = Math.min(hist.dates, version >= 3 ? 1 : 4);
    // With the running relationship state (lib/relationships.ts), the warmth they've built carries in, bounded to
    // the same ±8 the last-ending rule moves; dates decided before it (no chemistry) replay exactly as they did.
    const histChem =
      hist.chemistry !== undefined
        ? bounded(Math.round((hist.chemistry - 50) * 0.2), 8)
        : hist.last_ending === "disaster" ? -8 : hist.last_ending === "second_date" ? 6 : 0;
    const histTrust = hist.trust !== undefined ? bounded(Math.round((hist.trust - 50) * 0.12), 6) : 0;

    // Each jitter is drawn exactly where the expression used to draw it (the same order of rand() calls), so a date
    // decided before the trace existed replays to the same outcome.
    const jChem = jitter(input.a.autonomy);
    const chemistry = clamp(
      START.chemistry + 6 * traitResonance + 12 * humor + 9 * warmth + budget + strategyChem +
        3 * noteBump - 13 * dealbreakers + histChem + jChem,
    );
    const jAttr = jitter(input.b.autonomy);
    const attraction = clamp(
      START.attraction + 11 * openness + 8 * wantsMet + 5 * agendasMet - 6 * dealbreakers + jAttr,
    );
    const jTrust = jitter(input.a.autonomy);
    const trust = clamp(
      START.trust + 13 * warmth - 15 * guarded + strategyTrust + 3 * noteBump - 10 * dealbreakers +
        4 * familiarity + histTrust + jTrust,
    );
    const jAwk = jitter(input.b.autonomy);
    const awkwardness = clamp(
      START.awkwardness + 15 * dealbreakers + 12 * guarded + 7 * clashes - 11 * humor - 4 * noteBump -
        3 * familiarity + jAwk,
    );

    // v3: a couple that has dated before starts tonight where they left off: chemistry and trust carry from the running
    // relationship (lib/relationships.ts), so the box score and the narration's "rose/fell" read against the last
    // date, not a stranger's baseline. Display only: no decision reads start or delta.
    const carry = version >= 3;
    const chemStart = carry && hist.chemistry !== undefined ? clamp(Math.round(hist.chemistry)) : START.chemistry;
    const trustStart = carry && hist.trust !== undefined ? clamp(Math.round(hist.trust)) : START.trust;
    const variables: Record<DateVariable, VariableArc> = {
      chemistry: { start: chemStart, delta: chemistry - chemStart, final: chemistry },
      attraction: { start: START.attraction, delta: attraction - START.attraction, final: attraction },
      trust: { start: trustStart, delta: trust - trustStart, final: trust },
      awkwardness: { start: START.awkwardness, delta: awkwardness - START.awkwardness, final: awkwardness },
    };

    // Ending: the initiating side's strategy decides which variables matter. A tripped dealbreaker hurts.
    const [wc, wa, wt, wk] = STRATEGY_WEIGHTS[input.a.strategy];
    const score = wc * chemistry + wa * attraction + wt * trust - wk * awkwardness - DEALBREAKER_PENALTY * dealbreakers;
    const { rel } = endingScore(input.a.strategy, { chemistry, attraction, trust, awkwardness }, dealbreakers);
    let ending: Ending;
    if (v2) {
      ending = rel >= V2_SECOND_DATE_REL ? ENDINGS[0] : rel >= V2_FRIENDS_REL ? ENDINGS[1] : ENDINGS[2];
    } else {
      ending = score >= SECOND_DATE_AT ? ENDINGS[0] : score >= FRIENDS_AT ? ENDINGS[1] : ENDINGS[2];
    }

    // Per-side satisfaction, for who-wants-another and who-leaves/who-rejects.
    const satOf = (self: SideSetup, r: SideRead, mine: Autonomy): number =>
      (r.wantCue ? 16 : 0) + (r.agendaMet ? 8 : 0) + 14 * sig(self).warmth - (r.dealbreakerCue ? 28 : 0) +
      chemistry * 0.25 + trust * 0.1 - awkwardness * 0.2 + jitter(mine) * 0.5;
    const satA = satOf(input.a, ra, input.a.autonomy);
    const satB = satOf(input.b, rb, input.b.autonomy);

    // wants_another: satisfied and the date didn't blow up — but an "unpredictable" AI may flip, so it
    // surprises its owner either way (PRD: "an AI can ask for another date even when its owner expected
    // the opposite").
    const flipped: string[] = [];
    const wantsAnother = (self: SideSetup, sat: number, label: "a" | "b"): boolean => {
      const base = sat > 8 && ending !== ENDINGS[2];
      if (self.autonomy === "unpredictable" && rand() < 0.3) {
        flipped.push(label);
        return !base;
      }
      return base;
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
        wants_another: wantsAnother(input.a, satA, "a"),
        agenda_met: ra.agendaMet,
        satisfied: satA > 8,
        dealbreaker_hit: ra.dealbreakerCue,
        want_met: ra.wantCue,
        note_followed: aNote,
      },
      {
        wants_another: wantsAnother(input.b, satB, "b"),
        agenda_met: rb.agendaMet,
        satisfied: satB > 8,
        dealbreaker_hit: rb.dealbreakerCue,
        want_met: rb.wantCue,
        note_followed: bNote,
      },
    ];

    const outcome: Outcome = { ending, drama_question, drama_answer, variables, sides, seed, margin: Math.round(rel * 10) / 10 };
    if (!withTrace) return { outcome, trace: null };

    // The trace reads what was already computed: no rand() past this point.
    const reasons: string[] = [];
    if (ra.wantCue) reasons.push("want_met:a");
    if (rb.wantCue) reasons.push("want_met:b");
    if (ra.dealbreakerCue) reasons.push("dealbreaker:a");
    if (rb.dealbreakerCue) reasons.push("dealbreaker:b");
    if (ra.agendaMet) reasons.push("agenda_met:a");
    if (rb.agendaMet) reasons.push("agenda_met:b");
    if (ra.agendaClash) reasons.push("agenda_clash:a");
    if (rb.agendaClash) reasons.push("agenda_clash:b");
    if (aNote !== null) reasons.push(aNote ? "note_followed:a" : "note_ignored:a");
    if (bNote !== null) reasons.push(bNote ? "note_followed:b" : "note_ignored:b");
    if (traitResonance > 0) reasons.push("shared_traits");
    if (hist.dates > 0) reasons.push("history_carry");
    for (const side of flipped) reasons.push(`unpredictable_flip:${side}`);
    const endingFor = (relOrScore: number): Ending =>
      v2
        ? relOrScore >= V2_SECOND_DATE_REL ? ENDINGS[0] : relOrScore >= V2_FRIENDS_REL ? ENDINGS[1] : ENDINGS[2]
        : relOrScore >= SECOND_DATE_AT ? ENDINGS[0] : relOrScore >= FRIENDS_AT ? ENDINGS[1] : ENDINGS[2];
    const decider = v2 ? rel : score;
    const near = v2
      ? Math.min(Math.abs(rel - V2_SECOND_DATE_REL), Math.abs(rel - V2_FRIENDS_REL))
      : Math.min(Math.abs(score - SECOND_DATE_AT), Math.abs(score - FRIENDS_AT));
    if (near < 2) reasons.push("near_threshold");
    // Would the ending have differed with no luck at all (every jitter zero)?
    const calm = { chemistry: clamp(chemistry - jChem), attraction: clamp(attraction - jAttr), trust: clamp(trust - jTrust), awkwardness: clamp(awkwardness - jAwk) };
    const calmScore = wc * calm.chemistry + wa * calm.attraction + wt * calm.trust - wk * calm.awkwardness - DEALBREAKER_PENALTY * dealbreakers;
    const calmDecider = v2 ? endingScore(input.a.strategy, calm, dealbreakers).rel : calmScore;
    if (endingFor(calmDecider) !== endingFor(decider)) reasons.push("jitter_swing");

    const trace: EngineTrace = {
      v: 1,
      engine_version: version,
      strategy: input.a.strategy,
      ending,
      margin: outcome.margin ?? 0,
      score: r2(score),
      thresholds: v2 ? { friends: V2_FRIENDS_REL, second_date: V2_SECOND_DATE_REL } : { friends_at: FRIENDS_AT, second_date_at: SECOND_DATE_AT },
      reasons,
      counts: { dealbreakers, wants_met: wantsMet, agendas_met: agendasMet, clashes, trait_resonance: traitResonance, familiarity },
      signals: { warmth: r2(warmth), openness: r2(openness), guardedness: r2(guarded), humor: r2(humor) },
      terms: {
        chemistry: {
          base: START.chemistry, traits: 6 * traitResonance, humor: r2(12 * humor), warmth: r2(9 * warmth), budget: r2(budget),
          strategy: strategyChem, note: 3 * noteBump, dealbreakers: -13 * dealbreakers, history: histChem, jitter: r2(jChem),
        },
        attraction: {
          base: START.attraction, openness: r2(11 * openness), wants: 8 * wantsMet, agendas: 5 * agendasMet, dealbreakers: -6 * dealbreakers, jitter: r2(jAttr),
        },
        trust: {
          base: START.trust, warmth: r2(13 * warmth), guarded: r2(-15 * guarded), strategy: strategyTrust, note: 3 * noteBump,
          dealbreakers: -10 * dealbreakers, familiarity: 4 * familiarity, history: histTrust, jitter: r2(jTrust),
        },
        awkwardness: {
          base: START.awkwardness, dealbreakers: 15 * dealbreakers, guarded: r2(12 * guarded), clashes: 7 * clashes, humor: r2(-11 * humor),
          note: -4 * noteBump, familiarity: -3 * familiarity, jitter: r2(jAwk),
        },
      },
      contributions: {
        chemistry: r2(wc * chemistry),
        attraction: r2(wa * attraction),
        trust: r2(wt * trust),
        awkwardness: r2(-wk * awkwardness),
        dealbreakers: -DEALBREAKER_PENALTY * dealbreakers,
        // rel = score - neutralScore(strategy): the neutral date's score, subtracted.
        neutral: r2(rel - score),
      },
      sat: { a: r2(satA), b: r2(satB) },
    };
    return { outcome, trace };
}

/** The pure deterministic engine. Everything here is a function of (input, seed). */
export const deterministicEngine: Engine = {
  decide(input: DateInput, seed: number, version: EngineVersion = CURRENT_ENGINE_VERSION): Outcome {
    return decideCore(input, seed, version, false).outcome;
  },
};

/**
 * The outcome and its trace, for storing at booking (episodes.engine_trace). Null trace under a test engine (tests'
 * fixed outcomes have no reasoning to record). Never throws: a trace is a nice-to-have, the outcome is the date.
 */
export function decideTraced(input: DateInput, seed: number, version: EngineVersion = CURRENT_ENGINE_VERSION): { outcome: Outcome; trace: EngineTrace | null } {
  const engine = getEngine();
  if (engine !== deterministicEngine) return { outcome: engine.decide(input, seed, version), trace: null };
  return deterministicTraced(input, seed, version);
}

/** Always the deterministic engine, with its trace (replays like Sliding Doors, which never use a test engine). */
export function deterministicTraced(input: DateInput, seed: number, version: EngineVersion = CURRENT_ENGINE_VERSION): { outcome: Outcome; trace: EngineTrace | null } {
  try {
    return decideCore(input, seed, version, true);
  } catch {
    return { outcome: deterministicEngine.decide(input, seed, version), trace: null };
  }
}

/* ---------------------------------- injection (mirrors lib/model.ts) ---------------------------------- */
// (CURRENT_ENGINE_VERSION is what new dates are decided with; see EngineVersion above.)

let testEngine: Engine | null = null;

/** Tests can force an outcome, the same way setModelForTests swaps the model. Production always decides. */
export function setEngineForTests(engine: Engine | null): void {
  testEngine = engine;
}

export function getEngine(): Engine {
  return testEngine ?? deterministicEngine;
}

/**
 * A fixed outcome, for integration tests that need a specific ending (see tests/helpers.ts). It stands exactly as given
 * unless `wishes` is on, for a test of the wishes weighing in (lib/wishes.ts).
 */
export function fixedEngine(partial: Partial<Outcome> & { ending: Ending }, opts: { wishes?: boolean } = {}): Engine {
  return {
    exact: !opts.wishes,
    decide(_input, seed, _version) {
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
