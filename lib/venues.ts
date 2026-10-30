/**
 * The reusable library of date locations (the competitor report's "reuse a library of date settings").
 * Thirty-three venues, dealt to a date by seed exactly like the producer's situation, so every episode happens
 * somewhere specific and recognisable without a location ever being generated per date. Every one has a reviewed
 * backdrop photo (lib/portraits.ts VENUES_WITH_BACKDROPS, all of them since 2026-10-18); one added later paints its
 * two-hue gradient until its own is made and reviewed (David, 2026-10-18: "more extreme date scenarios… and 20 more
 * funny ones").
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
 * Places deliberately varied in how much they help: a rooftop at golden hour flatters anyone, a cramped café
 * on a deadline does not, and nobody looks their best strapped to a skydiving instructor. The engine decides
 * the outcome either way — the venue is where it happens, never a thumb on the scale. Every one comes with
 * its own small trouble (the broken clue, the goat with a favourite), so the date has something to play off.
 * Append new venues at the end: a stored date keeps its venue (DateSetup.venue), so order only changes new deals.
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
  // 2026-10-18: the extreme ones David asked for.
  { id: "skydive", name: "A tandem skydive at 13,000 feet", prompt: "a tiny plane at 13,000 feet before a tandem skydive, the instructor checking their straps with alarming cheer as the door rattles open", hues: [205, 28], plate: "an empty small skydiving plane cabin high above a patchwork of fields, its side door open, a bench and harness straps inside, bright blue sky" },
  { id: "surf_lesson", name: "A beginner surf lesson in cold water", prompt: "a beginner surf lesson in cold grey water, wetsuits a size wrong, with an instructor who talks only in wave metaphors", hues: [195, 170], plate: "an empty beach by a surf hire shack in the morning, two foam surfboards on the sand, grey-green waves rolling in" },
  { id: "dive_bar", name: "A sticky dive bar on trivia night", prompt: "a sticky neighbourhood dive bar on trivia night, where a team called Quiz Pro Quo wins every single round", hues: [38, 12], plate: "an empty neighbourhood dive bar, worn wooden booths, a pool table, a blank chalkboard, warm amber light" },
  { id: "nightclub", name: "A nightclub too loud to talk in", prompt: "a packed nightclub so loud they have to shout every line, with a DJ who keeps dedicating songs to the couple by the pillar", hues: [275, 320], plate: "an empty nightclub dance floor under purple and magenta lights, a mirror ball, a mixing desk with blank screens, a pillar wrapped in lights" },
  { id: "safari", name: "A safari jeep at dawn", prompt: "an open safari jeep at dawn, a guide whispering about lions while a giraffe stares at them for far too long", hues: [35, 80], plate: "an empty open safari jeep parked in golden savanna grass at dawn, an acacia tree on the horizon, a distant giraffe silhouette" },
  // 2026-10-18: twenty more, each with its own small trouble.
  { id: "escape_room", name: "An escape room with a broken clue", prompt: "an escape room where the final clue is clearly broken and the game master keeps giving hints over a crackling speaker", hues: [48, 200], plate: "an empty escape room styled as a dusty study, a locked chest, a padlocked bookcase, an old clock, dim green-tinted light" },
  { id: "flat_pack", name: "A flat-pack furniture maze", prompt: "a sprawling flat-pack furniture superstore they can't find the way out of, arguing over a wardrobe with one leftover screw", hues: [210, 52], plate: "an empty furniture showroom, cosy model living rooms with sofas, lamps, rugs and bookshelves, arrows painted on the floor, bright even light, warm colours" },
  { id: "pottery_class", name: "A pottery class (the wheel wins)", prompt: "a beginners' pottery class where the wheel spins too fast and the teacher keeps murmuring feel the clay", hues: [22, 30], plate: "an empty pottery studio, two potter's wheels with lumps of wet clay, shelves of lopsided bowls, afternoon light" },
  { id: "hot_air_balloon", name: "A hot air balloon drifting off course", prompt: "a hot air balloon basket drifting off course, with a pilot who will not stop talking about wind", hues: [12, 200], plate: "an empty hot air balloon basket high above rolling hills at sunrise, the burner and ropes overhead, a striped balloon above" },
  { id: "bowling_alley", name: "Bowling on league night", prompt: "a bowling alley on league night, sharing lane twelve with a retired couple who take it very, very seriously", hues: [330, 230], plate: "an empty bowling alley at night, glossy lanes, neat rows of pins, a ball return, neon glow, blank score screens" },
  { id: "laundromat", name: "A laundromat at midnight", prompt: "a 24-hour laundromat at midnight, both of them waiting on the one dryer that works", hues: [190, 260], plate: "an empty 24-hour laundromat at midnight, rows of washing machines with round windows, plastic chairs, buzzing fluorescent light" },
  { id: "ice_rink", name: "An ice rink, and neither can skate", prompt: "a public ice rink where neither of them can skate, clinging to the barrier while a retiree glides past backwards", hues: [200, 240], plate: "an empty indoor ice rink, fresh white ice, a low barrier around the edge, cold blue light, a pair of skates on a bench" },
  { id: "cooking_class", name: "A cooking class with a nervous smoke alarm", prompt: "a couples' cooking class where the smoke alarm goes off every ten minutes and the chef pretends it's part of the lesson", hues: [18, 45], plate: "an empty teaching kitchen, two cooking stations with chopping boards and pans, hanging copper pots, a smoke alarm on the ceiling" },
  { id: "haunted_house", name: "A haunted house tour", prompt: "a haunted house tour where the actors jump out a beat too early and then apologise", hues: [270, 120], plate: "an empty creaky haunted house hallway at night filling the whole picture edge to edge, flickering candles in wall sconces, cobwebs, peeling wallpaper, a grand staircase in shadow" },
  { id: "silent_disco", name: "A silent disco on the wrong channels", prompt: "a rooftop silent disco where they're accidentally tuned to different channels, dancing to two different songs", hues: [300, 180], plate: "an empty rooftop at night, wireless headphones glowing in three colours on a table, string lights, a city skyline" },
  { id: "museum_night", name: "A museum after dark", prompt: "a natural history museum's late opening under a dinosaur skeleton, with a volunteer guide who has strong opinions about the dinosaur", hues: [40, 220], plate: "an empty natural history museum hall at night, a huge dinosaur skeleton, a marble floor, glass display cases, soft spotlights" },
  { id: "rainy_campsite", name: "A campsite in the rain", prompt: "a campsite where the tent instructions are no help at all and the rain starts exactly on cue", hues: [110, 200], plate: "an empty campsite in light rain, a half-pitched tent, a small campfire ring, pine trees and mist" },
  { id: "goat_yoga", name: "Goat yoga (one goat has a favourite)", prompt: "an outdoor goat yoga class where one goat has very clearly chosen a favourite", hues: [90, 50], plate: "an empty grassy field set up for outdoor yoga, a row of yoga mats, a wooden fence, two small goats grazing, morning sun" },
  { id: "swan_pedalo", name: "A swan pedal boat with one broken pedal", prompt: "a rented swan-shaped pedal boat on a city lake, one pedal broken, and a goose following them with intent", hues: [180, 130], plate: "an empty white swan-shaped pedal boat on a calm city lake, a small wooden dock, willow trees, a single goose on the water" },
  { id: "murder_mystery", name: "A murder mystery dinner", prompt: "a murder mystery dinner where the actor playing the victim keeps forgetting he's meant to be dead", hues: [350, 280], plate: "an empty grand dining room set for a murder mystery dinner, candelabras, a long table with place cards, velvet curtains, moody light" },
  { id: "ballroom_lesson", name: "A ballroom lesson (\"connection!\")", prompt: "a beginners' ballroom lesson where the instructor pairs them up and keeps shouting connection", hues: [45, 330], plate: "an empty ballroom dance studio, a polished wooden floor, a wall of mirrors, a chandelier, a music stand in the corner" },
  { id: "paintball", name: "Paintball, on the same team", prompt: "a paintball field where they're on the same team against a stag party in matching shirts", hues: [95, 300], plate: "an empty paintball field, inflatable bunkers and stacked tyres, paint splats on wooden barriers, a forest edge" },
  { id: "trail_ride", name: "A trail ride on two stubborn horses", prompt: "a trail ride on two horses who refuse to walk side by side", hues: [30, 105], plate: "an empty forest bridle path, two saddled horses tied at a fence, dappled light, a stable in the distance" },
  { id: "comedy_club", name: "A comedy open mic, front row", prompt: "a comedy open mic where they're in the front row and the host keeps picking on the first date", hues: [0, 260], plate: "an empty comedy club, a small stage with a microphone stand against a brick wall, round tables with candles, a red curtain" },
  { id: "climbing_wall", name: "An indoor climbing wall", prompt: "an indoor climbing wall where they take turns holding each other's rope, and the instructor keeps saying trust", hues: [15, 190], plate: "an empty indoor climbing gym, a tall colourful wall of holds, ropes hanging down, crash mats on the floor" },
  // 2026-10-18: where a date goes next (lib/moves.ts; David: "we should get a bigger library"). Dealt like any other.
  { id: "late_night_diner", name: "A late-night diner, open till four", prompt: "a late-night diner open till four, where the waitress calls everyone trouble and tops up the coffee whether they want it or not", hues: [355, 200], plate: "an empty all-night diner interior, red vinyl booths and chrome-trimmed tables, a long counter with chrome stools and a glowing pie case, big windows streaked with rain and a soft blurred neon glow outside, gentle fluorescent warmth, deep cosy perspective, nobody present, no readable text" },
  { id: "night_market", name: "A night market of steam and lanterns", prompt: "a crowded night market strung with lanterns, where every stall insists they try one more thing", hues: [18, 330], plate: "an empty deserted night-market lane strung with rows of glowing paper lanterns receding into the dark, unattended wooden food stalls with steaming pots and covered counters on both sides, wet reflective cobblestones catching warm pools of light, deep perspective, nobody there, no lettering" },
  { id: "old_cinema", name: "A tiny old cinema, last showing", prompt: "a tiny old single-screen cinema at the last showing of the night, where the only other person in the audience laughs at all the wrong moments", hues: [350, 28], plate: "an empty vintage single-screen cinema auditorium, rows of plush red velvet seats seen from the back, a large softly glowing blank screen, art-deco wall sconces washing the deep-red walls in warm light, intimate and nostalgic, nobody present, no text" },
  { id: "stargazing_hill", name: "A hill above the city, for the stars", prompt: "a grassy hill above the city at night, with a borrowed telescope that only ever finds the same star", hues: [238, 270], plate: "an empty grassy hilltop above a distant glittering city at night, in the foreground a telescope on a tripod and a checked picnic blanket with a thermos, a vast deep-blue sky brushed with stars and a faint milky way overhead, quiet and romantic, nobody present, no text" },
  { id: "city_walk", name: "The long walk home", prompt: "the long walk home through the city at night, past shuttered shops, with a street musician who knows exactly one song", hues: [220, 40], plate: "an empty rain-slicked city street at night, shuttered shopfronts with blank unlettered signs, warm streetlamps throwing long reflections across the wet pavement, a few glowing windows above, soft drifting mist, cinematic and intimate, nobody present, no readable text" },
  { id: "pier_at_night", name: "The pier at night", prompt: "the end of an old seaside pier at night, the rides shutting down one by one and a gull guarding the last of the chips", hues: [200, 320], plate: "an empty old wooden seaside pier at night, weathered railings leading the eye out to a small darkened ferris wheel and a shuttered funfair, strings of warm bulbs reflecting on the black water, a moonlit horizon beyond, nostalgic and still, nobody present, no lettering" },
  { id: "jazz_bar", name: "A basement jazz bar, one table left", prompt: "a basement jazz bar with one table left, right beside the drummer, who takes every solo personally", hues: [32, 285], plate: "an empty cosy basement jazz club, a small raised wooden stage with a drum kit and an upright double bass under a single warm spotlight, exposed brick walls, round tables with flickering candles, smoky amber light, intimate late-night mood, nobody present, no lettering" },
  { id: "late_bookshop", name: "A bookshop open late", prompt: "a bookshop that stays open late, with a cat asleep on the poetry and an owner who recommends books aggressively", hues: [36, 12], plate: "an empty warm labyrinthine second-hand bookshop at night, floor-to-ceiling wooden shelves packed with colourful books with no readable titles, a leaning library ladder, a pair of worn armchairs under a glowing reading lamp, a cat asleep on a stack of books, honeyed lamplight, nobody present, no text" },
] as const satisfies readonly Venue[];

export type VenueId = (typeof DATE_VENUES)[number]["id"];

export const VENUE_IDS = DATE_VENUES.map((v) => v.id) as [VenueId, ...VenueId[]];

/**
 * Places a date can be at but is never dealt (David, 2026-10-18): places the two of them chose themselves, in their
 * texts. `home` is one of their places: the living room and the kitchen, never a bedroom (the show stays PG).
 * `elsewhere` stands in for a place the library has no set for yet: a generic background with the place's own name,
 * and the request is logged (lib/scenes.ts) so the library grows where people actually want to go.
 */
export const EXTRA_VENUES = [
  { id: "home", name: "Their place", prompt: "one of their homes: the living room and the kitchen, a lamp on, something on the stove", hues: [28, 340], plate: "a warm lived-in open-plan flat at night; on the left a small kitchen with a stove, a steaming pot, a hanging rack of utensils, a potted herb and a dark window; on the right a soft two-seater sofa with cushions and a folded throw, a glowing floor lamp, a woven rug and a trailing plant; deep cosy amber lighting, inviting and intimate, nobody present, no text" },
  { id: "elsewhere", name: "Somewhere new", prompt: "a place they picked themselves", hues: [235, 290], plate: "a dreamy softly out-of-focus evening somewhere unnamed; warm bokeh streetlights in amber and violet, a single empty wooden bench catching the light in the foreground, hazy indistinct depth behind, nothing identifiable, no people, no lettering" },
] as const satisfies readonly Venue[];

export type ExtraVenueId = (typeof EXTRA_VENUES)[number]["id"];
export type AnyVenueId = VenueId | ExtraVenueId;
/**
 * Where a date is, as stored (DateSetup.venue): a venue's id, or a venue with a name of its own after an "@" —
 * "home@Chud's place", "elsewhere@the observatory". `venue()` reads either, so every caller that takes an id takes these.
 */
export type PlaceId = AnyVenueId | `${AnyVenueId}@${string}`;

/** The longest name a place of their own can have. */
export const PLACE_LABEL_MAX = 40;

const ALL_VENUES: readonly Venue[] = [...DATE_VENUES, ...EXTRA_VENUES];

/** The same place however it's written: "The Observatory", "the observatory" and "an observatory" count together. */
export const normalizeScene = (label: string): string =>
  label
    .toLowerCase()
    .replace(/^(the|a|an|that|this|some|our)\s+/, "")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Where a drawn set for a place of its own is served (lib/sets.ts); a 404 until one is drawn. */
export const setPath = (label: string): string => `/api/sets/${encodeURIComponent(normalizeScene(label))}`;

/** A place's venue id and its own name ("elsewhere@the observatory" → elsewhere, "the observatory"). */
export function placeParts(id: string | null | undefined): { id: string | null; label: string | null } {
  if (!id) return { id: null, label: null };
  const at = id.indexOf("@");
  if (at < 0) return { id, label: null };
  const label = id.slice(at + 1).trim().slice(0, PLACE_LABEL_MAX);
  return { id: id.slice(0, at), label: label || null };
}

/** A place of their own's name, or null for a venue from the library. */
export const placeLabel = (id: string | null | undefined): string | null => placeParts(id).label;

/** True for a place the library has no set for yet: it shows the generic background, and the request is logged. */
export const isPlaceholder = (id: string | null | undefined): boolean => placeParts(id).id === "elsewhere";

/**
 * The venue for an id or a place; falls back to the first venue so an episode stored before the library still renders.
 * A place with its own name takes that name, and the showrunner and the actors are told where they are by it.
 */
export const venue = (id: PlaceId | string | null | undefined): Venue => {
  const { id: base, label } = placeParts(id);
  const v = ALL_VENUES.find((x) => x.id === base) ?? DATE_VENUES[0];
  if (!label) return v;
  return { ...v, name: label.charAt(0).toUpperCase() + label.slice(1), prompt: v.id === "home" ? `${label}: ${v.prompt.replace(/^one of their homes: /, "")}` : label };
};

export const venueName = (id: PlaceId | string | null | undefined): string => venue(id).name;

/** Where a date is after these lines: the last place they moved to (lib/moves.ts stamps `moved_to`), else where it started. */
export function placeAt<P extends string>(turns: readonly { moved_to?: P }[], start: P | null): P | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const to = turns[i].moved_to;
    if (to) return to;
  }
  return start;
}

/** The place, written to sit mid-sentence ("last time at the observatory", "at Chud's place"). */
export const venuePhrase = (id: PlaceId | string | null | undefined): string => {
  const label = placeLabel(id);
  if (label) return label;
  const name = venue(id).name;
  return name.charAt(0).toLowerCase() + name.slice(1);
};

/** Deals a venue from a seed, the way the producer's situation is dealt: bounded, reproducible, free. */
export const pickVenue = (seed: number): VenueId => VENUE_IDS[seed % VENUE_IDS.length];

/**
 * Deals a venue from a seed, stepping past any in `avoid` (the venues a character was just at: run 4 got the same
 * double date twice in a row). With nothing to avoid it's exactly pickVenue, so a stored date replays the same.
 */
export function pickVenueAvoiding(seed: number, avoid: readonly string[] = []): VenueId {
  const start = seed % VENUE_IDS.length;
  for (let i = 0; i < VENUE_IDS.length; i++) {
    const v = VENUE_IDS[(start + i) % VENUE_IDS.length];
    if (!avoid.includes(v)) return v;
  }
  return VENUE_IDS[start];
}

/** The backdrop gradient for a venue, for the episode page and the share card. */
export const venueBackdropCss = (id: PlaceId | string | null | undefined): string => {
  const [from, to] = venue(id).hues;
  return `linear-gradient(135deg, hsl(${from} 58% 24%), hsl(${to} 52% 16%))`;
};
