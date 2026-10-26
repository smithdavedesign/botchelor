/**
 * After Dark's continuity (David, 2026-10-21: "when a scene changes I always get the blurred temporary image", "they
 * moved scenes a few times unprovoked and the dialog didn't match"). Star Dust × Chud's night asked for 14 sets in 18
 * minutes ("bedroom glow", "bedroom ambiance", "bedroom's edge", "same bedroom"…), moved to a balcony, a car and "your
 * sanctuary" without anyone suggesting it, and said five lines twice. Three rules, all free and deterministic:
 *
 * 1. A set is a place, not a mood: its name is canonicalized (mood, light and filler words out, the place noun kept)
 *    and a rewording of where they already are keeps the set they're on (canonicalSet, samePlace).
 * 2. A move is provoked: it counts only when, in the lines just written, one of them proposes going somewhere and the
 *    other agrees, as on a date (lib/moves.ts), at most MAX_SCENE_MOVES a chapter, and never "my place?" once they're
 *    there (settlePlace). Anything else the model says about where they are is ignored, and logged for the observer.
 * 3. A line said before tonight isn't said again: verbatim or nearly (repeatOf), and a catchphrase once a chapter.
 *
 * Prompt v2.1 (2026-10-21, Cass Vega × Chud on prod): Cass proposed "a torch-lit balcony", Chud said "Lead the way", line
 * 17 was "*leads him out of the restaurant*", and the model's place and set said "restaurant" for all sixteen steps while
 * it went on to undressing. A move the lines show (a proposal, a yes, and them going: shownMove) now counts even when the
 * model's place doesn't change, and a public place (isPublicPlace) is where nothing goes past kissing.
 */
import { agrees, saysNo } from "../plans";

/** Moves a chapter can have (a date has lib/rules.ts MAX_MOVES; a chapter of a night is about as long). */
export const MAX_SCENE_MOVES = 2;
/** How far after a proposal the other's yes may come (a date's is the very next line; a scene has actions between). */
const AGREE_REACH = 4;
/** A proposal in the last lines before these still counts, when the yes is in these. */
const PROPOSAL_LOOKBACK = 2;

// ---------------------------------------------------------------------------------------------------------------------
// 1. Canonical sets
// ---------------------------------------------------------------------------------------------------------------------

/** Two-word places, read before single words ("living room" isn't a room, "back seat" is the car). */
const COMPOUNDS: Record<string, string> = {
  "living room": "living room",
  "living space": "living room",
  "sitting room": "living room",
  "family room": "living room",
  "dining room": "dining room",
  "master bedroom": "bedroom",
  "guest room": "bedroom",
  "spare room": "bedroom",
  "hotel room": "hotel room",
  "hotel suite": "hotel room",
  "motel room": "hotel room",
  "back seat": "car",
  "car park": "parking lot",
  "parking lot": "parking lot",
  "parking garage": "garage",
  "coffee shop": "cafe",
  "hot tub": "hot tub",
  "dance floor": "dance floor",
  "bowling alley": "bowling alley",
  "kitchen counter": "kitchen",
  "kitchen table": "kitchen",
  "front door": "hallway",
  "car door": "car",
  "rooftop bar": "rooftop bar",
  "night market": "night market",
};

/** One word that names a place, and the place it is ("bed" is the bedroom, "flat" is home). */
const SYNONYMS: Record<string, string> = {
  bedroom: "bedroom", bed: "bedroom", bedside: "bedroom", bedchamber: "bedroom", boudoir: "bedroom", mattress: "bedroom", sheets: "bedroom",
  lounge: "living room", den: "living room", couch: "living room", sofa: "living room", settee: "living room", fireplace: "living room",
  kitchen: "kitchen", kitchenette: "kitchen", countertop: "kitchen",
  bathroom: "bathroom", shower: "bathroom", bath: "bathroom", bathtub: "bathroom", tub: "bathroom", restroom: "bathroom", washroom: "bathroom",
  hallway: "hallway", hall: "hallway", corridor: "hallway", entryway: "hallway", entrance: "hallway", foyer: "hallway", doorway: "hallway", door: "hallway", vestibule: "hallway", threshold: "hallway", stairwell: "hallway", staircase: "hallway", stairs: "hallway",
  balcony: "balcony", terrace: "balcony", patio: "balcony", veranda: "balcony", verandah: "balcony",
  elevator: "elevator", lift: "elevator",
  car: "car", cab: "car", taxi: "car", uber: "car", backseat: "car", limo: "car", limousine: "car",
  home: "home", apartment: "home", flat: "home", place: "home", house: "home", pad: "home", loft: "home", condo: "home", penthouse: "home", townhouse: "home", mansion: "home", sanctuary: "home",
  suite: "hotel room", hotel: "hotel", motel: "hotel", lobby: "lobby",
  rooftop: "rooftop", roof: "rooftop", pool: "pool", poolside: "pool", jacuzzi: "hot tub", sauna: "sauna", spa: "spa",
  bar: "bar", pub: "bar", tavern: "bar", club: "club", nightclub: "club", cafe: "cafe", café: "cafe", coffeeshop: "cafe", diner: "diner", restaurant: "restaurant", bistro: "restaurant",
  street: "street", sidewalk: "street", road: "street", alley: "alley", alleyway: "alley", park: "park", beach: "beach", shore: "beach", garden: "garden", yard: "yard", backyard: "yard", porch: "porch",
  office: "office", library: "library", gym: "gym", cinema: "cinema", theater: "theater", theatre: "theater", museum: "museum", gallery: "gallery", studio: "studio",
  cabin: "cabin", tent: "tent", boat: "boat", yacht: "boat", lake: "lake", forest: "forest", woods: "forest", field: "field", meadow: "field", garage: "garage", arcade: "arcade", observatory: "observatory", closet: "closet", basement: "basement", attic: "attic",
};

/** The places a set can be: what a move has to go to (a rug, a wall or "the swing" is somewhere in the room). */
export const KNOWN_PLACES: ReadonlySet<string> = new Set([...Object.values(COMPOUNDS), ...Object.values(SYNONYMS)]);

/** Rooms you walk into from a front door: arriving at someone's home is being in these. */
const ARRIVAL_ROOMS = new Set(["home", "living room", "hallway"]);

/**
 * Words that describe a place's mood, light, time or state, or point at it, never which place it is (David,
 * 2026-10-21: "glow", "ambiance", "atmosphere", "buzzing", "edge", "dimly lit", "same", "their", "passionate"…).
 */
const FILLER = new Set(
  (
    "the a an that this these those some our their his her my your its same other another whole very more most rather quite " +
    "glow glowing glows ambiance ambience atmosphere atmospheric buzzing buzz humming edge edges dim dimly lit light lights lighting lamplit candlelit candlelight candle candles moonlit moonlight sunlit " +
    "soft warm warmth cozy cosy comfy comfortable intimate private passionate romantic sensual steamy sultry quiet secluded hidden darkened dark darkness shadowy shadows hazy dreamy " +
    "messy tangled rumpled heated hot sweaty luxurious luxury plush lavish elegant fancy cramped tiny small little big large huge spacious grand celestial magical mysterious " +
    "playtime environment setting space spot area corner middle center centre side vibe vibes mood scene interior surroundings confines privacy " +
    "moment night nights evening midnight morning late dusk dawn sunset golden hour tonight now still again back new old own nearby just only " +
    "one two three four five six seven eight nine ten eleven twelve somewhere place's love sexy naughty wild"
  ).split(/\s+/),
);
/** "place" names home only on its own or with an owner ("Chud's place"); "a private place" is just somewhere. */
const VAGUE_ALONE = new Set(["place"]);

/** Words that start a phrase about another thing ("swing in the yard", "middle of bed", "where their date was"). */
const SPLITTERS = new Set("in at on by near with under beside inside outside of against behind beneath toward towards from into onto around across for where while during after before".split(" "));

export type CanonicalSet = {
  /** The place, as a short name with its mood taken out ("bedroom", "rooftop pool", "hotel hallway"); "" when nothing's left. */
  canonical: string;
  /** The place noun it comes down to ("bedroom"); null when it names no place. */
  head: string | null;
  /** Whether the head is a place a set can be (KNOWN_PLACES). */
  known: boolean;
  /** Whose it is, when the name says ("chud" for "Chud's living room"). */
  owner: string | null;
};

const words = (label: string): string[] =>
  label
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** A set's name as the place it is: "bedroom glow" and "the cozy bedroom" are both "bedroom". */
export function canonicalSet(label: string | null | undefined): CanonicalSet {
  const all = words(label ?? "");
  let owner: string | null = null;
  const kept: string[] = [];
  for (const w of all) {
    const poss = /^(.+?)'s?$/.exec(w);
    if (poss && w.includes("'")) {
      // "bedroom's edge" is the bedroom; "Chud's" is whose it is.
      if (SYNONYMS[poss[1]] || FILLER.has(poss[1])) kept.push(poss[1]);
      else owner ??= poss[1];
      continue;
    }
    kept.push(w);
  }
  const possessive = Boolean(owner) || all.some((w) => /^(my|his|her|your|their|our)$/.test(w));
  // Split into phrases at prepositions; the first phrase with a place in it names the set.
  const phrases: string[][] = [[]];
  for (const w of kept) {
    if (SPLITTERS.has(w)) phrases.push([]);
    else phrases[phrases.length - 1].push(w);
  }
  const cleaned = phrases.map((p) => {
    const joined = p.join(" ");
    const compound = Object.keys(COMPOUNDS).find((c) => joined.includes(c));
    // A compound stays whole ("living space" would lose "space" to the filler).
    const ws = compound ? joined.replace(compound, compound.replace(" ", "_")).split(" ") : p;
    return ws.filter((w) => !FILLER.has(w)).filter((w) => !(VAGUE_ALONE.has(w) && !possessive));
  });
  const headOf = (ws: string[]): { at: number; head: string } | null => {
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = ws[i];
      if (w.includes("_")) return { at: i, head: COMPOUNDS[w.replace("_", " ")] };
      if (SYNONYMS[w]) return { at: i, head: SYNONYMS[w] };
    }
    return null;
  };
  for (const ws of cleaned) {
    const h = headOf(ws);
    if (!h) continue;
    const mods = ws.slice(0, h.at).filter((w) => !SYNONYMS[w] || SYNONYMS[w] === h.head || KNOWN_PLACES.has(w));
    // "hotel hallway", "rooftop pool": a modifier that is itself a place stays; anything else is description.
    const placeMods = mods.filter((w) => KNOWN_PLACES.has(SYNONYMS[w] ?? w) && (SYNONYMS[w] ?? w) !== h.head);
    return { canonical: [...placeMods, h.head].join(" "), head: h.head, known: true, owner };
  }
  const first = cleaned.find((ws) => ws.length);
  if (!first) return { canonical: "", head: null, known: false, owner };
  const last = first[first.length - 1].replace("_", " ");
  return { canonical: first.join(" ").replace(/_/g, " "), head: last, known: false, owner };
}

/** The last place a piece of text names ("*carries her toward the door*" → hallway), as its head; null for none. */
export function placeIn(text: string): string | null {
  const ws = words(text).map((w) => w.replace(/'s$/, ""));
  let found: string | null = null;
  for (let i = 0; i < ws.length; i++) {
    const two = i + 1 < ws.length ? `${ws[i]} ${ws[i + 1]}` : "";
    if (two && COMPOUNDS[two]) {
      found = COMPOUNDS[two];
      i++;
    } else if (SYNONYMS[ws[i]] && !VAGUE_ALONE.has(ws[i])) found = SYNONYMS[ws[i]];
  }
  return found;
}

/** Every place a piece of text names, in order, as heads ("leaves the restaurant for the balcony" → restaurant, balcony). */
export function placesIn(text: string): string[] {
  const ws = words(text).map((w) => w.replace(/'s$/, ""));
  const out: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const two = i + 1 < ws.length ? `${ws[i]} ${ws[i + 1]}` : "";
    if (two && COMPOUNDS[two]) {
      out.push(COMPOUNDS[two]);
      i++;
    } else if (SYNONYMS[ws[i]] && !VAGUE_ALONE.has(ws[i])) out.push(SYNONYMS[ws[i]]);
  }
  return out;
}

/** Rooms of a home: being in one is still being at their place. */
export const HOME_ROOMS: ReadonlySet<string> = new Set(["home", "bedroom", "living room", "kitchen", "bathroom", "hallway", "balcony", "dining room", "closet"]);

/** Places other people are (David, 2026-10-18: "at a cafe… not the right scenario"): past kissing means leaving first. */
const PUBLIC_PLACES: ReadonlySet<string> = new Set([
  "bar", "club", "cafe", "diner", "restaurant", "street", "alley", "park", "beach", "rooftop bar", "dance floor", "bowling alley", "night market",
  "lobby", "hotel", "parking lot", "library", "gym", "cinema", "theater", "museum", "gallery", "arcade", "observatory", "elevator",
]);
/** Outdoor spots that are public unless they're at one of their homes (a restaurant's terrace, not her balcony). */
const PUBLIC_UNLESS_HOME: ReadonlySet<string> = new Set(["balcony", "rooftop", "pool", "garden", "yard", "porch", "field", "forest", "lake"]);

/** Whether where they are is public (other people around): a bar, a restaurant, the street, a venue; a terrace away from home. */
export function isPublicPlace(label: string | null | undefined, homeNow: "a" | "b" | null = null): boolean {
  const c = canonicalSet(label);
  if (!c.head || !c.known) return false;
  if (PUBLIC_PLACES.has(c.canonical) || PUBLIC_PLACES.has(c.head)) return true;
  return PUBLIC_UNLESS_HOME.has(c.head) && !homeNow && !c.owner;
}

/** Whether two names are the same place: the same place noun (and nobody else's), or arriving at a home and its front rooms. */
export function samePlace(x: string | null | undefined, y: string | null | undefined): boolean {
  const a = canonicalSet(x);
  const b = canonicalSet(y);
  if (!a.head || !b.head) return false;
  if (a.owner && b.owner && a.owner !== b.owner) return false;
  if (a.head === b.head) return true;
  return ARRIVAL_ROOMS.has(a.head) && ARRIVAL_ROOMS.has(b.head);
}

/**
 * The closest ready set for a place among the sets already drawn: the same canonical name first, then the same place
 * noun with the most words in common, then the shortest name. Null when none is the same place. v2.2 (Lexi × Dex,
 * 2026-10-22): whose it is counts, both ways, so "Lexi's bedroom" keeps its name instead of becoming "the cozy bedroom",
 * and an unowned "bedroom glow" never lands in Lexi's.
 */
export function closestSet(label: string, ready: readonly string[]): string | null {
  const want = canonicalSet(label);
  if (!want.head || !want.known) return null;
  const wantWords = new Set(want.canonical.split(" "));
  const said = new Set(words(label));
  const scored = ready
    .map((r) => ({ r, c: canonicalSet(r) }))
    .filter(({ c }) => c.known && c.head === want.head && c.owner === want.owner)
    .map(({ r, c }) => ({
      r,
      exact: c.canonical === want.canonical ? 1 : 0,
      overlap: c.canonical.split(" ").filter((w) => wantWords.has(w)).length,
      plain: c.canonical === c.head ? 1 : 0,
      // Then the one that shares most of the words as written ("cozy bedroom glow" → "cozy bedroom").
      echo: words(r).filter((w) => said.has(w)).length,
    }))
    .sort((p, q) => q.exact - p.exact || q.overlap - p.overlap || q.plain - p.plain || q.echo - p.echo || p.r.length - q.r.length || p.r.localeCompare(q.r));
  return scored[0]?.r ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Provoked moves
// ---------------------------------------------------------------------------------------------------------------------

export type PlaceLine = { who: "a" | "b"; text: string };

/** Going somewhere, as a suggestion or a lead ("let's", "shall we", "follow me", "*leads her to the bedroom*"). */
const GO =
  /\b(let's|lets|let us|shall we|should we|how about|what about|wanna|want to|come with me|follow me|take me|take you|lead (?:me|us|the way)|get out of here|get you (?:home|upstairs|inside|back)|go (?:inside|upstairs|downstairs|home|back|somewhere|to)|head (?:inside|upstairs|home|back|to|for)|move this|take this|continue this|leads? (?:him|her|them) (?:to|toward|towards|into|inside|upstairs|out)|pulls? (?:him|her|them) (?:toward|towards|into|inside|out)|tugs? (?:him|her|them) (?:toward|towards|into))\b/i;
/** Somewhere to go: a place word, or a direction. */
const WHERE =
  /\b(my place|your place|mine|yours|home|inside|upstairs|downstairs|elsewhere|somewhere|out of here|private|bedroom|bed|room|car|cab|taxi|balcony|terrace|shower|bath|kitchen|couch|sofa|hotel|door|outside|roof|rooftop|pool|hallway|elevator|lift)\b/i;
const NOT_GOING = /\b(let's not|lets not|stay(?:ing)? (?:here|put|right here)|not going anywhere)\b/i;
/** One of their homes, said by the one whose home it is (the same words as a date's move, lib/places.ts). */
const MY_HOME = /\b(?:(?:my|our) (?:place|flat|apartment|house|home|bedroom|room|pad)\b|(?:back to|over to|round to|to) mine\b|come (?:over|round|back to mine)\b)/i;
const YOUR_HOME = /\b(?:your (?:place|flat|apartment|house|home|bedroom|room|pad)|(?:back to|over to|round to|to) yours)\b/i;
/** Going along with it, in a scene's terms: a nod, following, "lead the way". A refusal always overrides. */
const SCENE_YES =
  /\b(nods?|nodding|follows?|following|you're right|youre right|lead the way|take me|show me|please|god,? yes|mm+-?h?m+|mhm|lets? (?:him|her) lead|doesn't resist|after you|right behind you|let's go|lets go|i'm yours|gladly|happily|can't wait|cant wait|(?:saunters?|heads?|walks?|moves?) (?:toward|towards|for|to) the door|takes? (?:his|her) hand)\b/i;

/** The sentence a cue is in, so "shall we…?" only counts when it's the one with the place in it. */
const sentences = (text: string): string[] => text.split(/(?<=[.!?*])\s+/).filter(Boolean);

/** Whether a line suggests going somewhere: a lead plus a place, or a question naming one ("My place, perhaps?"). */
export function proposesMove(text: string): boolean {
  if (NOT_GOING.test(text)) return false;
  return sentences(text).some((s) => NEARBY.test(s) || ((WHERE.test(s) || PLACE_WORD.test(s)) && (GO.test(s) || /\?\s*$/.test(s.trim()))));
}
/** Any place a set can be, named in a sentence (SYNONYMS): "the bakery", "his workshop". */
const PLACE_WORD = new RegExp(`\\b(?:${Object.keys(SYNONYMS).join("|")})\\b`, "i");
/**
 * An invitation said as how close somewhere is: "The bakery is ten minutes from here", "my place is just around the
 * corner" (Star × Rafe, 2026-10-25: no "let's", no question mark, and "Lead the way" agreed to it).
 */
const NEARBY = /\b(?:is|it's|its|are)\s+(?:only\s+|just\s+|right\s+)?(?:(?:\w+\s+){0,2}(?:minutes?|blocks?)\s+(?:from here|away)|a (?:short )?walk(?: away)?|around the corner|round the corner|down the (?:street|road|block)|nearby|close by|not far)\b/i;

/** Whether a line goes along with a suggestion to move: a yes, a nod, following. Never a no. */
export function agreesToMove(text: string): boolean {
  return !saysNo(text) && !NOT_GOING.test(text) && (agrees(text) || SCENE_YES.test(text));
}

/** Whose home a proposal means: "my place" is the speaker's, "your place" the other's; null for anywhere else. */
export function homeProposed(text: string, who: "a" | "b"): "a" | "b" | null {
  if (MY_HOME.test(text)) return who;
  if (YOUR_HOME.test(text)) return who === "a" ? "b" : "a";
  return null;
}

export type AgreedMove = { proposal: number; agree: number; by: "a" | "b"; home: "a" | "b" | null };

/**
 * The move agreed in the lines from `from` on: one proposes (in these lines or the PROPOSAL_LOOKBACK before them) and
 * the other agrees within AGREE_REACH lines, in these. The latest agreed one wins; null when there's none.
 */
export function agreedMove(lines: readonly PlaceLine[], from: number): AgreedMove | null {
  let found: AgreedMove | null = null;
  for (let i = Math.max(0, from - PROPOSAL_LOOKBACK); i < lines.length; i++) {
    if (!proposesMove(lines[i].text)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + AGREE_REACH); j++) {
      if (lines[j].who === lines[i].who) continue;
      if (j >= from && agreesToMove(lines[j].text)) {
        found = { proposal: i, agree: j, by: lines[i].who, home: homeProposed(lines[i].text, lines[i].who) };
        break;
      }
    }
  }
  return found;
}

/** How long an agreed move, or an invitation home, stays good while they get there: a walk, a kiss on the way, the stairs. */
const PENDING_REACH = 60;
/** Turning an invitation down: a reply that opens with it ("No.", "Not tonight"), not any "I can't" in passing. */
const DECLINES = /^\s*(?:\*[^*]*\*\s*)?(?:no\b|nope|nah|not tonight|not yet|not this time|maybe not|another time|i'd rather not|i'll pass|rain ?check)/i;

/**
 * Where they agreed to go, earlier tonight, now that they're arriving: an agreed move (agreedMove) in the last
 * PENDING_REACH lines, or the latest invitation to the speaker's own home there ("My place has party lighting. Yes or
 * no?", "My place has no corners") that nobody turned down. Only for where it was: that home (any room of it), or a
 * place the proposal names. The model simulation (2026-10-22): the pair agreed in the bookshop and arrived steps
 * later, past AGREE_REACH (and in words agreedMove doesn't read as a proposal), so every arrival was refused and the
 * night looped on the street, held at kissing by the public cap.
 */
export function pendingMove(lines: readonly PlaceLine[], from: number, claim: string, names: { a: string; b: string }): AgreedMove | null {
  const want = canonicalSet(claim);
  const homeish = want.canonical === "home" || HOME_ROOMS.has(want.canonical) || (want.head !== null && HOME_ROOMS.has(want.head));
  const owner = homeFromOwner(want, names);
  const fits = (home: "a" | "b" | null, proposal: string) => (home ? homeish && (!owner || owner === home) : placesIn(proposal).some((p) => samePlace(p, claim)));
  const start = Math.max(0, from - PENDING_REACH);
  const agreed = agreedMove(lines, start);
  if (agreed && agreed.agree < from && fits(agreed.home, lines[agreed.proposal].text)) return agreed;
  for (let i = from - 1; i >= start; i--) {
    const l = lines[i];
    if (!MY_HOME.test(l.text) || NOT_GOING.test(l.text)) continue;
    const turnedDown = lines.slice(i + 1, i + 1 + AGREE_REACH).some((r) => r.who !== l.who && DECLINES.test(r.text));
    return !turnedDown && fits(l.who, l.text) ? { proposal: i, agree: i, by: l.who, home: l.who } : null;
  }
  return null;
}

/** Them going, in what a line does: heading somewhere, out of a place, through a door, arriving ("*leads him out of the restaurant*"). */
const GOING = new RegExp(
  [
    String.raw`\b(?:leads?|leading|led|walks?|walking|walked|heads?|heading|headed|steps?|stepping|stepped|slips?|slipping|slipped|hurr(?:y|ies|ied|ying)|guides?|guiding|guided|ushers?|ushering|ushered|carr(?:y|ies|ied|ying)|(?:makes?|made|making) (?:their|our|his|her|the) way)\b[^*.!?]{0,40}?\b(?:out|outside|away|through|toward|towards|into the|onto the|to the|inside|upstairs|downstairs|home|across)\b`,
    String.raw`\b(?:pulls?|pulling|pulled|tugs?|tugging|tugged|drags?|dragging|dragged)\b[^*.!?]{0,30}?\b(?:out|outside|along|through|toward the|towards the)\b`,
    String.raw`\b(?:arriv\w*|enters?|entering|entered|exits?|exiting|exited|climbs? into|gets? into|unlocks? (?:the|his|her|their) (?:front )?door|out (?:of|into|onto) the|into the night)\b`,
  ].join("|"),
  "i",
);
/** Arriving, out loud: "Come on in", "Welcome to my place". */
const ARRIVING = /\b(?:come (?:on )?in\b|step inside|welcome to my|we're here)/i;
/** Leaving with nowhere named: out of here, outside, into the night. */
const OUT = /\b(?:out of (?:here|the)|get out|outside|into the night|out into)\b/i;
const actionsOf = (text: string) => (text.match(/\*[^*]+\*/g) ?? []).join(" ");

export type ShownMove = { proposal: number; agree: number; at: number; to: string; home: "a" | "b" | null };

/**
 * A move the lines show, whatever the model's place says (Cass × Chud, 2026-10-21: "Lead the way", "*leads him out of the
 * restaurant*", and "restaurant" for sixteen steps): one proposes going somewhere, the other agrees (agreedMove; the yes
 * may be in the last AGREE_REACH lines before `from`), and a line from the yes on, in these lines, shows them going or
 * arriving. Where to: the home proposed ("Sable's place"), else a place the proposal names, else one the going names,
 * else outside ("the street") when they just left. `at` is the line that moved them: the yes, or the going when the yes
 * came before these lines. Null when the lines show no move, or none away from `here`.
 */
export function shownMove(lines: readonly PlaceLine[], from: number, here: string | null, names: { a: string; b: string }): ShownMove | null {
  const move = agreedMove(lines, Math.max(0, from - AGREE_REACH));
  if (!move) return null;
  const going = lines.findIndex((l, i) => i >= Math.max(move.agree, from) && (GOING.test(actionsOf(l.text)) || ARRIVING.test(l.text)));
  if (going < 0) return null;
  const away = (p: string) => !here || !samePlace(here, p);
  const proposal = lines[move.proposal];
  const to =
    (move.home ? `${names[move.home].split(/\s+/)[0]}'s place` : null) ??
    placesIn(proposal.text).find(away) ??
    lines.slice(move.agree, going + 1).flatMap((l) => placesIn(actionsOf(l.text))).find(away) ??
    (OUT.test(proposal.text) || OUT.test(actionsOf(lines[going].text)) ? "the street" : null);
  if (!to || !away(to)) return null;
  return { proposal: move.proposal, agree: move.agree, at: move.agree >= from ? move.agree : going, to, home: move.home ?? homeFromOwner(canonicalSet(to), names) };
}

/** One stop in a night: where they were, the set it was on, whose home it is (when it's one), and the chapter. */
export type PlaceStop = { place: string; set: string | null; home: "a" | "b" | null; chapter: number };
/** A move the model reported, and whether it was taken (the observer reads the ones that weren't). */
export type MoveLog = { chapter: number; at: number; from: string | null; to: string; taken: boolean; reason: "agreed" | "no_agreement" | "cap" | "already_there" | "set_scene" | "plan" };

/**
 * Whether where they are was chosen for them, not by the model (David, 2026-10-25: "I sent them on it, but it chose the
 * original destination"): the owner's paid Set the scene, or the place the two agreed by text (lib/plans.ts). The model
 * can't swap in somewhere else for it then, even a place it names when the chosen one names nowhere it knows ("An awkward
 * double date"); they still leave only by agreeing to, like any move.
 */
export function placeLocked(scene: { moves: readonly MoveLog[]; set_place: string | null }): boolean {
  const last = [...scene.moves].reverse().find((m) => m.taken);
  return Boolean(last && (last.reason === "set_scene" || last.reason === "plan") && last.to === scene.set_place);
}

export type Settled = {
  place: string | null;
  set: string | null;
  /** The move taken: the agreeing line's index among the new lines, where they went, and whose home it is. */
  moved: { at: number; to: string; home: "a" | "b" | null } | null;
  /** A move the model reported that wasn't taken, and why. */
  rejected: { to: string; reason: MoveLog["reason"] } | null;
};

/**
 * Where the scene is after these lines. The model's "place" and "set" are a claim: a rewording of where they are keeps
 * the set; a different place is taken only when the lines agreed to go (agreedMove), the chapter has moves left, and
 * it isn't going to the home they're already in. `lines` is the night so far with the new lines last, from `from`.
 */
export function settlePlace(input: {
  current: { place: string | null; set: string | null };
  claimed: { place: string | null; set: string | null };
  lines: readonly PlaceLine[];
  from: number;
  movesThisChapter: number;
  /** Whose home they're in now, when they're in one (the last stop's). */
  homeNow: "a" | "b" | null;
  names: { a: string; b: string };
  /** v2.1: also take a move the lines show when the model's place says nothing new (shownMove). */
  fromLines?: boolean;
  /** Where they are was chosen for them (placeLocked): the model's claim never renames it, only an agreed move leaves it. */
  locked?: boolean;
}): Settled {
  const { current, claimed } = input;
  const keep = (rejected: Settled["rejected"] = null): Settled => ({ place: placeDetail(current, claimed), set: current.set, moved: null, rejected });
  const here = current.set ?? current.place;
  // v2.1: the model's place said nothing new, but the lines may have taken them somewhere (shownMove), by the same rules.
  const orShown = (otherwise: Settled): Settled => {
    const shown = input.fromLines ? shownMove(input.lines, input.from, here, input.names) : null;
    if (!shown) return otherwise;
    if (shown.home && shown.home === input.homeNow) return keep({ to: shown.to, reason: "already_there" });
    if (input.movesThisChapter >= MAX_SCENE_MOVES) return keep({ to: shown.to, reason: "cap" });
    return { place: shown.to, set: shown.to, moved: { at: shown.at - input.from, to: shown.to, home: shown.home }, rejected: null };
  };
  const claim = claimed.set ?? claimed.place;
  const want = canonicalSet(claim);
  // Nothing new: they're where they were.
  if (!claim) return orShown(keep());
  // A place the rules don't know ("the bakery", "his workshop"): only when the lines agreed to go there by that name;
  // otherwise it names nowhere ("an intimate, private space", "on the swing") and they're where they were.
  if (!want.known) {
    const named = namedMove(input.lines, input.from, claimed.set ?? claim, input.names);
    if (!named) return orShown(keep());
    if (input.movesThisChapter >= MAX_SCENE_MOVES) return keep({ to: claimed.set ?? claim, reason: "cap" });
    return { place: claimed.place ?? claim, set: claimed.set ?? claim, moved: named, rejected: null };
  }
  const now = canonicalSet(here);
  // The first set of the scene, or one so vague it named nowhere: the model's names it, and that's no move. Unless the
  // place was chosen for them: then the model's claim never renames it, but the lines agreeing to go still take them
  // elsewhere, by the rules below (David, 2026-10-25: they agreed to go to his bakery from "A safari jeep at dawn", a
  // place the rules don't know, and the move was refused as "no agreement" twice).
  if (!here || !now.known) {
    if (!(input.locked && here)) return { place: claimed.place ?? current.place, set: claimed.set ?? (claimed.place ? want.canonical : current.set), moved: null, rejected: null };
  } else if (samePlace(here, claim) && !ownerChanged(now, want, input.homeNow, input.names)) return orShown(keep());
  const agreedHere = agreedMove(input.lines, input.from);
  const to = claimed.set ?? want.canonical;
  // v2 (fromLines): a move agreed earlier tonight, or an invitation home, that they're only now arriving at (pendingMove).
  const move = agreedHere ?? (input.fromLines ? pendingMove(input.lines, input.from, claim, input.names) : null);
  if (!move) return keep({ to, reason: "no_agreement" });
  if (move.home && move.home === input.homeNow) return keep({ to, reason: "already_there" });
  if (input.movesThisChapter >= MAX_SCENE_MOVES) return keep({ to, reason: "cap" });
  // An agreement in these lines moves them there; one from before moves them where these lines show them going, else at the start.
  const at = agreedHere ? agreedHere.agree - input.from : Math.max(0, input.lines.slice(input.from).findIndex((l) => GOING.test(actionsOf(l.text)) || ARRIVING.test(l.text)));
  return { place: claimed.place ?? to, set: to, moved: { at, to, home: move.home ?? homeFromOwner(want, input.names) }, rejected: null };
}

/**
 * A move to a place the rules don't know, agreed by name: an agreed move (agreedMove) in these lines or the last
 * PENDING_REACH whose invitation names the place's own word ("The bakery is ten minutes from here" / "Lead the way" →
 * "the bakery"). Where among the new lines they went: the agreeing line when it's new, else the first line going or
 * arriving.
 */
function namedMove(lines: readonly PlaceLine[], from: number, place: string, names: { a: string; b: string }): Settled["moved"] {
  const word = place.toLowerCase().replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !/['’]s$/.test(w) && !STOP_WORDS.has(w)).at(-1);
  if (!word) return null;
  const start = Math.max(0, lines.length - PENDING_REACH);
  // Agreed in these lines or earlier tonight (still within reach): the latest agreement in the window.
  const move = agreedMove(lines.slice(start), 0);
  if (!move || !new RegExp(`\\b${word}\\b`, "i").test(lines[start + move.proposal].text)) return null;
  const agree = start + move.agree;
  const at = agree >= from ? agree - from : Math.max(0, lines.slice(from).findIndex((l) => GOING.test(actionsOf(l.text)) || ARRIVING.test(l.text)));
  return { at, to: place, home: move.home ?? homeFromOwner(canonicalSet(place), names) };
}
const STOP_WORDS = new Set(["with", "from", "into", "onto", "over", "under", "near", "outside", "inside", "their", "there", "where", "rain", "rainy", "night", "dawn", "morning", "evening"]);

/** The place text for a kept set: the model's detail ("on the bed") when it names nowhere else, else what it was. */
function placeDetail(current: { place: string | null; set: string | null }, claimed: { place: string | null; set: string | null }): string | null {
  if (!claimed.place) return current.place;
  const c = canonicalSet(claimed.place);
  const here = current.set ?? current.place;
  if (!c.known || !here || samePlace(here, claimed.place)) return claimed.place;
  return current.place;
}

const firstName = (n: string) => n.split(/\s+/)[0].toLowerCase();
function homeFromOwner(c: CanonicalSet, names: { a: string; b: string }): "a" | "b" | null {
  if (!c.owner) return null;
  if (c.owner === firstName(names.a)) return "a";
  if (c.owner === firstName(names.b)) return "b";
  return null;
}
/** "Star's bedroom" from "Chud's bedroom" is somewhere else, even with the same noun. */
function ownerChanged(now: CanonicalSet, want: CanonicalSet, homeNow: "a" | "b" | null, names: { a: string; b: string }): boolean {
  const wantHome = homeFromOwner(want, names);
  const nowHome = homeFromOwner(now, names) ?? homeNow;
  return Boolean(wantHome && nowHome && wantHome !== nowHome);
}

/** Where they've been tonight, as a phrase for the prompt: "the bowling alley → Chud's place → his bedroom". */
export const historyPhrase = (stops: readonly PlaceStop[]): string => stops.map((s) => s.set ?? s.place).join(" → ");

// ---------------------------------------------------------------------------------------------------------------------
// 3. No repeated lines
// ---------------------------------------------------------------------------------------------------------------------

/** What a line says, without its *action*, case or punctuation: the thing that mustn't be said twice. */
export function speechOf(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const fullOf = (text: string) => speechOf(text.replace(/\*/g, " "));

const grams = (ws: string[], n: number): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
};

/** How much of the shorter line's 3-word runs the other has: 1 is the same words in the same order. */
export function overlap(x: string, y: string): number {
  const a = grams(speechOf(x).split(" ").filter(Boolean), 3);
  const b = grams(speechOf(y).split(" ").filter(Boolean), 3);
  const small = Math.min(a.size, b.size);
  if (small < 3) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return shared / small;
}

/** A line counts as nearly the same as an earlier one at this overlap (lines 102–106 copied 84–88 at 1.0). */
export const NEAR_DUPLICATE = 0.6;

/** The earlier line this one repeats, word for word or nearly, or null. Short lines ("Yes.") never count. */
export function repeatOf(text: string, earlier: readonly string[]): { kind: "verbatim" | "near"; of: string } | null {
  const said = speechOf(text);
  if (said.split(" ").length < 4) return null;
  const full = fullOf(text);
  for (const e of earlier) {
    if (speechOf(e) === said || fullOf(e) === full) return { kind: "verbatim", of: e };
  }
  for (const e of earlier) if (overlap(text, e) >= NEAR_DUPLICATE) return { kind: "near", of: e };
  return null;
}

/** The catchphrase's words, in order, as they'd appear in a line ("That's a problem for future me." → that's problem…). */
const phraseWords = (phrase: string) => speechOf(phrase).split(" ").filter(Boolean);

/** Whether a line says the catchphrase: the whole thing, or a four-word run of it. */
export function saysCatchphrase(text: string, phrase: string | null | undefined): boolean {
  if (!phrase) return false;
  const p = phraseWords(phrase);
  if (p.length < 2) return false;
  const said = ` ${speechOf(text)} `;
  if (said.includes(` ${p.join(" ")} `)) return true;
  if (p.length < 4) return false;
  return [...grams(p, 4)].some((g) => said.includes(` ${g} `));
}

/**
 * The line with the sentence carrying `phrase` taken out (its action kept), or null when nothing it says would be
 * left. Used for a catchphrase past its once a chapter, and a tic the critic flags.
 */
export function withoutPhrase(text: string, has: (sentence: string) => boolean): string | null {
  const action = /^\*[^*]+\*\s*/.exec(text)?.[0] ?? "";
  const speech = text.slice(action.length);
  const kept = sentences(speech).filter((s) => !has(s));
  const rest = kept.join(" ").trim();
  if (!rest || speechOf(rest).split(" ").filter(Boolean).length < 2) return null;
  return `${action}${rest}`.trim();
}

/**
 * The line without whatever `has` flags in it: its leading action, and the sentences of what it says (withoutPhrase).
 * Null when nothing's left of what it says, or when it was only an action and that went. v2.2's hooks and tells show in
 * what a line does as often as in what it says ("*spins her pencil*").
 */
export function withoutPart(text: string, has: (part: string) => boolean): string | null {
  const action = /^\*[^*]+\*\s*/.exec(text)?.[0] ?? "";
  const speech = text.slice(action.length).trim();
  const act = action && has(action) ? "" : action.trim();
  const said = !speech ? "" : sentences(speech).some(has) ? withoutPhrase(speech, has) : speech;
  if (said === null) return null;
  return `${act} ${said}`.trim() || null;
}

/**
 * The line without its first sentences, up to `n` words of what it says (v2.2: an opening said just before can't be
 * rephrased, only cut); null when nothing's left of what it says. The action stays.
 */
export function withoutOpening(text: string, n: number): string | null {
  const action = /^\*[^*]+\*\s*/.exec(text)?.[0] ?? "";
  const parts = sentences(text.slice(action.length));
  let said = 0;
  let i = 0;
  while (i < parts.length && said < n) said += speechOf(parts[i++]).split(" ").filter(Boolean).length;
  const rest = parts.slice(i).join(" ").trim();
  if (!rest || speechOf(rest).split(" ").filter(Boolean).length < 2) return null;
  return `${action}${rest}`.trim();
}
