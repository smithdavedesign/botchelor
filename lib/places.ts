/**
 * Where two characters said they'd go, as a place on the show (David, 2026-10-18: "if it exists use it otherwise add it
 * as a feedback loop for a new scene requested. If the scene doesnt exist let's just use a placeholder generic
 * background"). Deterministic and free:
 *
 *  - one of their homes ("my place", "back to yours") → "home@Chud's place": a living room and a kitchen (PG: never a
 *    bedroom);
 *  - a kind of place the library has ("coffee" → the corner café, "the east wing" → the museum after dark);
 *  - a place the library doesn't have, named with a place word ("the aquarium") → "elsewhere@the aquarium": the
 *    generic background with its own name, and a scene request (lib/scenes.ts);
 *  - nothing nameable → null, and the date is dealt a venue as before.
 */
import { shortName } from "./names";
import { checkShowText } from "./safety";
import { PLACE_LABEL_MAX, type PlaceId, type VenueId } from "./venues";

/** The specific places first (2026-10-18), so "surfing" isn't just the beach and "a pub quiz" isn't the rooftop. */
const SPECIFIC: [RegExp, VenueId][] = [
  [/\b(sky ?div\w*|parachut\w*|free ?fall)\b/i, "skydive"],
  [/\b(surf\w*|wetsuits?)\b/i, "surf_lesson"],
  [/\b(safari|lions?|giraffes?|zebras?|savann?ah?)\b/i, "safari"],
  [/\b(hot air balloon|balloon ride)\b/i, "hot_air_balloon"],
  [/\b(silent disco)\b/i, "silent_disco"],
  [/\b(night ?club|clubbing|dance ?floor|dj)\b/i, "nightclub"],
  [/\b(dive bar|pub|trivia|quiz night|pints?)\b/i, "dive_bar"],
  [/\b(escape room)\b/i, "escape_room"],
  [/\b(flat-?pack|furniture (?:shop|store)|showroom)\b/i, "flat_pack"],
  [/\b(pottery|ceramics?|potter'?s wheel)\b/i, "pottery_class"],
  [/\b(bowling|ten-?pin)\b/i, "bowling_alley"],
  [/\b(laundromat|laundrette|laundry)\b/i, "laundromat"],
  [/\b(ice ?skat\w*|skating|ice rink)\b/i, "ice_rink"],
  [/\b(cooking class|cook(?:ing)? together)\b/i, "cooking_class"],
  [/\b(haunted|ghost tour|ghosts?)\b/i, "haunted_house"],
  // Chud × Nell (2026-10-18) agreed "the east wing" ten times over: it's the museum.
  [/\b(museum|dinosaurs?|fossils?|east wing|west wing|sculpture (?:hall|garden)s?|exhibits?|exhibition|galler(?:y|ies))\b/i, "museum_night"],
  [/\b(camping|campsite|tent|campfire)\b/i, "rainy_campsite"],
  [/\b(yoga|goats?)\b/i, "goat_yoga"],
  [/\b(pedalo|pedal ?boat|swan boat|rowing boat|boating lake)\b/i, "swan_pedalo"],
  [/\b(murder mystery|whodunn?it)\b/i, "murder_mystery"],
  [/\b(ballroom|waltz|tango|foxtrot)\b/i, "ballroom_lesson"],
  [/\b(paintball)\b/i, "paintball"],
  [/\b(horse ?back|horse ?riding|trail ride|horses?)\b/i, "trail_ride"],
  [/\b(comedy|stand-?up|open mic)\b/i, "comedy_club"],
  [/\b(climbing|bouldering|climb)\b/i, "climbing_wall"],
  // 2026-10-25 (prod scene requests: "the night market", "the 24-hour diner", "the sea wall" all landed on the
  // placeholder): the eight phase-two venues were never wired in here, so plans and moves to places the library has a
  // reviewed set for were drawing throwaway sets instead. Named-place detection runs after SPECIFIC, so these win.
  [/\b(night market|hawker|food stalls?)\b/i, "night_market"],
  [/\b(diners?|milkshakes?)\b/i, "late_night_diner"],
  [/\b(cinema|movies?|films?|picture house|matinee)\b/i, "old_cinema"],
  // Just the activity: a named "the observatory" or "the planetarium" is its own building, and stays a named place.
  [/\b(stargaz\w*|telescopes?)\b/i, "stargazing_hill"],
  [/\b(book ?shops?|bookstores?|librar(?:y|ies))\b/i, "late_bookshop"],
  [/\b(piers?|boardwalk|promenade|esplanade|seafront|sea ?wall|harbou?r wall|breakwater|jetty|quay(?:side)?)\b/i, "pier_at_night"],
  [/\b(jazz|blues|saxophone|live music)\b/i, "jazz_bar"],
  [/\b(city walk|night walk|evening stroll|long walk home)\b/i, "city_walk"],
];

/**
 * Kinds of place the library has a set for, in order. Most are that place ("coffee" is the café). The `near` ones are
 * only something like it: casual food has no venue of its own, so the café is the nearest kind of place (run 2: a
 * food-truck plan got the rooftop), and any bar is the rooftop's. A near one can set a date that names nowhere in
 * particular, but never stands in for a place they named: "the night market" stays the night market (a 2026-10-18 move
 * landed two characters "at a corner café that closes in an hour" while they talked about the market).
 */
const KINDS: [RegExp, VenueId, "near"?][] = [
  // No \b after "é": JavaScript's \b is ASCII-only, so "café" never matched (a 2026-10-18 move to "the corner café").
  [/\b(coffee|caf[eé](?![a-z])|espresso|latte|pastr\w*|croissant)(?![a-z])/i, "corner_cafe"],
  [/\b(karaoke)\b/i, "karaoke_booth"],
  [/\b(arcade|pinball)\b/i, "retro_arcade"],
  [/\b(beach|ocean|shore)\b/i, "night_beach"],
  [/\b(park|garden|botanic|greenhouse|picnic)\b/i, "botanic_park"],
  // "night market" and "diner" moved to SPECIFIC (2026-10-25): they're venues of their own now.
  [/\b(food truck|street food|chill?i|tacos?|noodles?|ramen|dumplings?|stall|burgers?|pizza|fries|sandwich(?:es)?|brunch|breakfast|bagels?)\b/i, "corner_cafe", "near"],
  [/\b(rooftop|cocktails?)\b/i, "rooftop_bar"],
  [/\b(bar)\b/i, "rooftop_bar", "near"],
  [/\b(restaurant|tasting menu)\b/i, "tasting_menu"],
];
const kind = (t: string, near: boolean): VenueId | undefined => KINDS.find(([re, , n]) => Boolean(n) === near && re.test(t))?.[1];

/**
 * Things to do that the library has no set for yet: they become the placeholder with a name ("elsewhere@the cinema"),
 * and their scene requests show which sets to make next.
 */
const ACTIVITIES: [RegExp, string][] = [
  // 2026-10-25: cinema, observatory/planetarium, bookshop, pier and live music left this list for SPECIFIC: the
  // phase-two venues (old_cinema, stargazing_hill, late_bookshop, pier_at_night, jazz_bar) are the library's own sets.
  [/\b(concert|gig)\b/i, "the concert"],
  [/\b(observatory)\b/i, "the observatory"],
  [/\b(planetarium)\b/i, "the planetarium"],
  [/\b(theatre|theater|musical)\b/i, "the theatre"],
  [/\b(zoo)\b/i, "the zoo"],
  [/\b(aquarium)\b/i, "the aquarium"],
  [/\b(hik(?:e|es|ing)|trek(?:king)?)\b/i, "the hiking trail"],
  [/\b(bike ride|cycling|bikes)\b/i, "the bike path"],
  [/\b(swim(?:ming)?|lido)\b/i, "the lido"],
  [/\b(wine tasting|vineyard|winery)\b/i, "the vineyard"],
  [/\b(farmers'? market|flea market|market)\b/i, "the market"],
  [/\b(mini ?golf|crazy golf)\b/i, "the mini golf course"],
  [/\b(funfair|carnival|ferris wheel)\b/i, "the funfair"],
  [/\b(spa|sauna)\b/i, "the spa"],
  [/\b(boat trip|ferry)\b/i, "the ferry"],
  [/\b(lighthouse)\b/i, "the lighthouse"],
];

/** Words that only hint at a kind of place: a named place ("a walk to the observatory") wins over them. */
const HINTS: [RegExp, VenueId][] = [
  [/\b(tea)\b/i, "corner_cafe"],
  [/\b(sing|song|duet)\b/i, "karaoke_booth"],
  [/\b(games?|high score)\b/i, "retro_arcade"],
  [/\b(sea|waves)\b/i, "night_beach"],
  [/\b(walk|plants)\b/i, "botanic_park"],
  [/\b(drinks)\b/i, "rooftop_bar"],
  [/\b(dinner|tasting|courses|chef)\b/i, "tasting_menu"],
];

/** Every keyword in the order it's tried: the old PLAN_VENUES order, so a plan that named a venue before still does. */
export const PLACE_KEYWORDS: readonly [RegExp, VenueId][] = [...SPECIFIC, ...KINDS.map(([re, v]): [RegExp, VenueId] => [re, v]), ...HINTS];

/** The library venue a text names, or null (lib/relationships.ts venueForPlan reads plans with it). */
export function venueFor(text: string): VenueId | null {
  return PLACE_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** One of their homes. "mine"/"my place" is the sender's; "yours"/"your place" is the other's. A bedroom is a living room. */
const MY_HOME = /\b(?:(?:my|our) (?:place|flat|apartment|house|home|kitchen|balcony|living room|studio|loft|bedroom|room)\b|(?:back to|over to|round to|at|to) mine\b|come (?:over|round)\b(?! to (?:the|a|an|this|that)\b)|i'll cook\b|let me cook\b)/i;
const YOUR_HOME = /\b(?:your (?:place|flat|apartment|house|home|kitchen|balcony|living room|studio|loft|bedroom|room)|(?:back to|over to|round to|at|to) yours)\b/i;

/** The words a named place ends on ("the observatory", "the top of the hill", "that tiny ramen bar"). */
const PLACE_NOUNS = new Set(
  (
    "observatory planetarium gallery library bookshop bookstore market garden gardens pier harbour harbor lake river riverbank " +
    "canal bridge tower station platform cinema theatre theater studio bakery bistro brasserie trattoria pub bar café cafe " +
    "restaurant diner terrace hill hilltop forest woods trail path wing hall museum zoo aquarium rink pool lido court club stadium " +
    "field farm orchard vineyard winery brewery distillery chapel castle palace ruins island boat ferry train tram plaza " +
    "square street alley corner shop store mall spa sauna track canyon cave waterfall mountain summit cliff cliffs lighthouse " +
    "dock docks marina port lobby lounge booth stall truck stand place spot joint conservatory fair funfair carnival circus " +
    "festival concert gig opera ballet mill barn meadow valley lookout viewpoint overlook roof rooftop beach park greenhouse " +
    // 2.7.0 (#643, the 2026-10-22-0215 run): a bell founder and a cheese-cave keeper planned "the foundry" and "the caves",
    // and the second date was dealt the long walk home: the places people work and make things are places too.
    "foundry forge smithy workshop kiln cellar caves cavern grotto quarry yard boatyard shipyard boathouse " +
    "warehouse factory atelier bakehouse creamery dairy deli tavern inn taproom speakeasy teahouse tearoom " +
    "cathedral church abbey belfry clocktower windmill watermill arboretum glasshouse bandstand gazebo pavilion " +
    "promenade boardwalk esplanade seafront waterfront quay quayside wharf jetty towpath cove bay lagoon dunes " +
    "courtyard cloister maze labyrinth crypt catacombs tunnel tunnels allotment stables paddock velodrome arena auditorium"
  ).split(" "),
);
/** Place words too plain to name a place alone: "the place" is nowhere; "that little noodle place" is somewhere. */
const PLAIN_NOUNS = new Set("place spot joint corner stand stall shop store street track path field club hall court".split(" "));
/**
 * Where a named place starts: after a preposition, an "how about…", or a verb of going to see one ("visit the foundry",
 * "show you the caves": 2.7.0, #643), with an article in front of it.
 */
const NAMED = /\b(?:at|to|by|in|inside|outside|near|on|under|up|from|over|along|across|down|around|through|into|past|behind|how about|what about|fancy|try|visit|see|show you|tour|explore)\s+((?:the|a|an|that|this|some|our)\s+[^.,!?;:()"“”\n]{2,80})/gi;
/** The show stays PG: none of these is a date venue, whatever the texts say. */
// Not date venues on this PG show: a bedroom etc., and a car/van (a 2026-10-18 move put two of them in a car, where one
// said "come sit on my lap" over a revving engine). A move or plan naming one of these is dropped.
const NOT_A_VENUE = /\b(bed|beds|bedroom|bathroom|bath|shower|hotel room|motel|my room|your room|cars?|van|vehicle|back ?seat|backseat)\b/i;
const LINKISH = /https?:|www\.|@\w|\.\w{2,4}\/|\d{3,}/i;

/** A named place the text points at ("the observatory"), or null when nothing in it reads like one. */
export function namedPlace(text: string): string | null {
  for (const m of text.matchAll(NAMED)) {
    const words = m[1].trim().split(/\s+/).slice(0, 6);
    // Cut at the first place word after the article: "the observatory tomorrow and…" → "the observatory".
    const noun = (w: string) => w.toLowerCase().replace(/['’]s$/, "");
    // 2026-10-23 ("dusk under the footbridge" was planned and the date landed elsewhere): a compound that ends on a place
    // word is a place too (footbridge, boathouse, clocktower), as long as the place word is 4+ letters.
    const isPlace = (w: string) => PLACE_NOUNS.has(noun(w)) || [...PLACE_NOUNS].some((n) => n.length >= 4 && noun(w).length > n.length + 2 && noun(w).endsWith(n));
    const end = words.findIndex((w, i) => i > 0 && isPlace(w));
    if (end < 1 || (end < 2 && PLAIN_NOUNS.has(noun(words[end])))) continue;
    const label = words.slice(0, end + 1).join(" ").replace(/\s+/g, " ").trim();
    if (label.length > PLACE_LABEL_MAX || LINKISH.test(label) || NOT_A_VENUE.test(label)) continue;
    if (!checkShowText({ label }).ok) continue;
    // "the" for "a"/"an"/"some": it's the place they agreed on, not one of many.
    return label.replace(/^(a|an|some)\s+/i, "the ");
  }
  return null;
}

/**
 * Where a text points, and how strong a destination it is (lib/plans.ts agreedPlan). A real destination — one of their
 * homes, a specific venue ("the bowling alley"), or a place named with a going cue ("come to the aquarium") — is
 * `strong`. A bare kind-of-place word, which is often just logistics ("I'll bring the coffee" is not a café), is weak,
 * so a strong destination earlier in the exchange outranks it. Null when the text names nowhere.
 */
export function placeProposal(text: string, from: string, to: string): { place: PlaceId; strong: boolean } | null {
  const t = text.slice(0, 300);
  if (MY_HOME.test(t)) return { place: `home@${shortName(from)}'s place`, strong: true };
  if (YOUR_HOME.test(t)) return { place: `home@${shortName(to)}'s place`, strong: true };
  const specific = SPECIFIC.find(([re]) => re.test(t))?.[1];
  if (specific) return { place: specific, strong: true };
  const named = namedPlace(t) ?? ACTIVITIES.find(([re]) => re.test(t))?.[1];
  if (named) return { place: `elsewhere@${named}`, strong: true };
  const weak = kind(t, false) ?? kind(t, true) ?? HINTS.find(([re]) => re.test(t))?.[1];
  return weak ? { place: weak, strong: false } : null;
}

/**
 * Where a character on a date proposes moving to, from its own few words ("move": "my place", "the night market",
 * "somewhere quieter"): one of their homes, a library venue, or else the placeholder with their words for a name. Null
 * when the words can't name a place on the show (too long, a link, not PG, or filtered).
 */
export function movePlace(say: string, from: string, to: string): PlaceId | null {
  const text = say.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  if (!text || text.length > 80) return null;
  if (/^(?:mine|my (?:place|flat|apartment|house|home))$/i.test(text)) return `home@${shortName(from)}'s place`;
  if (/^(?:yours|your (?:place|flat|apartment|house|home))$/i.test(text)) return `home@${shortName(to)}'s place`;
  if (MY_HOME.test(text)) return `home@${shortName(from)}'s place`;
  if (YOUR_HOME.test(text)) return `home@${shortName(to)}'s place`;
  // "Dex Okafor's place" (a 2026-10-18 move): one of their homes by name, which waits for the end of the night like any.
  const owner = /^(.+?)['’]s (?:place|flat|apartment|house|home|kitchen|balcony)$/i.exec(text.replace(/^(?:to|at|back to)\s+/i, ""))?.[1].toLowerCase();
  if (owner) {
    const whose = [from, to].find((n) => owner === n.toLowerCase() || owner === shortName(n).toLowerCase());
    if (whose) return `home@${shortName(whose)}'s place`;
  }
  // A library venue only when it IS the place; something merely like it keeps their own words, on the placeholder.
  const known = SPECIFIC.find(([re]) => re.test(text))?.[1] ?? kind(text, false);
  if (known) return known;
  const label = text.replace(/^(?:to|at|into|over to)\s+/i, "");
  if (label.length > PLACE_LABEL_MAX || LINKISH.test(label) || NOT_A_VENUE.test(label) || !checkShowText({ label }).ok) return null;
  return `elsewhere@${label}`;
}

/**
 * Why movePlace turned these words down, in a sentence for the booker (#1108: one sentence for every cause, so a
 * 47-character place looked like a content refusal). It names the limit, never the content rules themselves.
 */
export function placeRefusedWhy(say: string): string {
  const label = say.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").replace(/^(?:to|at|into|over to)\s+/i, "");
  if (label.length > PLACE_LABEL_MAX) return `It's too long: ${PLACE_LABEL_MAX} characters at most, and yours is ${label.length}. Name the place; the details can come up on the date.`;
  if (LINKISH.test(label)) return "It looks like a link, a handle or a long number: name the place in words.";
  if (NOT_A_VENUE.test(label)) return "It names a bed, bathroom, hotel room or car: dates are filmed in public places or at one of their homes.";
  return "Its words didn't pass the show's content check: keep it PG.";
}

/**
 * Where a couple's morning-after plan points, for a second date with no agreed plan (lib/simulation.ts): a library venue
 * when the texts name one (as lib/relationships.ts venueForPlan reads them, so a plan that set a venue before still does),
 * else one of their homes or a place the library has no set for yet, the placeholder (2.7.0, #643: "the foundry" was
 * planned, and the date was dealt somewhere random), from the newest text that names one. Null when none does.
 */
export function planPlace(plans: readonly { text: string; from: string; to: string }[]): PlaceId | null {
  const library = venueFor(plans.map((p) => p.text).join(" "));
  if (library) return library;
  for (const p of [...plans].reverse()) {
    const place = placeFor(p.text, p.from, p.to);
    if (place) return place;
  }
  return null;
}

/**
 * Where a text proposes going, as a place: one of their homes, a library venue, or a place the library doesn't have
 * yet (the placeholder). `from` is the sender's name and `to` the other's, for "home@Chud's place". Null when the text
 * names nowhere in particular.
 */
export function placeFor(text: string, from: string, to: string): PlaceId | null {
  const t = text.slice(0, 300);
  if (MY_HOME.test(t)) return `home@${shortName(from)}'s place`;
  if (YOUR_HOME.test(t)) return `home@${shortName(to)}'s place`;
  const specific = SPECIFIC.find(([re]) => re.test(t))?.[1] ?? kind(t, false);
  if (specific) return specific;
  const named = namedPlace(t) ?? ACTIVITIES.find(([re]) => re.test(t))?.[1];
  if (named) return `elsewhere@${named}`;
  return kind(t, true) ?? HINTS.find(([re]) => re.test(t))?.[1] ?? null;
}
