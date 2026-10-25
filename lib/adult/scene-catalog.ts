/**
 * Every place the theater's 📍 Set the scene can take them, for its picker (David, 2026-10-25: "shows all the scenes we
 * have in a giant modal popup with filters and tags… use all the role play ideas [candy.ai's] as categories"). It holds:
 *  - the venue library (lib/venues.ts), each with its reviewed backdrop;
 *  - the scenario packs' places (lib/adult/scenarios.ts), which can also start the night as that story;
 *  - a few roleplay places the library has no set for yet (fantasy, sci-fi, mystery…): their set is drawn the first time
 *    someone goes there, like any place typed in (lib/sets.ts);
 *  - every set already drawn (place_sets, read by the page), so a place someone went to once can be picked again.
 *
 * The categories follow the roleplay genres companion apps sort scenarios by (romance and slow burn, strangers, second
 * chances, after hours, getaways, nightlife, nights in, outdoors, fantasy, sci-fi, mystery, funny), kept inside After
 * Dark's lines: two adults who both want to be there, never family, school or teacher and student (the scenario tests'
 * rules; tests/after-dark-scene-catalog.test.ts runs every label through checkAdultText). Pure and client-safe.
 */
import { venueBackdrop } from "../portraits";
import { DATE_VENUES, EXTRA_VENUES, normalizeScene, PLACE_LABEL_MAX, setPath } from "../venues";
import { SCENARIOS } from "./scenarios";

export const SCENE_CATEGORIES = [
  { id: "romance", label: "Romance & slow burn", icon: "💞" },
  { id: "strangers", label: "Strangers", icon: "🎭" },
  { id: "second", label: "Second chances", icon: "🔁" },
  { id: "afterhours", label: "After hours", icon: "💼" },
  { id: "getaway", label: "Getaways & travel", icon: "🧳" },
  { id: "nightlife", label: "Nightlife", icon: "🌃" },
  { id: "nightin", label: "Nights in", icon: "🕯️" },
  { id: "outdoors", label: "Outdoors & adventure", icon: "🌲" },
  { id: "fantasy", label: "Fantasy", icon: "🐉" },
  { id: "scifi", label: "Sci-fi", icon: "🚀" },
  { id: "mystery", label: "Mystery & thriller", icon: "🕵️" },
  { id: "funny", label: "Funny dates", icon: "😂" },
] as const;
export type SceneCategory = (typeof SCENE_CATEGORIES)[number]["id"];

export const SCENE_TAGS = ["Romantic", "Cozy", "Wild", "Luxe", "Playful", "Private", "Public", "Indoors", "Outdoors", "Night", "Water"] as const;
export type SceneTag = (typeof SCENE_TAGS)[number];

export type CatalogScene = {
  /** Unique in the catalog: `venue:<id>`, `scenario:<id>`, `idea:<n>` or `set:<normalized>`. */
  id: string;
  title: string;
  /** What set_scene is sent (60 characters at most, lib/adult/scenes.ts SET_SCENE_MAX). */
  place: string;
  /** The picture on its card: a venue's backdrop or a drawn set; null paints the card's gradient. */
  image: string | null;
  categories: SceneCategory[];
  tags: SceneTag[];
  /** A scenario pack's id: the card can start the night as that story too. */
  scenario?: string;
  premise?: string;
};

type Meta = [SceneCategory[], SceneTag[]];

/** The venue library, sorted by genre (any venue missing here still shows, under Funny dates). */
const VENUE_META: Record<string, Meta> = {
  rooftop_bar: [["romance", "nightlife"], ["Romantic", "Public", "Outdoors"]],
  corner_cafe: [["romance", "strangers"], ["Cozy", "Public", "Indoors"]],
  retro_arcade: [["funny", "nightlife"], ["Playful", "Public", "Indoors", "Night"]],
  botanic_park: [["romance", "outdoors"], ["Romantic", "Public", "Outdoors"]],
  tasting_menu: [["romance", "funny"], ["Luxe", "Public", "Indoors"]],
  night_beach: [["romance", "outdoors"], ["Romantic", "Outdoors", "Night", "Water"]],
  double_date: [["funny"], ["Playful", "Public", "Indoors"]],
  karaoke_booth: [["nightlife", "funny"], ["Playful", "Private", "Indoors", "Night"]],
  skydive: [["outdoors", "funny"], ["Wild", "Outdoors"]],
  surf_lesson: [["outdoors", "funny"], ["Playful", "Outdoors", "Water"]],
  dive_bar: [["nightlife", "strangers"], ["Playful", "Public", "Indoors", "Night"]],
  nightclub: [["nightlife", "strangers"], ["Wild", "Public", "Indoors", "Night"]],
  safari: [["getaway", "outdoors"], ["Wild", "Outdoors"]],
  escape_room: [["mystery", "funny"], ["Playful", "Private", "Indoors"]],
  flat_pack: [["funny"], ["Playful", "Public", "Indoors"]],
  pottery_class: [["romance", "funny"], ["Playful", "Indoors"]],
  hot_air_balloon: [["romance", "outdoors", "getaway"], ["Romantic", "Outdoors"]],
  bowling_alley: [["funny", "nightlife"], ["Playful", "Public", "Indoors", "Night"]],
  laundromat: [["strangers", "funny"], ["Cozy", "Public", "Indoors", "Night"]],
  ice_rink: [["funny"], ["Playful", "Public", "Indoors"]],
  cooking_class: [["funny", "nightin"], ["Playful", "Indoors"]],
  haunted_house: [["mystery", "funny"], ["Wild", "Indoors", "Night"]],
  silent_disco: [["nightlife", "funny"], ["Playful", "Public", "Outdoors", "Night"]],
  museum_night: [["mystery", "romance"], ["Public", "Indoors", "Night"]],
  rainy_campsite: [["outdoors", "nightin"], ["Cozy", "Private", "Outdoors"]],
  goat_yoga: [["funny", "outdoors"], ["Playful", "Outdoors"]],
  swan_pedalo: [["funny", "romance"], ["Playful", "Outdoors", "Water"]],
  murder_mystery: [["mystery", "funny"], ["Luxe", "Indoors", "Night"]],
  ballroom_lesson: [["romance", "funny"], ["Romantic", "Indoors"]],
  paintball: [["funny", "outdoors"], ["Wild", "Outdoors"]],
  trail_ride: [["outdoors", "getaway"], ["Outdoors"]],
  comedy_club: [["nightlife", "funny"], ["Playful", "Public", "Indoors", "Night"]],
  climbing_wall: [["outdoors", "funny"], ["Wild", "Indoors"]],
  late_night_diner: [["strangers", "nightlife"], ["Cozy", "Public", "Indoors", "Night"]],
  night_market: [["nightlife", "getaway"], ["Playful", "Public", "Outdoors", "Night"]],
  old_cinema: [["romance", "nightlife"], ["Romantic", "Indoors", "Night"]],
  stargazing_hill: [["romance", "outdoors"], ["Romantic", "Private", "Outdoors", "Night"]],
  city_walk: [["romance", "strangers"], ["Romantic", "Public", "Outdoors", "Night"]],
  pier_at_night: [["romance", "nightlife"], ["Romantic", "Outdoors", "Night", "Water"]],
  jazz_bar: [["nightlife", "romance"], ["Romantic", "Public", "Indoors", "Night"]],
  late_bookshop: [["romance", "nightin"], ["Cozy", "Indoors", "Night"]],
  home: [["nightin"], ["Cozy", "Private", "Indoors"]],
};

const SCENARIO_META: Record<string, Meta> = {
  elevator: [["strangers"], ["Private", "Indoors", "Night"]],
  "wedding-hotel": [["getaway", "romance"], ["Romantic", "Private", "Indoors", "Night"]],
  "rivals-conference": [["afterhours", "strangers"], ["Playful", "Public", "Indoors"]],
  "rainy-cabin": [["nightin", "getaway"], ["Cozy", "Private", "Indoors"]],
  "exes-party": [["second"], ["Outdoors", "Night"]],
  massage: [["afterhours"], ["Private", "Indoors"]],
  "ski-lodge": [["getaway", "nightin"], ["Cozy", "Indoors"]],
  motel: [["getaway", "strangers"], ["Private", "Indoors", "Night"]],
  blackout: [["nightin"], ["Cozy", "Private", "Indoors", "Night"]],
  "sleeper-train": [["getaway", "strangers"], ["Private", "Indoors", "Night"]],
  masquerade: [["strangers", "fantasy"], ["Luxe", "Wild", "Indoors", "Night"]],
  neighbours: [["romance"], ["Outdoors", "Night"]],
  bookshop: [["afterhours", "romance"], ["Cozy", "Indoors", "Night"]],
  "rooftop-pool": [["getaway", "nightlife"], ["Wild", "Outdoors", "Night", "Water"]],
  reunion: [["second", "romance"], ["Romantic", "Private", "Indoors"]],
  anniversary: [["second", "romance", "nightin"], ["Romantic", "Cozy", "Private", "Indoors"]],
};

/** Roleplay places with no set yet (drawn the first time, lib/sets.ts): the genres the library didn't cover. */
const IDEAS: { title: string; place: string; meta: Meta }[] = [
  { title: "The castle's candlelit chamber", place: "a candlelit castle chamber", meta: [["fantasy", "romance"], ["Romantic", "Luxe", "Private", "Indoors", "Night"]] },
  { title: "The last inn before the mountain", place: "the last inn before the mountain", meta: [["fantasy", "getaway"], ["Cozy", "Indoors", "Night"]] },
  { title: "An enchanted moonlit forest", place: "an enchanted moonlit forest", meta: [["fantasy", "outdoors"], ["Romantic", "Outdoors", "Night"]] },
  { title: "The court mage's tower", place: "the court mage's tower library", meta: [["fantasy"], ["Private", "Indoors", "Night"]] },
  { title: "A starship observation deck", place: "a starship observation deck", meta: [["scifi"], ["Romantic", "Private", "Indoors"]] },
  { title: "A neon city rooftop in the rain", place: "a neon cyberpunk rooftop in the rain", meta: [["scifi", "nightlife"], ["Wild", "Outdoors", "Night"]] },
  { title: "A space station's quiet quarters", place: "a space station's crew quarters", meta: [["scifi", "nightin"], ["Private", "Indoors"]] },
  { title: "A detective's office in the rain", place: "a detective's office on a rainy night", meta: [["mystery", "afterhours"], ["Private", "Indoors", "Night"]] },
  { title: "A speakeasy behind a bookcase", place: "a speakeasy behind a hidden bookcase", meta: [["mystery", "nightlife"], ["Luxe", "Indoors", "Night"]] },
  { title: "The casino's high-roller lounge", place: "a casino high-roller lounge", meta: [["mystery", "nightlife"], ["Luxe", "Indoors", "Night"]] },
  { title: "The office after everyone's gone", place: "the empty office after hours", meta: [["afterhours"], ["Private", "Indoors", "Night"]] },
  { title: "A recording studio at 2am", place: "a recording studio at 2am", meta: [["afterhours", "nightlife"], ["Private", "Indoors", "Night"]] },
  { title: "An art gallery after hours", place: "an art gallery after hours", meta: [["afterhours", "romance"], ["Luxe", "Indoors", "Night"]] },
  { title: "The penthouse with the view", place: "a penthouse with a city view", meta: [["getaway", "nightlife"], ["Luxe", "Private", "Indoors", "Night"]] },
  { title: "A yacht deck at sunset", place: "a yacht deck at sunset", meta: [["getaway", "romance"], ["Luxe", "Outdoors", "Water"]] },
  { title: "A private spa with a hot tub", place: "a private spa with a hot tub", meta: [["getaway", "nightin"], ["Luxe", "Private", "Indoors", "Water"]] },
  { title: "A villa terrace in Italy", place: "a villa terrace on the Amalfi coast", meta: [["getaway", "romance"], ["Romantic", "Luxe", "Outdoors"]] },
  { title: "A vineyard at dusk", place: "a vineyard at dusk", meta: [["getaway", "romance"], ["Romantic", "Outdoors"]] },
  { title: "Airport lounge, flight delayed", place: "an airport lounge with every flight delayed", meta: [["strangers", "getaway"], ["Public", "Indoors", "Night"]] },
  { title: "A greenhouse in the rain", place: "a greenhouse in the rain", meta: [["romance", "outdoors"], ["Romantic", "Private", "Indoors"]] },
  { title: "Their old favourite bar", place: "the bar where they first met", meta: [["second", "nightlife"], ["Cozy", "Public", "Indoors", "Night"]] },
  { title: "A lake house dock at night", place: "a lake house dock at night", meta: [["nightin", "outdoors"], ["Cozy", "Private", "Outdoors", "Night", "Water"]] },
];

/** Guesses a drawn set's genre from its words; anything else is a night in or out by what it says. */
const WORD_META: [RegExp, Meta][] = [
  [/bed|bedroom|bath|shower|sofa|couch|living room|kitchen|apartment|flat|home|place/, [["nightin"], ["Cozy", "Private", "Indoors"]]],
  [/hotel|motel|suite|lodge|cabin|resort|villa|train|airport|cruise/, [["getaway"], ["Private", "Indoors"]]],
  [/bar|club|lounge|pub|dance|disco|casino/, [["nightlife"], ["Public", "Indoors", "Night"]]],
  [/beach|pool|lake|sea|ocean|hot tub|jacuzzi|river/, [["outdoors"], ["Outdoors", "Water"]]],
  [/park|garden|forest|woods|hill|field|roof|balcony|terrace|street|car/, [["outdoors"], ["Outdoors"]]],
  [/office|studio|shop|store|gallery|library|museum/, [["afterhours"], ["Indoors"]]],
  [/castle|tower|dragon|tavern|enchanted/, [["fantasy"], ["Indoors"]]],
  [/ship|space|station|neon/, [["scifi"], ["Indoors"]]],
];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A library venue named by a set label (its name, or its name as a set keeps it, 40 characters), else null. */
export function libraryVenueFor(label: string | null | undefined): string | null {
  if (!label) return null;
  const n = normalizeScene(label);
  if (!n) return null;
  for (const v of [...DATE_VENUES, ...EXTRA_VENUES]) {
    if (v.id === "elsewhere") continue;
    if (normalizeScene(v.name) === n || normalizeScene(v.name.slice(0, PLACE_LABEL_MAX)) === n) return v.id;
  }
  return null;
}

/** The whole catalog: the library, the scenarios, the ideas, then the drawn sets nothing above already covers. */
export function sceneCatalog(drawn: readonly string[] = []): CatalogScene[] {
  const out: CatalogScene[] = [];
  const seen = new Set<string>();
  const add = (s: CatalogScene) => {
    const key = normalizeScene(s.place);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const s of SCENARIOS) {
    const [categories, tags] = SCENARIO_META[s.id] ?? [["romance"], []];
    add({ id: `scenario:${s.id}`, title: s.title, place: s.place, image: setPath(s.place), categories, tags, scenario: s.id, premise: s.premise });
  }
  for (const v of [...DATE_VENUES, ...EXTRA_VENUES]) {
    if (v.id === "elsewhere") continue;
    const [categories, tags] = VENUE_META[v.id] ?? [["funny"], []];
    add({ id: `venue:${v.id}`, title: v.id === "home" ? "One of their places" : v.name, place: v.name, image: venueBackdrop(v.id), categories, tags });
  }
  IDEAS.forEach((i, n) => add({ id: `idea:${n}`, title: i.title, place: i.place, image: setPath(i.place), categories: i.meta[0], tags: i.meta[1] }));
  for (const label of drawn) {
    const words = label.toLowerCase();
    const [categories, tags] = WORD_META.find(([re]) => re.test(words))?.[1] ?? [["romance"], []];
    add({ id: `set:${normalizeScene(label)}`, title: titleCase(label), place: label, image: setPath(label), categories, tags });
  }
  return out;
}

/** The cards a filter leaves: a category (or all), every picked tag, and words in the title, place or premise. */
export function filterScenes(scenes: readonly CatalogScene[], f: { category?: SceneCategory | null; tags?: readonly SceneTag[]; query?: string }): CatalogScene[] {
  const q = (f.query ?? "").trim().toLowerCase();
  return scenes.filter(
    (s) =>
      (!f.category || s.categories.includes(f.category)) &&
      (f.tags ?? []).every((t) => s.tags.includes(t)) &&
      (!q || `${s.title} ${s.place} ${s.premise ?? ""}`.toLowerCase().includes(q)),
  );
}
