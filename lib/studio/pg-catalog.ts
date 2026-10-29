/**
 * The PG Studio's menus (plan PR 3, ~/.claude/plans/allow-studio-for-after-memoized-bird.md; David, 2026-10-25: "a Studio
 * for regular characters too, with lots of features and accessories"). Pure data and the prompt it builds: nothing here
 * is After Dark's, and no option goes past dressed. Swimwear is offered only with a beach or pool place (`beach`), and
 * the picture's check (lib/adult/moderation.ts checkRating) rates it suggestive anywhere else anyway.
 *
 * Pure: the page, the API and the tests share it.
 */

export type PgOption = { id: string; label: string; words: string; /** Only at a beach or a pool (swimwear). */ beach?: true };
export type PgGroup = { id: PgGroupId; title: string; pick: "one" | "many"; max?: number; options: readonly PgOption[] };

const o = (id: string, label: string, words: string, beach?: true): PgOption => (beach ? { id, label, words, beach } : { id, label, words });

export const PG_GROUPS = [
  {
    id: "shot",
    title: "Shot",
    pick: "one",
    options: [
      o("headshot", "Profile headshot", "a profile headshot, head and shoulders, looking at the camera"),
      o("candid", "Candid", "a candid photo, caught naturally, not posing"),
      o("full", "Full-length", "a full-length photo, head to toe"),
      o("action", "Action shot", "an action shot, mid-movement"),
      o("mirror", "Mirror selfie", "a mirror selfie, phone in hand"),
      o("selfie", "Arm's-length selfie", "an arm's-length selfie"),
      o("shoulder", "Over the shoulder", "looking back over the shoulder at the camera"),
      o("laughing", "Caught laughing", "caught mid-laugh, a real unposed laugh"),
    ],
  },
  {
    id: "activity",
    title: "Doing",
    pick: "one",
    options: [
      o("coffee", "Coffee", "holding a coffee"),
      o("reading", "Reading", "reading a book"),
      o("cooking", "Cooking", "cooking at the stove"),
      o("baking", "Baking", "baking, flour on their hands"),
      o("hiking", "Hiking", "hiking on a trail"),
      o("surfing", "Surfing", "carrying a surfboard"),
      o("skiing", "Skiing", "in ski gear on the slopes"),
      o("cycling", "Cycling", "riding a bicycle"),
      o("running", "Running", "out for a run"),
      o("yoga", "Yoga", "doing a yoga pose on a mat"),
      o("gym", "The gym", "working out at the gym"),
      o("dancing", "Dancing", "dancing"),
      o("guitar", "Guitar", "playing an acoustic guitar"),
      o("piano", "Piano", "playing the piano"),
      o("painting", "Painting", "painting at an easel"),
      o("records", "Record shop", "flipping through vinyl in a record shop"),
      o("market", "Farmers market", "browsing a farmers market stall"),
      o("wine", "Wine tasting", "at a wine tasting, glass in hand"),
      o("karaoke", "Karaoke", "singing karaoke into a microphone"),
      o("boardgames", "Board games", "playing a board game"),
      o("gardening", "Gardening", "gardening, hands in the soil"),
      o("dog", "Walking a dog", "walking a friendly dog on a lead"),
      o("cat", "Holding a cat", "holding a cat"),
      o("roadtrip", "Road trip", "on a road trip, leaning on a car"),
      o("concert", "At a concert", "at a concert in the crowd"),
      o("gallery", "At a gallery", "looking at art in a gallery"),
      o("campfire", "Campfire", "sitting by a campfire"),
    ],
  },
  {
    id: "place",
    title: "Where",
    pick: "one",
    options: [
      o("cafe", "Café", "in a cosy café"),
      o("bookstore", "Bookstore", "in an old bookstore"),
      o("park", "Park", "in a green city park"),
      o("beach", "Beach", "on a sunny beach"),
      o("pool", "Pool", "by a swimming pool"),
      o("trail", "Mountain trail", "on a mountain trail with a view"),
      o("lake", "Lake", "by a calm lake"),
      o("street", "City street", "on a busy city street"),
      o("rooftop", "Rooftop bar", "at a rooftop bar"),
      o("museum", "Museum", "in a museum hall"),
      o("cinema", "Cinema", "outside an old cinema"),
      o("diner", "Diner", "in a retro diner booth"),
      o("bowling", "Bowling alley", "at a bowling alley"),
      o("arcade", "Arcade", "in a neon arcade"),
      o("ferris", "Ferris wheel", "by a ferris wheel at a fair"),
      o("garden", "Botanical garden", "in a botanical garden"),
      o("vineyard", "Vineyard", "in a vineyard"),
      o("ski_lodge", "Ski lodge", "in a ski lodge by the fire"),
      o("train", "Train window", "by a train window, scenery passing"),
      o("airport", "Airport", "in an airport terminal with a suitcase"),
      o("paris", "Paris-style street", "on a Parisian-style street with cafés"),
      o("tokyo", "Tokyo at night", "on a neon-lit Tokyo street at night"),
      o("desert", "Desert road", "on an open desert road"),
      o("cabin", "Snowy cabin", "outside a snowy cabin"),
      o("kitchen", "Home kitchen", "in a home kitchen"),
      o("living_room", "Cosy living room", "in a cosy living room"),
      o("studio_white", "Studio: white", "against a plain white studio backdrop"),
      o("studio_grey", "Studio: grey", "against a plain grey studio backdrop"),
      o("studio_colour", "Studio: colour", "against a bold single-colour studio backdrop"),
    ],
  },
  {
    id: "wardrobe",
    title: "Wearing",
    pick: "one",
    options: [
      o("casual", "Casual", "casual everyday clothes"),
      o("streetwear", "Streetwear", "streetwear"),
      o("smart", "Smart casual", "smart casual clothes"),
      o("suit", "Suit", "a tailored suit"),
      o("dress", "Dress", "a summer dress"),
      o("cocktail", "Cocktail", "a cocktail outfit"),
      o("formal", "Black tie", "formal black-tie evening wear"),
      o("athleisure", "Athleisure", "athleisure, a hoodie and joggers"),
      o("outdoorsy", "Outdoorsy", "outdoor gear and a rain jacket"),
      o("knit", "Cosy knit", "a cosy knit jumper"),
      o("denim", "Denim jacket", "a denim jacket"),
      o("leather", "Leather jacket", "a leather jacket"),
      o("trench", "Trench coat", "a trench coat"),
      o("seventies", "Vintage 70s", "vintage 1970s clothes"),
      o("grunge", "90s grunge", "90s grunge, flannel shirt"),
      o("boho", "Boho", "boho clothes"),
      o("preppy", "Preppy", "preppy clothes"),
      o("punk", "Punk", "punk clothes, studded jacket"),
      o("cottagecore", "Cottagecore", "cottagecore, a floral dress or linen shirt"),
      o("business", "Business", "business attire"),
      o("chef", "Chef's whites", "chef's whites"),
      o("scrubs", "Scrubs", "medical scrubs"),
      o("halloween", "Costume", "a playful costume, nothing revealing"),
      o("swim", "Beachwear", "modest beachwear", true),
    ],
  },
  {
    id: "accessories",
    title: "Accessories",
    pick: "many",
    max: 5,
    options: [
      o("glasses", "Glasses", "glasses"),
      o("sunglasses", "Sunglasses", "sunglasses"),
      o("watch", "Watch", "a wristwatch"),
      o("necklace", "Necklace", "a necklace"),
      o("earrings", "Earrings", "earrings"),
      o("rings", "Rings", "rings"),
      o("bracelets", "Bracelets", "bracelets"),
      o("beanie", "Beanie", "a beanie"),
      o("cap", "Baseball cap", "a baseball cap"),
      o("fedora", "Fedora", "a fedora"),
      o("sunhat", "Sun hat", "a sun hat"),
      o("beret", "Beret", "a beret"),
      o("scarf", "Scarf", "a scarf"),
      o("headphones", "Headphones", "headphones"),
      o("tote", "Tote bag", "a tote bag"),
      o("backpack", "Backpack", "a backpack"),
      o("umbrella", "Umbrella", "an umbrella"),
      o("film_camera", "Film camera", "a film camera"),
      o("cup", "Coffee cup", "a coffee cup"),
      o("book", "Book", "a book"),
      o("bouquet", "Bouquet", "a bouquet of flowers"),
      o("wine_glass", "Wine glass", "a glass of wine"),
      o("guitar_prop", "Guitar", "a guitar"),
      o("skateboard", "Skateboard", "a skateboard"),
      o("bike", "Bike", "a bicycle"),
      o("surfboard", "Surfboard", "a surfboard"),
      o("pet_dog", "A dog", "a dog beside them"),
      o("pet_cat", "A cat", "a cat beside them"),
    ],
  },
  {
    id: "hair",
    title: "Hair & grooming",
    pick: "one",
    options: [
      o("down", "Hair down", "hair down"),
      o("up", "Hair up", "hair up"),
      o("ponytail", "Ponytail", "hair in a ponytail"),
      o("braid", "Braid", "hair in a braid"),
      o("windswept", "Windswept", "windswept hair"),
      o("wet_look", "Wet look", "slicked-back wet-look hair"),
      o("hat_hair", "Under a hat", "hair tucked under a hat"),
      o("stubble", "Stubble", "light stubble"),
      o("clean_shaven", "Clean-shaven", "clean-shaven"),
      o("trimmed_beard", "Trimmed beard", "a neatly trimmed beard"),
      o("makeup_none", "No makeup", "no makeup, natural skin"),
      o("makeup_natural", "Natural makeup", "natural makeup"),
      o("bold_lip", "Bold lip", "a bold lip colour"),
      o("glam", "Glam", "glamorous evening makeup"),
    ],
  },
  {
    id: "season",
    title: "Season & weather",
    pick: "one",
    options: [
      o("blossom", "Spring blossom", "spring blossom in the air"),
      o("summer", "Summer sun", "bright summer sun"),
      o("autumn", "Autumn leaves", "autumn leaves falling"),
      o("snow", "Snow", "snow falling"),
      o("rain_neon", "Rain & neon", "rain with neon reflections"),
      o("fog", "Fog", "soft fog"),
    ],
  },
  {
    id: "light",
    title: "Light",
    pick: "one",
    options: [
      o("golden", "Golden hour", "golden-hour light"),
      o("blue", "Blue hour", "blue-hour light"),
      o("window", "Window light", "soft window light"),
      o("neon", "Neon", "neon light"),
      o("candle", "Candlelight", "warm candlelight"),
      o("flash", "Flash at night", "direct camera flash at night"),
      o("overcast", "Overcast", "soft overcast light"),
    ],
  },
  {
    id: "style",
    title: "Photo style",
    pick: "one",
    options: [
      o("phone", "Phone candid", "shot on a phone, candid"),
      o("film35", "35 mm film", "35 mm film photo, grain"),
      o("polaroid", "Polaroid", "a Polaroid photo"),
      o("disposable", "Disposable flash", "disposable-camera flash photo"),
      o("bw", "Black & white", "black-and-white photo"),
      o("editorial", "Editorial", "editorial magazine photo"),
      o("cinematic", "Cinematic", "cinematic film still"),
      o("photobooth", "Photo booth", "a photo-booth strip"),
      o("painted", "Painted portrait", "a painted portrait"),
      o("watercolour", "Watercolour", "a watercolour portrait"),
    ],
  },
  {
    id: "expression",
    title: "Expression",
    pick: "one",
    options: [
      o("smiling", "Smiling", "smiling"),
      o("laughing_x", "Laughing", "laughing"),
      o("talking", "Mid-sentence", "mid-sentence, talking"),
      o("thoughtful", "Thoughtful", "thoughtful"),
      o("playful", "Playful", "playful"),
      o("confident", "Confident", "confident"),
      o("shy", "Shy smile", "a shy smile"),
      o("surprised", "Surprised", "surprised"),
    ],
  },
  {
    id: "framing",
    title: "Framing",
    pick: "one",
    options: [
      o("close", "Close", "close framing"),
      o("medium", "Medium", "medium framing, waist up"),
      o("wide", "Wide", "wide framing with the scene around them"),
      o("above", "From above", "shot from slightly above"),
      o("below", "From below", "shot from slightly below"),
    ],
  },
] as const satisfies readonly { id: string; title: string; pick: "one" | "many"; max?: number; options: readonly PgOption[] }[];

export type PgGroupId = (typeof PG_GROUPS)[number]["id"];
export const PG_GROUP_IDS = PG_GROUPS.map((g) => g.id) as PgGroupId[];

/** The places where swimwear is PG. */
export const BEACH_PLACES: ReadonlySet<string> = new Set(["beach", "pool"]);

/** What an owner picked: one option id per single-pick group, ids for a multi-pick, and their own words. */
export type PgChoices = Partial<Record<PgGroupId, string | string[]>> & {
  /** Their own words for the whole picture (checked by checkPgPictureText). */
  custom?: string;
  /** A place of their own from their Create library (lib/studio/library.ts): its name and what it's like. */
  own_place?: { name: string; description?: string | null } | null;
};

export const PG_CUSTOM_MAX = 300;

export type PgPlan = { parts: { group: PgGroupId; words: string }[]; beach: boolean; custom: string | null; place: string | null; ownPlace: string | null };
export type PgPlanResult = { ok: true; plan: PgPlan } | { ok: false; error: string; message: string };

const groupOf = (id: string) => PG_GROUPS.find((g) => g.id === id) as PgGroup | undefined;

/** Checks the picks against the menus and returns the words for each part. Unknown ids, too many, swimwear away from water: refused. */
export function planPgShoot(choices: PgChoices): PgPlanResult {
  const parts: PgPlan["parts"] = [];
  const placeId = typeof choices.place === "string" ? choices.place : null;
  const beach = Boolean(placeId && BEACH_PLACES.has(placeId));
  for (const g of PG_GROUPS as readonly PgGroup[]) {
    const raw = choices[g.id];
    if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;
    const ids = Array.isArray(raw) ? raw : [raw];
    if (g.pick === "one" && ids.length > 1) return { ok: false, error: "too_many", message: `Pick one ${g.title.toLowerCase()}.` };
    if (g.max && ids.length > g.max) return { ok: false, error: "too_many", message: `Up to ${g.max} ${g.title.toLowerCase()}.` };
    const words: string[] = [];
    for (const id of ids) {
      const opt = g.options.find((x) => x.id === id);
      if (!opt) return { ok: false, error: "unknown_option", message: `There's no "${id}" in ${g.title}.` };
      if (opt.beach && !beach) return { ok: false, error: "beach_only", message: `${opt.label} is for a beach or a pool: pick one of those as the place.` };
      words.push(opt.words);
    }
    parts.push({ group: g.id, words: g.pick === "many" ? `with ${words.join(", ")}` : words.join(", ") });
  }
  const custom = typeof choices.custom === "string" && choices.custom.trim() ? choices.custom.trim().slice(0, PG_CUSTOM_MAX) : null;
  const own = choices.own_place?.name?.trim() ? choices.own_place : null;
  // A place of their own stands in for the menu's place (one or the other).
  if (own && placeId) return { ok: false, error: "two_places", message: "Pick one place: a menu place or one of yours." };
  const ownPlace = own ? `at ${own.name.trim().slice(0, 60)}${own.description?.trim() ? ` (${own.description.trim().slice(0, 200)})` : ""}` : null;
  return { ok: true, plan: { parts, beach, custom, place: placeId, ownPlace } };
}

/** The words the strict word check reads: every pick's, the own place's and the owner's own. */
export const planWords = (plan: PgPlan): string => [...plan.parts.map((p) => p.words), plan.ownPlace ?? "", plan.custom ?? ""].join(" ");

/** Who the picture shows, for the prompt: the noun, the age, and PG look words (never a body's). */
export type PgSubject = { noun: "man" | "woman" | "person"; age: number; look: string };

/** The fixed words that keep every picture a show picture, whatever was picked. */
/** A PG picture's tag: a group and one of its options (a shoot's picks), or what made it (`made`: shoot, identity, carousel, twin). */
export type PgTag = { kind: string; value: string };

/**
 * What a PG picture shows, as tags (the showcase's filters; David, 2026-10-29: "always tag assets on creation"): each
 * of the shoot's picks by its group (place, activity, wardrobe, shot…), never the owner's own words.
 */
export function pgTagsOf(choices: PgChoices, made: string): PgTag[] {
  const tags: PgTag[] = [{ kind: "made", value: made }];
  for (const id of PG_GROUP_IDS) {
    const v = choices[id];
    for (const x of Array.isArray(v) ? v : v ? [v] : []) if (typeof x === "string" && x) tags.push({ kind: id, value: x.slice(0, 40) });
  }
  if (choices.own_place?.name) tags.push({ kind: "place", value: "own" });
  return tags;
}

export const PG_TAIL = "Fully clothed, tasteful and everyday, safe for work. Photorealistic. Everyone shown is an adult.";

/** A PG carousel's angles (the creator suite): one picture's very moment, seen from six places a photographer walks to. */
export const PG_CAROUSEL_ANGLES = [
  "in a wide shot, the whole scene in frame",
  "from the side, at eye level",
  "in a close-up, the face and shoulders",
  "from a low angle, looking up",
  "from behind and to one side, looking back over the shoulder at the camera",
  "in a medium shot, the camera turned slightly, natural and candid",
] as const;

/** One of a PG carousel's pictures: the person (their face, when there's a portrait) at the very moment of their picture, from `angle`. */
export function pgCarouselPrompt(subject: PgSubject, hasFace: boolean, angle: string): string {
  const who = `a ${subject.age}-year-old ${subject.noun}${subject.look ? `, ${subject.look}` : ""}`;
  const lead = hasFace
    ? `A photograph of the person in the first reference picture (${who}), keeping their face exactly, at the very moment in the second reference picture.`
    : `A photograph of the person in the reference picture (${who}), at the very moment it shows.`;
  return [lead, `The same pose, clothes, place and light, seen ${angle}.`, PG_TAIL].join(" ");
}
export const PG_NEGATIVE = "child, children, kid, teen, teenager, minor, underage, young-looking, school uniform, nudity, nude, topless, lingerie, underwear, cleavage, see-through, sexual, suggestive, provocative pose";

/** The picture's prompt: the same person as the reference (when there is one), then each part, then the fixed tail. */
export function pgShootPrompt(plan: PgPlan, subject: PgSubject, hasFace: boolean): string {
  const who = `a ${subject.age}-year-old ${subject.noun}${subject.look ? `, ${subject.look}` : ""}`;
  const lead = hasFace ? `A photograph of the person in the reference picture (${who}), keeping their face exactly.` : `A photograph of ${who}.`;
  const order: PgGroupId[] = ["shot", "activity", "place", "wardrobe", "accessories", "hair", "expression", "season", "light", "framing", "style"];
  const byGroup = new Map(plan.parts.map((p) => [p.group, p.words]));
  const body = order
    .map((g) => (g === "place" && plan.ownPlace ? plan.ownPlace : byGroup.get(g)))
    .filter(Boolean)
    .map((w) => `${w!.charAt(0).toUpperCase()}${w!.slice(1)}.`)
    .join(" ");
  return [lead, body, plan.custom ? `${plan.custom.replace(/[.\s]+$/, "")}.` : "", PG_TAIL].filter(Boolean).join(" ");
}
