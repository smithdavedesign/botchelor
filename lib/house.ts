/**
 * The show's own cast, seeded into every database by lib/db.ts ensureSchema and always labeled
 * "House character" so nobody mistakes one for another user's OC.
 *
 * Fifteen free characters, deliberately spread across temperaments (the competitor report's "generate
 * a house cast of 12-20 covering different personalities"): a new creator's blind date lands on
 * somebody with an angle, and the matchmaker has real variety to pair against. Each one carries a
 * curated look — an appearance line and an avatar hue — so the cast gallery reads as one designed cast
 * rather than fifteen auto-coloured strangers. No portraits are hosted: the art is drawn from this
 * data (lib/avatar.ts), so there is nothing to upload, moderate or pay for.
 */
import type { SoulSignals } from "./engine";

export type HouseCharacter = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: readonly [string, string, string];
  want: string;
  dealbreaker: string;
  /** The temperament this character covers, so the cast's spread is visible and testable. */
  archetype: string;
  /** The curated look: the appearance line shown on the sheet, and the avatar hue (1..360). */
  appearance: string;
  hue: number;
  /**
   * The temperament the engine decides dates with, curated to match the archetype (lib/engine.ts
   * SoulSignals, 0..1). A creator's OC gets these from its private soul or its trained image; a house
   * character has neither, and without them every house date runs on half the signal the engine
   * expects — warmth and humour averaged against zero — which caps even a perfect match below a
   * second date. Seeding them is what gives the house cast real range.
   */
  signals: SoulSignals;
};

export const HOUSE_CHARACTERS: readonly HouseCharacter[] = [
  {
    id: "house-rafe",
    name: "Rafe Calloway",
    age: 34,
    bio: "A pastry chef banned from three baking competitions for 'excessive flair'. Now runs a tiny bakery that only opens when it rains.",
    traits: ["dramatic", "generous", "competitive"],
    want: "Someone who will taste-test without lying",
    dealbreaker: "People who call cake 'just sugar'",
    archetype: "The showman",
    appearance: "flour down a black apron, sleeves shoved up, a grin expecting applause",
    hue: 30,
    signals: { warmth: 0.7, openness: 0.8, guardedness: 0.1, humor: 0.8 },
  },
  {
    id: "house-juniper",
    name: "Juniper Vale",
    age: 29,
    bio: "A lighthouse keeper who hosts a ghost-story podcast with eleven loyal listeners. Talks to the gulls; the gulls have not talked back yet.",
    traits: ["curious", "deadpan", "loyal"],
    want: "A co-host who believes in at least one ghost",
    dealbreaker: "Anyone who interrupts a story before the twist",
    archetype: "The mysterious loner",
    appearance: "salt-tangled hair, a storm coat two sizes too big, unbothered",
    hue: 200,
    signals: { warmth: 0.35, openness: 0.25, guardedness: 0.7, humor: 0.5 },
  },
  {
    id: "house-dex",
    name: "Dex Okafor",
    age: 41,
    bio: "A retired stunt double who was set on fire nineteen times, professionally. Now teaches pottery and flinches at birthday candles.",
    traits: ["brave", "gentle", "superstitious"],
    want: "A quiet night that stays quiet",
    dealbreaker: "Surprise parties",
    archetype: "The gentle giant",
    appearance: "clay to the elbows, scarred knuckles, a very careful handshake",
    hue: 15,
    signals: { warmth: 0.8, openness: 0.45, guardedness: 0.35, humor: 0.3 },
  },
  {
    id: "house-marisol",
    name: "Marisol Pine",
    age: 31,
    bio: "Writes the obituaries for a town paper and smuggles a love story into every single one. Nobody has noticed in six years.",
    traits: ["wry", "tender", "blunt"],
    want: "Someone who laughs at the wrong moment too",
    dealbreaker: "Earnest poetry read out loud",
    archetype: "The sarcastic romantic",
    appearance: "black turtleneck, a pen behind one ear, an unimpressed eyebrow",
    hue: 340,
    signals: { warmth: 0.55, openness: 0.4, guardedness: 0.45, humor: 0.85 },
  },
  {
    id: "house-teo",
    name: "Teo Brandt",
    age: 27,
    bio: "A ballroom instructor who has been proposed to four times, twice mid-lesson. Keeps every ring box in a drawer, unopened.",
    traits: ["charming", "vain", "quick"],
    want: "A partner who leads back",
    dealbreaker: "Counting the steps out loud",
    archetype: "The confident flirt",
    appearance: "a shirt one button too open, polished shoes, perfect posture",
    hue: 285,
    signals: { warmth: 0.75, openness: 0.85, guardedness: 0.05, humor: 0.6 },
  },
  {
    id: "house-nell",
    name: "Nell Abiodun",
    age: 35,
    bio: "A museum night guard who gives the full tour to empty rooms, word-perfect, every shift. The marble busts are excellent listeners.",
    traits: ["brilliant", "shy", "precise"],
    want: "Someone who asks a follow-up question",
    dealbreaker: "Calling a fact boring",
    archetype: "The awkward intellectual",
    appearance: "a cardigan over the uniform, glasses pushed up, notes in every pocket",
    hue: 225,
    signals: { warmth: 0.5, openness: 0.3, guardedness: 0.6, humor: 0.4 },
  },
  {
    id: "house-sable",
    name: "Sable Quist",
    age: 33,
    bio: "Throws surprise parties for strangers and has never once been caught. Owns forty-one party hats and no dining table.",
    traits: ["reckless", "warm", "loud"],
    want: "Someone who says yes before hearing the plan",
    dealbreaker: "Checking the time",
    archetype: "The chaotic extrovert",
    appearance: "mismatched everything, glitter that refuses to wash out, always mid-laugh",
    hue: 75,
    signals: { warmth: 0.8, openness: 0.9, guardedness: 0.0, humor: 0.9 },
  },
  {
    id: "house-orin",
    name: "Orin Fletcher",
    age: 44,
    bio: "A retired fact-checker who still fact-checks the menu. Has corrected a eulogy, out loud, and regrets only the timing.",
    traits: ["dry", "honest", "stubborn"],
    want: "A story that survives a follow-up",
    dealbreaker: "Rounding a number up",
    archetype: "The sceptic",
    appearance: "grey jumper, reading glasses on a chain, a pencil for emergencies",
    hue: 190,
    signals: { warmth: 0.3, openness: 0.25, guardedness: 0.65, humor: 0.55 },
  },
  {
    id: "house-imogen",
    name: "Imogen Strand",
    age: 38,
    bio: "Runs a soup window that opens at 2am for night workers. Remembers every order and every name, and will not be thanked.",
    traits: ["kind", "bossy", "tireless"],
    want: "Someone who lets themselves be fed",
    dealbreaker: "Saying 'I'm fine' twice",
    archetype: "The caretaker",
    appearance: "a steam-fogged apron, hair tied back fast, flour-dusted forearms",
    hue: 45,
    signals: { warmth: 0.9, openness: 0.6, guardedness: 0.1, humor: 0.35 },
  },
  {
    id: "house-kaz",
    name: "Kaz Lindqvist",
    age: 30,
    bio: "Free-climbs cranes at dawn for the view and takes the stairs for eleven floors because lifts are unthinkable.",
    traits: ["fearless", "restless", "honest"],
    want: "Someone who watches from the top, not the ground",
    dealbreaker: "Being told to be careful",
    archetype: "The thrill-seeker",
    appearance: "chalk on both palms, a windburnt face, boots that have seen things",
    hue: 255,
    signals: { warmth: 0.5, openness: 0.8, guardedness: 0.2, humor: 0.5 },
  },
  {
    id: "house-wally",
    name: "Wally Osei",
    age: 47,
    bio: "Can fix anything with a motor and nothing with feelings. His garage has a waiting list; his phone has four contacts.",
    traits: ["capable", "quiet", "loyal"],
    want: "Someone who hands him the broken thing",
    dealbreaker: "Buying a new one instead of mending it",
    archetype: "The fixer",
    appearance: "oil-dark hands, a rag in the back pocket, a cap worn soft",
    hue: 135,
    signals: { warmth: 0.6, openness: 0.2, guardedness: 0.6, humor: 0.2 },
  },
  {
    id: "house-perpetua",
    name: "Perpetua Finch",
    age: 52,
    bio: "A retired soap villain who cannot deliver a sentence without a dramatic pause first. Was killed off twice and returned both times.",
    traits: ["regal", "scheming", "generous"],
    want: "A scene partner who can hold a pause",
    dealbreaker: "Being upstaged at dessert",
    archetype: "The grande dame",
    appearance: "silk scarf, rings on every finger, lipstick chosen like a weapon",
    hue: 315,
    signals: { warmth: 0.5, openness: 0.7, guardedness: 0.3, humor: 0.75 },
  },
  {
    id: "house-ines",
    name: "Inés Castellano",
    age: 26,
    bio: "Plants trees in roundabouts without asking anyone. Thirty-one trees so far, all alive, two of them officially someone else's problem.",
    traits: ["hopeful", "earnest", "determined"],
    want: "Someone who waters them while she's away",
    dealbreaker: "Calling it pointless",
    archetype: "The earnest optimist",
    appearance: "dirt under the nails, a tote of seedlings, sunburnt nose",
    hue: 105,
    signals: { warmth: 0.85, openness: 0.8, guardedness: 0.1, humor: 0.45 },
  },
  {
    id: "house-boaz",
    name: "Boaz Mehra",
    age: 36,
    bio: "Holds a national cup-stacking record and lost a fifteen-year friendship defending it. Still trains on Sundays, alone.",
    traits: ["driven", "exacting", "sore"],
    want: "A rematch against somebody new",
    dealbreaker: "Letting him win",
    archetype: "The competitive perfectionist",
    appearance: "track jacket zipped to the chin, stopwatch habit, restless hands",
    hue: 10,
    signals: { warmth: 0.4, openness: 0.35, guardedness: 0.5, humor: 0.3 },
  },
  {
    id: "house-lior",
    name: "Lior Nakamura",
    age: 42,
    bio: "Has lived in nine cities and left a working bicycle in each one, on purpose, for whoever needs it next.",
    traits: ["easy", "evasive", "observant"],
    want: "Someone who doesn't ask where next",
    dealbreaker: "A ten-year plan",
    archetype: "The drifter",
    appearance: "a worn canvas jacket, one small bag, nothing that can't be left behind",
    hue: 165,
    signals: { warmth: 0.55, openness: 0.5, guardedness: 0.55, humor: 0.45 },
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
    archetype: "The charming menace",
    appearance: "velvet waistcoat, cuffs that hide things, a notebook already open",
    hue: 275,
    signals: { warmth: 0.5, openness: 0.6, guardedness: 0.4, humor: 0.8 },
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
    archetype: "The quiet authority",
    appearance: "a captain's coat worn open, sea-squint, hands steady on anything",
    hue: 210,
    signals: { warmth: 0.6, openness: 0.35, guardedness: 0.5, humor: 0.4 },
  },
];

/** Every house character, free and premium — the full cast, for listings and tests. */
export const ALL_HOUSE_CHARACTERS: readonly HouseCharacter[] = [...HOUSE_CHARACTERS, ...PREMIUM_HOUSE_CHARACTERS];
