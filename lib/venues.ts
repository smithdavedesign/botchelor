/**
 * The reusable library of date locations (the competitor report's "reuse a library of date settings").
 * Eight venues, dealt to a date by seed exactly like the producer's situation, so every episode happens
 * somewhere specific and recognisable without a location ever being generated per date.
 *
 * Each venue carries a two-hue backdrop, so the episode page can paint the place behind the matchup —
 * a composited scene at $0, with no image to host or moderate. Pure and client-safe.
 */

export type Venue = {
  id: string;
  /** The place, as the audience sees it on the episode. */
  name: string;
  /** Where the showrunner must set the date. Written as a stage direction, not an instruction to obey. */
  prompt: string;
  /** The backdrop gradient (two hues, 0..360), drawn behind the matchup. */
  hues: readonly [number, number];
  /**
   * The empty set, for the backdrop image generator only (scripts/prompts.mjs). `prompt` is written for
   * the showrunner and has people in it ("a smug couple", "a hovering waiter"); fed to an image model,
   * it drew them — backdrop-v1 was rejected for exactly that. A plate describes the place with nobody
   * in it, and screens and signs blank, since generated lettering comes out as garbled pseudo-text.
   */
  plate: string;
};

/**
 * Eight places, deliberately varied in how much they help: a rooftop at golden hour flatters anyone,
 * a cramped café on a deadline does not. The engine decides the outcome either way — the venue is
 * where it happens, never a thumb on the scale.
 */
export const DATE_VENUES = [
  { id: "rooftop_bar", name: "A rooftop bar at golden hour", prompt: "a rooftop bar at golden hour, with the city going gold below them", hues: [32, 348], plate: "an empty rooftop bar at golden hour, string lights, a few bistro tables and stools, the city skyline glowing gold below" },
  { id: "corner_cafe", name: "A corner café that closes in an hour", prompt: "a cramped corner café that is closing in an hour, chairs going up around them", hues: [28, 54], plate: "an empty cramped corner café near closing time, chairs stacked upside down on some tables, warm lamplight, a rain-streaked window" },
  { id: "retro_arcade", name: "A loud retro arcade", prompt: "a loud retro arcade where one machine is broken and keeps announcing a winner", hues: [285, 200], plate: "an empty retro arcade at night, rows of glowing cabinets with blank colourful screens and plain unlettered marquees, neon light on a patterned carpet" },
  { id: "botanic_park", name: "A botanic park before the rain", prompt: "a botanic park in the minutes before it rains, nobody willing to mention the sky", hues: [140, 100], plate: "an empty botanic garden path under a heavy grey sky just before rain, lush palms and ferns, a wet stone bench" },
  { id: "tasting_menu", name: "A too-fancy tasting menu", prompt: "a too-fancy tasting-menu restaurant with eleven tiny courses and a hovering waiter", hues: [250, 215], plate: "an empty, too-fancy fine-dining room, white tablecloths, one table set with many tiny plates and gleaming cutlery, candlelight" },
  { id: "night_beach", name: "A cold beach at night", prompt: "a cold beach at night with one shared blanket and a thermos of something terrible", hues: [220, 190], plate: "an empty cold beach at night under a moonlit sky, a single checked blanket and a thermos on the sand, gentle waves" },
  { id: "double_date", name: "An awkward double date", prompt: "an awkward double date with a smug couple who finish each other's sentences", hues: [340, 18], plate: "an empty restaurant booth set for four, four glasses and one shared dessert on the table, warm evening light" },
  { id: "karaoke_booth", name: "A karaoke booth, one hour booked", prompt: "a karaoke booth booked for a full hour, with a song already queued by someone else", hues: [310, 265], plate: "an empty karaoke booth, a leather sofa around a low table with two microphones on it, a glowing screen showing only abstract colour" },
] as const satisfies readonly Venue[];

export type VenueId = (typeof DATE_VENUES)[number]["id"];

export const VENUE_IDS = DATE_VENUES.map((v) => v.id) as [VenueId, ...VenueId[]];

/** The venue for an id; falls back to the first one so an episode stored before the library still renders. */
export const venue = (id: VenueId | null | undefined): Venue =>
  DATE_VENUES.find((v) => v.id === id) ?? DATE_VENUES[0];

export const venueName = (id: VenueId | null | undefined): string => venue(id).name;

/** Deals a venue from a seed, the way the producer's situation is dealt: bounded, reproducible, free. */
export const pickVenue = (seed: number): VenueId => VENUE_IDS[seed % VENUE_IDS.length];

/**
 * Deals a venue from a seed, stepping past any in `avoid` (the venues a character was just at: run 4 got the same
 * double date twice in a row). With nothing to avoid it's exactly pickVenue, so a stored date replays the same.
 */
export function pickVenueAvoiding(seed: number, avoid: readonly VenueId[] = []): VenueId {
  const start = seed % VENUE_IDS.length;
  for (let i = 0; i < VENUE_IDS.length; i++) {
    const v = VENUE_IDS[(start + i) % VENUE_IDS.length];
    if (!avoid.includes(v)) return v;
  }
  return VENUE_IDS[start];
}

/** The backdrop gradient for a venue, for the episode page and the share card. */
export const venueBackdropCss = (id: VenueId | null | undefined): string => {
  const [from, to] = venue(id).hues;
  return `linear-gradient(135deg, hsl(${from} 58% 24%), hsl(${to} 52% 16%))`;
};
