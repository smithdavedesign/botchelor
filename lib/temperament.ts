/**
 * A temperament for every character (David, 2026-10-15: "be unique"). The engine decides dates from four
 * signals (warmth, openness, guardedness, humour; lib/engine.ts). A character's private soul or a trained image
 * sets them; without either, every character used to read the same, "unremarkable" temperament, so its
 * traits and voice never touched the engine at all. Now they do:
 *
 *  - sheetSignals: the unremarkable baseline, nudged by the temperament words in the character's own traits
 *    and voice ("warm", "guarded", "deadpan", "cautious", "cold"). A sheet with none of those words reads
 *    exactly as before, so existing characters only change where their own words say they should.
 *  - explicit signals (souls.signals) still win: a trained image, or the builder's temperament sliders.
 *
 * Reproducibility holds: every date snapshots the exact signals it ran on (setup.signals_a/b), and replays and
 * the async worker use the snapshot, so changing how signals are read never rewrites a settled date. The
 * engine's own maths is untouched. Pure and client-safe (the builder previews it as you type).
 */
import { LEXICON, NEUTRAL_SIGNALS, UNREMARKABLE_SIGNALS, type CharacterSheet, type DateSignals, type SoulSignals } from "./engine";

const AXES = ["warmth", "openness", "guardedness", "humor"] as const;

/** Words that pull an axis DOWN (the engine's own lexicon is the words that pull it up). */
const LOWER: Record<keyof SoulSignals, readonly string[]> = {
  warmth: ["cold", "aloof", "icy", "prickly", "grumpy", "stern", "standoffish", "detached", "frosty", "brusque"],
  openness: ["cautious", "traditional", "rigid", "predictable", "homebody", "routine", "fussy", "particular", "methodical", "set"],
  guardedness: ["trusting", "unguarded", "forthcoming", "candid", "chatty", "talkative", "outgoing", "sociable", "transparent"],
  humor: ["serious", "solemn", "stoic", "grave", "humourless", "humorless", "somber", "sombre", "formal"],
};

/** How far one word moves an axis: a trait says more about someone than a word in how they talk. */
export const TRAIT_STEP = 0.2;
export const VOICE_STEP = 0.1;
/** How far the sheet can move any axis from the baseline. */
export const SHEET_CAP = 0.4;

/** Plurals fold into their word ("jokes" → "joke"), the same way on both sides, so "curious" still meets "curious". */
const fold = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
const tokens = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(fold);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The temperament a character's own words describe: the unremarkable baseline, nudged by its traits and voice. */
export function sheetSignals(sheet: Pick<CharacterSheet, "traits"> & { voice?: string | null }): SoulSignals {
  const traitWords = sheet.traits.flatMap((t) => tokens(t));
  const voiceWords = tokens(sheet.voice ?? "");
  const out = { ...UNREMARKABLE_SIGNALS };
  for (const axis of AXES) {
    const up = new Set(LEXICON[axis].map(fold));
    const down = new Set(LOWER[axis].map(fold));
    const score = (words: string[], step: number) => words.reduce((n, w) => n + (up.has(w) ? step : down.has(w) ? -step : 0), 0);
    const delta = Math.max(-SHEET_CAP, Math.min(SHEET_CAP, score(traitWords, TRAIT_STEP) + score(voiceWords, VOICE_STEP)));
    out[axis] = round2(clamp01(UNREMARKABLE_SIGNALS[axis] + delta));
  }
  return out;
}

/**
 * The words in a sheet's traits and voice that moved its temperament, and which way (#754, the 2026-10-23-2135 run: a
 * deadpan character "plays as quick to joke"): "deadpan" and "dry" are humour words, so plays_as can say why.
 */
export function temperamentWords(sheet: Pick<CharacterSheet, "traits"> & { voice?: string | null }): { word: string; axis: keyof SoulSignals; up: boolean }[] {
  const out: { word: string; axis: keyof SoulSignals; up: boolean }[] = [];
  const seen = new Set<string>();
  for (const w of [...sheet.traits.flatMap((t) => tokens(t)), ...tokens(sheet.voice ?? "")]) {
    for (const axis of AXES) {
      const up = LEXICON[axis].map(fold).includes(w);
      const down = LOWER[axis].map(fold).includes(w);
      if ((up || down) && !seen.has(`${w}:${axis}`)) {
        seen.add(`${w}:${axis}`);
        out.push({ word: w, axis, up });
      }
    }
  }
  return out;
}

const isBlank = (s: SoulSignals) => AXES.every((a) => s[a] === 0);

/**
 * The base signals a character plays from, before what its dates have taught it:
 *   explicit signals (a trained image or the sliders) → the private soul's words → its sheet.
 * A soul whose words name no temperament at all falls through to the sheet rather than to a blank.
 */
export function baseSignals(
  soul: { signals: SoulSignals | null } | null,
  fromSoulText: SoulSignals | null,
  sheet: SoulSignals | null,
): DateSignals {
  if (soul?.signals) return soul.signals;
  if (fromSoulText && !isBlank(fromSoulText)) return fromSoulText;
  // #728: marked as read off the sheet (no soul spoke), so engine v4 can centre it on the show's typical temperament.
  return { ...(sheet ?? NEUTRAL_SIGNALS), sheet: true };
}

/** A temperament in plain words, for the owner (third person): "warm, quick to joke". */
export function describeTemperament(s: SoulSignals): string {
  const parts: string[] = [];
  if (s.warmth >= 0.6) parts.push("warm");
  else if (s.warmth <= 0.25) parts.push("cool and hard to read");
  if (s.humor >= 0.6) parts.push("quick to joke");
  else if (s.humor <= 0.2) parts.push("earnest");
  if (s.openness >= 0.6) parts.push("game for anything");
  else if (s.openness <= 0.25) parts.push("set in their ways");
  if (s.guardedness >= 0.6) parts.push("slow to let anyone in");
  else if (s.guardedness <= 0.2) parts.push("an open book");
  return parts.length ? parts.join(", ") : "even-keeled";
}

/** The four sliders the builder shows, low end to high end. */
export const TEMPERAMENT_AXES: { key: keyof SoulSignals; label: string; low: string; high: string }[] = [
  { key: "warmth", label: "Warmth", low: "cool", high: "warm" },
  { key: "openness", label: "Openness", low: "set in their ways", high: "game for anything" },
  { key: "guardedness", label: "Guard", low: "an open book", high: "slow to let anyone in" },
  { key: "humor", label: "Humour", low: "earnest", high: "quick to joke" },
];
