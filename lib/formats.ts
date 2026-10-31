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
import { roleplayNote, type RoleplayTerms } from "./roleplays";

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
  /** False when the format keeps the date where it started (a speed date is one table against the clock): no moves. */
  moves?: false;
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
    moves: false,
    premiumSku: null,
  },
  {
    id: "meet_the_parents",
    label: "Meet the parents",
    tagline: "A chaperone nobody invited.",
    blurb: "A protective house regular crashes the date and sizes up the match.",
    // {chaperone} is filled with a real house regular's name at date-build time (lib/simulation.ts); it
    // falls back to a generic phrase via formatNote() when none is available.
    note:
      "{chaperone} has turned up to CHAPERONE this date, judging whether the two are right for each other, " +
      "interrupting and asking pointed questions. Keep the chaperone a background presence; the date is still " +
      "decided between the two main characters.",
    premiumSku: null,
  },
  {
    id: "ex_returns",
    label: "The ex returns",
    tagline: "Someone from before walks in.",
    blurb: "An old flame makes a surprise appearance and tests the chemistry.",
    // {ex} is filled from the relationship graph (a real past partner) when there is one; otherwise generic.
    note:
      "Partway through, {ex} makes a surprise appearance and lingers nearby, raising the stakes. Keep the ex " +
      "a background presence; the date is still decided between the two main characters.",
    premiumSku: null,
  },
] as const;

/**
 * Names pulled from real data to fill a format's note (lib/simulation.ts computes them per date), whether the two have
 * dated before (a rematch isn't "two strangers"), and the roleplay the date plays, as one sentence (lib/roleplays.ts
 * roleplayNote), so the director, the narrator, the morning after and the reflections all know it.
 */
export type FormatContext = { chaperone?: string; ex?: string; metBefore?: boolean; roleplay?: string };

/**
 * A format's note with any real names filled in — a named house regular as the meet-the-parents chaperone,
 * a real past partner as the returning ex — falling back to a generic phrase when there's no name. Classic
 * and speed dates have no placeholders, so the note is returned unchanged.
 */
export function formatNote(id: FormatId | null | undefined, ctx: FormatContext = {}): string {
  const note = format(id).note
    .replace("two strangers meeting for the first time", ctx.metBefore ? "two people who have dated before, meeting again" : "two strangers meeting for the first time")
    .replace("{chaperone}", ctx.chaperone ? `A protective house regular, ${ctx.chaperone},` : "A protective older house regular")
    .replace("{ex}", ctx.ex ? `${ctx.ex}, an ex of one of the characters,` : "an ex of one of the characters");
  return ctx.roleplay ? `${note} ${ctx.roleplay}` : note;
}

/**
 * A built date's FormatContext, from its setup: the format's cast, and the roleplay it plays as one sentence. Every
 * prompt that frames a whole date takes it (the plan, the conversation, the recap, the morning after, the reflections).
 */
export function formatContextOf(built: {
  setup: { chaperone?: string; ex?: string; roleplay?: RoleplayTerms };
  characters: readonly { id: string; name: string }[];
}): FormatContext {
  const roleplay = roleplayNote(built.setup.roleplay, built.characters);
  return { chaperone: built.setup.chaperone, ex: built.setup.ex, ...(roleplay ? { roleplay } : {}) };
}

export const DEFAULT_FORMAT: FormatId = "classic";
export const FORMAT_IDS = FORMATS.map((f) => f.id) as [FormatId, ...FormatId[]];

/** The format for an id, falling back to classic for an unknown or legacy value. */
export const format = (id: FormatId | null | undefined): ShowFormat =>
  FORMATS.find((f) => f.id === id) ?? FORMATS[0];
export const formatLabel = (id: FormatId | null | undefined): string => format(id).label;
export const isDefaultFormat = (id: FormatId | null | undefined): boolean => format(id).id === DEFAULT_FORMAT;
