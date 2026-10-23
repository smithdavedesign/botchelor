/**
 * Scenario packs for After Dark (David, 2026-10-22, from the competitor analysis: nearly every adult product has them):
 * curated starting points for a night. Each has a title, a short premise, the place it starts (a set label, drawn once
 * and shared like any set), a starting stage (0 to 2: talking, tension or kissing) and an opening steer.
 *
 * "Start a night from a scenario" (lib/adult/scenes.ts startScenario) files the night that ran, as Start over does,
 * puts them in the place (setSceneTo, so the first lines open on arriving there), sets the starting stage (never past the
 * pair's intensity), keeps the premise on the scene for every step of the night, and writes the first lines with the
 * opening as a Nudge: the pacing, the public-place cap, the intensity and the hard nos all hold from the first line.
 *
 * Every scenario is reviewed against the lines that never move (tests/after-dark-scenarios.test.ts runs each through
 * checkAdultText and a theme check): two adults, both willing, no family or step-family, no teacher and student (no
 * lessons or instruction either), no school, no age-play, nothing non-consensual (no one is drunk, trapped against their
 * will, paid for it or kept from saying no). Where a premise is a professional one, the attraction is mutual and said out
 * loud first.
 */

export type Scenario = {
  id: string;
  title: string;
  /** One or two sentences: the situation, never an act. */
  premise: string;
  /** Where the night starts: a set label (lib/sets.ts), 60 characters at most. */
  place: string;
  /** How far it's gone when it starts (STAGES index): 0 talking, 1 tension, 2 kissing. */
  stage: 0 | 1 | 2;
  /** The first steer, sent as a Nudge. */
  opening: string;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "elevator",
    title: "Stuck in an elevator",
    premise: "Late at night the lift jams between floors. Help is an hour away, and it's just the two of them and one flickering light.",
    place: "the stalled elevator",
    stage: 0,
    opening: "The lift jolts to a stop between floors and the light flickers; they're stuck together until help comes.",
  },
  {
    id: "wedding-hotel",
    title: "Hotel after the wedding",
    premise: "A friend's wedding is over. At two in the morning they meet in the hotel corridor, shoes in hand, neither ready for the night to end.",
    place: "the hotel corridor",
    stage: 1,
    opening: "Shoes in hand after the wedding, they run into each other outside their rooms and neither says goodnight.",
  },
  {
    id: "rivals-conference",
    title: "Rivals at a conference",
    premise: "Two rival speakers who argued on stage all afternoon end up alone at the hotel bar, still arguing, enjoying it far too much.",
    place: "the hotel bar",
    stage: 0,
    opening: "After their heated debate on stage, they end up on neighbouring bar stools and pick the argument back up.",
  },
  {
    id: "rainy-cabin",
    title: "Rainy cabin",
    premise: "A storm closes the mountain road. The rented cabin has one fireplace, one blanket and nothing to do but talk.",
    place: "the cabin by the fire",
    stage: 1,
    opening: "Rain hammers the cabin roof; they build up the fire and share the only blanket.",
  },
  {
    id: "exes-party",
    title: "Exes at a party",
    premise: "Years after they split, they run into each other at a friend's party and end up on the balcony, away from everyone.",
    place: "the party balcony",
    stage: 1,
    opening: "Years after they broke up, they find each other on the balcony at a friend's party and finally talk about it.",
  },
  {
    id: "massage",
    title: "Massage appointment (licensed adults)",
    premise: "A licensed massage therapist and a regular client at the end of the last appointment of the day. The attraction has been there for months; tonight one of them says so, and the other says it back.",
    place: "the massage studio",
    stage: 0,
    opening: "At the end of the last appointment, one of them admits the attraction out loud, and they talk about whether to act on it.",
  },
  {
    id: "ski-lodge",
    title: "Snowed in at the lodge",
    premise: "The roads are closed and the ski lodge has emptied out. The last two guests share the fire in the lounge.",
    place: "the ski lodge lounge",
    stage: 0,
    opening: "Snow closes the road; the last two guests in the lodge pull their chairs closer to the fire.",
  },
  {
    id: "motel",
    title: "One room left",
    premise: "A long drive, a roadside motel and one room left with two beds. They agree to share it, and the talk goes on long after the light is out.",
    place: "the motel room",
    stage: 1,
    opening: "They take the last room at the roadside motel, two beds, and talk across the gap in the dark.",
  },
  {
    id: "blackout",
    title: "Power cut",
    premise: "The whole street goes dark. Candles, a deck of cards and no reason to go anywhere.",
    place: "the candlelit living room",
    stage: 0,
    opening: "The power goes out across the street; they light candles and find a deck of cards.",
  },
  {
    id: "sleeper-train",
    title: "The night train",
    premise: "An overnight train, a sleeper cabin booked twice by mistake, and a long way to the next station.",
    place: "the sleeper cabin",
    stage: 0,
    opening: "The conductor shrugs: the cabin was booked twice. They agree to share it as the train pulls out.",
  },
  {
    id: "masquerade",
    title: "Masquerade",
    premise: "Masks on and names unknown. One dance turns into a dare, and the dare into slipping away from the ballroom.",
    place: "the masquerade ballroom",
    stage: 1,
    opening: "Two masked strangers share a dance and dare each other to slip away from the ballroom.",
  },
  {
    id: "neighbours",
    title: "The balcony next door",
    premise: "Next-door neighbours who've only waved for a year finally talk across the balcony rail on a warm night.",
    place: "the neighbouring balconies",
    stage: 0,
    opening: "On a warm night, the neighbours who only ever wave finally talk across the balcony rail.",
  },
  {
    id: "bookshop",
    title: "After closing",
    premise: "A bookseller and her favourite regular, the last two in the shop after closing, reading aloud to each other between the shelves.",
    place: "the bookshop after closing",
    stage: 0,
    opening: "After closing, the bookseller and her favourite regular read their favourite pages aloud to each other.",
  },
  {
    id: "rooftop-pool",
    title: "The rooftop pool",
    premise: "The hotel's rooftop pool is closed for the night. Two guests who climbed the fence have the whole city's lights to themselves.",
    place: "the rooftop pool",
    stage: 1,
    opening: "They climb the fence to the closed rooftop pool and sit with their feet in the water, the city lit up below.",
  },
  {
    id: "reunion",
    title: "Long distance, finally",
    premise: "Months of video calls across time zones. Tonight, for the first time in a long time, they're in the same hotel room.",
    place: "the hotel room",
    stage: 2,
    opening: "The door closes behind them: after months of calls, they're finally in the same room.",
  },
  {
    id: "anniversary",
    title: "The anniversary",
    premise: "Long-term partners on a night away to remember why: a cottage by the sea, a fire and no phones.",
    place: "the seaside cottage",
    stage: 2,
    opening: "On their anniversary night away, they put the phones in a drawer and remember how it started.",
  },
];

export const scenarioById = (id: string): Scenario | null => SCENARIOS.find((s) => s.id === id) ?? null;
