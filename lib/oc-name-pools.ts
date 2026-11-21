/**
 * The name lists and draws behind the OC name generator (lib/oc-names.ts, app/tools/oc-name-generator), and the draws
 * the show's other writers make from them: the people in a show character's life (lib/social/person-names.ts has the
 * rules; lib/social/circles.ts and scripts/social/backfill-circles.mjs use both).
 *
 * No imports, so a plain script loads it as it is (Node strips the types). The content filter's check of a whole name
 * (lib/safety.ts) stays in lib/oc-names.ts, and the site checks every circle's names when it writes them.
 */
export const OC_NAME_STYLES = ["fantasy", "modern", "scifi", "gothic", "cozy"] as const;
export type OcNameStyle = (typeof OC_NAME_STYLES)[number];
export const OC_NAME_KINDS = ["any", "feminine", "masculine", "neutral"] as const;
export type OcNameKind = (typeof OC_NAME_KINDS)[number];

type Gendered = { feminine: readonly string[]; masculine: readonly string[]; neutral: readonly string[] };

const MODERN_FIRST: Gendered = {
  feminine: ["Maya", "Nadia", "Imani", "Clara", "Priya", "Lucia", "Hana", "Simone", "Talia", "Noor", "Ingrid", "Delphine", "Yara", "Marisol", "Keiko", "Bea", "Celeste", "Anouk", "Freya", "Zainab", "Odette", "Leila", "Ramona", "Tess"],
  masculine: ["Theo", "Marcus", "Idris", "Mateo", "Jonah", "Kenji", "Felix", "Omar", "Elliot", "Rafael", "Desmond", "Anton", "Kofi", "Luca", "Sami", "Hugo", "Malik", "Bastian", "Dario", "Ezra", "Callum", "Nikhil", "Tobias", "Wes"],
  neutral: ["Rowan", "Sasha", "Quinn", "Remy", "Jules", "Avery", "Robin", "Emery", "Kai", "Sol", "Ari", "Morgan", "Blair", "Riley", "Sage", "Noa", "Jesse", "Shay", "Alexis", "Reese"],
};
const MODERN_LAST = ["Okafor", "Lindqvist", "Moreau", "Castellano", "Nakashima", "Brennan", "Haddad", "Kowalski", "Achterberg", "Delacroix", "Mensah", "Iversen", "Ferreira", "Novak", "Sato", "Abernathy", "Quintero", "Halloran", "Varga", "Oyelaran", "Petrov", "Carrow", "Bhatt", "Sorensen", "Agbaje", "Montague", "Reyes", "Whitfield", "Kaur", "Lindgren", "Osei", "Duval"];

const GOTHIC_FIRST: Gendered = {
  feminine: ["Lenore", "Isolde", "Morwenna", "Ophelia", "Seraphine", "Evangeline", "Rosalind", "Cordelia", "Lilith", "Annabel", "Ottilie", "Theodora", "Clemency", "Wilhelmina", "Euphemia", "Ligeia"],
  masculine: ["Silas", "Ambrose", "Evander", "Corvin", "Lucian", "Thaddeus", "Augustin", "Barnabas", "Cassius", "Ignatius", "Mortimer", "Valentin", "Edmund", "Lazarus", "Percival", "Alaric"],
  neutral: ["Vesper", "Raven", "Ellery", "Sorrel", "Hollis", "Wren", "Ashby", "Marlow", "Lark", "Sable", "Isley", "Crane"],
};
const GOTHIC_LAST = ["Blackwood", "Ashcombe", "Vane", "Grimsby", "Hollowell", "Ravenscroft", "Whitlock", "Mordaunt", "Thorncastle", "Greaves", "Nightingale", "Harrowgate", "Locke", "Wolcott", "Dunmore", "Fairfax", "Crowhurst", "Mallory", "Sterne", "Coldridge", "Pemberton", "Gravesend", "Ashdown"];

const COZY_FIRST: Gendered = {
  feminine: ["Clementine", "Hazel", "Rosie", "Olive", "Mabel", "Willa", "Tilly", "Poppy", "Daisy", "Matilda", "Junie", "Pearl", "Elsie", "Marigold", "Nell", "Etta"],
  masculine: ["Bram", "Arlo", "Otis", "Benji", "Toby", "Basil", "Alfie", "Ned", "Rupert", "Barnaby", "Gus", "Hamish", "Jasper", "Teddy", "Monty", "Ollie"],
  neutral: ["Pip", "Wren", "Maple", "Rowan", "Fern", "Juniper", "Sunny", "Bee", "Clover", "Robin", "Briar", "Sparrow"],
};
const COZY_LAST = ["Honeywell", "Applegate", "Fairweather", "Kettleby", "Thistlewood", "Featherstone", "Merriweather", "Brambleton", "Hollyhock", "Copperpot", "Larkspur", "Puddingstone", "Butterworth", "Bramblewick", "Teasdale", "Hearthfield", "Plumtree", "Marchbank", "Woolsey", "Goodfellow", "Cobblestone", "Lindenberry", "Muffett", "Quillfeather"];

/**
 * The last resort, after every list style has been refused (2026-11-21: all 153 list first names had been used three
 * times by the people in the show's circles, so a fourth Alfie had no rename and 15 circles lost everyone): everyday
 * names from many places, never drawn while a list name will do, so the OC generator's names don't change.
 */
const WIDE_FIRST: Gendered = {
  feminine: [
    "Abigail", "Adaeze", "Agnes", "Aiko", "Alba", "Amara", "Amelie", "Anika", "Annika", "Aurora", "Beatriz", "Bianca", "Camila", "Carmen", "Cecily", "Chiara",
    "Dalia", "Daphne", "Dina", "Edith", "Elena", "Eliza", "Esme", "Esther", "Fatima", "Fiona", "Flora", "Gemma", "Greta", "Hallie", "Helena", "Hilde",
    "Ines", "Irene", "Isla", "Ivy", "Jana", "Josie", "Kalinda", "Kamala", "Karin", "Kezia", "Lena", "Liesel", "Lina", "Lorna", "Lucy", "Mairead",
    "Malia", "Margot", "Mariam", "Meera", "Mina", "Mira", "Nadine", "Naomi", "Nora", "Oksana", "Paloma", "Petra", "Philippa", "Rhea", "Rina", "Ruth",
    "Saoirse", "Selma", "Signe", "Sofia", "Stella", "Suki", "Tamsin", "Thea", "Uma", "Valeria", "Vera", "Vivian", "Winnie", "Ximena", "Yasmin", "Zora",
  ],
  masculine: [
    "Aarav", "Abel", "Adrian", "Ahmed", "Albert", "Amos", "Anders", "Arjun", "Arthur", "August", "Bennett", "Bjorn", "Bruno", "Caleb", "Carlos", "Cyrus",
    "Daniel", "Dmitri", "Eamon", "Elias", "Emil", "Enzo", "Erik", "Ewan", "Fabian", "Finn", "Frank", "Gabriel", "George", "Gideon", "Hamza", "Harvey",
    "Henrik", "Ibrahim", "Isaac", "Ivan", "Jakob", "James", "Javier", "Joel", "Jorge", "Kamal", "Karl", "Kwame", "Lars", "Leon", "Levi", "Lionel",
    "Magnus", "Mario", "Milo", "Nathan", "Oscar", "Pablo", "Patrick", "Pedro", "Ravi", "Reuben", "Rhys", "Rohan", "Ruben", "Samuel",
    "Santiago", "Seamus", "Stefan", "Tariq", "Tomas", "Umar", "Victor", "Vikram", "Walter", "Xavier", "Yusuf", "Zane",
  ],
  neutral: [
    "Addison", "Alex", "Bailey", "Cameron", "Casey", "Charlie", "Dakota", "Devon", "Drew", "Eden", "Ellis", "Emerson", "Finley", "Frankie", "Hayden", "Harper",
    "Indigo", "Jamie", "Jordan", "Kendall", "Lennon", "Logan", "Marley", "Max", "Micah", "Nico", "Oakley", "Parker", "Peyton", "Phoenix", "Reagan", "River",
    "Rory", "Sam", "Skyler", "Spencer", "Sydney", "Tatum", "Taylor", "Toni", "Val", "Yael",
  ],
};
const WIDE_LAST = [
  "Abara", "Albrecht", "Alvarez", "Andersen", "Arslan", "Asante", "Banerjee", "Barros", "Becker", "Bergstrom", "Bianchi", "Bose", "Calloway", "Chandra", "Costa", "Dahl",
  "Dimitrov", "Eriksen", "Esposito", "Fischer", "Fontaine", "Gallagher", "Garcia", "Gill", "Grant", "Gustafsson", "Hale", "Hansen", "Hayes", "Horvath", "Ibarra", "Ito",
  "Jansen", "Jovanovic", "Kamara", "Keane", "Kim", "Kruger", "Lambert", "Larsen", "Lopez", "Lund", "Madsen", "Mahler", "Marsh", "Medina", "Molina", "Murphy",
  "Nair", "Nguyen", "Nilsen", "Nowak", "Obi", "Olsen", "Ortega", "Park", "Pereira", "Ramos", "Rossi", "Saito", "Santos", "Schmidt", "Shah",
  "Silva", "Sokolov", "Tan", "Torres", "Ueda", "Vasquez", "Vogel", "Walsh", "Weber", "Yilmaz", "Young", "Zhang",
];

/** Fantasy first names: a start, sometimes a middle, and an ending that leans the way the kind asks. */
const FANTASY = {
  start: ["Ae", "Ca", "Ela", "Fae", "Gal", "Ith", "Lo", "Mae", "Ny", "Or", "Sil", "Tha", "Va", "Ys", "Bry", "Cae", "Del", "Ear", "Fen", "Kel", "Lir", "Mor", "Rha", "Sor", "Tal", "Zeph"],
  middle: ["la", "ri", "the", "wy", "ve", "sa", "lo", "dri", "na", "ma"],
  end: {
    feminine: ["a", "wyn", "iel", "ra", "elle", "ith", "ia", "essa", "lyn", "ora"],
    masculine: ["or", "an", "ric", "dain", "us", "ion", "mir", "dor", "eth", "gar"],
    neutral: ["en", "is", "yn", "el", "ir", "ae", "rin", "ash", "oth", "ey"],
  },
} as const;
const FANTASY_LAST = {
  head: ["Ash", "Thorn", "Wren", "Storm", "Gold", "Raven", "Frost", "Elder", "Moss", "Silver", "Oak", "Star", "Ember", "Hawk", "Mist", "Briar", "Dawn", "Bright"],
  tail: ["vale", "wood", "hollow", "brook", "crest", "fall", "ward", "mere", "whisper", "song", "shade", "field", "ridge", "wind", "glen", "bloom"],
} as const;

/** Sci-fi first names: short and hard-edged. Surnames: two pieces, one of them from far away. */
const SCIFI = {
  start: ["Kae", "Vex", "Ryn", "Zo", "Tal", "Ix", "Nova", "Cy", "Dax", "Ora", "Sev", "Kir", "Juno", "Rho", "Ty", "Lyr", "Ash", "Mira", "Quill", "Zan"],
  end: {
    feminine: ["a", "ia", "ys", "ette", "ra", "ine", ""],
    masculine: ["on", "ek", "us", "ar", "ix", "en", ""],
    neutral: ["", "ri", "el", "o", "is", "an"],
  },
} as const;
const SCIFI_LAST = {
  head: ["Kade", "Voss", "Arden", "Castellan", "Okonjo", "Halvorsen", "Ryker", "Teshima", "Valdez", "Quorra", "Strand", "Ilyan", "Marek", "Sol", "Draven", "Tavi"],
  tail: ["", "", "", "-7", "-Lin", "-Oduya", "-Vance", "-Reyes", "-Sato", "-Hale"],
} as const;

/** A small seeded generator (mulberry32), seeded from a string: the same address always draws the same names. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

/** The kind one name is drawn as: "any" picks one of the three for each name. */
function drawKind(rand: () => number, kind: OcNameKind): Exclude<OcNameKind, "any"> {
  return kind === "any" ? pick(rand, ["feminine", "masculine", "neutral"] as const) : kind;
}

/** Joins syllables, folding a doubled vowel or an awkward triple consonant ("Ela" + "a" → "Ela"). */
function joinSyllables(parts: readonly string[]): string {
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    const last = out.slice(-1).toLowerCase();
    const first = part[0].toLowerCase();
    out += last && last === first && "aeiouy".includes(last) ? part.slice(1) : part;
  }
  return out[0].toUpperCase() + out.slice(1).toLowerCase();
}

const VOWEL = /[aeiouy]/i;
/** The longest syllable-built first name: past it they stop reading like names. */
const SYLLABLE_NAME_MAX = 8;

/**
 * Whether syllables read as a name: no vowel meeting a vowel where two pieces join ("Nova" + "us" makes Novaus), no
 * three vowels in a row, no syllable said twice, and short enough to say.
 */
function readable(parts: readonly string[]): boolean {
  const used = parts.filter(Boolean);
  for (let i = 1; i < used.length; i++) if (VOWEL.test(used[i - 1].slice(-1)) && VOWEL.test(used[i][0])) return false;
  const name = used.join("");
  // …nor an echo ("Ix" + "ix", "Lir" + "ir").
  return name.length <= SYLLABLE_NAME_MAX && !/[aeiouy]{3}/i.test(name) && !/(\w\w)\1/i.test(name);
}

/** Draws syllables until they read as a name (readable), at most a few times, then takes the start alone. */
function syllableName(rand: () => number, draw: () => string[]): string {
  for (let i = 0; i < 24; i++) {
    const parts = draw();
    if (readable(parts)) return joinSyllables(parts);
  }
  return joinSyllables([draw()[0]]);
}

const fantasyFirst = (rand: () => number, kind: Exclude<OcNameKind, "any">): string =>
  syllableName(rand, () => [pick(rand, FANTASY.start), rand() < 0.25 ? pick(rand, FANTASY.middle) : "", pick(rand, FANTASY.end[kind])]);
// "Moss" + "shade" is Mosshade, not three s's.
const fantasyLast = (rand: () => number): string => `${pick(rand, FANTASY_LAST.head)}${pick(rand, FANTASY_LAST.tail)}`.replace(/(\w)\1\1/g, "$1$1");
const scifiFirst = (rand: () => number, kind: Exclude<OcNameKind, "any">): string => syllableName(rand, () => [pick(rand, SCIFI.start), pick(rand, SCIFI.end[kind])]);
const scifiLast = (rand: () => number): string => `${pick(rand, SCIFI_LAST.head)}${pick(rand, SCIFI_LAST.tail)}`;

function fantasyName(rand: () => number, kind: Exclude<OcNameKind, "any">): string {
  const first = fantasyFirst(rand, kind);
  return `${first} ${fantasyLast(rand)}`;
}

function scifiName(rand: () => number, kind: Exclude<OcNameKind, "any">): string {
  const first = scifiFirst(rand, kind);
  return `${first} ${scifiLast(rand)}`;
}

function listName(rand: () => number, kind: Exclude<OcNameKind, "any">, first: Gendered, last: readonly string[]): string {
  return `${pick(rand, first[kind])} ${pick(rand, last)}`;
}

/** One name in a style, with the kind it was drawn as. */
export type OcName = { name: string; style: OcNameStyle; kind: Exclude<OcNameKind, "any"> };

export function drawName(rand: () => number, style: OcNameStyle, kind: OcNameKind): OcName {
  const k = drawKind(rand, kind);
  const name =
    style === "fantasy"
      ? fantasyName(rand, k)
      : style === "scifi"
        ? scifiName(rand, k)
        : style === "gothic"
          ? listName(rand, k, GOTHIC_FIRST, GOTHIC_LAST)
          : style === "cozy"
            ? listName(rand, k, COZY_FIRST, COZY_LAST)
            : listName(rand, k, MODERN_FIRST, MODERN_LAST);
  return { name, style, kind: k };
}

/* ---------------------------------- names for the people in a show character's life ---------------------------------- */

/** The kind a name is drawn as, once "any" is decided. */
export type NameKind = Exclude<OcNameKind, "any">;
/** The styles whose names are real names from a list; fantasy and sci-fi build theirs from syllables. */
const LIST_STYLES = ["modern", "cozy", "gothic"] as const;
type ListStyle = (typeof LIST_STYLES)[number];
const FIRST_LISTS: Record<ListStyle, Gendered> = { modern: MODERN_FIRST, cozy: COZY_FIRST, gothic: GOTHIC_FIRST };
const LAST_LISTS: Record<ListStyle, readonly string[]> = { modern: MODERN_LAST, cozy: COZY_LAST, gothic: GOTHIC_LAST };
const isListStyle = (style: OcNameStyle): style is ListStyle => (LIST_STYLES as readonly string[]).includes(style);
/** How many syllable names to draw before giving up on one `ok` takes. */
const SYLLABLE_TRIES = 40;

/** A copy of a list in the order `rand` gives. */
function inOrder<T>(rand: () => number, list: readonly T[]): T[] {
  return list.map((x) => ({ x, r: rand() })).sort((a, b) => a.r - b.r).map((k) => k.x);
}

/** Whether a first name is on the lists as feminine, masculine or neutral; null for one on none. */
export function firstNameKind(first: string): NameKind | null {
  const f = first.trim().toLowerCase();
  for (const lists of [...Object.values(FIRST_LISTS), WIDE_FIRST]) {
    for (const kind of ["feminine", "masculine", "neutral"] as const) if (lists[kind].some((n) => n.toLowerCase() === f)) return kind;
  }
  return null;
}

/**
 * A first name in a style and kind that `ok` takes (one not used too often yet, say), or null when there's none. A
 * list style goes through its whole list in an order `rand` picks, then the other list styles' (a real name before
 * none at all); fantasy and sci-fi draw syllables a few dozen times. Then, for any style, the wide everyday names.
 */
export function drawFirstName(rand: () => number, style: OcNameStyle, kind: NameKind, ok: (first: string) => boolean = () => true): string | null {
  if (!isListStyle(style)) {
    for (let i = 0; i < SYLLABLE_TRIES; i++) {
      const first = style === "fantasy" ? fantasyFirst(rand, kind) : scifiFirst(rand, kind);
      if (ok(first)) return first;
    }
  } else {
    for (const s of [style, ...LIST_STYLES.filter((x) => x !== style)]) {
      const found = inOrder(rand, FIRST_LISTS[s][kind]).find((n) => ok(n));
      if (found) return found;
    }
  }
  return inOrder(rand, WIDE_FIRST[kind]).find((n) => ok(n)) ?? null;
}

/** A surname in a style that `ok` takes, or null: the same order of trying as drawFirstName, wide surnames last. */
export function drawSurname(rand: () => number, style: OcNameStyle, ok: (last: string) => boolean = () => true): string | null {
  if (!isListStyle(style)) {
    for (let i = 0; i < SYLLABLE_TRIES; i++) {
      const last = style === "fantasy" ? fantasyLast(rand) : scifiLast(rand);
      if (ok(last)) return last;
    }
  } else {
    for (const s of [style, ...LIST_STYLES.filter((x) => x !== style)]) {
      const found = inOrder(rand, LAST_LISTS[s]).find((n) => ok(n));
      if (found) return found;
    }
  }
  return inOrder(rand, WIDE_LAST).find((n) => ok(n)) ?? null;
}

/**
 * A few names to offer a writer for the people in one character's life, the same for the same seed (the character's
 * id) and style: `first` first names, feminine, masculine and neutral in turn, and `last` surnames, each one its `ok`
 * takes.
 */
export function nameIdeas(
  seed: string,
  style: OcNameStyle,
  o: { first?: number; last?: number; okFirst?: (first: string) => boolean; okLast?: (last: string) => boolean } = {},
): { first: string[]; last: string[] } {
  const { first = 6, last = 3, okFirst = () => true, okLast = () => true } = o;
  const rand = seeded(`name-ideas|${seed}`);
  const kinds = ["feminine", "masculine", "neutral"] as const;
  const firsts: string[] = [];
  for (let i = 0; firsts.length < first && i < first * 3; i++) {
    const f = drawFirstName(rand, style, kinds[i % 3], (n) => okFirst(n) && !firsts.includes(n));
    if (f) firsts.push(f);
  }
  const lasts: string[] = [];
  for (let i = 0; lasts.length < last && i < last * 3; i++) {
    const l = drawSurname(rand, style, (n) => okLast(n) && !lasts.includes(n));
    if (l) lasts.push(l);
  }
  return { first: firsts, last: lasts };
}

/** The draws lib/social/person-names.ts renames with, from one seed and style. */
export function nameDraws(seed: string, style: OcNameStyle) {
  const rand = seeded(`name-draws|${seed}`);
  return {
    first: (kind: NameKind, ok: (first: string) => boolean): string | null => drawFirstName(rand, style, kind, ok),
    last: (ok: (last: string) => boolean): string | null => drawSurname(rand, style, ok),
    kindOf: firstNameKind,
  };
}
