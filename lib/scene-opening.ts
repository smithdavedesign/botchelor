/**
 * An opening you choose (the roleplay audit, 2026-11-17, item 2: "the opening message does most of the scene-setting …
 * today it's whatever the first draw gives"). After the place and the roleplay, the person can say how the scene opens:
 * one of the roleplay's three (lib/scene-cards.ts), or one sentence of their own. This file turns what a picker sent
 * into the opening's text, for a show date's terms (lib/date-roleplays.ts resolveTerms) and a companion's scene
 * (lib/companion.ts setScene), and says why a written one can't be used.
 *
 * What's sent: 0, 1 or 2 picks one of three; a string is one the person wrote, held to CARD_OPENING_MAX and to exactly
 * what a show card's opening must pass (showCardTextIssue: PG, adults, no real people, nothing suggestive, none of the
 * never-list). Nothing sent is nothing chosen: the scene opens as it did before (a pick by a stable hash). A refused
 * opening is never stored or logged.
 *
 * Pure; the server's: the pickers send their choice with lib/opening-choice.ts.
 */
import { CARD_OPENING_MAX } from "./scene-cards";
import { showCardTextIssue } from "./scene-card-check";
import { tidyOpening } from "./opening-choice";

// The picker's side (what it sends for a choice) is lib/opening-choice.ts, which the pickers load without the content
// filter this file's check runs (2026-11-22 audit).
export { openingField, tidyOpening, type OpeningChoice } from "./opening-choice";

export type OpeningResult = { ok: true; opening: string | null } | { ok: false; status: number; error: "invalid_opening" | "opening_not_allowed"; message: string };

const refuse = (error: "invalid_opening" | "opening_not_allowed", message: string): OpeningResult => ({ ok: false, status: 422, error, message });

/** Why a written opening can't be used, in the show's usual words (as a written roleplay is told), or null. */
export function writtenOpeningIssue(text: string): string | null {
  const issue = showCardTextIssue(text);
  if (!issue) return null;
  if (issue === "minor") return "That opening can't be used: everyone in it is an adult, with nothing suggesting otherwise.";
  if (issue === "real_person") return "That opening can't be used: no real or famous people (made-up ones are fine).";
  if (issue.startsWith("theme") || issue.startsWith("never")) {
    return "That opening can't be used: two adults who both want to be there, never family, school or a babysitter, nobody with a say over the other's job, and nobody drunk, trapped or kept from saying no.";
  }
  return "That opening can't be used: the show is PG, so nothing sexual and no innuendo.";
}

/**
 * The opening a picker's `opening` names: one of `openings` by its index (0, 1 or 2; "0" to "2" too), or the sentence
 * they wrote, checked. `openings` is the roleplay's card's three, the generic three for a scene with no roleplay, or
 * null where there are none to pick from (a roleplay someone wrote): then only a written one can be chosen.
 */
export function resolveOpening(raw: unknown, openings: readonly string[] | null): OpeningResult {
  if (raw === undefined || raw === null || raw === "") return { ok: true, opening: null };
  const index = typeof raw === "number" ? raw : typeof raw === "string" && /^[0-2]$/.test(raw.trim()) ? Number(raw.trim()) : null;
  if (index !== null) {
    if (!Number.isInteger(index) || index < 0 || index > 2) return refuse("invalid_opening", "opening is 0, 1 or 2 (one of the three), or a sentence of your own.");
    if (!openings || !openings[index]) return refuse("invalid_opening", "There are no openings to pick from here: write one of your own, or leave it out.");
    return { ok: true, opening: openings[index] };
  }
  if (typeof raw !== "string") return refuse("invalid_opening", "opening is 0, 1 or 2 (one of the three), or a sentence of your own.");
  const text = tidyOpening(raw);
  if (!text) return { ok: true, opening: null };
  if (text.length > CARD_OPENING_MAX) return refuse("invalid_opening", `Keep the opening to one sentence, up to ${CARD_OPENING_MAX} characters.`);
  const wrong = writtenOpeningIssue(text);
  if (wrong) return refuse("opening_not_allowed", wrong);
  return { ok: true, opening: text };
}

/** Whether an opening's text is one of ours (a card's, a generic one: it names {a} or {b}) rather than a person's own words. */
export const openingHasSides = (text: string): boolean => /\{[ab]\}/.test(text);
