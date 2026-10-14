/**
 * Show formats (PRD "More mechanics" / "Show formats"): the same engine runs with different *framing*.
 *
 * A format is a COSMETIC narrative wrapper. It reframes the narration and the turn-by-turn conversation
 * (tone, pacing, a producer-flavour presence) but NEVER touches the engine, the box score, predictions or
 * odds. The same two sheets + souls + seed produce the same outcome in every format — tests/formats.test.ts
 * proves it. That is what keeps formats sellable later as cosmetic packs that can't buy a better result
 * (PRD guardrail: "Formats can be paid cosmetic packs that never change points or odds").
 *
 * Client-safe: pure constants and helpers, no server imports, so the builder form and the server share one
 * source of truth and nothing here needs a model call.
 */

export type FormatId = "classic" | "speed_date" | "meet_the_parents" | "ex_returns";

export type ShowFormat = {
  id: FormatId;
  label: string;
  /** A one-line hook for the builder card. */
  tagline: string;
  /** A sentence of description for the builder and the episode badge. */
  blurb: string;
  /**
   * The single line injected into the showrunner and conversation prompts to set this format's tone.
   * It is data for the model to colour the scene with; it never reaches the engine.
   */
  note: string;
  /** Optional conversation length override, for pacing (a speed date is snappier). Cosmetic only. */
  turns?: number;
  /**
   * When set, this format is a paid cosmetic pack: the owner must own this SKU to pick it (gated like a
   * premium house character, before any model call). null = free. Every format is free today; the seam
   * is here so a pack can be switched on later without touching the generation path.
   */
  premiumSku: string | null;
};

export const FORMATS: readonly ShowFormat[] = [
  {
    id: "classic",
    label: "Classic blind date",
    tagline: "Two strangers, one table, no rules.",
    blurb: "The original Botchelor format: a blind date in three acts.",
    note: "This is a classic blind date: two strangers meeting for the first time.",
    premiumSku: null,
  },
  {
    id: "speed_date",
    label: "Speed date",
    tagline: "Five minutes. One spark, or none.",
    blurb: "A fast, high-pressure date against the clock. Short, clipped, everything on the line.",
    note:
      "This is a SPEED DATE: a countdown is running and there is very little time. Keep every scene fast, " +
      "clipped and high-pressure; the characters talk quickly and cut straight to what matters.",
    turns: 6,
    premiumSku: null,
  },
  {
    id: "meet_the_parents",
    label: "Meet the parents",
    tagline: "A chaperone nobody invited.",
    blurb: "A protective house regular crashes the date and sizes up the match.",
    note:
      "A protective older house regular has turned up to CHAPERONE this date, judging whether the two are " +
      "right for each other, interrupting and asking pointed questions. Keep the chaperone an unnamed " +
      "background presence; the date is still decided between the two main characters.",
    premiumSku: null,
  },
  {
    id: "ex_returns",
    label: "The ex returns",
    tagline: "Someone from before walks in.",
    blurb: "An old flame makes a surprise appearance and tests the chemistry.",
    note:
      "Partway through, an EX of one of the characters makes a surprise appearance and lingers nearby, " +
      "raising the stakes. Keep the ex an unnamed background presence; the date is still decided between " +
      "the two main characters.",
    premiumSku: null,
  },
] as const;

export const DEFAULT_FORMAT: FormatId = "classic";
export const FORMAT_IDS = FORMATS.map((f) => f.id) as [FormatId, ...FormatId[]];

/** The format for an id, falling back to classic for an unknown or legacy value. */
export const format = (id: FormatId | null | undefined): ShowFormat =>
  FORMATS.find((f) => f.id === id) ?? FORMATS[0];
export const formatLabel = (id: FormatId | null | undefined): string => format(id).label;
export const isDefaultFormat = (id: FormatId | null | undefined): boolean => format(id).id === DEFAULT_FORMAT;
