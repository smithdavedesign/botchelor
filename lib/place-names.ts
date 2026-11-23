/**
 * The place name generator (app/tools/place-name-generator): names for the places in a story, by style and kind.
 *
 * Pure and deterministic, like the OC name generator (lib/oc-names.ts): no model, no randomness, no database. A style,
 * a kind and a batch number always give the same twelve places, so every page is a link anyone can share.
 *
 * The styles are the OC name generator's (fantasy, modern, sci-fi, gothic, cozy), so a character and their hometown
 * can come from the same shelf. Each style has four kinds of place: towns (where someone is from), wilds (forests,
 * rivers, moors, nebulae), realms (kingdoms, districts, estates, shires) and venues (inns, cafés, cantinas). A place is
 * a template ("the {adj} {feature}") filled from hand-picked lists, and fantasy and sci-fi also build names from
 * syllables. Every name goes through the show's content filter (lib/safety.ts) and a refused one is dropped.
 *
 * Added 2026-11-23 for the worldbuilding lists: grades2018/awesome-worldbuilding-lore-tools turned down the ship name
 * generator as off-topic and asked for "a generator for places, languages, or setting-specific names".
 */
import { OC_NAME_STYLES, seeded, type OcNameStyle } from "./oc-name-pools";
import { checkFields } from "./safety";

export const PLACE_NAMES_PATH = "/tools/place-name-generator";
/** How many places one page shows. */
export const PLACE_NAMES_SHOWN = 12;
/** The highest batch an address takes; past it the batch number wraps around. */
export const PLACE_NAMES_MAX_BATCH = 999;

export const PLACE_STYLES = OC_NAME_STYLES;
export type PlaceStyle = OcNameStyle;
export const PLACE_KINDS = ["any", "town", "wild", "realm", "venue"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
type DrawnKind = Exclude<PlaceKind, "any">;
const DRAWN_KINDS: readonly DrawnKind[] = ["town", "wild", "realm", "venue"];

export type PlaceName = {
  name: string;
  style: PlaceStyle;
  kind: DrawnKind;
  /** What the place is, in a word or two: "market town", "forest", "kingdom", "tavern". */
  what: string;
};

export const PLACE_STYLE_INFO: Record<PlaceStyle, { label: string; title: string; blurb: string }> = {
  fantasy: {
    label: "Fantasy",
    title: "Fantasy place name generator",
    blurb: "Towns, forests, kingdoms and taverns for a fantasy world: names that sound old, and like someone has walked there.",
  },
  modern: {
    label: "Modern",
    title: "Modern town name generator",
    blurb: "Towns, lakes, neighbourhoods and cafés you'd believe on a road sign or a map app, for stories set now.",
  },
  scifi: {
    label: "Sci-fi",
    title: "Sci-fi planet and station name generator",
    blurb: "Colonies, stations, nebulae, star empires and cantinas: names for a crew's next stop and the long way between.",
  },
  gothic: {
    label: "Gothic",
    title: "Gothic place name generator",
    blurb: "Villages under fog, moors, manors and public houses: places with a bell nobody rings and a gate that sticks.",
  },
  cozy: {
    label: "Cozy",
    title: "Cozy village name generator",
    blurb: "Villages, meadows, shires and tea rooms for a small-town story: places with a bakery and a festival every month.",
  },
};

export const PLACE_KIND_LABELS: Record<PlaceKind, string> = { any: "Any", town: "Towns", wild: "Wilds", realm: "Realms", venue: "Inns & cafés" };

/** A template: words in braces come from the style's lists ({N} is a name built from syllables), `what` says what the place is. */
type Template = { pattern: string; what: readonly string[] };
type StylePool = { lists: Record<string, readonly string[]>; syllables?: { start: readonly string[]; mid: readonly string[]; end: readonly string[] }; kinds: Record<DrawnKind, readonly Template[]> };

const POOLS: Record<PlaceStyle, StylePool> = {
  fantasy: {
    syllables: {
      start: ["Ae", "Bel", "Cor", "Dra", "El", "Fal", "Gor", "Is", "Kar", "Lyr", "Mal", "Nym", "Or", "Per", "Quel", "Rha", "Sar", "Tir", "Val", "Zar", "Ith", "Myr"],
      mid: ["", "", "a", "e", "i", "o", "an", "en", "or", "il"],
      end: ["dor", "wyn", "mar", "thas", "ia", "eth", "ion", "ra", "goth", "lis", "ven", "rath", "duil", "mere"],
    },
    lists: {
      root: ["Ash", "Bryn", "Cael", "Dun", "Eld", "Fen", "Gal", "Hal", "Iron", "Kel", "Lor", "Mor", "Nor", "Oak", "Rav", "Sil", "Thal", "Ulm", "Vael", "Wyn", "Thorn", "Glen", "Stor", "Elder", "Frost", "Amber"],
      settle: ["ford", "hold", "mere", "haven", "reach", "wick", "fell", "gard", "moor", "crest", "dale", "spire", "holm", "bridge", "barrow", "stead", "watch", "keep"],
      adj: ["Whispering", "Silver", "Ember", "Hollow", "Starfall", "Gloaming", "Raven", "Sunken", "Wyrm", "Moonlit", "Ashen", "Thornveil", "Shattered", "Sleeping", "Gilded", "Weeping"],
      feature: ["Wood", "Forest", "Marches", "Peaks", "Fen", "Vale", "Wastes", "Falls", "Downs", "Mere", "Barrows", "Isles", "Steppe", "Glades"],
      realm: ["Kingdom", "Duchy", "Principality", "Free Cities", "Elven Reaches", "Holy Dominion", "Clanlands", "Empire"],
      innAdj: ["Gilded", "Drowsy", "Crooked", "Laughing", "Rusty", "Wandering", "Copper", "One-Eyed", "Silver", "Merry", "Thirsty", "Lucky", "Broken", "Bashful"],
      innNoun: ["Griffin", "Wyvern", "Stag", "Kettle", "Lantern", "Goose", "Boar", "Hound", "Mermaid", "Crown", "Owl", "Tankard", "Badger", "Basilisk"],
    },
    kinds: {
      town: [
        { pattern: "{root}{settle}", what: ["town", "village", "walled city", "market town", "port", "hill fort"] },
        { pattern: "{N}", what: ["elven city", "dwarf hold", "capital", "ruined city"] },
      ],
      wild: [
        { pattern: "the {adj} {feature}", what: ["wilderness", "frontier", "old forest", "borderland"] },
        { pattern: "Mount {N}", what: ["mountain", "volcano"] },
        { pattern: "the River {N}", what: ["river"] },
        { pattern: "Lake {N}", what: ["lake"] },
      ],
      realm: [
        { pattern: "the {realm} of {N}", what: ["realm"] },
        { pattern: "{N}", what: ["kingdom", "empire", "elven realm", "lost kingdom"] },
        { pattern: "the {N} Dominion", what: ["empire"] },
      ],
      venue: [
        { pattern: "the {innAdj} {innNoun}", what: ["tavern", "inn", "alehouse", "coaching inn"] },
        { pattern: "the {innNoun} and {innNoun}", what: ["tavern", "inn"] },
      ],
    },
  },
  modern: {
    lists: {
      root: ["Ash", "Brook", "Cedar", "Clear", "East", "Fair", "Glen", "Lake", "Maple", "Mill", "North", "Oak", "Pine", "River", "Rock", "Spring", "Stone", "West", "Willow", "Harbor", "Bay", "Elm", "Laurel", "Copper"],
      settle: ["field", "ton", "ville", "wood", "port", "dale", " Falls", " Springs", " Heights", "haven", " Crossing", " Junction", "bridge", " Point"],
      surname: ["Halloran", "Mercer", "Whitaker", "Delgado", "Lindqvist", "Okafor", "Brennan", "Castillo", "Abernathy", "Nakamura", "Kowalski", "Fairchild", "Montague", "Osei", "Varga", "Calloway"],
      ridge: ["Bluebird", "Hawk", "Granite", "Juniper", "Sycamore", "Fox", "Heron", "Cypress", "Sandstone", "Larkspur", "Driftwood", "Kingfisher"],
      wildFeature: ["Ridge", "Creek", "Point", "Bluffs", "Hollow", "Canyon", "Bay", "Narrows", "Pass", "Dunes"],
      district: ["Arts", "Garment", "Warehouse", "Old Mill", "Harbor", "Market", "Lantern", "Ironworks", "Riverside", "Printworks"],
      cafeNoun: ["Ink", "Ember", "Salt", "Honey", "Thread", "Copper", "Fern", "Smoke", "Cloud", "Bloom", "Brass", "Fig"],
      cafeAdj: ["Little", "Night", "Blue", "Second", "Corner", "Golden", "Velvet", "Lucky", "Quiet", "Last"],
      cafePlace: ["Owl", "Room", "Fox", "Kitchen", "Window", "Shelf", "Lamp", "Table", "Light", "Door"],
    },
    kinds: {
      town: [{ pattern: "{root}{settle}", what: ["small town", "suburb", "harbor town", "college town", "city", "lake town"] }],
      wild: [
        { pattern: "{ridge} {wildFeature}", what: ["state park", "trailhead", "beach", "lookout"] },
        { pattern: "Lake {surname}", what: ["lake", "reservoir"] },
        { pattern: "{surname} Island", what: ["island"] },
      ],
      realm: [
        { pattern: "the {district} District", what: ["neighbourhood", "district"] },
        { pattern: "{surname} Heights", what: ["neighbourhood"] },
        { pattern: "Old {root}", what: ["old town", "historic quarter"] },
        { pattern: "{surname} County", what: ["county"] },
      ],
      venue: [
        { pattern: "{cafeNoun} & {cafeNoun}", what: ["café", "bar", "bookshop", "wine bar", "bakery"] },
        { pattern: "the {cafeAdj} {cafePlace}", what: ["café", "cocktail bar", "diner", "record shop", "bistro"] },
      ],
    },
  },
  scifi: {
    syllables: {
      start: ["Ky", "Vex", "Ora", "Zen", "Tal", "Hex", "Nov", "Cyr", "Dax", "Ix", "Rho", "Sol", "Vy", "Kor", "Lum", "Aur", "Sef", "Tess", "Quor", "Xan"],
      mid: ["", "", "a", "e", "i", "o"],
      end: ["ara", "on", "is", "ex", "ia", "or", "una", "ix", "ane", "eth", "os", "yx", "ari", "ul"],
    },
    lists: {
      greek: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Kappa", "Sigma", "Tau", "Theta", "Omega"],
      num: ["2", "4", "7", "9", "11", "12", "17", "23", "31", "40", "52", "88"],
      roman: ["II", "III", "IV", "V", "VI", "VII", "IX", "XII"],
      earth: ["Lagos", "Kyoto", "Lisbon", "Nairobi", "Oslo", "Lima", "Mumbai", "Quebec", "Cairo", "Seoul", "Valparaíso", "Auckland"],
      adj: ["Drifting", "Crimson", "Silent", "Shattered", "Pale", "Burning", "Hollow", "Ember", "Veiled", "Cold", "Singing", "Long"],
      space: ["Nebula", "Expanse", "Belt", "Drift", "Rift", "Reach", "Shoal", "Verge", "Deep", "Corridor"],
      polity: ["Concord", "Directorate", "Compact", "Hegemony", "Union", "Collective", "Authority", "Free Worlds"],
      barNoun: ["Airlock", "Orbit", "Static", "Gravity", "Comet", "Signal", "Vacuum", "Redshift", "Ion", "Docking Bay"],
      barPlace: ["Cantina", "Noodle Bar", "Lounge", "Canteen", "Bar", "Galley", "Tea House", "Diner"],
    },
    kinds: {
      town: [
        { pattern: "{N} Station", what: ["space station", "orbital", "relay station"] },
        { pattern: "New {earth}", what: ["colony", "domed city", "terraformed city"] },
        { pattern: "Port {N}", what: ["spaceport", "trade port"] },
        { pattern: "Outpost {greek}-{num}", what: ["outpost", "mining outpost", "research base"] },
      ],
      wild: [
        { pattern: "the {adj} {space}", what: ["nebula", "asteroid field", "dead zone", "star cluster"] },
        { pattern: "{N} {roman}", what: ["ice world", "desert planet", "gas giant", "ocean moon", "jungle planet"] },
        { pattern: "{N}'s {space}", what: ["asteroid belt", "nebula"] },
      ],
      realm: [
        { pattern: "the {N} {polity}", what: ["star empire", "interstellar government", "trade bloc"] },
        { pattern: "the {N} Sector", what: ["frontier sector", "quarantine zone", "mining sector"] },
        { pattern: "the {adj} Rim", what: ["frontier", "lawless frontier"] },
      ],
      venue: [
        { pattern: "the {barNoun} {barPlace}", what: ["cantina", "station bar", "noodle stand", "lounge"] },
        { pattern: "Bay {num} {barPlace}", what: ["dockside bar", "canteen"] },
      ],
    },
  },
  gothic: {
    lists: {
      root: ["Black", "Raven", "Grey", "Mourn", "Hollow", "Crow", "Ash", "Thorn", "Wither", "Bleak", "Grave", "Dusk", "Shade", "Marrow", "Wolf", "Lich", "Cold", "Sorrow"],
      settle: ["moor", "hollow", "wick", "combe", "fell", "mere", "stead", "gate", "mire", "holt", "ridge", "bury", "ham", "cross"],
      surname: ["Blackwood", "Ashcombe", "Vane", "Ravenscroft", "Whitlock", "Mordaunt", "Thorncastle", "Greaves", "Harrowgate", "Wolcott", "Crowhurst", "Mallory", "Coldridge", "Pemberton"],
      adj: ["Weeping", "Drowned", "Silent", "Bleeding", "Hanged", "Forsaken", "Grey", "Witching", "Starless", "Shrouded", "Mourning"],
      feature: ["Moor", "Fen", "Mire", "Wood", "Tarn", "Cliffs", "Barrows", "Heath", "Marsh", "Hollow"],
      estate: ["Manor", "Hall", "Abbey", "House", "Priory", "Grange", "Asylum", "Chapel"],
      saint: ["Agatha", "Bartholomew", "Lucien", "Ursula", "Cyprian", "Margarethe", "Ambrose", "Winifred"],
      pubAdj: ["Hanged", "Black", "Weeping", "Drowned", "Last", "Crooked", "Pale", "Silent", "Lantern-Jawed", "Headless"],
      pubNoun: ["Crow", "Lantern", "Bell", "Widow", "Raven", "Candle", "Hound", "Key", "Ferryman", "Shepherd"],
    },
    kinds: {
      town: [{ pattern: "{root}{settle}", what: ["village", "fog-bound village", "market town", "fishing village", "parish"] }],
      wild: [
        { pattern: "the {adj} {feature}", what: ["moor", "marsh", "wood", "cliffs"] },
        { pattern: "{surname} {feature}", what: ["moor", "fen", "wood"] },
      ],
      realm: [
        { pattern: "{surname} {estate}", what: ["manor", "estate", "ruin", "abbey"] },
        { pattern: "the Abbey of St. {saint}", what: ["abbey", "ruined abbey"] },
        { pattern: "the Barony of {root}{settle}", what: ["barony"] },
      ],
      venue: [
        { pattern: "the {pubAdj} {pubNoun}", what: ["public house", "coaching inn", "tavern", "gin palace"] },
        { pattern: "{surname}'s Curiosities", what: ["antique shop", "bookseller"] },
      ],
    },
  },
  cozy: {
    lists: {
      root: ["Honey", "Apple", "Bramble", "Butter", "Clover", "Fern", "Hazel", "Thistle", "Puddle", "Plum", "Willow", "Bumble", "Mossy", "Lavender", "Pudding", "Bluebell", "Teacup", "Marigold"],
      settle: ["brook", "bury", "ton", "wick", "dale", "combe", "field", " Hollow", " Green", " Bottom", "-on-the-Water", " St. Giles"],
      adj: ["Buttercup", "Dandelion", "Foxglove", "Sunny", "Hedgerow", "Primrose", "Elderflower", "Mistletoe", "Honeysuckle", "Strawberry", "Gooseberry", "Bilberry", "Cowslip", "Snowdrop", "Chestnut", "Rosehip", "Bluebell", "Hazelnut"],
      wildFeature: ["Meadow", "Hill", "Wood", "Pond", "Orchard", "Common", "Beck", "Lane", "Brook", "Copse"],
      shire: ["Bramble", "Clover", "Apple", "Hazel", "Thistle", "Willow", "Fern", "Barley", "Pippin"],
      vale: ["Vale", "Valley", "Downs", "Isles", "Hundreds"],
      shopAdj: ["Little", "Sleepy", "Busy", "Toasty", "Golden", "Merry", "Crooked", "Rosy", "Snug", "Tipsy"],
      shopNoun: ["Teapot", "Kettle", "Crumpet", "Hedgehog", "Spoon", "Acorn", "Bun", "Thimble", "Hare", "Teacake", "Mitten", "Pumpkin"],
    },
    kinds: {
      town: [{ pattern: "{root}{settle}", what: ["village", "seaside village", "market town", "hamlet", "island village"] }],
      wild: [
        { pattern: "{adj} {wildFeature}", what: ["meadow", "hill", "wood", "pond", "orchard", "village green"] },
        { pattern: "{root} Cove", what: ["cove", "beach", "harbour"] },
      ],
      realm: [
        { pattern: "{shire}shire", what: ["shire", "county"] },
        { pattern: "the {adj} {vale}", what: ["valley", "isles", "downs"] },
      ],
      venue: [
        { pattern: "the {shopAdj} {shopNoun}", what: ["tea room", "bakery", "bookshop", "café", "pub", "sweet shop"] },
        { pattern: "{shopNoun} & {shopNoun}", what: ["bakery", "florist", "yarn shop"] },
      ],
    },
  },
};

const pickFrom = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];

/** A name from syllables (fantasy and sci-fi): a start, maybe a middle, an end, never three letters the same in a row. */
function syllableName(rand: () => number, s: NonNullable<StylePool["syllables"]>): string {
  for (let tries = 0; tries < 10; tries++) {
    const raw = pickFrom(rand, s.start) + pickFrom(rand, s.mid) + pickFrom(rand, s.end);
    const word = raw.charAt(0) + raw.slice(1).toLowerCase();
    if (!/(.)\1\1/i.test(word) && !/[aeiou]{3}/i.test(word)) return word;
  }
  return pickFrom(rand, s.start) + pickFrom(rand, s.end).toLowerCase();
}

/**
 * One place in a style and kind, drawn from `rand`. `roots` is how the page avoids two places from the same root word
 * (Ashford and Ashmere): the first list word the template drew.
 */
function drawPlace(rand: () => number, style: PlaceStyle, kind: DrawnKind): { place: PlaceName; root: string; template: string } {
  const pool = POOLS[style];
  const t = pickFrom(rand, pool.kinds[kind]);
  let root = "";
  // Each {key} draws on its own, so "{innNoun} and {innNoun}" can be two different words; the loop below rejects a repeat.
  const used: string[] = [];
  const name = t.pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
    const word = key === "N" && pool.syllables ? syllableName(rand, pool.syllables) : pickFrom(rand, pool.lists[key] ?? [""]);
    if (!root) root = word;
    used.push(word);
    return word;
  });
  // "Greaves's Curiosities" reads as Greaves' Curiosities.
  const cased = (name.charAt(0).toUpperCase() + name.slice(1)).replace(/s's\b/g, "s'");
  const repeat = new Set(used).size < used.length;
  return { place: { name: repeat ? "" : cased, style, kind, what: pickFrom(rand, t.what) }, root, template: `${style}|${t.pattern}` };
}

/**
 * A page of places: PLACE_NAMES_SHOWN of them, no name or root word twice, none the content filter refuses. With no
 * style the page mixes every style in turn, and with kind "any" it turns through the kinds. The same style, kind and
 * batch always give the same page.
 */
export function placeNames({ style, kind = "any", batch = 1 }: { style?: PlaceStyle | null; kind?: PlaceKind; batch?: number }): PlaceName[] {
  const rand = seeded(`place-names|${style ?? "mixed"}|${kind}|${batch}`);
  const seen = new Set<string>();
  const perTemplate = new Map<string, number>();
  const out: PlaceName[] = [];
  for (let tries = 0; out.length < PLACE_NAMES_SHOWN && tries < PLACE_NAMES_SHOWN * 30; tries++) {
    const s = style ?? PLACE_STYLES[out.length % PLACE_STYLES.length];
    const k = kind === "any" ? DRAWN_KINDS[out.length % DRAWN_KINDS.length] : kind;
    const { place, root, template } = drawPlace(rand, s, k);
    if (!place.name) continue;
    // No template more than its share of a page (five "Outpost"s in a row read like one name).
    if ((perTemplate.get(template) ?? 0) >= templateCap(s, k)) continue;
    const key = place.name.toLowerCase();
    const rootKey = `root:${s}:${root.toLowerCase()}`;
    if (seen.has(key) || seen.has(rootKey)) continue;
    if (!checkFields({ name: place.name }).ok) continue;
    seen.add(key);
    seen.add(rootKey);
    perTemplate.set(template, (perTemplate.get(template) ?? 0) + 1);
    out.push(place);
  }
  return out;
}

/** The most places one template gives a page: an even share of the page, at least four (a kind with one template fills the page). */
const templateCap = (style: PlaceStyle, kind: DrawnKind) => Math.max(4, Math.ceil(PLACE_NAMES_SHOWN / POOLS[style].kinds[kind].length));

/** A style from an address segment ("sci-fi" and "scifi" both read as sci-fi), or null. */
export function readPlaceStyle(raw: unknown): PlaceStyle | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  return (PLACE_STYLES as readonly string[]).includes(s) ? (s as PlaceStyle) : null;
}

export function readPlaceKind(raw: unknown): PlaceKind {
  return typeof raw === "string" && (PLACE_KINDS as readonly string[]).includes(raw) ? (raw as PlaceKind) : "any";
}

/** A batch number from an address: a whole number from 1 to PLACE_NAMES_MAX_BATCH, otherwise 1. */
export function readPlaceBatch(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? ((n - 1) % PLACE_NAMES_MAX_BATCH) + 1 : 1;
}

/** The address of a page of places. The plain style page is its first batch with any kind. */
export function placeNamesHref(style: PlaceStyle | null, kind: PlaceKind = "any", batch = 1): string {
  const base = style ? `${PLACE_NAMES_PATH}/${style}` : PLACE_NAMES_PATH;
  const q = new URLSearchParams();
  if (kind !== "any") q.set("kind", kind);
  if (batch !== 1) q.set("batch", String(batch));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Whether a place can be someone's hometown (a town or a realm, not a tavern or a nebula). */
export const isHometown = (p: PlaceName) => p.kind === "town" || p.kind === "realm";

/** Where "Make a character from here" goes: the builder, with the hometown already in (app/create/page.tsx reads ?hometown=). */
export function createFromPlace(name: string): string {
  return `/create?hometown=${encodeURIComponent(name)}`;
}
