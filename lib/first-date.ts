/**
 * A newcomer's first date, straight away (2026-11-11 bounce review, David: "yes do 1-4").
 *
 * In the month before, 7 visitors opened the builder, 3 made a character, 2 started a date and nobody watched one end:
 * after "Create" the builder asked "Who should they meet?" with a blind date, swipes, open characters and the house
 * cast, then a settings sheet for each. A blind date can mean a match and texting first, so there was nothing to watch.
 * The builder now leads a creator's first character with one button: a date with one of this season's house cast,
 * which plays in the theater at once. Every other choice stays below it.
 */

export type FirstDatePartner = { id: string; name: string; premium?: boolean };

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
