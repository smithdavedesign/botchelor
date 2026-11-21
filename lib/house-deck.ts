/**
 * Three of the house cast as the swipe deck shows a card (the visual pop audit's pass 3 leftovers, /create): beside an
 * empty form they take turns as the example, until the person types; on a phone their faces are a slim strip above the
 * first question. Real characters from lib/house.ts with their committed portraits, so the example is somebody on the
 * show rather than an "MV" in a circle. Built on the server and passed down, so the client never carries the whole cast.
 */
import { HOUSE_CHARACTERS } from "./house";
import { characterPortrait } from "./portraits";

export type DeckCard = {
  id: string;
  name: string;
  age: number;
  hue: number;
  portrait: string | null;
  bio: string;
  traits: readonly string[];
  want: string;
  dealbreaker: string;
};

/** Who takes turns: a spread of temperaments (the loner, the gentle giant, the chaotic extrovert), all with portraits. */
export const HOUSE_DECK_IDS = ["house-juniper", "house-dex", "house-sable"] as const;

/** The three cards, in turn order; any id no longer in the house is left out. */
export function houseDeckCards(): DeckCard[] {
  return HOUSE_DECK_IDS.flatMap((id) => {
    const c = HOUSE_CHARACTERS.find((h) => h.id === id);
    return c ? [{ id: c.id, name: c.name, age: c.age, hue: c.hue, portrait: characterPortrait(c.id), bio: c.bio, traits: [...c.traits], want: c.want, dealbreaker: c.dealbreaker }] : [];
  });
}
