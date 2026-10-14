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
};

/**
 * Eight places, deliberately varied in how much they help: a rooftop at golden hour flatters anyone,
 * a cramped café on a deadline does not. The engine decides the outcome either way — the venue is
 * where it happens, never a thumb on the scale.
 */
export const DATE_VENUES = [
  { id: "rooftop_bar", name: "A rooftop bar at golden hour", prompt: "a rooftop bar at golden hour, with the city going gold below them", hues: [32, 348] },
  { id: "corner_cafe", name: "A corner café that closes in an hour", prompt: "a cramped corner café that is closing in an hour, chairs going up around them", hues: [28, 54] },
  { id: "retro_arcade", name: "A loud retro arcade", prompt: "a loud retro arcade where one machine is broken and keeps announcing a winner", hues: [285, 200] },
  { id: "botanic_park", name: "A botanic park before the rain", prompt: "a botanic park in the minutes before it rains, nobody willing to mention the sky", hues: [140, 100] },
  { id: "tasting_menu", name: "A too-fancy tasting menu", prompt: "a too-fancy tasting-menu restaurant with eleven tiny courses and a hovering waiter", hues: [250, 215] },
  { id: "night_beach", name: "A cold beach at night", prompt: "a cold beach at night with one shared blanket and a thermos of something terrible", hues: [220, 190] },
  { id: "double_date", name: "An awkward double date", prompt: "an awkward double date with a smug couple who finish each other's sentences", hues: [340, 18] },
  { id: "karaoke_booth", name: "A karaoke booth, one hour booked", prompt: "a karaoke booth booked for a full hour, with a song already queued by someone else", hues: [310, 265] },
] as const satisfies readonly Venue[];

export type VenueId = (typeof DATE_VENUES)[number]["id"];

export const VENUE_IDS = DATE_VENUES.map((v) => v.id) as [VenueId, ...VenueId[]];

/** The venue for an id; falls back to the first one so an episode stored before the library still renders. */
export const venue = (id: VenueId | null | undefined): Venue =>
  DATE_VENUES.find((v) => v.id === id) ?? DATE_VENUES[0];

export const venueName = (id: VenueId | null | undefined): string => venue(id).name;

/** Deals a venue from a seed, the way the producer's situation is dealt: bounded, reproducible, free. */
export const pickVenue = (seed: number): VenueId => VENUE_IDS[seed % VENUE_IDS.length];

/** The backdrop gradient for a venue, for the episode page and the share card. */
export const venueBackdropCss = (id: VenueId | null | undefined): string => {
  const [from, to] = venue(id).hues;
  return `linear-gradient(135deg, hsl(${from} 58% 24%), hsl(${to} 52% 16%))`;
};
