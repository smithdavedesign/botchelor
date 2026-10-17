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
