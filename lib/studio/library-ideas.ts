/**
 * The Create tab's ideas (app/studio/CreateLibrary.tsx; David, 2026-10-25: "make suggestions"): one tap fills a form to
 * edit; never saved by themselves. Each is held to the same check as what a person writes (tests/studio-library.test.ts).
 */
import { ROLEPLAY_CATEGORIES, type LibraryMode } from "./library";

/** Ideas to start from, one tap each (David, 2026-10-25: "make suggestions"): a starting point to edit, never saved by themselves. */
export const PROMPT_IDEAS: Record<LibraryMode, string[]> = {
  safe: [
    "Golden-hour portrait on a rooftop, wind in their hair, the city behind them",
    "Reading in a café window seat, rain on the glass, a half-finished latte",
    "Laughing at a street-food stall at night under neon signs",
    "Hiking selfie at a mountain lookout, clouds below",
    "Cosy knit jumper and a mug of tea by an autumn window",
    "Dressed up for a gallery opening, a glass of wine in hand",
  ],
  after_dark: [
    "A candlelit hotel room, a silk robe, looking back over the shoulder",
    "A rain-soaked shirt in a doorway at night, streetlight behind",
    "A lazy Sunday morning in bed, white sheets and soft sunlight",
    "A steamy bathroom mirror, a towel and a slow smile",
  ],
};
export const PLACE_IDEAS: { name: string; description: string }[] = [
  { name: "The lighthouse lantern room", description: "the top of an old lighthouse, the lamp turning slowly, wind rattling the glass" },
  { name: "A rooftop greenhouse", description: "a glass greenhouse on a city roof at night, warm and green, the city's lights through the panes" },
  { name: "A canal houseboat", description: "a narrow houseboat at dusk, fairy lights strung along the deck, water lapping at the hull" },
  { name: "The observatory dome", description: "a small observatory with the dome open, a big brass telescope pointed at the stars" },
  { name: "A record shop after hours", description: "a record shop after closing, one lamp on, a turntable playing low" },
  { name: "A cabin hot tub in the snow", description: "an outdoor hot tub at a mountain cabin, snow falling, steam rising into the dark" },
];
export const ROLEPLAY_IDEAS: { title: string; premise: string; roles: [string, string] | null; category: (typeof ROLEPLAY_CATEGORIES)[number] }[] = [
  { title: "Rival food trucks", premise: "{a} and {b} run food trucks parked side by side; tonight one of them finally admits the rivalry was flirting all along.", roles: ["the taco truck owner", "the ramen truck owner"], category: "romance" },
  { title: "The lighthouse and the storm", premise: "A storm strands {b} at {a}'s lighthouse for the night. They're two adults with nowhere to be, and both are glad of the company.", roles: ["the lighthouse keeper", "the stranded sailor"], category: "getaway" },
  { title: "Pen pals, finally", premise: "{a} and {b} have written letters for a year. Tonight they meet for the first time, and the letters were not exaggerating.", roles: null, category: "strangers" },
  { title: "Fake dating, real feelings", premise: "{a} and {b} agreed to pretend to be a couple at a friend's wedding. Tonight the pretending stops being pretend, for both of them.", roles: null, category: "second" },
  { title: "The thief and the detective", premise: "{a} keeps stealing the same painting and {b} keeps catching them. Tonight neither of them wants the chase to end.", roles: ["the art thief", "the detective"], category: "mystery" },
  { title: "Lovers across time", premise: "{a} and {b} keep meeting in different centuries. Tonight, for once, they get a whole night in the same one.", roles: null, category: "fantasy" },
];
