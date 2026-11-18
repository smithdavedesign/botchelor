/**
 * How long a character's sheet is, in words, across everything its creator wrote (PRD styles-and-storylines phase 6).
 * The census of public character profiles found 400–999 words in total ranked best: a few lines ranked lowest, and
 * the fullest sheets ranked below the middle. So /create shows a soft meter (app/create/DepthMeter.tsx), and nothing is
 * ever refused for its length.
 *
 * Client-safe: the create flow counts as people type.
 */
import { TEXT_DETAIL_KEYS, type CharacterExtras } from "./extras";

/** The sweet spot, in words across the whole sheet. */
export const SHEET_WORDS_MIN = 400;
export const SHEET_WORDS_MAX = 999;

/** What a sheet's creator wrote, in any of the shapes it's held in (the create wizard's state, a draft, a row). */
export type SheetText = {
  bio?: string | null;
  want?: string | null;
  dealbreaker?: string | null;
  traits?: readonly string[] | null;
  voice?: string | null;
  appearance?: string | null;
  /** The private inner life (values, insecurities, …): every string in it counts. */
  soul?: Readonly<Record<string, unknown>> | null;
  extras?: CharacterExtras | null;
  /** What they're hiding (lib/cast-secrets.ts own secrets). */
  hiding?: readonly string[] | null;
  /** The "this week" line. */
  week?: string | null;
};

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/** Words in a piece of text: by the platform's word breaker (so Chinese, Japanese and Korean count too), else by spaces. */
export function wordCount(text: string | null | undefined): number {
  const s = (text ?? "").trim();
  if (!s) return 0;
  if (!segmenter) return s.split(/\s+/).length;
  let n = 0;
  for (const seg of segmenter.segment(s)) if (seg.isWordLike) n++;
  return n;
}

/** Every piece of text a sheet holds, in no particular order. */
export function sheetTexts(s: SheetText): string[] {
  const e = s.extras ?? {};
  return [
    s.bio,
    s.want,
    s.dealbreaker,
    ...(s.traits ?? []),
    s.voice,
    s.appearance,
    ...Object.values(s.soul ?? {}).filter((v): v is string => typeof v === "string"),
    ...TEXT_DETAIL_KEYS.map((k) => e[k]),
    e.kind === "other" ? e.kind_label : undefined,
    ...(e.hobbies ?? []),
    ...(e.prompts ?? []).map((p) => p.answer),
    ...Object.values(e.lines ?? {}),
    ...Object.values(e.tells ?? {}),
    ...(e.never_says ?? []),
    ...(e.facts ?? []).flatMap((f) => [f.label, f.value]),
    ...(e.hot_takes ?? []),
    e.baggage,
    e.wins_them_over,
    ...(s.hiding ?? []),
    s.week,
  ].filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

/** The sheet's length in words. */
export function sheetWords(s: SheetText): number {
  return sheetTexts(s).reduce((n, t) => n + wordCount(t), 0);
}

export type SheetBand = "short" | "sweet" | "long";

export function sheetBand(words: number): SheetBand {
  return words < SHEET_WORDS_MIN ? "short" : words <= SHEET_WORDS_MAX ? "sweet" : "long";
}

/** The meter's line for a length, in words people would say. */
export function sheetMeterNote(words: number): string {
  const band = sheetBand(words);
  const n = `${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}`;
  if (band === "sweet") return `${n}: in the sweet spot (400–999), enough for a date to draw on with every line counting.`;
  if (band === "long") return `${n}: past the sweet spot (400–999). A date draws on the strongest details, so cutting the weakest helps.`;
  return `${n}: the sweet spot is 400–999, enough for a date to draw on. Their voice, more about them and Go deeper add the most.`;
}
