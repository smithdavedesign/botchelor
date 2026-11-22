/**
 * The picker's side of choosing how a scene opens (lib/scene-opening.ts is the server's, which checks a written one):
 * what a picker sends for its choice. Apart so the pickers' code in the browser doesn't carry the content filter's word
 * lists (2026-11-22 audit).
 */

/** A written opening, tidied to one line (nothing is cut: a long one is refused). */
export const tidyOpening = (raw: string): string => raw.replace(/\s+/g, " ").trim();

/* ------------------------------------------------ the picker's side ------------------------------------------------ */

/** What the "How it opens" step chose: one of the three, any of the three at random, or a sentence of their own. */
export type OpeningChoice = { pick: 0 | 1 | 2 } | { surprise: true } | { written: string };

/**
 * The `opening` field a picker sends for its choice (nothing when nothing was chosen, or a written one is still
 * empty). "Surprise me" draws one of the three here, as it's sent. `random` is for tests.
 */
export function openingField(choice: OpeningChoice | null | undefined, random: () => number = Math.random): { opening?: number | string } {
  if (!choice) return {};
  if ("pick" in choice) return { opening: choice.pick };
  if ("surprise" in choice) return { opening: Math.min(2, Math.floor(random() * 3)) };
  const text = tidyOpening(choice.written);
  return text ? { opening: text } : {};
}
