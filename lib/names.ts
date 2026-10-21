/**
 * The short name the show calls a character by ("Mira" for "Mira Quell"). Usually the first word, but not when the
 * first word isn't a name on its own: a possessive ("David's OC"), a title ("Mr. Fox", "Dr. Vale"), an article
 * ("The Duke") or an initial ("J. Wren"). Those keep going to the next word, so a short name is never "The" or "Mr.".
 */
const PREFIXES = new Set(
  [
    "the", "a", "an", "la", "le", "el", "los", "las", "les", "der", "die", "das", "lil", "lil'", "big", "little", "old", "young",
    "mr", "mrs", "ms", "mx", "miss", "mister", "dr", "doctor", "prof", "professor", "sir", "dame", "lady", "lord", "madam", "madame",
    "mme", "mlle", "señor", "senor", "señora", "senora", "herr", "frau", "don", "doña", "dona", "st", "saint", "father", "sister",
    "brother", "uncle", "aunt", "auntie", "captain", "capt", "agent", "detective", "officer", "king", "queen", "prince", "princess",
    "count", "countess", "duke", "duchess", "baron", "baroness",
  ],
);

const isPrefix = (word: string): boolean => {
  const bare = word.toLowerCase().replace(/[.,]+$/, "");
  return PREFIXES.has(bare) || /['’]s$/i.test(word) || /^\p{L}\.?$/u.test(word);
};

export function shortName(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const out = [words[0]];
  // At most three words ("The Old Duke"), and only while the words so far are all prefixes.
  for (let i = 1; i < words.length && out.length < 3 && out.every(isPrefix); i++) out.push(words[i]);
  return out.join(" ");
}

/**
 * Two characters' short names for one sentence ("Mira and Otto"), falling back to their full names when the short
 * ones are the same (#502: "Marguerite and Marguerite haven't matched yet" named nobody).
 */
export function pairNames(a: string | null | undefined, b: string | null | undefined): [string, string] {
  const x = shortName(a);
  const y = shortName(b);
  return x.toLowerCase() === y.toLowerCase() ? [(a ?? "").trim() || x, (b ?? "").trim() || y] : [x, y];
}

/** First names the show hands out when a name is taken (#477): distinctive, and not one of the house cast's. */
export const SPARE_FIRST_NAMES = [
  "Odalys", "Thaddeus", "Winifred", "Caspian", "Marisol", "Ignatius", "Philippa", "Leopold", "Henrietta", "Rafferty",
  "Clementine", "Barnaby", "Imogen", "Cornelius", "Rosalind", "Fitzgerald", "Seraphina", "Ambrose", "Theodora", "Lysander",
  "Juniper", "Montgomery", "Wilhelmina", "Octavian", "Perpetua", "Ludovic", "Isadora", "Bartholomew", "Marguerite", "Evander",
] as const;

/**
 * A few names like `wanted` that aren't in `taken` (lower-cased full names): the same surname with another first name,
 * so "Barnaby Quill" taken suggests "Thaddeus Quill" and "Winifred Quill" (#477: agents picking stock names collided
 * and could only find out by trying). The first name decides which spares come first, so two agents get different ones.
 */
export function suggestFreeNames(wanted: string, taken: ReadonlySet<string>, count = 3): string[] {
  const words = wanted.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const surname = words.length > 1 ? words.slice(1).join(" ") : "";
  const first = words[0].toLowerCase();
  const start = [...first].reduce((n, ch) => n + ch.charCodeAt(0), 0) % SPARE_FIRST_NAMES.length;
  const out: string[] = [];
  for (let i = 0; i < SPARE_FIRST_NAMES.length && out.length < count; i++) {
    const given = SPARE_FIRST_NAMES[(start + i) % SPARE_FIRST_NAMES.length];
    if (given.toLowerCase() === first) continue;
    const name = surname ? `${given} ${surname}` : given;
    if (!taken.has(name.toLowerCase())) out.push(name);
  }
  return out;
}
