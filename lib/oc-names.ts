/**
 * The OC name generator (app/tools/oc-name-generator): names for an original character, by style and kind.
 *
 * Pure and deterministic, like the ship name generator (lib/ship-names.ts): no model, no randomness, no database. A
 * style, a kind and a batch number always give the same twelve names, so every page of names is a link anyone can
 * share, and it works with no model key at all.
 *
 * Modern, gothic and cozy names pair a hand-picked first name with a hand-picked surname. Fantasy and sci-fi first
 * names are built from syllables (a start, sometimes a middle, an ending that leans the way the kind asks), and their
 * surnames are two hand-picked pieces joined ("Ash" + "vale"). Every full name goes through the show's content filter
 * (lib/safety.ts), so a pairing that lands on a well-known real person is dropped, not shown.
 */
import { checkFields } from "./safety";

export const OC_NAMES_PATH = "/tools/oc-name-generator";
/** How many names one page shows. */
export const OC_NAMES_SHOWN = 12;
/** The highest batch an address takes; past it the batch number wraps around. */
export const OC_NAMES_MAX_BATCH = 999;

export const OC_NAME_STYLES = ["fantasy", "modern", "scifi", "gothic", "cozy"] as const;
export type OcNameStyle = (typeof OC_NAME_STYLES)[number];
export const OC_NAME_KINDS = ["any", "feminine", "masculine", "neutral"] as const;
export type OcNameKind = (typeof OC_NAME_KINDS)[number];

/** How each style is named on the page, and the line under its heading. */
export const OC_NAME_STYLE_INFO: Record<OcNameStyle, { label: string; title: string; blurb: string }> = {
  fantasy: { label: "Fantasy", title: "Fantasy OC name generator", blurb: "Names for elves, mages, knights and wanderers: soft or sharp first names, and surnames that sound like a place." },
  modern: { label: "Modern", title: "Modern OC name generator", blurb: "Names someone could have today: a first name and a surname you'd believe on a coffee cup or a cast list." },
  scifi: { label: "Sci-fi", title: "Sci-fi OC name generator", blurb: "Names for pilots, androids, colonists and station crews: short, hard-edged first names and surnames from far away." },
  gothic: { label: "Gothic", title: "Gothic OC name generator", blurb: "Names for old houses and older secrets: Victorian first names and surnames with a crow on the gate." },
  cozy: { label: "Cozy", title: "Cozy OC name generator", blurb: "Names for bakers, cottage witches and small-town romances: warm first names and surnames you'd find on a shop sign." },
};
export const OC_NAME_KIND_LABELS: Record<OcNameKind, string> = { any: "Any", feminine: "Feminine", masculine: "Masculine", neutral: "Neutral" };

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

function fantasyName(rand: () => number, kind: Exclude<OcNameKind, "any">): string {
  const first = syllableName(rand, () => [pick(rand, FANTASY.start), rand() < 0.25 ? pick(rand, FANTASY.middle) : "", pick(rand, FANTASY.end[kind])]);
  // "Moss" + "shade" is Mosshade, not three s's.
  return `${first} ${`${pick(rand, FANTASY_LAST.head)}${pick(rand, FANTASY_LAST.tail)}`.replace(/(\w)\1\1/g, "$1$1")}`;
}

function scifiName(rand: () => number, kind: Exclude<OcNameKind, "any">): string {
  const first = syllableName(rand, () => [pick(rand, SCIFI.start), pick(rand, SCIFI.end[kind])]);
  return `${first} ${pick(rand, SCIFI_LAST.head)}${pick(rand, SCIFI_LAST.tail)}`;
}

function listName(rand: () => number, kind: Exclude<OcNameKind, "any">, first: Gendered, last: readonly string[]): string {
  return `${pick(rand, first[kind])} ${pick(rand, last)}`;
}

/** One name in a style, with the kind it was drawn as. */
export type OcName = { name: string; style: OcNameStyle; kind: Exclude<OcNameKind, "any"> };

function drawName(rand: () => number, style: OcNameStyle, kind: OcNameKind): OcName {
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

/**
 * One name in a style, drawn from `rand` until the content filter takes it (the random OC generator, lib/random-oc.ts,
 * draws its names here). `avoid`: first names and surname families already used, so a page never repeats one; null
 * when none is free.
 */
export function drawOcName(rand: () => number, style: OcNameStyle, kind: OcNameKind, avoid: Set<string> = new Set()): OcName | null {
  let drawn = drawName(rand, style, kind);
  for (let tries = 0; tries < 40; tries++) {
    const [first, last] = drawn.name.split(" ");
    const family = `last:${last.split("-")[0]}`;
    if (!avoid.has(first) && !avoid.has(family) && checkFields({ name: drawn.name }).ok) {
      avoid.add(first);
      avoid.add(family);
      return drawn;
    }
    drawn = drawName(rand, style, kind);
  }
  // None free in forty draws (a small list, a full page): the caller draws again or stops.
  return null;
}

/**
 * A page of names: OC_NAMES_SHOWN of them, no first name or surname twice, none the content filter refuses. With no style, the page mixes
 * every style in turn. The same style, kind and batch always give the same page.
 */
export function ocNames({ style, kind = "any", batch = 1 }: { style?: OcNameStyle | null; kind?: OcNameKind; batch?: number }): OcName[] {
  const rand = seeded(`oc-names|${style ?? "mixed"}|${kind}|${batch}`);
  const seen = new Set<string>();
  const out: OcName[] = [];
  for (let tries = 0; out.length < OC_NAMES_SHOWN && tries < OC_NAMES_SHOWN * 20; tries++) {
    const s = style ?? OC_NAME_STYLES[out.length % OC_NAME_STYLES.length];
    const drawn = drawName(rand, s, kind);
    // No first name, and no surname family ("Kade" in Kade-Lin), twice on a page.
    const [first, last] = drawn.name.split(" ");
    const family = `last:${last.split("-")[0]}`;
    if (seen.has(first) || seen.has(family)) continue;
    if (!checkFields({ name: drawn.name }).ok) continue;
    seen.add(first);
    seen.add(family);
    out.push(drawn);
  }
  return out;
}

/** A style from an address segment ("sci-fi" and "scifi" both read as sci-fi), or null. */
export function readStyle(raw: unknown): OcNameStyle | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  return (OC_NAME_STYLES as readonly string[]).includes(s) ? (s as OcNameStyle) : null;
}

export function readKind(raw: unknown): OcNameKind {
  return typeof raw === "string" && (OC_NAME_KINDS as readonly string[]).includes(raw) ? (raw as OcNameKind) : "any";
}

/** A batch number from an address: a whole number from 1 to OC_NAMES_MAX_BATCH, otherwise 1. */
export function readBatch(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? ((n - 1) % OC_NAMES_MAX_BATCH) + 1 : 1;
}

/** The address of a page of names. The plain style page is its first batch with any kind. */
export function ocNamesHref(style: OcNameStyle | null, kind: OcNameKind = "any", batch = 1): string {
  const base = style ? `${OC_NAMES_PATH}/${style}` : OC_NAMES_PATH;
  const q = new URLSearchParams();
  if (kind !== "any") q.set("kind", kind);
  if (batch !== 1) q.set("batch", String(batch));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Where "Make this character" goes: the builder, with the name already in (app/create/page.tsx reads ?name=). */
export function createWithName(name: string): string {
  return `/create?name=${encodeURIComponent(name)}`;
}
