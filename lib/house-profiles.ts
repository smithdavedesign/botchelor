/**
 * The house cast's dating profiles (docs/swipes.md): what the swipe deck shows of them, two profile prompts and a few
 * interests each, written in each one's voice (lib/house.ts). This season's house characters are in everyone's deck,
 * so these are the first profiles most people swipe on. Each has the basics on its card too (David, 2026-10-25: "some of
 * the basics"): where they're from, what they're here for, their sign and their love language. Merged into the house kits (lib/house-kits.ts) and seeded
 * with the cast; prompts only, never the engine.
 */
import type { CharacterExtras } from "./extras";

export const HOUSE_PROFILES: Record<string, Pick<CharacterExtras, "occupation" | "hometown" | "star_sign" | "love_language" | "here_for" | "prompts" | "hobbies">> = {
  "house-rafe": {
    hometown: "Brighton",
    star_sign: "Leo",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Pastry chef (rainy days only)",
    prompts: [
      { id: "win_me_over", answer: "Tell me the truth about my croissant. Then ask for a second one." },
      { id: "unpopular_opinion", answer: "A soufflé that never falls is a soufflé that never tried." },
    ],
    hobbies: ["Baking", "Storm watching", "Judging other people's cakes"],
  },
  "house-juniper": {
    hometown: "A rock off the Cornish coast",
    star_sign: "Pisces",
    love_language: "Quality time",
    here_for: "figuring_it_out",
    occupation: "Lighthouse keeper and podcaster",
    prompts: [
      { id: "fall_for_you", answer: "You believe in at least one ghost. Two is a lot. One is perfect." },
      { id: "simple_pleasures", answer: "Fog, a thermos, and the gulls almost saying something." },
    ],
    hobbies: ["Ghost stories", "Podcasting", "Talking to gulls"],
  },
  "house-dex": {
    hometown: "Lagos, then Atlanta",
    star_sign: "Taurus",
    love_language: "Quality time",
    here_for: "long_term",
    occupation: "Pottery teacher, retired stuntman",
    prompts: [
      { id: "irrational_fear", answer: "Birthday candles. Nineteen fires on set and it's the cake that gets me." },
      { id: "simple_pleasures", answer: "A quiet night that stays quiet. A wheel, some clay, no surprises." },
    ],
    hobbies: ["Pottery", "Knocking on wood", "Early nights"],
  },
  "house-marisol": {
    hometown: "A town with one newspaper",
    star_sign: "Cancer",
    love_language: "Words of affirmation",
    here_for: "long_term",
    occupation: "Obituary writer",
    prompts: [
      { id: "weirdly_attracted", answer: "People who laugh at the wrong moment. Ideally at my funeral, much, much later." },
      { id: "two_truths", answer: "I've written six hundred obituaries. Every one hides a love story. I've never cried at a wedding." },
    ],
    hobbies: ["Crosswords", "Graveyard walks", "Writing"],
  },
  "house-teo": {
    hometown: "Vienna",
    star_sign: "Libra",
    love_language: "Physical touch",
    here_for: "figuring_it_out",
    occupation: "Ballroom instructor",
    prompts: [
      { id: "win_me_over", answer: "Lead back. Confidently. On the second step, not the first." },
      { id: "dating_me_is_like", answer: "A tango: I lead, you lead back, and somebody's ring box ends up in a drawer." },
    ],
    hobbies: ["Ballroom dancing", "Mirrors", "Collecting ring boxes"],
  },
  "house-nell": {
    hometown: "Manchester",
    star_sign: "Virgo",
    love_language: "Quality time",
    here_for: "long_term",
    occupation: "Museum night guard",
    prompts: [
      { id: "fall_for_you", answer: "You ask a follow-up question. Ask a second and you get the full tour." },
      { id: "geek_out", answer: "Marble busts, Roman plumbing, and the exact minute the east wing goes quiet." },
    ],
    hobbies: ["Museums", "History", "Night walks"],
  },
  "house-sable": {
    hometown: "Marseille",
    star_sign: "Sagittarius",
    love_language: "Gifts",
    here_for: "chaos",
    occupation: "Professional surpriser",
    prompts: [
      { id: "win_me_over", answer: "Say yes before you hear the plan. The plan is always good. Mostly." },
      { id: "together_we_could", answer: "Throw a party for someone we've never met. They'll cry. We'll leave before the cake." },
    ],
    hobbies: ["Party planning", "Party hats", "Spontaneous trips"],
  },
  "house-orin": {
    hometown: "Edinburgh",
    star_sign: "Doesn't believe in it",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Retired fact-checker",
    prompts: [
      { id: "unpopular_opinion", answer: "Most anecdotes don't survive one follow-up question. Yours had better." },
      { id: "two_truths", answer: "I once corrected a eulogy, out loud. I regret the timing. I've never been wrong about a date." },
    ],
    hobbies: ["Fact-checking", "Reading menus", "Long walks"],
  },
  "house-imogen": {
    hometown: "Glasgow",
    star_sign: "Cancer",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Runs a 2am soup window",
    prompts: [
      { id: "win_me_over", answer: "Let me feed you. Don't argue. Don't thank me. Just eat." },
      { id: "simple_pleasures", answer: "The 2am regulars, a pot that's been going since midnight, and nobody saying thank you." },
    ],
    hobbies: ["Cooking", "Night shifts", "Remembering names"],
  },
  "house-kaz": {
    hometown: "Gothenburg",
    star_sign: "Aries",
    love_language: "Physical touch",
    here_for: "casual",
    occupation: "Crane climber (unofficially)",
    prompts: [
      { id: "irrational_fear", answer: "Lifts. Small boxes that decide where you're going." },
      { id: "together_we_could", answer: "Watch the sun come up from somewhere we're not technically allowed to be." },
    ],
    hobbies: ["Climbing", "Sunrises", "Stairs"],
  },
  "house-wally": {
    hometown: "Accra",
    star_sign: "Capricorn",
    love_language: "Acts of service",
    here_for: "figuring_it_out",
    occupation: "Mechanic",
    prompts: [
      { id: "win_me_over", answer: "Hand me the broken thing. I won't ask how it broke." },
      { id: "simple_pleasures", answer: "An engine turning over first try. A mug of tea. Quiet." },
    ],
    hobbies: ["Fixing engines", "Tinkering", "Fishing"],
  },
  "house-perpetua": {
    hometown: "London's West End, darling",
    star_sign: "Leo",
    love_language: "Words of affirmation",
    here_for: "chaos",
    occupation: "Retired soap villain",
    prompts: [
      { id: "dating_me_is_like", answer: "A season finale. Long pauses, a twist, and I come back either way." },
      { id: "win_me_over", answer: "Hold a pause with me. ... Longer. ... There it is." },
    ],
    hobbies: ["Theatre", "Dramatic pauses", "Scheming"],
  },
  "house-ines": {
    hometown: "Seville",
    star_sign: "Aquarius",
    love_language: "Gifts",
    here_for: "figuring_it_out",
    occupation: "Guerrilla gardener",
    prompts: [
      { id: "together_we_could", answer: "Plant a tree somewhere it doesn't belong and visit it every spring." },
      { id: "fall_for_you", answer: "You water my trees while I'm away, and you don't tell the council." },
    ],
    hobbies: ["Gardening", "Trees", "Night cycling"],
  },
  "house-boaz": {
    hometown: "Pune",
    star_sign: "Virgo",
    love_language: "Quality time",
    here_for: "long_term",
    occupation: "National cup-stacking champion",
    prompts: [
      { id: "geek_out", answer: "Stacking speed, cup weight, and the 2014 nationals, which I won fairly." },
      { id: "together_we_could", answer: "Race. You'll lose. Then we race again, because that's the part I want." },
    ],
    hobbies: ["Cup stacking", "Training", "Rematches"],
  },
  "house-lior": {
    hometown: "Osaka, then nine other cities",
    star_sign: "Sagittarius",
    love_language: "Gifts",
    here_for: "casual",
    occupation: "Wanderer, leaver of bicycles",
    prompts: [
      { id: "simple_pleasures", answer: "A new city, an old bicycle, and nobody asking where I'm headed." },
      { id: "dating_me_is_like", answer: "A long ride with no map. Pleasant. Don't ask where next." },
    ],
    hobbies: ["Cycling", "Travel", "People-watching"],
  },
  "house-vesper": {
    hometown: "A cruise ship, mostly",
    star_sign: "Gemini",
    love_language: "Gifts",
    here_for: "chaos",
    occupation: "Retired cruise-ship magician",
    prompts: [
      { id: "worst_first_date", answer: "Four stars. Lost one when my dessert vanished. I made it vanish. Still counts." },
      { id: "weirdly_attracted", answer: "People who check their pockets after a hug. Smart." },
    ],
    hobbies: ["Magic tricks", "Desserts", "Star ratings"],
  },
  "house-odalys": {
    hometown: "Between two feuding islands",
    star_sign: "Scorpio",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Ferry captain",
    prompts: [
      { id: "geek_out", answer: "Tides, rope knots, and a hundred-year feud I can recite by heart." },
      { id: "two_truths", answer: "I'm neutral in public. I keep a scorecard of every passenger. I've never once looked at the scores." },
    ],
    hobbies: ["Sailing", "Knots", "Gossip"],
  },
};
