/**
 * A newcomer's first date, straight away (2026-11-11 bounce review, David: "yes do 1-4").
 *
 * In the month before, 7 visitors opened the builder, 3 made a character, 2 started a date and nobody watched one end:
 * after "Create" the builder asked "Who should they meet?" with a blind date, swipes, open characters and the house
 * cast, then a settings sheet for each. A blind date can mean a match and texting first, so there was nothing to watch.
 * The builder now leads a creator's first character with one button: a date with one of this season's house cast,
 * which plays in the theater at once. Every other choice stays below it.
 */

import { FORMATS, type FormatId } from "./formats";

export type FirstDatePartner = { id: string; name: string; premium?: boolean };

/**
 * The format a first character's instant first date plays in (2026-11-14 first-session plan, PR1). The classic date is
 * 12 lines: about 2 minutes to write and as long again to watch, and in the month before nobody watched one end. The
 * speed date is 6 lines (lib/formats.ts), free, one table with no moves, so the first verdict comes in about a minute.
 * FIRST_DATE_FORMAT names another format when the speed date's verdicts turn out thin (no deploy to change it back);
 * it has to be a format we have and a free one (premiumSku null): a newcomer owns no packs, and a locked format would
 * refuse the one date the whole front door leads to. Anything else falls back to the speed date.
 */
export const DEFAULT_FIRST_DATE_FORMAT: FormatId = "speed_date";

export function firstDateFormat(env: Record<string, string | undefined> = {}): FormatId {
  const want = env.FIRST_DATE_FORMAT?.trim();
  const found = want ? FORMATS.find((f) => f.id === want) : undefined;
  return found && found.premiumSku === null ? found.id : DEFAULT_FIRST_DATE_FORMAT;
}

/**
 * The builder's steps for a first character, by name: identity, look, review. The Dating profile step (two answered
 * prompts, two interests) stays on the depth track and in edit; at Create an empty profile is filled from the sheet
 * (lib/profile-fill.ts), so the swipe deck and later dates still have one.
 */
export const FIRST_DATE_STEPS = ["identity", "look", "review"] as const;

/**
 * The house character a first date is with (pure): one of this season's cast, never a premium one (those are the
 * buyer's own), picked by the new character's id so different newcomers meet different cast members but a reload
 * keeps the same one. `meet` (/create?meet=<id>, a post's link naming a house character in place of a creator's own
 * "date my OC" link) picks that one when they're on the cast. Null when there's nobody to offer.
 */
export function pickFirstPartner<T extends FirstDatePartner>(partners: readonly T[], characterId: string, meet?: string | null): T | null {
  const cast = partners.filter((p) => !p.premium);
  if (!cast.length) return null;
  const named = meet ? cast.find((p) => p.id === meet) : undefined;
  if (named) return named;
  let h = 2166136261;
  for (const ch of characterId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return cast[h % cast.length];
}

/** Whether the builder leads with the instant first date (pure): their first character, free to date, a date left. */
export function offerFirstDate(o: { firstCharacter: boolean; taken: boolean; datesLeft: number; partner: unknown }): boolean {
  return o.firstCharacter && !o.taken && o.datesLeft > 0 && o.partner !== null;
}
