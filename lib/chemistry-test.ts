/**
 * The OC chemistry test (/tools/oc-chemistry-test, GROWTH.md 2026-10-20): two characters' sheets in, the show's own
 * prediction out: a score out of 100, how their first date would end (a second date, just friends or a disaster) and
 * three one-line reasons.
 *
 * It is the engine every real date is decided by (lib/engine.ts), run as a first date at the show's default settings
 * on just what the form asks for: a name, three traits, a want and a dealbreaker. Each side plays the temperament its
 * traits describe (lib/temperament.ts, as the builder reads it) and the secret agenda the seed deals it, the way
 * buildDate deals them (lib/simulation.ts). The seed comes from the two sheets, so the same two characters always get
 * the same answer and a result is a link anyone can open. No model, no randomness, no database. Pure, so the tool's
 * pages, its share card and /create's prefill all read the same thing.
 *
 * One rule is stated outright: a dealbreaker that goes off is a disaster. On a real date the engine weighs it heavily
 * (lib/engine.ts DEALBREAKER_PENALTY), but a pair that lines up everywhere else can still scrape "friends" on the
 * numbers; a test that reads six lines a side says it plainly. And a dealbreaker that names one of the other's traits
 * outright always goes off, even when the engine's cue matching skips the word (it drops stopwords like "loud", short
 * words and accented letters): see traitTripped.
 */
import { cues, deterministicEngine, seedFrom, V2_FRIENDS_REL, V2_SECOND_DATE_REL, type SideSetup } from "./engine";
import { shortName } from "./names";
import {
  AGENDA_IDS,
  DATE_VARIABLES,
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
  type AgendaId,
  type DateVariable,
  type Ending,
} from "./rules";
import { CHARACTER_REJECTION_MESSAGES, checkFields, type RejectReason } from "./safety";
import { sheetSignals } from "./temperament";

export const CHEMISTRY_TEST_PATH = "/tools/oc-chemistry-test";
export const CHEMISTRY_RESULT_PATH = `${CHEMISTRY_TEST_PATH}/result`;
/** The result's share card (app/api/chemistry-card): under /api, so the 18+ gate never stands in an unfurler's way. */
export const CHEMISTRY_CARD_PATH = "/api/chemistry-card";

/**
 * /create's limits on the same fields (app/api/characters/route.ts and the builder's inputs). The tests read the
 * builder's maxLength off the rendered page, so a change there fails until this follows.
 */
export const SHEET_LIMITS = { name: 40, nameWords: 5, trait: 30, want: 140, dealbreaker: 140 } as const;

export type TestSheet = { name: string; traits: readonly [string, string, string]; want: string; dealbreaker: string };
export type Side = "a" | "b";
export const SIDES: readonly Side[] = ["a", "b"];
/** One sheet's fields, named as /create names its inputs (trait1, want, ...). */
export const SHEET_FIELDS = ["name", "trait1", "trait2", "trait3", "want", "dealbreaker"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

const LIMIT: Record<SheetField, number> = {
  name: SHEET_LIMITS.name,
  trait1: SHEET_LIMITS.trait,
  trait2: SHEET_LIMITS.trait,
  trait3: SHEET_LIMITS.trait,
  want: SHEET_LIMITS.want,
  dealbreaker: SHEET_LIMITS.dealbreaker,
};
export const fieldLimit = (field: SheetField): number => LIMIT[field];

/** The form's input (and the result address's parameter) for one side's field: a_name, b_trait2, ... */
export const param = (side: Side, field: SheetField): string => `${side}_${field}`;

/** One field of a sheet, by its input name. */
export const fieldOf = (s: TestSheet, field: SheetField): string =>
  field === "name" ? s.name : field === "want" ? s.want : field === "dealbreaker" ? s.dealbreaker : s.traits[Number(field.slice(5)) - 1];

/**
 * A worked example, for the tool page's "try it" link and the screenshots. Invented characters (not the house cast):
 * each has something the other wants, and neither trips the other's dealbreaker.
 */
export const SAMPLE_PAIR: readonly [TestSheet, TestSheet] = [
  { name: "Odessa Crane", traits: ["curious", "deadpan", "night owl"], want: "Someone who stays up for the meteor shower", dealbreaker: "Spoiling the end of a mystery novel" },
  { name: "Fitz Harlow", traits: ["warm", "witty", "meteor chaser"], want: "A date who is curious about everything", dealbreaker: "Flaky plans" },
];

/* ---------------------------------- reading the form ---------------------------------- */

export type Query = Record<string, string | string[] | undefined> | URLSearchParams;

const read = (q: Query, key: string): string => {
  const v = q instanceof URLSearchParams ? q.get(key) : q[key];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** /create's own messages for a field that's empty or too long (its zod schema's). */
function shapeError(field: SheetField, value: string): string | null {
  if (!value) return "Required.";
  if (value.length > LIMIT[field]) return `At most ${LIMIT[field]} characters.`;
  if (field === "name" && words(value) > SHEET_LIMITS.nameWords) return `At most ${SHEET_LIMITS.nameWords} words.`;
  return null;
}

export type ChemistryError = "empty" | "invalid" | RejectReason;

export type ChemistryRead =
  | { ok: true; a: TestSheet; b: TestSheet }
  | {
      ok: false;
      error: ChemistryError;
      /** Where to look (null when nothing was typed at all). */
      side: Side | null;
      field: SheetField | null;
      message: string;
      /** What may go back in the form: every field that's fine on its own. Never a refused one. */
      keep: Record<string, string>;
    };

export const EMPTY_MESSAGE = "Fill in both characters to test their chemistry.";

/**
 * The form (or a shared result's address) as two sheets, or the first thing wrong with it: an empty or too-long field
 * gets /create's limit message, and anything suggesting someone under 18, a real person or sexual content gets
 * /create's own refusal (lib/safety.ts, the same filter and the same words). Values are trimmed, as /create trims them.
 */
export function readChemistryTest(query: Query): ChemistryRead {
  const raw = Object.fromEntries(SIDES.flatMap((side) => SHEET_FIELDS.map((f) => [param(side, f), read(query, param(side, f))])));
  const keep: Record<string, string> = {};
  type Wrong = { error: ChemistryError; side: Side; field: SheetField; message: string };
  let first: Wrong | null = null;
  let refused: Wrong | null = null;
  for (const side of SIDES) {
    for (const field of SHEET_FIELDS) {
      const value = raw[param(side, field)];
      const shape = shapeError(field, value);
      if (shape) {
        first ??= { error: "invalid", side, field, message: shape };
        continue;
      }
      const verdict = checkFields({ [field]: value });
      if (!verdict.ok) {
        refused ??= { error: verdict.reason, side, field, message: CHARACTER_REJECTION_MESSAGES[verdict.reason] };
        continue;
      }
      keep[param(side, field)] = value;
    }
  }
  if (Object.values(raw).every((v) => !v)) return { ok: false, error: "empty", side: null, field: null, message: EMPTY_MESSAGE, keep };
  // Like /create's API: the shape first, then the content rules.
  const wrong = first ?? refused;
  if (wrong) return { ok: false, ...wrong, keep };
  const sheetOf = (side: Side): TestSheet => ({
    name: raw[param(side, "name")],
    traits: [raw[param(side, "trait1")], raw[param(side, "trait2")], raw[param(side, "trait3")]],
    want: raw[param(side, "want")],
    dealbreaker: raw[param(side, "dealbreaker")],
  });
  return { ok: true, a: sheetOf("a"), b: sheetOf("b") };
}

/* ---------------------------------- the test ---------------------------------- */

/** One band per ending, worst to best, covering 0-100: a score always agrees with the ending it comes with. */
export const SCORE_BANDS: Record<Ending, readonly [number, number]> = { disaster: [0, 39], friends: [40, 69], second_date: [70, 100] };
/** The engine's margin (how far the date landed from an ordinary one; lib/engine.ts endingScore) at each band's ends. */
const MARGIN_SPAN: Record<Ending, readonly [number, number]> = {
  disaster: [-30, V2_FRIENDS_REL],
  friends: [V2_FRIENDS_REL, V2_SECOND_DATE_REL],
  second_date: [V2_SECOND_DATE_REL, 30],
};

function scoreFor(ending: Ending, margin: number): number {
  const [lo, hi] = SCORE_BANDS[ending];
  const [from, to] = MARGIN_SPAN[ending];
  return Math.max(lo, Math.min(hi, Math.round(lo + ((margin - from) / (to - from)) * (hi - lo))));
}

export type ChemistryResult = {
  a: TestSheet;
  b: TestSheet;
  score: number;
  ending: Ending;
  reasons: [string, string, string];
  /** Whose dealbreaker went off, and on what of the other's: a trait it names outright, or the engine's cue word. */
  tripped: { side: Side; cue: string }[];
  /** Where the box score's four numbers finished (0..100). */
  numbers: Record<DateVariable, number>;
};

/** The same sheet however it was typed (case, spacing), for the seed. */
const sheetKey = (s: TestSheet) => SHEET_FIELDS.map((f) => fieldOf(s, f).toLowerCase().replace(/\s+/g, " ").trim()).join("\u0001");

const setup = (s: TestSheet, agendaId: AgendaId): SideSetup => ({
  // The engine never reads age or bio; the form has neither.
  sheet: { name: s.name, age: 18, bio: "", traits: s.traits, want: s.want, dealbreaker: s.dealbreaker, house: false },
  signals: sheetSignals({ traits: s.traits }),
  autonomy: DEFAULT_AUTONOMY,
  strategy: DEFAULT_STRATEGY,
  agendaId,
  note: null,
  gameBudget: DEFAULT_GAME_BUDGET,
});

/**
 * A text's words, every one of them: lowercased, accents folded (naïve, naive), split on anything that isn't a letter
 * or digit in any script, and a plural's "s" off as the engine drops it. Unlike the engine's cues, no stopword or
 * short word is left out.
 */
const plainWords = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));

/**
 * The trait of the other's that a dealbreaker names outright (all its words, in order, among the dealbreaker's), as
 * those words; else null. "Loud people" names "loud", "Night owls" names "night owl". The engine finds its dealbreaker
 * cues without stopwords, so on its own it never sees "loud".
 */
function traitTripped(dealbreaker: string, other: TestSheet): string | null {
  const said = plainWords(dealbreaker);
  for (const trait of other.traits) {
    const t = plainWords(trait);
    if (t.length && said.some((_, i) => t.every((w, j) => said[i + j] === w))) return t.join(" ");
  }
  return null;
}

/** The two sheets' prediction: the engine's first date between them, decided from the sheets alone. */
export function chemistryTest(a: TestSheet, b: TestSheet): ChemistryResult {
  const seed = seedFrom("oc-chemistry-test", sheetKey(a), "×", sheetKey(b));
  const deal = (salt: string) => AGENDA_IDS[seedFrom(seed, salt) % AGENDA_IDS.length];
  const outcome = deterministicEngine.decide({ a: setup(a, deal("agenda-a")), b: setup(b, deal("agenda-b")) }, seed);
  const tripped = SIDES.flatMap((side, i) => {
    const [self, other] = side === "a" ? [a, b] : [b, a];
    const cue = traitTripped(self.dealbreaker, other) ?? outcome.sides[i].dealbreaker_hit;
    return cue ? [{ side, cue }] : [];
  });
  const ending: Ending = tripped.length ? "disaster" : outcome.ending;
  const numbers = Object.fromEntries(DATE_VARIABLES.map((v) => [v, outcome.variables[v].final])) as Record<DateVariable, number>;
  const wants = SIDES.map((_, i) => outcome.sides[i].want_met);
  return {
    a,
    b,
    score: scoreFor(ending, outcome.margin ?? 0),
    ending,
    reasons: reasonsFor(a, b, ending, tripped, wants, numbers),
    tripped,
    numbers,
  };
}

/* ---------------------------------- the reasons ---------------------------------- */

/** A text's words as the engine compares them (lowercase, a plural's "s" off), each with how it was typed. */
function wordsOf(text: string): { cue: string; typed: string }[] {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((typed) => {
      const t = typed.toLowerCase();
      return { cue: t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t, typed: t };
    });
}

/** Where a cue sits in a sheet: one of its traits (as typed), or its want (the word as typed). */
function findCue(s: TestSheet, cue: string): { in: "trait" | "want"; text: string } {
  const trait = s.traits.find((t) => plainWords(t).join(" ") === cue) ?? s.traits.find((t) => wordsOf(t).some((w) => w.cue === cue));
  if (trait) return { in: "trait", text: trait };
  return { in: "want", text: wordsOf(s.want).find((w) => w.cue === cue)?.typed ?? cue };
}

const avg = (x: number, y: number) => (x + y) / 2;

/**
 * Three one-line reasons, from what the engine read: a tripped dealbreaker always first, then what helped and what
 * didn't (in the order that explains this ending), then a summary and the box score's numbers. Names are first
 * names. Each line is something the engine really weighed, so a reason never contradicts the ending.
 */
function reasonsFor(
  a: TestSheet,
  b: TestSheet,
  ending: Ending,
  tripped: { side: Side; cue: string }[],
  wants: (string | null)[],
  n: Record<DateVariable, number>,
): [string, string, string] {
  const sheets = { a, b };
  const other = (side: Side): Side => (side === "a" ? "b" : "a");
  const first = (side: Side) => shortName(sheets[side].name);

  const trips = tripped.map(({ side, cue }) => {
    const at = findCue(sheets[other(side)], cue);
    return at.in === "trait"
      ? `${first(side)}'s dealbreaker goes off: ${first(other(side))} is “${at.text}”, and that ends it.`
      : `${first(side)}'s dealbreaker goes off at what ${first(other(side))} wants (“${at.text}”), and that ends it.`;
  });

  const good: string[] = [];
  const bad: string[] = [];
  SIDES.forEach((side, i) => {
    const cue = wants[i];
    if (!cue) return;
    const at = findCue(sheets[other(side)], cue);
    good.push(
      at.in === "trait"
        ? `${first(other(side))} is “${at.text}”, which is what ${first(side)} wants.`
        : `${first("a")} and ${first("b")} want the same thing (“${at.text}”).`,
    );
  });
  if (!wants[0] && !wants[1]) bad.push("Neither has what the other wants, so attraction stays flat.");
  else SIDES.forEach((side, i) => !wants[i] && bad.push(`Nothing in ${first(other(side))}'s sheet is what ${first(side)} wants.`));

  // Shared traits: the engine's chemistry bonus, word for word.
  const bCues = cues(b.traits.join(" "));
  const shared = [...cues(a.traits.join(" "))].filter((c) => bCues.has(c)).map((c) => wordsOf(a.traits.join(" ")).find((w) => w.cue === c)?.typed ?? c);
  if (shared.length === 1) good.push(`They're both “${shared[0]}”, and a shared trait sparks chemistry.`);
  else if (shared.length > 1) good.push(`They share “${shared[0]}” and “${shared[1]}”, which sparks chemistry.`);

  // The temperaments their traits describe, where they're strong enough to move the night.
  const sa = sheetSignals({ traits: a.traits });
  const sb = sheetSignals({ traits: b.traits });
  if (avg(sa.humor, sb.humor) >= 0.6) good.push("Plenty of humour between them takes the edge off the awkward moments.");
  if (avg(sa.warmth, sb.warmth) >= 0.6) good.push("Both read as warm, and warmth builds trust.");
  if (avg(sa.openness, sb.openness) >= 0.6) good.push("Both are game for anything, which helps attraction.");
  const guarded = SIDES.filter((side) => (side === "a" ? sa : sb).guardedness >= 0.6);
  if (guarded.length === 2) bad.push("Both are slow to let anyone in, so trust comes slowly.");
  else if (guarded.length === 1) bad.push(`${first(guarded[0])} is slow to let anyone in, so trust comes slowly.`);
  if (avg(sa.humor, sb.humor) <= 0.2) bad.push("Neither is quick to joke, so awkward moments linger.");
  if (avg(sa.warmth, sb.warmth) <= 0.2) bad.push("Both read as cool, so trust is hard to build.");

  const summary = tripped.length
    ? []
    : [
        ending === "second_date"
          ? "Enough sparks for a second date, and nothing they can't get past."
          : ending === "friends"
            ? "Warm enough for friends, but not enough spark for a second date."
            : "Not enough clicks to get past the awkward moments.",
      ];
  const numbers = `By the end of the night: chemistry ${n.chemistry}, attraction ${n.attraction}, trust ${n.trust}, awkwardness ${n.awkwardness}.`;
  const order =
    ending === "disaster"
      ? [...trips, ...bad, ...summary, numbers, ...good]
      : ending === "friends"
        ? [...good, ...bad, ...summary, numbers]
        : [...good, ...summary, numbers, ...bad];
  const [r1, r2, r3] = [...new Set(order)];
  return [r1, r2, r3];
}

/* ---------------------------------- links ---------------------------------- */

/** Two sheets as the form's fields (a_name … b_dealbreaker): what it submits, and what puts them back in it. */
export function formValues(a: TestSheet, b: TestSheet): Record<string, string> {
  return Object.fromEntries(SIDES.flatMap((side) => SHEET_FIELDS.map((f) => [param(side, f), fieldOf(side === "a" ? a : b, f)])));
}

/** The shareable result for two sheets: /tools/oc-chemistry-test/result?a_name=…, exactly what the form submits. */
export function resultHref(a: TestSheet, b: TestSheet): string {
  return `${CHEMISTRY_RESULT_PATH}?${new URLSearchParams(formValues(a, b))}`;
}

/** The result's share card, drawn from the same query. */
export function cardHref(a: TestSheet, b: TestSheet): string {
  return `${CHEMISTRY_CARD_PATH}?${new URLSearchParams(formValues(a, b))}`;
}

/** A sheet as /create prefills it from its address: any of the fields, each within the builder's limit. */
export type CreatePrefill = { name?: string; traits?: readonly [string, string, string]; want?: string; dealbreaker?: string };

/** A prefill's fields as /create's address carries them, blanks left out. */
const prefillEntries = (p: CreatePrefill, prefix: string): [string, string][] =>
  (
    [
      ["name", p.name],
      ["trait1", p.traits?.[0]],
      ["trait2", p.traits?.[1]],
      ["trait3", p.traits?.[2]],
      ["want", p.want],
      ["dealbreaker", p.dealbreaker],
    ] as const
  ).flatMap(([k, v]) => (v ? [[`${prefix}${k}`, v] as [string, string]] : []));

/**
 * The builder with a sheet already in (/create?name=…&trait1=…&want=…&dealbreaker=…), and optionally the next one to
 * build (with_name=…): the result's "Watch the real date". The builder makes one character at a time, so it opens on
 * the first and links to the second, filled in too.
 */
export function createHref(sheet: CreatePrefill, next?: CreatePrefill | null): string {
  return `/create?${new URLSearchParams([...prefillEntries(sheet, ""), ...(next ? prefillEntries(next, "with_") : [])])}`;
}

/**
 * /create's prefill from its address (`with_` for the next one to build): each field trimmed to the builder's limit,
 * and dropped if it's empty or the content rules would refuse it (the builder would refuse it on save anyway). Null
 * when nothing is left.
 */
export function prefillFromQuery(query: Query, prefix = ""): CreatePrefill | null {
  const value = (field: SheetField) => {
    const v = read(query, `${prefix}${field}`).slice(0, LIMIT[field]).trim();
    return v && checkFields({ [field]: v }).ok ? v : "";
  };
  const out: CreatePrefill = {};
  const name = value("name");
  if (name) out.name = name;
  const traits = [value("trait1"), value("trait2"), value("trait3")] as const;
  if (traits.some(Boolean)) out.traits = traits;
  const want = value("want");
  if (want) out.want = want;
  const dealbreaker = value("dealbreaker");
  if (dealbreaker) out.dealbreaker = dealbreaker;
  return Object.keys(out).length ? out : null;
}
