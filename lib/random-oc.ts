/**
 * The random OC generator (app/tools/random-oc-generator): whole original characters, six at a time. Each has a name, an
 * age, pronouns, a role in their world, a quirk, three traits, the partner they want, a dealbreaker and a secret.
 *
 * Pure and deterministic, like the other free tools (lib/oc-names.ts, lib/ship-names.ts): no model, no randomness, no
 * database. A genre, a kind and a batch always give the same six characters, so every page is a link anyone can share,
 * and it works with no model key at all. Names come from the OC name generator in the same genre; everything else is
 * hand-written lists, all PG and all adults, and every character is checked with the show's content filter
 * (lib/safety.ts checkSheetText) before it is shown.
 *
 * Each character is the fields a character starts with on /create (an OcSheet: name, three traits, a want, a
 * dealbreaker), so it goes on into the builder as one sentence (/create?say=…, the one-sentence box drafts the rest) and
 * into the OC chemistry test beside the next character on the page.
 */
import type { OcSheet } from "./chemistry-test";
import { DEALBREAKER_MAX, TRAIT_MAX, WANT_MAX } from "./field-limits";
import { EXPRESS_TEXT_MAX } from "./express-create";
import { drawOcName, OC_NAME_STYLES, pick, seeded, type OcNameKind, type OcNameStyle } from "./oc-names";
import { checkSheetText } from "./safety";

export const RANDOM_OC_PATH = "/tools/random-oc-generator";
/** How many characters one page shows. */
export const RANDOM_OCS_SHOWN = 6;
/** The highest batch an address takes; past it the batch number wraps around. */
export const RANDOM_OC_MAX_BATCH = 999;
/** Every character is an adult: ages from here up to RANDOM_OC_AGE_MAX. */
export const RANDOM_OC_AGE_MIN = 21;
export const RANDOM_OC_AGE_MAX = 49;

/** The genres are the name generator's styles, so a genre's names are its names. */
export const RANDOM_OC_GENRES = OC_NAME_STYLES;
export type RandomOcGenre = OcNameStyle;

export const RANDOM_OC_GENRE_INFO: Record<RandomOcGenre, { label: string; world: string }> = {
  fantasy: { label: "Fantasy", world: "elves, mages, knights and wanderers" },
  modern: { label: "Modern", world: "people you could meet today" },
  scifi: { label: "Sci-fi", world: "pilots, androids, colonists and station crews" },
  gothic: { label: "Gothic", world: "old houses and older secrets" },
  cozy: { label: "Cozy", world: "bakers, cottage witches and small towns" },
};

/** Who they are in their world: "a {role} who {quirk}". */
const ROLES: Record<RandomOcGenre, readonly string[]> = {
  fantasy: ["hedge witch", "disgraced knight", "court bard", "dragon's bookkeeper", "innkeeper and retired adventurer", "royal food taster", "runaway heir", "potion tester", "monster hunter", "temple archivist", "map maker", "lighthouse mage", "travelling blacksmith", "fae diplomat"],
  modern: ["night-shift nurse", "wedding photographer", "food truck chef", "public defender", "tattoo artist", "chemistry teacher", "session musician", "florist", "paramedic", "podcast producer", "architect", "dog walker", "radio DJ", "pastry chef"],
  scifi: ["freighter pilot", "station botanist", "terraforming engineer", "salvage diver", "colony doctor", "comms officer", "former smuggler", "xenolinguist", "orbital chef", "mech mechanic", "deep-space map maker", "android negotiator", "asteroid miner", "dock inspector"],
  gothic: ["governess", "gravedigger", "portrait painter", "lighthouse keeper", "heir to a crumbling manor", "spirit medium", "apothecary", "church organist", "night-watch constable", "clockmaker", "keeper of a private library", "travelling photographer", "undertaker's apprentice", "boarding-house landlady"],
  cozy: ["cottage baker", "bookshop owner", "beekeeper", "village vet", "tea shop owner", "knitwear designer", "postmaster", "community gardener", "candle maker", "ferry captain", "cat café owner", "pie contest judge", "flower farmer", "village librarian"],
};

/** "who {quirk}": a habit anyone in any genre could have. */
const QUIRKS: readonly string[] = [
  "names every houseplant",
  "hums when nervous",
  "keeps a list of every compliment ever received",
  "can't walk past a dog without saying hello",
  "collects postcards from places never visited",
  "always has a snack in a pocket",
  "rearranges other people's shelves",
  "laughs before the punchline",
  "writes letters that never get sent",
  "knows every bird by its call",
  "brings a book to every party",
  "can't keep a present secret",
  "keeps receipts as souvenirs",
  "cooks when sad",
  "remembers everyone's coffee order",
  "has never once been on time",
  "always sits facing the door",
  "doodles on every napkin",
  "quotes films nobody else has seen",
  "counts stairs",
  "sings in the car with the windows down",
  "apologises to furniture",
  "can fall asleep anywhere",
  "tells the same three jokes",
];

/** Three of these, never two alike. Short words, as /create's trait fields take them. */
const TRAITS: readonly string[] = [
  "curious", "stubborn", "warm", "guarded", "funny", "loyal", "anxious", "bold", "dreamy", "practical", "sarcastic",
  "gentle", "restless", "proud", "shy", "charming", "blunt", "patient", "impulsive", "thoughtful", "competitive",
  "romantic", "cautious", "generous", "dry-witted", "earnest", "moody", "calm", "chaotic", "tender", "ambitious",
  "nosy", "brave", "secretive", "playful", "honest",
];

/** The partner they're after, as the chemistry test and /create take a want: "Someone who…". */
const WANTS: readonly string[] = [
  "Someone who laughs at the same things",
  "Someone who chooses them first, for once",
  "Someone who won't try to fix them",
  "Someone who falls in love slowly",
  "Someone to cook for",
  "Someone who can keep up",
  "Someone who gets lost on purpose",
  "Someone braver than they are",
  "Someone who plans the evening for once",
  "Someone who reads the same books",
  "A partner in crime",
  "Someone who listens more than they talk",
  "Someone who is good at quiet",
  "Someone who still writes letters",
  "Someone who isn't afraid of a little mess",
  "Someone who sees through the act",
  "Someone with a terrible sense of direction and a good sense of humour",
  "Someone who will dance badly in the kitchen",
];

/** Who they can't stand, as /create takes a dealbreaker. */
const DEALBREAKERS: readonly string[] = [
  "People who are rude to waiters",
  "People who never ask a question back",
  "Being late without a message",
  "People who talk over others",
  "People who don't like dogs",
  "People who can't laugh at themselves",
  "Lying about small things",
  "People who are always on their phone",
  "Anyone who can't say sorry",
  "Food snobs",
  "People with no curiosity",
  "Show-offs",
  "Jealousy",
  "Keeping score",
  "Cynics",
  "People who never finish a story",
];

/** What nobody knows yet: one per genre, said without a pronoun ("once stole…"). */
const SECRETS: Record<RandomOcGenre, readonly string[]> = {
  fantasy: ["once stole a dragon's egg and gave it back", "is the true heir and hopes nobody checks", "faked the prophecy everyone quotes", "is afraid of horses", "keeps a letter from a rival under the pillow", "lost a duel on purpose", "talks to a ghost every night", "has never actually seen the sea"],
  modern: ["still has a key to an ex's flat", "wrote a hit song under a fake name", "can't swim", "was once on a reality show", "has never seen the film everyone quotes", "secretly hates brunch", "dropped out of medical school", "is the anonymous reviewer everyone in town fears"],
  scifi: ["isn't from the colony on the papers", "was grown, not born", "is on three planets' wanted lists, for parking", "has never stood on a planet", "keeps a seed from Earth in a locket", "deleted a memory on purpose", "taught the station's AI to tell jokes", "can't actually fly the ship on manual"],
  gothic: ["hears the house at night", "is the ghost's only friend", "burned the will", "writes the anonymous letters the town fears", "has never been photographed", "keeps the key to the locked east wing", "sleeps all day and nobody has asked why", "owes a debt to someone long dead"],
  cozy: ["can't actually bake; the neighbour does", "won the pie contest under a fake name", "is allergic to the shop cat", "reads everyone's postcards", "moved here to hide from a big-city past", "has a crush on the rival shop owner", "has never left the village", "secretly writes the town's gossip column"],
};

const PRONOUNS: Record<Exclude<OcNameKind, "any">, string> = { feminine: "she/her", masculine: "he/him", neutral: "they/them" };

export type RandomOc = OcSheet & {
  genre: RandomOcGenre;
  kind: Exclude<OcNameKind, "any">;
  pronouns: string;
  age: number;
  role: string;
  quirk: string;
  secret: string;
};

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** "a hedge witch who names every houseplant". */
export function roleLine(oc: Pick<RandomOc, "role" | "quirk">): string {
  return `${article(oc.role)} ${oc.role} who ${oc.quirk}`;
}

/** "curious, stubborn and warm". */
export function traitLine(traits: readonly string[]): string {
  return `${traits.slice(0, -1).join(", ")} and ${traits[traits.length - 1]}`;
}

/**
 * The character in a sentence or two for the one-sentence box on /create (lib/express-create.ts), within its limit: the
 * secret goes first if it doesn't fit, then the dealbreaker.
 */
export function ocSentence(oc: RandomOc): string {
  const head = `${oc.name} (${oc.pronouns}), ${oc.age}, ${roleLine(oc)}. ${cap(traitLine(oc.traits))}.`;
  const want = ` Wants: ${lower(oc.want)}.`;
  const deal = ` Can't stand: ${lower(oc.dealbreaker)}.`;
  const secret = ` Secret: ${oc.secret}.`;
  for (const text of [head + want + deal + secret, head + want + deal, head + want, head]) if (text.length <= EXPRESS_TEXT_MAX) return text;
  return head.slice(0, EXPRESS_TEXT_MAX);
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
// "Someone who…" mid-sentence; "A partner in crime" too. Names inside a want stay as written (none today).
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);

/** Draws `n` different items from a list. */
function drawDistinct<T>(rand: () => number, list: readonly T[], n: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/**
 * A page of characters: RANDOM_OCS_SHOWN of them, no name, role, quirk, want or secret twice, none the content filter
 * refuses. With no genre the page mixes every genre in turn. The same genre, kind and batch always give the same page.
 */
export function randomOcs({ genre, kind = "any", batch = 1 }: { genre?: RandomOcGenre | null; kind?: OcNameKind; batch?: number }): RandomOc[] {
  const rand = seeded(`random-oc|${genre ?? "mixed"}|${kind}|${batch}`);
  const names = new Set<string>();
  const used = new Set<string>();
  const out: RandomOc[] = [];
  for (let tries = 0; out.length < RANDOM_OCS_SHOWN && tries < RANDOM_OCS_SHOWN * 20; tries++) {
    const g = genre ?? RANDOM_OC_GENRES[(batch + out.length) % RANDOM_OC_GENRES.length];
    const role = pick(rand, ROLES[g]);
    const quirk = pick(rand, QUIRKS);
    const want = pick(rand, WANTS);
    const secret = pick(rand, SECRETS[g]);
    if ([role, quirk, want, secret].some((x) => used.has(x))) continue;
    // The name last, so a draw that's thrown away doesn't use one up.
    const name = drawOcName(rand, g, kind, names);
    if (!name) continue;
    const traits = drawDistinct(rand, TRAITS, 3) as [string, string, string];
    const oc: RandomOc = {
      name: name.name,
      genre: g,
      kind: name.kind,
      pronouns: PRONOUNS[name.kind],
      age: RANDOM_OC_AGE_MIN + Math.floor(rand() * (RANDOM_OC_AGE_MAX - RANDOM_OC_AGE_MIN + 1)),
      role,
      quirk,
      traits,
      want,
      dealbreaker: pick(rand, DEALBREAKERS),
      secret,
    };
    if (!checkSheetText({ name: oc.name, bio: ocSentence(oc), traits: oc.traits, want: oc.want, dealbreaker: oc.dealbreaker }).ok) continue;
    [role, quirk, want, secret].forEach((x) => used.add(x));
    out.push(oc);
  }
  return out;
}

/** A genre from an address ("sci-fi" and "scifi" both read as sci-fi), or null for every genre mixed. */
export function readGenre(raw: unknown): RandomOcGenre | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  return (RANDOM_OC_GENRES as readonly string[]).includes(s) ? (s as RandomOcGenre) : null;
}

/** A batch number from an address: a whole number from 1 to RANDOM_OC_MAX_BATCH, otherwise 1. */
export function readOcBatch(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? ((n - 1) % RANDOM_OC_MAX_BATCH) + 1 : 1;
}

/** The address of a page of characters. The plain page is every genre, any kind, the first batch. */
export function randomOcHref(genre: RandomOcGenre | null, kind: OcNameKind = "any", batch = 1): string {
  const q = new URLSearchParams();
  if (genre) q.set("genre", genre);
  if (kind !== "any") q.set("kind", kind);
  if (batch !== 1) q.set("batch", String(batch));
  const qs = q.toString();
  return qs ? `${RANDOM_OC_PATH}?${qs}` : RANDOM_OC_PATH;
}

/** "Make this character": the one-sentence box on /create, which drafts the rest (and takes the sentence out of the address). */
export function createFromOc(oc: RandomOc): string {
  return `/create?say=${encodeURIComponent(ocSentence(oc))}`;
}

/** The fields' limits hold for every list (tests/random-oc.test.ts). */
export const RANDOM_OC_LIMITS = { trait: TRAIT_MAX, want: WANT_MAX, dealbreaker: DEALBREAKER_MAX } as const;

