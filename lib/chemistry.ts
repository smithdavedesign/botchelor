/**
 * The OC chemistry test (app/tools/oc-chemistry-test): two characters in, each a name, three traits, a want and a
 * dealbreaker (the same fields and limits as /create), and out come a 0–100 score, a predicted ending and three reasons.
 *
 * It runs the show's own engine (lib/engine.ts) on the two sheets the way it would decide a first date between two
 * new characters: each plays the temperament its traits describe (lib/temperament.ts) on the settings a new
 * character starts with, and the secret agendas and the night's roll of the dice are seeded from the two sheets. So
 * the same two sheets always get the same result, whichever goes first, and it costs nothing: no model, no database,
 * no network. One rule is the test's own: a tripped dealbreaker is always a disaster.
 *
 * Every sheet passes the builder's checks first, with the builder's messages: its limits (the schema in
 * app/api/characters/route.ts) and the show's content filter (lib/safety.ts): adults only, no real people, nothing
 * sexual. tests/oc-chemistry-test.test.ts holds the messages and limits equal to /create's.
 */
import { CURRENT_ENGINE_VERSION, cues, deterministicEngine, seedFrom, UNREMARKABLE_SIGNALS, V2_FRIENDS_REL, V2_SECOND_DATE_REL, type CharacterSheet, type SideSetup, type SoulSignals } from "./engine";
import { pairNames } from "./names";
import { AGENDA_IDS, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY, type Ending } from "./rules";
import { checkFields, type RejectReason } from "./safety";
import { sheetSignals } from "./temperament";

export const CHEMISTRY_PATH = "/tools/oc-chemistry-test";
/** Where the form goes (a plain GET), so the address of a result is the two sheets: a link anyone can open. */
export const CHEMISTRY_RESULT_PATH = `${CHEMISTRY_PATH}/result`;
/** A result's share card (app/api/og/chemistry). */
export const CHEMISTRY_CARD_PATH = "/api/og/chemistry";

/** /create's limits: its schema (app/api/characters/route.ts) and the builder's inputs. */
export const SHEET_LIMITS = { name: 40, nameWords: 5, trait: 30, want: 140, dealbreaker: 140, minAge: 18, maxAge: 1000 } as const;

/** The score where each ending starts: under 40 is a disaster, 40 to 69 just friends, 70 and up a second date. */
export const FRIENDS_SCORE = 40;
export const SECOND_DATE_SCORE = 70;

export const SIDES = ["a", "b"] as const;
export type Side = (typeof SIDES)[number];
/** One character's fields, in the form's order; each is `<side>_<field>` in the form and the address. */
export const FIELD_KEYS = ["name", "age", "trait1", "trait2", "trait3", "want", "dealbreaker"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type FieldValues = Record<FieldKey, string>;

export const SIDE_LABELS: Record<Side, string> = { a: "First character", b: "Second character" };
export const FIELD_LABELS: Record<FieldKey, string> = {
  name: "name",
  age: "age",
  trait1: "trait 1",
  trait2: "trait 2",
  trait3: "trait 3",
  want: "what they want",
  dealbreaker: "dealbreaker",
};

/** A character sheet the test reads. The age is optional here (the engine never reads it); /create asks for one. */
export type ChemistrySheet = { name: string; age: number | null; traits: [string, string, string]; want: string; dealbreaker: string };

/* ------------------------------------------- reading the form ------------------------------------------- */

// What /create answers for the same problems: its schema's messages, and its content filter's (REJECTION_MESSAGES).
const REQUIRED = "Required.";
const tooLong = (max: number) => `At most ${max} characters.`;
const AGE_MESSAGES = {
  number: "Age must be a number.",
  whole: "Age must be a whole number.",
  adult: "Characters must be adults (18+).",
  max: `At most ${SHEET_LIMITS.maxAge}.`,
};
const REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
  innuendo: "Keep the character sheet free of innuendo.",
};

export type ChemistryProblem = { side: Side; field: FieldKey; message: string };

export type PairRead =
  | { ok: true; a: ChemistrySheet; b: ChemistrySheet }
  | {
      ok: false;
      problems: ChemistryProblem[];
      /** What to put back in the form: what was typed, minus any field the content filter refused (never echoed). */
      values: Record<Side, FieldValues>;
      /** Nothing was typed at all (the result page opened on its own). */
      empty: boolean;
    };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function getter(params: Params): (key: string) => string {
  if (params instanceof URLSearchParams) return (key) => params.get(key) ?? "";
  return (key) => {
    const v = params[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
}

/** Whether an address carries any chemistry test field (so /create knows to read one). */
export function hasChemistryFields(params: Params): boolean {
  const get = getter(params);
  return SIDES.some((side) => FIELD_KEYS.some((f) => get(`${side}_${f}`) !== ""));
}

function textProblem(value: string, max: number): string | null {
  if (!value) return REQUIRED;
  return value.length > max ? tooLong(max) : null;
}

function ageProblem(value: string): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return AGE_MESSAGES.number;
  if (!Number.isInteger(n)) return AGE_MESSAGES.whole;
  if (n < SHEET_LIMITS.minAge) return AGE_MESSAGES.adult;
  return n > SHEET_LIMITS.maxAge ? AGE_MESSAGES.max : null;
}

function readSide(get: (key: string) => string, side: Side): { sheet: ChemistrySheet | null; problems: ChemistryProblem[]; values: FieldValues } {
  const values = Object.fromEntries(FIELD_KEYS.map((f) => [f, get(`${side}_${f}`).trim()])) as FieldValues;
  const problems: ChemistryProblem[] = [];
  const add = (field: FieldKey, message: string | null) => {
    if (message) problems.push({ side, field, message });
  };
  // The builder's schema, in its order.
  const nameProblem = textProblem(values.name, SHEET_LIMITS.name);
  add("name", nameProblem ?? (values.name.split(/\s+/).length > SHEET_LIMITS.nameWords ? `At most ${SHEET_LIMITS.nameWords} words.` : null));
  add("age", ageProblem(values.age));
  for (const f of ["trait1", "trait2", "trait3"] as const) add(f, textProblem(values[f], SHEET_LIMITS.trait));
  add("want", textProblem(values.want, SHEET_LIMITS.want));
  add("dealbreaker", textProblem(values.dealbreaker, SHEET_LIMITS.dealbreaker));
  // The show's content filter, field by field, so every refused field is named and none is put back in the form.
  for (const f of ["name", "trait1", "trait2", "trait3", "want", "dealbreaker"] as const) {
    if (!values[f]) continue;
    const verdict = checkFields({ [f]: values[f] });
    if (!verdict.ok) {
      problems.push({ side, field: f, message: REJECTION_MESSAGES[verdict.reason] });
      values[f] = "";
    }
  }
  if (problems.length) return { sheet: null, problems, values };
  return {
    sheet: {
      name: values.name,
      age: values.age ? Number(values.age) : null,
      traits: [values.trait1, values.trait2, values.trait3],
      want: values.want,
      dealbreaker: values.dealbreaker,
    },
    problems,
    values,
  };
}

/** Reads the two characters from the form or an address (a_name, a_age, a_trait1…3, a_want, a_dealbreaker, b_…). */
export function readPair(params: Params): PairRead {
  const get = getter(params);
  const a = readSide(get, "a");
  const b = readSide(get, "b");
  if (a.sheet && b.sheet) return { ok: true, a: a.sheet, b: b.sheet };
  return { ok: false, problems: [...a.problems, ...b.problems], values: { a: a.values, b: b.values }, empty: !hasChemistryFields(params) };
}

/** A sheet as the form's values. */
export function sheetValues(s: ChemistrySheet): FieldValues {
  return { name: s.name, age: s.age === null ? "" : String(s.age), trait1: s.traits[0], trait2: s.traits[1], trait3: s.traits[2], want: s.want, dealbreaker: s.dealbreaker };
}

/** The two sheets as a query string, in the form's order: exactly what submitting the form puts in the address. */
export function pairQuery(a: ChemistrySheet, b: ChemistrySheet): string {
  const q = new URLSearchParams();
  for (const [side, s] of [["a", a], ["b", b]] as const) {
    const v = sheetValues(s);
    for (const f of FIELD_KEYS) q.append(`${side}_${f}`, v[f]);
  }
  return q.toString();
}

export const resultPath = (a: ChemistrySheet, b: ChemistrySheet) => `${CHEMISTRY_RESULT_PATH}?${pairQuery(a, b)}`;
export const cardPath = (a: ChemistrySheet, b: ChemistrySheet) => `${CHEMISTRY_CARD_PATH}?${pairQuery(a, b)}`;
/** /create with `build`'s sheet filled in, and `other`'s carried along (app/create/page.tsx reads both). */
export const createHref = (build: ChemistrySheet, other: ChemistrySheet) => `/create?${pairQuery(build, other)}`;

/* ------------------------------------------- the test ------------------------------------------- */

export type ChemistryResult = { score: number; ending: Ending; reasons: [string, string, string] };

/** Case, spacing and Unicode forms don't change a result. */
const fold = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const keyOf = (s: ChemistrySheet) => [s.name, ...s.traits, s.want, s.dealbreaker].map(fold).join("\n");

/** Where the deciding number (lib/engine.ts endingScore's `rel`) lands, scaled per ending onto its stretch of 0–100. */
const REL_FLOOR = -40;
const REL_CEILING = 30;
const BANDS: Record<Ending, [relFrom: number, relTo: number, scoreFrom: number, scoreTo: number]> = {
  disaster: [REL_FLOOR, V2_FRIENDS_REL, 0, FRIENDS_SCORE - 1],
  friends: [V2_FRIENDS_REL, V2_SECOND_DATE_REL, FRIENDS_SCORE, SECOND_DATE_SCORE - 1],
  second_date: [V2_SECOND_DATE_REL, REL_CEILING, SECOND_DATE_SCORE, 100],
};

function scoreFor(rel: number, ending: Ending): number {
  const [r0, r1, s0, s1] = BANDS[ending];
  const t = Math.max(0, Math.min(1, (rel - r0) / (r1 - r0)));
  return Math.round(s0 + t * (s1 - s0));
}

/** The engine's side for one character: a new character's settings, its traits' temperament, an agenda dealt by seed. */
function sideSetup(s: ChemistrySheet, seed: number, which: Side): SideSetup {
  const sheet: CharacterSheet = {
    name: fold(s.name),
    age: s.age ?? SHEET_LIMITS.minAge,
    bio: "",
    traits: s.traits.map(fold),
    want: fold(s.want),
    dealbreaker: fold(s.dealbreaker),
    house: false,
  };
  return {
    sheet,
    signals: sheetSignals({ traits: sheet.traits }),
    autonomy: DEFAULT_AUTONOMY,
    strategy: DEFAULT_STRATEGY,
    agendaId: AGENDA_IDS[seedFrom(seed, `agenda-${which}`) % AGENDA_IDS.length],
    note: null,
    gameBudget: DEFAULT_GAME_BUDGET,
  };
}

/** Words for phrase matching: folded, punctuation dropped, a plural's "s" dropped the way the engine does it. */
const phraseWords = (s: string) =>
  fold(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** Whether `needle`'s words appear, in order and together, in `hay`'s. */
function hasPhrase(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.join("").length < 2) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, k) => hay[i + k] === w)) return true;
  return false;
}

/**
 * The trait of `other`'s that `self`'s dealbreaker names, as typed: the trait inside the dealbreaker ("loud" in "loud
 * people") or the dealbreaker inside the trait ("liar" in "compulsive liar"). The engine matches word by word and
 * skips its stopwords ("loud", from "out loud"); the test's own rule (a dealbreaker is a disaster) must not.
 */
function traitTripping(self: ChemistrySheet, other: ChemistrySheet): string | null {
  const dealbreaker = phraseWords(self.dealbreaker);
  return other.traits.find((t) => hasPhrase(dealbreaker, phraseWords(t)) || hasPhrase(phraseWords(t), dealbreaker))?.trim() ?? null;
}

/** A word the engine matched, as the other character wrote it (the engine reads "curious" as "curiou"). */
function wordFor(cue: string, texts: readonly string[]): string {
  for (const text of texts) for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) if (raw && cues(raw).has(cue)) return raw;
  return cue;
}

const quote = (s: string) => `“${s}”`;

/** The temperament line, by the axis the two characters' traits move furthest from an unremarkable one (up, down). */
const TEMPERAMENT_LINES: Record<keyof SoulSignals, [string, string]> = {
  humor: ["Their traits are quick to joke, which eases the awkward moments.", "Their traits run serious, so the awkward moments linger."],
  warmth: ["Their traits read warm, which builds chemistry and trust.", "Their traits read cold, which costs them chemistry and trust."],
  guardedness: ["Their traits are guarded, so trust comes slowly.", "Their traits are open books, so trust comes easily."],
  openness: ["Their traits are game for anything, which lifts the attraction.", "Their traits play it safe, which keeps the attraction low."],
};
const AXES: (keyof SoulSignals)[] = ["humor", "warmth", "guardedness", "openness"];
/** One trait word on one side moves the pair's average this far: the least worth a mention. */
const NOTABLE = 0.1 - 1e-9;

function temperamentLine(a: ChemistrySheet, b: ChemistrySheet): string {
  const sa = sheetSignals({ traits: a.traits });
  const sb = sheetSignals({ traits: b.traits });
  let best: { axis: keyof SoulSignals; dev: number } | null = null;
  for (const axis of AXES) {
    const dev = (sa[axis] + sb[axis]) / 2 - UNREMARKABLE_SIGNALS[axis];
    if (Math.abs(dev) >= NOTABLE && (!best || Math.abs(dev) > Math.abs(best.dev))) best = { axis, dev };
  }
  if (!best) return "Nothing in their traits warms the night up or cools it down.";
  return TEMPERAMENT_LINES[best.axis][best.dev > 0 ? 0 : 1];
}

/**
 * The test itself: the engine's decision on a first date between these two, as a 0–100 score, an ending and three
 * one-line reasons (dealbreakers, wants, then a shared trait or the temperament their traits describe).
 */
export function chemistryTest(a: ChemistrySheet, b: ChemistrySheet): ChemistryResult {
  // The same pair in either order runs the same date: the sheets go in a fixed order, and the seed is theirs.
  const flip = keyOf(b) < keyOf(a);
  const [first, second] = flip ? [b, a] : [a, b];
  const seed = seedFrom("oc-chemistry-test", keyOf(first), keyOf(second));
  const outcome = deterministicEngine.decide({ a: sideSetup(first, seed, "a"), b: sideSetup(second, seed, "b") }, seed, CURRENT_ENGINE_VERSION);
  const [sideA, sideB] = flip ? [outcome.sides[1], outcome.sides[0]] : outcome.sides;

  // What tripped each one's dealbreaker, and what met each one's want: a trait or a word of the other's, as written.
  const surface = (s: ChemistrySheet) => [...s.traits, s.want];
  const tripsA = traitTripping(a, b) ?? (sideA.dealbreaker_hit ? wordFor(sideA.dealbreaker_hit, surface(b)) : null);
  const tripsB = traitTripping(b, a) ?? (sideB.dealbreaker_hit ? wordFor(sideB.dealbreaker_hit, surface(a)) : null);
  const ending: Ending = tripsA || tripsB ? "disaster" : outcome.ending;
  const score = scoreFor(outcome.margin ?? 0, ending);

  const [na, nb] = pairNames(a.name, b.name);
  const dealbreakers =
    tripsA && tripsB
      ? `They trip each other's dealbreakers: ${quote(tripsA)} and ${quote(tripsB)}.`
      : tripsA
        ? `${nb} trips ${na}'s dealbreaker: ${quote(tripsA)}.`
        : tripsB
          ? `${na} trips ${nb}'s dealbreaker: ${quote(tripsB)}.`
          : "Neither one trips the other's dealbreaker.";
  const wantA = sideA.want_met ? wordFor(sideA.want_met, surface(b)) : null;
  const wantB = sideB.want_met ? wordFor(sideB.want_met, surface(a)) : null;
  const wants =
    wantA && wantB
      ? `Each has what the other wants: ${quote(wantA)} and ${quote(wantB)}.`
      : wantA
        ? `${nb} has what ${na} wants: ${quote(wantA)}.`
        : wantB
          ? `${na} has what ${nb} wants: ${quote(wantB)}.`
          : "Neither one sees what they want in the other.";
  const theirs = cues(b.traits.join(" "));
  const shared = [...cues(a.traits.join(" "))].find((w) => theirs.has(w));
  const traits = shared ? `Both are ${quote(wordFor(shared, a.traits))}, and a shared trait warms up the chemistry.` : temperamentLine(a, b);
  return { score, ending, reasons: [dealbreakers, wants, traits] };
}
