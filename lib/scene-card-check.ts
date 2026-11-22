/**
 * What a scene card's texts may say, held to the content filter (lib/safety.ts): the server's half of lib/scene-cards.ts,
 * apart so the roleplay pickers' code in the browser doesn't carry the filter's word lists (2026-11-22 audit). The card
 * itself, its shape (cardShapeIssue) and its pure helpers stay in lib/scene-cards.ts.
 */
import { DATE_ROLEPLAY_NEVER, suggestiveIn } from "./roleplays";
import { checkAdultText, checkFields, checkShowText, excludedTheme } from "./safety";
import { ADULT_CARD_NEVER, CARD_EXPLICIT, cardShapeIssue, cardTexts, type SceneCard } from "./scene-cards";

/**
 * Why one text can't be on a show card, or null: exactly what a roleplay someone writes must pass (lib/roleplay-check.ts
 * checkCustomRoleplay: the show's check, the suggestive list, the excluded themes and the never-list). An opening a
 * person writes for the show or a companion's scene answers to this too.
 */
export function showCardTextIssue(text: string): string | null {
  const r = checkShowText({ text });
  if (!r.ok) return r.reason;
  const suggestive = suggestiveIn(text);
  if (suggestive) return `suggestive ("${suggestive}")`;
  const theme = excludedTheme(text);
  if (theme) return `theme (${theme})`;
  const never = DATE_ROLEPLAY_NEVER.exec(text)?.[0];
  return never ? `never ("${never}")` : null;
}

/**
 * Why one text can't be on an After Dark card, or null: After Dark's own lines (checkAdultText, with its excluded
 * themes), its roleplays' never-list, and, because a card is a story card, nothing explicit and nothing that names the
 * bedroom either (the show's word check and suggestive list, and CARD_EXPLICIT).
 */
export function adultCardTextIssue(text: string): string | null {
  const r = checkAdultText({ text });
  if (!r.ok) return r.theme ?? r.reason;
  const plain = checkFields({ text });
  if (!plain.ok) return `explicit (${plain.reason})`;
  const never = ADULT_CARD_NEVER.exec(text)?.[0];
  if (never) return `never ("${never}")`;
  const explicit = CARD_EXPLICIT.exec(text)?.[0];
  if (explicit) return `explicit ("${explicit}")`;
  const suggestive = suggestiveIn(text);
  return suggestive ? `suggestive ("${suggestive}")` : null;
}

/** Why a card isn't fit for the show (a date, a companion's scene), as "field: reason", or null when it is. */
export function showCardIssue(card: SceneCard): string | null {
  const shape = cardShapeIssue(card);
  if (shape) return shape;
  for (const { field, text } of cardTexts(card)) {
    const issue = showCardTextIssue(text);
    if (issue) return `${field}: ${issue}`;
  }
  return null;
}

/** Why a card isn't fit for After Dark, as "field: reason", or null when it is. */
export function adultCardIssue(card: SceneCard): string | null {
  const shape = cardShapeIssue(card);
  if (shape) return shape;
  for (const { field, text } of cardTexts(card)) {
    const issue = adultCardTextIssue(text);
    if (issue) return `${field}: ${issue}`;
  }
  return null;
}
