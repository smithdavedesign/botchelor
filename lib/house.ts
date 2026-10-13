export type HouseCharacter = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: readonly [string, string, string];
  want: string;
  dealbreaker: string;
};

/** The show's own cast, always labeled "House character" so nobody mistakes them for another user's OC. */
export const HOUSE_CHARACTERS: readonly HouseCharacter[] = [
  {
    id: "house-rafe",
    name: "Rafe Calloway",
    age: 34,
    bio: "A pastry chef banned from three baking competitions for 'excessive flair'. Now runs a tiny bakery that only opens when it rains.",
    traits: ["dramatic", "generous", "competitive"],
    want: "Someone who will taste-test without lying",
    dealbreaker: "People who call cake 'just sugar'",
  },
  {
    id: "house-juniper",
    name: "Juniper Vale",
    age: 29,
    bio: "A lighthouse keeper who hosts a ghost-story podcast with eleven loyal listeners. Talks to the gulls; the gulls have not talked back yet.",
    traits: ["curious", "deadpan", "loyal"],
    want: "A co-host who believes in at least one ghost",
    dealbreaker: "Anyone who interrupts a story before the twist",
  },
  {
    id: "house-dex",
    name: "Dex Okafor",
    age: 41,
    bio: "A retired stunt double who was set on fire nineteen times, professionally. Now teaches pottery and flinches at birthday candles.",
    traits: ["brave", "gentle", "superstitious"],
    want: "A quiet night that stays quiet",
    dealbreaker: "Surprise parties",
  },
];

export type PremiumHouseCharacter = HouseCharacter & {
  /** The catalog item that unlocks this character as a date partner (lib/catalog.ts). */
  sku: string;
  price_cents: number;
};

/**
 * House characters a creator can buy as a date partner (M3). Still the show's cast and labeled as
 * such; only their buyer can pick them, and they never turn up in someone else's blind date.
 */
export const PREMIUM_HOUSE_CHARACTERS: readonly PremiumHouseCharacter[] = [
  {
    id: "house-vesper",
    sku: "character_vesper",
    price_cents: 300,
    name: "Vesper Lark",
    age: 38,
    bio: "A retired cruise-ship magician who still makes things vanish, mostly other people's desserts. Reviews every date in a notebook, with star ratings.",
    traits: ["charming", "petty", "theatrical"],
    want: "Someone who gasps at the trick before asking how it works",
    dealbreaker: "Anyone who explains a magic trick out loud",
  },
  {
    id: "house-odalys",
    sku: "character_odalys",
    price_cents: 500,
    name: "Captain Odalys Reyes",
    age: 45,
    bio: "Captains a tiny ferry between two islands that have been feuding for a century. Neutral in public; keeps a secret scorecard of every passenger.",
    traits: ["unflappable", "nosy", "fair"],
    want: "A date who can keep a secret for at least one crossing",
    dealbreaker: "Faking seasickness to get out of a conversation",
  },
];
