/**
 * The OC chemistry test (app/tools/oc-chemistry-test): two original characters in; a 0–100 chemistry score, the ending
 * Botchelor's date engine predicts for their first date (a second date, just friends or a disaster) and three one-line
 * reasons out.
 *
 * Pure and deterministic: no model, no randomness, no database. It runs the show's own engine (lib/engine.ts) on the
 * fields a character starts with on /create (a name, three traits, a want and a dealbreaker), leaving out the two things
 * a real date adds that a test can't know: the engine's luck (each variable's seeded jitter, taken out with the engine's
 * own trace) and the secret agenda each side is dealt (every pairing of agendas, averaged). So the same two characters
 * always get the same answer, in either order, and the score moves only when a field does.
 *
 * One rule on top of the engine: a character whose dealbreaker names one of the other's traits makes it a disaster. The
 * engine counts a tripped dealbreaker as its heaviest penalty; the test makes it the verdict.
 *
 * Fields are read with /create's limits, and the show's content filter (lib/safety.ts) refuses what /create refuses,
 * with the same messages. The two characters live in the result's address (a plain GET), so a result is a link to
 * share, and nothing is stored.
 */
import {
  cues,
  CURRENT_ENGINE_VERSION,
  DEALBREAKER_PENALTY,
  deterministicTraced,
  endingScore,
  UNREMARKABLE_SIGNALS,
  V2_FRIENDS_REL,
  V2_SECOND_DATE_REL,
  type EngineTrace,
  type SideSetup,
  type SoulSignals,
} from "./engine";
import { shortName } from "./names";
import { AGENDA_IDS, DATE_VARIABLES, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY, type AgendaId, type DateVariable, type Ending } from "./rules";
import { CHARACTER_REJECTION_MESSAGES, checkFields, type RejectReason } from "./safety";
import { sheetSignals } from "./temperament";

export const CHEMISTRY_TEST_PATH = "/tools/oc-chemistry-test";
export const CHEMISTRY_RESULT_PATH = `${CHEMISTRY_TEST_PATH}/result`;

/** A character as the test reads it: what /create asks for first, without the age and the bio. */
export type OcSheet = { name: string; traits: [string, string, string]; want: string; dealbreaker: string };

export type Side = "a" | "b";
export const SIDES: readonly Side[] = ["a", "b"];
export const SHEET_FIELDS = ["name", "trait1", "trait2", "trait3", "want", "dealbreaker"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
/** A field's name in the form and the address: a_name, b_trait2… */
export type FieldParam = `${Side}_${SheetField}`;
export type ChemistryForm = Partial<Record<FieldParam, string>>;

/** The longest each field may be: what /create's builder (app/create/CreateWizard.tsx) and its save take. */
export const SHEET_LIMITS: Record<SheetField, number> = { name: 40, trait1: 30, trait2: 30, trait3: 30, want: 140, dealbreaker: 140 };
/** The most words a name may have, as on /create (POST /api/characters). */
export const NAME_MAX_WORDS = 5;

/** Each ending's share of 0–100: the score says how clearly a pair lands where it does. */
export const SCORE_BANDS: Record<Ending, readonly [number, number]> = { disaster: [0, 39], friends: [40, 64], second_date: [65, 100] };

export const fieldParam = (side: Side, field: SheetField): FieldParam => `${side}_${field}`;

function fieldOf(sheet: OcSheet, field: SheetField): string {
  if (field === "name" || field === "want" || field === "dealbreaker") return sheet[field];
  return sheet.traits[Number(field.slice(-1)) - 1];
}

/** Two characters as the form's fields: the form filled in again, or an address. */
export function pairFormValues(a: OcSheet, b: OcSheet): Record<FieldParam, string> {
  const out = {} as Record<FieldParam, string>;
  for (const [side, sheet] of [["a", a], ["b", b]] as const) for (const f of SHEET_FIELDS) out[fieldParam(side, f)] = fieldOf(sheet, f);
  return out;
}

/** The query that carries two characters, in a fixed order, so a pair has one address. */
export function chemistryQuery(a: OcSheet, b: OcSheet): string {
  return new URLSearchParams(pairFormValues(a, b)).toString();
}

/** The result's own address: the link to share. */
export const chemistryResultHref = (a: OcSheet, b: OcSheet) => `${CHEMISTRY_RESULT_PATH}?${chemistryQuery(a, b)}`;
/** "Watch the real date": /create with both characters, the first in the builder (app/create/page.tsx). */
export const createPairHref = (a: OcSheet, b: OcSheet) => `/create?${chemistryQuery(a, b)}`;

/** An address's query as a page gets it, from URLSearchParams (a route handler), keeping a repeated key's first value. */
export function paramsFrom(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of search) if (!(k in out)) out[k] = v;
  return out;
}

/* ------------------------------------------------------------------------------------------------------------
 * Reading two characters from an address.
 * ---------------------------------------------------------------------------------------------------------- */

export type ChemistryError =
  | { kind: "invalid"; side: Side; field: SheetField; message: string }
  | { kind: "rejected"; side: Side; field: SheetField; reason: RejectReason; message: string };

export type ChemistryRead =
  | { ok: true; a: OcSheet; b: OcSheet }
  /** No character at all: the address is the tool's. */
  | { ok: false; empty: true }
  /** What's wrong, and the form to show again: every field that passed the filter, cut to its limit. */
  | { ok: false; empty: false; error: ChemistryError; form: ChemistryForm };

/** A field's shape, by /create's rules (POST /api/characters' schema), with its messages; null when it's fine. */
function shapeError(field: SheetField, value: string): string | null {
  if (!value) return "Required.";
  if (value.length > SHEET_LIMITS[field]) return `At most ${SHEET_LIMITS[field]} characters.`;
  if (field === "name" && value.split(/\s+/).length > NAME_MAX_WORDS) return `At most ${NAME_MAX_WORDS} words.`;
  return null;
}

/** Two characters from the form's fields (a page's searchParams), checked the way /create checks one. */
export function readChemistry(params: Record<string, string | string[] | undefined>): ChemistryRead {
  const raw = {} as Record<FieldParam, string>;
  for (const side of SIDES) {
    for (const f of SHEET_FIELDS) {
      const value = params[fieldParam(side, f)];
      raw[fieldParam(side, f)] = ((Array.isArray(value) ? value[0] : value) ?? "").trim();
    }
  }
  if (Object.values(raw).every((v) => !v)) return { ok: false, empty: true };

  // Nothing the filter refuses goes back into the form (or anywhere on the page).
  const form: ChemistryForm = {};
  for (const side of SIDES) {
    for (const f of SHEET_FIELDS) {
      const value = raw[fieldParam(side, f)];
      if (value && checkFields({ [f]: value }).ok) form[fieldParam(side, f)] = value.slice(0, SHEET_LIMITS[f]);
    }
  }

  // /create's order: each field's shape first, then the content filter.
  for (const side of SIDES) {
    for (const f of SHEET_FIELDS) {
      const message = shapeError(f, raw[fieldParam(side, f)]);
      if (message) return { ok: false, empty: false, error: { kind: "invalid", side, field: f, message }, form };
    }
  }
  for (const side of SIDES) {
    const verdict = checkFields(Object.fromEntries(SHEET_FIELDS.map((f) => [f, raw[fieldParam(side, f)]])));
    if (!verdict.ok) {
      const error: ChemistryError = { kind: "rejected", side, field: verdict.field as SheetField, reason: verdict.reason, message: CHARACTER_REJECTION_MESSAGES[verdict.reason] };
      return { ok: false, empty: false, error, form };
    }
  }

  const sheet = (side: Side): OcSheet => ({
    name: raw[fieldParam(side, "name")],
    traits: [raw[fieldParam(side, "trait1")], raw[fieldParam(side, "trait2")], raw[fieldParam(side, "trait3")]],
    want: raw[fieldParam(side, "want")],
    dealbreaker: raw[fieldParam(side, "dealbreaker")],
  });
  return { ok: true, a: sheet("a"), b: sheet("b") };
}

const FIELD_LABELS: Record<SheetField, string> = { name: "name", trait1: "first trait", trait2: "second trait", trait3: "third trait", want: "want", dealbreaker: "dealbreaker" };

/** Where an error is, in words: "Dex's want", or "the second character's name" when the name can't be shown. */
export function errorPlace(error: ChemistryError, form: ChemistryForm): string {
  const name = error.field === "name" ? undefined : form[fieldParam(error.side, "name")];
  const whose = name && !shapeError("name", name) ? `${name}'s` : `the ${error.side === "a" ? "first" : "second"} character's`;
  return `${whose} ${FIELD_LABELS[error.field]}`;
}

/* ------------------------------------------------------------------------------------------------------------
 * The test: the engine's rules, without luck or agendas.
 * ---------------------------------------------------------------------------------------------------------- */

export type ChemistryResult = { score: number; ending: Ending; reasons: [string, string, string] };

/** The margins (the engine's deciding score against an ordinary date) that read as 0 and 100: about the worst and best five fields can do. */
const MARGIN_FLOOR = -40;
const MARGIN_CEILING = 32;
/** How far a temperament has to move the margin before it's worth a reason. */
const TEMPERAMENT_MIN = 1;
/** The seed only draws the engine's luck, which the test leaves out. */
const SEED = 0;

/** A side as the engine takes it. The engine never reads the age or the bio; the rest are the show's defaults. */
function setup(s: OcSheet, agendaId: AgendaId, signals: SoulSignals): SideSetup {
  return {
    sheet: { name: s.name, age: 18, bio: "", traits: s.traits, want: s.want, dealbreaker: s.dealbreaker, house: false },
    signals,
    autonomy: "guided",
    strategy: DEFAULT_STRATEGY,
    agendaId,
    note: null,
    gameBudget: DEFAULT_GAME_BUDGET,
  };
}

function traced(a: OcSheet, b: OcSheet, agendas: readonly [AgendaId, AgendaId], signals: readonly [SoulSignals, SoulSignals]): EngineTrace {
  const { trace } = deterministicTraced({ a: setup(a, agendas[0], signals[0]), b: setup(b, agendas[1], signals[1]) }, SEED, CURRENT_ENGINE_VERSION);
  if (!trace) throw new Error("the engine gave no trace");
  return trace;
}

/** Where the four variables finish with no luck: every term of the engine's sum but the jitter, clamped as the engine does. */
function calmFinals(trace: EngineTrace): Record<DateVariable, number> {
  const out = {} as Record<DateVariable, number>;
  for (const v of DATE_VARIABLES) {
    const sum = Object.entries(trace.terms[v]).reduce((total, [term, n]) => (term === "jitter" ? total : total + n), 0);
    out[v] = Math.max(0, Math.min(100, Math.round(sum)));
  }
  return out;
}

/** The margin as a score, inside the band of the ending it decides. */
function scoreFor(margin: number): number {
  const span = (from: number, to: number, lo: number, hi: number) => lo + (hi - lo) * Math.max(0, Math.min(1, (margin - from) / (to - from)));
  if (margin >= V2_SECOND_DATE_REL) return Math.round(span(V2_SECOND_DATE_REL, MARGIN_CEILING, ...SCORE_BANDS.second_date));
  if (margin >= V2_FRIENDS_REL) return Math.floor(span(V2_FRIENDS_REL, V2_SECOND_DATE_REL, SCORE_BANDS.friends[0], SCORE_BANDS.second_date[0]));
  return Math.floor(span(MARGIN_FLOOR, V2_FRIENDS_REL, SCORE_BANDS.disaster[0], SCORE_BANDS.friends[0]));
}

/** The other's trait that `self`'s dealbreaker names, by the engine's own word matching, or null. */
function dealbreakerTrait(self: OcSheet, other: OcSheet): string | null {
  const breaks = cues(self.dealbreaker);
  return other.traits.find((t) => [...cues(t)].some((w) => breaks.has(w))) ?? null;
}

/** The first word of `self`'s text that the engine finds in `there`, as the engine reads it, or null. */
function sharedCue(self: string, there: string): string | null {
  const hay = cues(there);
  for (const w of cues(self)) if (hay.has(w)) return w;
  return null;
}

/** The word in `text`, as written (lowercased), that the engine reads as `cue`. */
function wordFor(cue: string, text: string): string {
  return text.toLowerCase().split(/[^a-z0-9]+/).find((w) => cues(w).has(cue)) ?? cue;
}

const quoted = (words: string[]) => {
  const q = words.map((w) => `“${w}”`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} and ${q.at(-1)}` : q[0];
};

/** What an engine term adds to the deciding score, by the default strategy's weights (awkwardness counts against). */
function worth(trace: EngineTrace, term: string, weights: Record<DateVariable, number>): number {
  return DATE_VARIABLES.reduce((sum, v) => sum + (v === "awkwardness" ? -1 : 1) * weights[v] * (trace.terms[v][term] ?? 0), 0);
}

/** A temperament axis's term in the trace, and its reason when it lifts the score (+) or drags it (-). */
const TEMPERAMENT: { term: string; up: string; down: string }[] = [
  { term: "humor", up: "There's plenty to laugh at between them, which takes the edge off.", down: "There isn't much joking between them, so the awkward bits stay awkward." },
  { term: "warmth", up: "There's a lot of warmth between them, and warmth builds trust.", down: "It's a cool pairing: not much warmth to build trust on." },
  { term: "guarded", up: "They're easy to read, so trust comes quickly.", down: "Their guard is up, which costs trust and adds awkward pauses." },
  { term: "openness", up: "They're game for anything, which feeds the attraction.", down: "They're set in their ways, which slows the attraction." },
];

/** Two characters in; the score, the predicted ending and three reasons out. */
export function chemistryTest(a: OcSheet, b: OcSheet): ChemistryResult {
  const signals = [sheetSignals({ traits: a.traits }), sheetSignals({ traits: b.traits })] as const;
  // Every pairing of secret agendas, averaged: the margin an ordinary night of theirs would land on.
  let total = 0;
  for (const ga of AGENDA_IDS) {
    for (const gb of AGENDA_IDS) {
      const trace = traced(a, b, [ga, gb], signals);
      total += endingScore(DEFAULT_STRATEGY, calmFinals(trace), trace.counts.dealbreakers).rel;
    }
  }
  const margin = total / (AGENDA_IDS.length * AGENDA_IDS.length);

  const tripped = [dealbreakerTrait(a, b), dealbreakerTrait(b, a)];
  const ending: Ending = tripped.some(Boolean) ? "disaster" : margin >= V2_SECOND_DATE_REL ? "second_date" : margin >= V2_FRIENDS_REL ? "friends" : "disaster";
  const [lo, hi] = SCORE_BANDS[ending];
  const score = Math.max(lo, Math.min(hi, scoreFor(margin)));
  return { score, ending, reasons: reasonsFor(a, b, signals, tripped, ending) };
}

/** The three reasons, by how far each moved the score; what's missing fills in when fewer than three did. */
function reasonsFor(a: OcSheet, b: OcSheet, signals: readonly [SoulSignals, SoulSignals], tripped: (string | null)[], ending: Ending): [string, string, string] {
  // The agenda-free terms (traits, wants, dealbreakers, temperament) are the same on every agenda; one trace has them.
  const trace = traced(a, b, [AGENDA_IDS[0], AGENDA_IDS[0]], signals);
  const plain = traced(a, b, [AGENDA_IDS[0], AGENDA_IDS[0]], [UNREMARKABLE_SIGNALS, UNREMARKABLE_SIGNALS]);
  const { weights } = endingScore(DEFAULT_STRATEGY, calmFinals(trace), 0);
  const found: { text: string; weight: number }[] = [];
  const sides = [[a, b, tripped[0]], [b, a, tripped[1]]] as const;

  const dealbreakers = trace.counts.dealbreakers;
  const perDealbreaker = dealbreakers ? Math.abs(worth(trace, "dealbreakers", weights) - DEALBREAKER_PENALTY * dealbreakers) / dealbreakers : 0;
  for (const [self, other, trait] of sides) {
    if (trait) {
      found.push({ text: `${shortName(self.name)}'s dealbreaker is right there in ${shortName(other.name)}'s traits: “${trait}”.`, weight: Number.POSITIVE_INFINITY });
      continue;
    }
    const hit = sharedCue(self.dealbreaker, other.want);
    if (hit) found.push({ text: `${shortName(self.name)}'s dealbreaker comes up in what ${shortName(other.name)} wants: “${wordFor(hit, other.want)}”.`, weight: perDealbreaker });
  }

  const wants = trace.counts.wants_met;
  const perWant = wants ? worth(trace, "wants", weights) / wants : 0;
  const sameThing = new Set<string>();
  for (const [self, other] of sides) {
    const hit = sharedCue(self.want, `${other.traits.join(" ")} ${other.want}`);
    if (!hit) continue;
    const trait = other.traits.find((t) => cues(t).has(hit));
    if (trait) found.push({ text: `What ${shortName(self.name)} wants is right there in ${shortName(other.name)}'s traits: “${trait}”.`, weight: perWant });
    else if (!sameThing.has(hit)) {
      sameThing.add(hit);
      found.push({ text: `${shortName(self.name)} and ${shortName(other.name)} want the same thing: “${wordFor(hit, self.want)}”.`, weight: perWant });
    }
  }

  const traitsB = cues(b.traits.join(" "));
  const shared = [...cues(a.traits.join(" "))].filter((w) => traitsB.has(w)).map((w) => wordFor(w, a.traits.join(" ")));
  if (shared.length) {
    const named = shared.length > 3 ? `${quoted(shared.slice(0, 3))} and ${shared.length - 3} more` : quoted(shared);
    found.push({ text: `They have ${named} in common.`, weight: worth(trace, "traits", weights) });
  }

  for (const axis of TEMPERAMENT) {
    const moved = worth(trace, axis.term, weights) - worth(plain, axis.term, weights);
    if (Math.abs(moved) >= TEMPERAMENT_MIN) found.push({ text: moved > 0 ? axis.up : axis.down, weight: Math.abs(moved) });
  }

  // Stable: equal weights keep the order above (dealbreakers, wants, shared traits, temperament).
  const reasons = found.sort((x, y) => y.weight - x.weight).map((r) => r.text);
  const missing = [
    ...(dealbreakers === 0 ? ["Neither one's dealbreaker comes up."] : []),
    ...(wants === 0 ? ["Neither has what the other says they want."] : []),
    ...(shared.length === 0 ? ["They have no trait in common."] : []),
  ];
  // A good night leads its gaps with the dealbreaker that didn't trip; a disaster, with what's missing.
  if (ending === "disaster" && dealbreakers === 0) missing.push(missing.shift()!);
  const [r1, r2, r3] = [...reasons, ...missing];
  return [r1, r2, r3];
}
