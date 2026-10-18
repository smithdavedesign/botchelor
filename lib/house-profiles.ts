/**
 * The house cast's dating profiles (docs/swipes.md): what the swipe deck shows of them, two profile prompts and a few
 * interests each, written in each one's voice (lib/house.ts). This season's house characters are in everyone's deck,
 * so these are the first profiles most people swipe on. Merged into the house kits (lib/house-kits.ts) and seeded
 * with the cast; prompts only, never the engine.
 */
import type { CharacterExtras } from "./extras";

export const HOUSE_PROFILES: Record<string, Pick<CharacterExtras, "occupation" | "prompts" | "hobbies">> = {
  "house-rafe": {
    occupation: "Pastry chef (rainy days only)",
    prompts: [
      { id: "win_me_over", answer: "Tell me the truth about my croissant. Then ask for a second one." },
      { id: "unpopular_opinion", answer: "A soufflé that never falls is a soufflé that never tried." },
    ],
    hobbies: ["Baking", "Storm watching", "Judging other people's cakes"],
  },
  "house-juniper": {
    occupation: "Lighthouse keeper and podcaster",
    prompts: [
      { id: "fall_for_you", answer: "You believe in at least one ghost. Two is a lot. One is perfect." },
      { id: "simple_pleasures", answer: "Fog, a thermos, and the gulls almost saying something." },
    ],
    hobbies: ["Ghost stories", "Podcasting", "Talking to gulls"],
  },
  "house-dex": {
    occupation: "Pottery teacher, retired stuntman",
    prompts: [
      { id: "irrational_fear", answer: "Birthday candles. Nineteen fires on set and it's the cake that gets me." },
      { id: "simple_pleasures", answer: "A quiet night that stays quiet. A wheel, some clay, no surprises." },
    ],
    hobbies: ["Pottery", "Knocking on wood", "Early nights"],
  },
  "house-marisol": {
    occupation: "Obituary writer",
    prompts: [
      { id: "weirdly_attracted", answer: "People who laugh at the wrong moment. Ideally at my funeral, much, much later." },
      { id: "two_truths", answer: "I've written six hundred obituaries. Every one hides a love story. I've never cried at a wedding." },
    ],
    hobbies: ["Crosswords", "Graveyard walks", "Writing"],
  },
  "house-teo": {
    occupation: "Ballroom instructor",
    prompts: [
      { id: "win_me_over", answer: "Lead back. Confidently. On the second step, not the first." },
      { id: "dating_me_is_like", answer: "A tango: I lead, you lead back, and somebody's ring box ends up in a drawer." },
    ],
    hobbies: ["Ballroom dancing", "Mirrors", "Collecting ring boxes"],
  },
  "house-nell": {
    occupation: "Museum night guard",
    prompts: [
      { id: "fall_for_you", answer: "You ask a follow-up question. Ask a second and you get the full tour." },
      { id: "geek_out", answer: "Marble busts, Roman plumbing, and the exact minute the east wing goes quiet." },
    ],
    hobbies: ["Museums", "History", "Night walks"],
  },
  "house-sable": {
    occupation: "Professional surpriser",
    prompts: [
      { id: "win_me_over", answer: "Say yes before you hear the plan. The plan is always good. Mostly." },
      { id: "together_we_could", answer: "Throw a party for someone we've never met. They'll cry. We'll leave before the cake." },
    ],
    hobbies: ["Party planning", "Party hats", "Spontaneous trips"],
  },
  "house-orin": {
    occupation: "Retired fact-checker",
    prompts: [
      { id: "unpopular_opinion", answer: "Most anecdotes don't survive one follow-up question. Yours had better." },
      { id: "two_truths", answer: "I once corrected a eulogy, out loud. I regret the timing. I've never been wrong about a date." },
    ],
    hobbies: ["Fact-checking", "Reading menus", "Long walks"],
  },
  "house-imogen": {
    occupation: "Runs a 2am soup window",
    prompts: [
      { id: "win_me_over", answer: "Let me feed you. Don't argue. Don't thank me. Just eat." },
      { id: "simple_pleasures", answer: "The 2am regulars, a pot that's been going since midnight, and nobody saying thank you." },
    ],
    hobbies: ["Cooking", "Night shifts", "Remembering names"],
  },
  "house-kaz": {
    occupation: "Crane climber (unofficially)",
    prompts: [
      { id: "irrational_fear", answer: "Lifts. Small boxes that decide where you're going." },
      { id: "together_we_could", answer: "Watch the sun come up from somewhere we're not technically allowed to be." },
    ],
    hobbies: ["Climbing", "Sunrises", "Stairs"],
  },
  "house-wally": {
    occupation: "Mechanic",
    prompts: [
      { id: "win_me_over", answer: "Hand me the broken thing. I won't ask how it broke." },
      { id: "simple_pleasures", answer: "An engine turning over first try. A mug of tea. Quiet." },
    ],
    hobbies: ["Fixing engines", "Tinkering", "Fishing"],
  },
  "house-perpetua": {
    occupation: "Retired soap villain",
    prompts: [
      { id: "dating_me_is_like", answer: "A season finale. Long pauses, a twist, and I come back either way." },
      { id: "win_me_over", answer: "Hold a pause with me. ... Longer. ... There it is." },
    ],
    hobbies: ["Theatre", "Dramatic pauses", "Scheming"],
  },
  "house-ines": {
    occupation: "Guerrilla gardener",
    prompts: [
      { id: "together_we_could", answer: "Plant a tree somewhere it doesn't belong and visit it every spring." },
      { id: "fall_for_you", answer: "You water my trees while I'm away, and you don't tell the council." },
    ],
    hobbies: ["Gardening", "Trees", "Night cycling"],
  },
  "house-boaz": {
    occupation: "National cup-stacking champion",
    prompts: [
      { id: "geek_out", answer: "Stacking speed, cup weight, and the 2014 nationals, which I won fairly." },
      { id: "together_we_could", answer: "Race. You'll lose. Then we race again, because that's the part I want." },
    ],
    hobbies: ["Cup stacking", "Training", "Rematches"],
  },
  "house-lior": {
    occupation: "Wanderer, leaver of bicycles",
    prompts: [
      { id: "simple_pleasures", answer: "A new city, an old bicycle, and nobody asking where I'm headed." },
      { id: "dating_me_is_like", answer: "A long ride with no map. Pleasant. Don't ask where next." },
    ],
    hobbies: ["Cycling", "Travel", "People-watching"],
  },
  "house-vesper": {
    occupation: "Retired cruise-ship magician",
    prompts: [
      { id: "worst_first_date", answer: "Four stars. Lost one when my dessert vanished. I made it vanish. Still counts." },
      { id: "weirdly_attracted", answer: "People who check their pockets after a hug. Smart." },
    ],
    hobbies: ["Magic tricks", "Desserts", "Star ratings"],
  },
  "house-odalys": {
    occupation: "Ferry captain",
    prompts: [
      { id: "geek_out", answer: "Tides, rope knots, and a hundred-year feud I can recite by heart." },
      { id: "two_truths", answer: "I'm neutral in public. I keep a scorecard of every passenger. I've never once looked at the scores." },
    ],
    hobbies: ["Sailing", "Knots", "Gossip"],
  },
};
