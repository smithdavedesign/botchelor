/**
 * The director's tools in After Dark (David, 2026-10-22, picked from the competitor analysis: the leading adult AI
 * products all have them). Pure: no database, no model. lib/adult/scenes.ts runs them on every step.
 *
 *  - Suggested next moves: each step's reply also gives three one-tap steers for what could happen next, one per heat
 *    (mild, flirty, spicy), each SUGGESTION_MAX characters at most. Every one is held to the rules a line is
 *    (holdSuggestion): the two lines (checkAdultText), no one else on the show by name, the stage pacing (at most one
 *    stage further than the scene stands), the public-place cap (past kissing somewhere public only by leaving for
 *    somewhere private first), and any limits a rules object brings (the pair's hard-nos). One that fails is replaced by
 *    a plain one of the same heat (fallbackSuggestion), held to the same rules, and left out if even that fails.
 *  - Whisper to one: a private note to ONE of the two ("she wants you to take the lead"). The prompt plays it as that
 *    character's own secret intention for this step and the next (WHISPER_STEPS); the other doesn't know it. It's never
 *    said aloud word for word (lib/adult/scenes.ts drops a line that copies it, as it does a quoted steer), and it's held
 *    to the same checks as a steer. The viewer holds both secrets: one whisper each can run at once.
 */
import { checkAdultText } from "../safety";
import { guardNames } from "./guards";
import { stageShown } from "./stage-floor";
import { STAGES } from "./stages";

export const HEATS = ["mild", "flirty", "spicy"] as const;
export type Heat = (typeof HEATS)[number];
export type Suggestion = { heat: Heat; text: string };

/** A suggestion is a one-tap steer: this long at most. */
export const SUGGESTION_MAX = 80;

const KISSING = STAGES.indexOf("kissing");
const LAST = STAGES.length - 1;

/** What a suggestion is held to, for the scene as it stands after the step that made it. */
export type SuggestionRules = {
  /** How far it's gone (STAGES index), and the furthest a suggestion may ask for: a stage on at most (the pacing). */
  stage: number;
  maxStage: number;
  /** Somewhere public: nothing past kissing, unless the suggestion has them leave for somewhere private first. */
  publicPlace: boolean;
  /** The pair's names, and every other character's given name (lib/adult/voice.ts castNames). */
  names: { a: string; b: string };
  cast: ReadonlySet<string>;
  /** Further limits (the pair's hard-nos): why a text crosses one, or null. */
  limit?: (text: string) => string | null;
};

/** Asking for more without naming it ("they take it further", "into bed"): a stage on from where it stands. */
const FURTHER =
  /\b(further|farther|heat(?:s|ed|ing)?\s+(?:it\s+|things\s+)?up|hotter|escalat\w*|more intimate|up a notch|next level|all the way|straddl\w*|(?:into|onto|on)\s+(?:his|her|their|the)\s+lap|onto the bed|into (?:the )?bed|to bed)\b/i;
/** Leaving for somewhere private: what a suggestion somewhere public needs before it goes past kissing. */
const LEAVES =
  /\b(somewhere (?:private|quieter|alone|else)|get(?:s|ting)? out of here|leaves?|leaving|head(?:s|ing)? (?:home|back|out|upstairs|off)|go(?:es|ing)? (?:home|back|upstairs)|back to (?:his|hers|her|their|my|your|mine|yours)\b|(?:his|her|their) (?:place|flat|apartment|room)|hotel room|upstairs|a cab|a taxi|(?:take|takes|taking) (?:him|her|them) home)\b/i;

/** Whether a steer has them leave for somewhere private. */
export const leavesForPrivate = (text: string): boolean => LEAVES.test(text);

/** Sex, as a steer names it rather than shows it ("they have sex", "make love", "sleep together"). */
const SEX_ASKED = /\b(sex|make love|making love|made love|sleep(s|ing)? (together|with (him|her|me|you|them))|slept (together|with (him|her|me|you|them)))\b/i;

/**
 * The stage a steer asks for: what it plainly shows (lib/adult/stage-floor.ts), or sex when it names it, else a stage on
 * when it asks for more.
 */
export function stageAsked(text: string, stage: number): number | null {
  const shown = stageShown(text);
  if (shown !== null) return shown;
  if (SEX_ASKED.test(text)) return LAST;
  return FURTHER.test(text) ? Math.min(LAST, stage + 1) : null;
}

/** A suggestion as the model wrote it, tidied: one line, no quotes round it, no "Mild:" label, no trailing full stop. */
export function cleanSuggestion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const unquote = (t: string) => t.replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  return unquote(unquote(raw.replace(/\s+/g, " ").trim()).replace(/^(?:mild|flirty|spicy)\s*[:\-–—]\s*/i, ""))
    .replace(/\.+$/, "")
    .trim();
}

/** A suggestion held to the rules a line is: the text to show (names put right), or why it can't be one. */
export function holdSuggestion(raw: unknown, rules: SuggestionRules): { ok: true; text: string } | { ok: false; reason: string } {
  const text = cleanSuggestion(raw);
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > SUGGESTION_MAX) return { ok: false, reason: `over ${SUGGESTION_MAX} characters` };
  if (!checkAdultText({ suggestion: text }).ok) return { ok: false, reason: "crosses one of the two lines" };
  const named = guardNames(text, { a: rules.names.a, b: rules.names.b, cast: rules.cast });
  if (named.stranger) return { ok: false, reason: `names someone who isn't in the scene (${named.stranger})` };
  const limit = rules.limit?.(named.text);
  if (limit) return { ok: false, reason: limit };
  const asks = stageAsked(named.text, rules.stage);
  if (asks !== null && asks > rules.maxStage) return { ok: false, reason: `asks for ${STAGES[asks]}, past ${STAGES[rules.maxStage]}` };
  if (rules.publicPlace && asks !== null && asks > KISSING && !leavesForPrivate(named.text)) return { ok: false, reason: "past kissing somewhere public" };
  return { ok: true, text: named.text };
}

/** The spicy steer for each next stage, when the model's couldn't be used. */
const SPICY_TOWARD: Record<number, string> = {
  1: "A touch that lingers, and neither of them pulls away",
  2: "They finally kiss",
  3: "They start undressing each other, slowly",
  4: "They go all the way, slowly",
};

/** A plain steer of this heat, for when the model's couldn't be used (held to the same rules by the caller). */
export function fallbackSuggestion(heat: Heat, rules: Pick<SuggestionRules, "stage" | "maxStage" | "publicPlace">): string {
  if (heat === "mild") return "They slow down and really talk for a while";
  if (heat === "flirty") return "One of them teases the other about something from earlier";
  const next = Math.min(rules.maxStage, rules.stage + 1);
  if (rules.publicPlace && next > KISSING) return "One of them suggests they leave for somewhere private";
  if (next <= rules.stage) return rules.stage >= LAST ? "They take their time and check in with each other" : "They draw it out, slower than before";
  return SPICY_TOWARD[next] ?? "They draw it out, slower than before";
}

/** A reply's key as it was meant: lower case, the underscores and stray marks a model puts round it gone ("_stage" → "stage"). */
export const metaKey = (k: string): string => k.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");

/** The text of one suggestion, however it came: a string, or {text}, {steer}, {suggestion} or {note}. */
const textOf = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? ((v as Record<string, unknown>).text ?? (v as Record<string, unknown>).steer ?? (v as Record<string, unknown>).suggestion ?? (v as Record<string, unknown>).note) : v);

/** The heat a key names: "mild", "Mild", "mild_steer", "spicy (bolder)". */
const heatOf = (k: string): Heat | null => HEATS.find((h) => metaKey(k).startsWith(h)) ?? null;

/**
 * The suggestions in a reply's JSON, in every shape DeepSeek V3.1 was seen to send (a real four-step run, 2026-10-22: in
 * one step of four the object as asked; in another, flattened into top-level "_suggestions_mild" keys; in the other two,
 * none): {"suggestions": {"mild": …}} (or {text: …} per heat), a list of {heat, text}, of single-key objects or of three
 * strings in heat order, and flattened keys ("suggestions_mild", "_suggestion-spicy"). Keys are read without the
 * underscores a model puts round them.
 */
export function suggestionsIn(j: unknown): Partial<Record<Heat, unknown>> {
  if (!j || typeof j !== "object" || Array.isArray(j)) return {};
  const entries = Object.entries(j as Record<string, unknown>);
  const named = (...keys: string[]) => entries.find(([k]) => keys.includes(metaKey(k)))?.[1];
  const s = named("suggestions", "suggestion", "next", "nextmoves", "next_moves", "suggestednextmoves", "suggested_next_moves");
  const out: Partial<Record<Heat, unknown>> = {};
  if (Array.isArray(s)) {
    s.forEach((x, i) => {
      if (typeof x === "string") out[HEATS[i]] ??= x;
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const keyed = Object.keys(o).length === 1 ? heatOf(Object.keys(o)[0]) : null;
        const heat = keyed ?? (typeof o.heat === "string" ? heatOf(o.heat) : null);
        const text = keyed ? textOf(Object.values(o)[0]) : textOf(o);
        if (heat) out[heat] ??= text;
        else if (i < HEATS.length) out[HEATS[i]] ??= text;
      }
    });
  } else if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      const heat = heatOf(k);
      if (heat) out[heat] ??= textOf(v);
    }
  }
  // Flattened into the reply itself: "suggestions_mild", "_suggestions_flirty", "suggestion-spicy".
  for (const [k, v] of entries) {
    const m = /^suggestions?[^a-z]*(mild|flirty|spicy)$/.exec(metaKey(k));
    if (m) out[m[1] as Heat] ??= textOf(v);
  }
  return out;
}

/**
 * The three suggestions to show: the model's, each held to the rules, a plain one of the same heat in place of one that
 * isn't (also held), and no two the same. Fewer than three only when even a plain one can't pass. `replaced` counts the
 * heats where the model's couldn't be used.
 */
export function suggestionsFor(proposed: Partial<Record<Heat, unknown>>, rules: SuggestionRules): { suggestions: Suggestion[]; replaced: number } {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let replaced = 0;
  for (const heat of HEATS) {
    const candidates = [proposed[heat], fallbackSuggestion(heat, rules)];
    for (let i = 0; i < candidates.length; i++) {
      const held = holdSuggestion(candidates[i], rules);
      if (!held.ok || seen.has(key(held.text))) continue;
      seen.add(key(held.text));
      suggestions.push({ heat, text: held.text });
      if (i > 0) replaced++;
      break;
    }
    if (!suggestions.some((x) => x.heat === heat)) replaced++;
  }
  return { suggestions, replaced };
}

/** Suggestions as stored (adult_scenes.suggestions): only well-formed ones come back. */
export function storedSuggestions(v: unknown): Suggestion[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Suggestion => Boolean(x) && typeof x === "object" && HEATS.includes((x as Suggestion).heat) && typeof (x as Suggestion).text === "string");
}

// ---------------------------------------------------------------------------------------------------------------------
// Whisper to one
// ---------------------------------------------------------------------------------------------------------------------

export const WHISPER_MAX = 200;
/** A whisper shapes the step it's sent with and the one after it. */
export const WHISPER_STEPS = 2;

export type Whisper = { text: string; steps_left: number };
/** One whisper each at most: the viewer holds both secrets. */
export type Whispers = { a?: Whisper; b?: Whisper };

/** The whispers as stored (adult_scenes.whispers): only live, well-formed ones. */
export function storedWhispers(v: unknown): Whispers {
  const out: Whispers = {};
  if (!v || typeof v !== "object") return out;
  for (const who of ["a", "b"] as const) {
    const w = (v as Record<string, unknown>)[who] as Whisper | undefined;
    if (w && typeof w.text === "string" && w.text.trim() && Number(w.steps_left) > 0) out[who] = { text: w.text, steps_left: Math.round(Number(w.steps_left)) };
  }
  return out;
}

/** The whispers after a step: each has one step fewer to run, and goes when it has none. */
export function afterWhisperStep(w: Whispers): Whispers {
  const out: Whispers = {};
  for (const who of ["a", "b"] as const) {
    const x = w[who];
    if (x && x.steps_left > 1) out[who] = { text: x.text, steps_left: x.steps_left - 1 };
  }
  return out;
}

/** The whisper as tidied before it's checked: one line, the quotes round it gone, WHISPER_MAX at most. */
export const cleanWhisper = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, "")
    .slice(0, WHISPER_MAX)
    .trim();

/**
 * The whispers in the prompt: each as its character's own secret intention, never said aloud and unknown to the other.
 * Empty when there are none.
 */
export function whisperLines(w: Whispers, names: { a: string; b: string }): string[] {
  const first = (who: "a" | "b") => names[who].split(/\s+/)[0];
  const lines: string[] = [];
  for (const who of ["a", "b"] as const) {
    const x = w[who];
    if (!x) continue;
    const other = who === "a" ? "b" : "a";
    lines.push(
      `A secret only ${first(who)} knows: "${x.text}". It was whispered to ${first(who)} alone; ${first(other)} doesn't know it, and nothing in these lines lets ${first(other)} find out. ` +
        `Play it as ${first(who)}'s own private intention: it shapes what ${first(who)} says and does in these lines, but it's never said aloud, word for word or nearly, and nobody mentions being told anything.`,
    );
  }
  return lines;
}
