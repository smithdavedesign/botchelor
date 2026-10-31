/**
 * Which language a piece of text is written in, without a model or a dependency: the writing system first (kana is
 * Japanese, Hangul Korean, Cyrillic Russian or Ukrainian…), then, for the Latin alphabet, which language's everyday
 * words and letters it uses most. Good enough to count which languages visitors and agents write in (lib/language-seen.ts)
 * and to tell a line that isn't English from one that is; not a translator's tool. Short or mixed text says null rather
 * than guessing.
 */

/** The languages it can name, with the name the show uses for each. */
export const LANGUAGE_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  id: "Indonesian",
  vi: "Vietnamese",
  ru: "Russian",
  uk: "Ukrainian",
  el: "Greek",
  ar: "Arabic",
  he: "Hebrew",
  hi: "Hindi",
  th: "Thai",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
} as const;
export type LanguageCode = keyof typeof LANGUAGE_NAMES;
/** Every code, in the order above (the builder's list, the character schema's enum). */
export const LANGUAGE_CODES = Object.keys(LANGUAGE_NAMES) as [LanguageCode, ...LanguageCode[]];

/** Fewer letters than this and the text is too short to say (a name, "ok", "jaja"). */
const MIN_LETTERS = 12;

/** Writing systems that point at one language (or a pair told apart below), as letter-class regexes. */
const SCRIPTS: readonly [LanguageCode, RegExp][] = [
  ["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ["ko", /\p{Script=Hangul}/gu],
  ["zh", /\p{Script=Han}/gu],
  ["ru", /\p{Script=Cyrillic}/gu],
  ["el", /\p{Script=Greek}/gu],
  ["ar", /\p{Script=Arabic}/gu],
  ["he", /\p{Script=Hebrew}/gu],
  ["hi", /\p{Script=Devanagari}/gu],
  ["th", /\p{Script=Thai}/gu],
];

const words = (s: string) => new Set(s.split(/\s+/));

/**
 * Each Latin-alphabet language's commonest short words: the ones a sentence can hardly avoid. A few are shared ("de",
 * "la", "e"); the count across a whole text still tells them apart.
 */
const EVERYDAY: Partial<Record<LanguageCode, Set<string>>> = {
  en: words("the a an and is are you that this with have for was not what but they my me i it's i'm your of to in it be just so do like don't we who on at or from can will all there their when about would been has had were if up out only someone people"),
  es: words("el la los las de que y es en un una por para con no mi tu su sus le pero como más muy yo qué está eso esta también porque hola gracias soy me te se lo del al estoy ella él hay fue usted"),
  fr: words("le la les de des est et je tu vous nous une pas qui pour avec dans sur ce cette mais très c'est j'ai suis mon ma oui bonjour merci du au il elle ne"),
  de: words("der die das und ist ich du nicht ein eine mit auf für zu den dem sie es wir aber auch sehr mein dass wie was hallo danke bin hast ja nein noch"),
  pt: words("o os as que de e é em um uma não para com por mas eu você muito meu minha isso está também obrigado obrigada olá sou tem do da no na ao então"),
  it: words("il lo gli la che di e è un una non per con ma io tu sono sei mi ti molto questo questa anche perché ciao grazie della del nel cosa come"),
  nl: words("de het een en is ik je jij niet van dat die met op voor maar ook zijn wat hoe hallo dank heel mijn er wel nog ben heb"),
  pl: words("i w z na nie się to jest że do jak ale co mnie mi jestem czy tak bardzo cześć dziękuję ty ja mój moja tylko już"),
  tr: words("ve bir bu da de ne için çok ben sen mi mı değil var yok ama gibi merhaba teşekkür evet hayır şey daha"),
  id: words("dan yang di ini itu aku saya kamu tidak ada dengan untuk dari apa juga sangat terima kasih halo ya bisa akan sudah"),
  vi: words("và là của không tôi bạn có một này được cho những rất cảm ơn xin chào anh em"),
};

/** Letters only one or two of them use, each worth a few everyday words. */
const MARKS: readonly [LanguageCode, RegExp, number][] = [
  ["es", /[ñ¿¡]|ción\b|dad\b/gu, 2],
  ["fr", /[êèëîïôûœ]|eau|qu'/gu, 1],
  ["pt", /[ãõ]/gu, 2],
  ["de", /ß/gu, 2],
  ["tr", /[ğşı]/gu, 3],
  ["pl", /[ąęłńśźż]/gu, 3],
  ["vi", /[đơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gu, 3],
];

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/**
 * The language `text` is written in, or null when it's too short or too mixed to say. URLs, emails and @handles are
 * dropped first, so a link doesn't read as English.
 */
export function detectLanguage(text: string | null | undefined): LanguageCode | null {
  const clean = (text ?? "")
    .replace(/https?:\/\/\S+|\S+@\S+|@\w+/g, " ")
    .toLowerCase()
    .replace(/[’‘]/g, "'");
  const letters = count(clean, /\p{L}/gu);
  if (letters < MIN_LETTERS) return null;

  // A writing system other than Latin, when it's most of the letters. Kana makes Han text Japanese; Ukrainian has
  // letters Russian doesn't.
  let best: [LanguageCode, number] | null = null;
  for (const [code, re] of SCRIPTS) {
    const n = count(clean, re);
    if (n && (!best || n > best[1])) best = [code, n];
  }
  if (best && best[1] >= letters * 0.4) {
    if (best[0] === "zh" && count(clean, SCRIPTS[0][1]) > 0) return "ja";
    if (best[0] === "ru" && /[іїєґ]/u.test(clean)) return "uk";
    return best[0];
  }

  const tokens = clean.split(/[^\p{L}']+/u).filter(Boolean);
  const scores = new Map<LanguageCode, number>();
  for (const [code, set] of Object.entries(EVERYDAY) as [LanguageCode, Set<string>][]) {
    let n = 0;
    for (const t of tokens) if (set.has(t)) n++;
    if (n) scores.set(code, n);
  }
  // A language's letters count only alongside its everyday words: a name ("Zdzisław Beksiński") in an English sentence
  // doesn't make it Polish.
  for (const [code, re, weight] of MARKS) {
    const n = count(clean, re);
    if (n && scores.has(code)) scores.set(code, scores.get(code)! + Math.min(n, 3) * weight);
  }
  const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]);
  const [top, second] = ranked;
  if (!top || top[1] < 2) return null;
  // A tie, or nearly one, is a mixed or ambiguous text: say nothing rather than guess.
  if (second && second[1] * 1.25 > top[1]) return null;
  return top[0];
}

/** The show's name for a language code ("es" → "Spanish"), or null for one it doesn't know. */
export function languageName(code: string | null | undefined): string | null {
  return code && code in LANGUAGE_NAMES ? LANGUAGE_NAMES[code as LanguageCode] : null;
}

/** Whether a text is confidently in a language other than English (unknown and English both say no). */
export const isNotEnglish = (text: string | null | undefined): boolean => {
  const lang = detectLanguage(text);
  return lang !== null && lang !== "en";
};
