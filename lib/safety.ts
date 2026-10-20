/**
 * Content filter for character sheets and model-written episodes.
 *
 * It is deliberately strict (false positives get a 422 that names the field to edit) and
 * matches whole words/phrases on normalized text so "Essex" or "kidding" don't trip it.
 * It is a first line of defence, not a moderation system.
 */

export type RejectReason = "minor" | "sexual" | "real_person";
export type SafetyResult = { ok: true } | { ok: false; reason: RejectReason; field: string };

/** What a refused character sheet is told: the builder's API (create and edit) and the OC chemistry test. */
export const CHARACTER_REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
};

const SEXUAL_TERMS = [
  "sex", "sexy", "sexual", "sexually", "sexting", "porn", "porno", "pornographic", "pornography",
  "nsfw", "nude", "nudes", "nudity", "naked", "erotic", "erotica", "orgasm", "orgasms", "orgy",
  "orgies", "fetish", "fetishes", "kink", "kinks", "kinky", "bdsm", "bondage", "horny", "lewd",
  "hentai", "smut", "smutty", "xxx", "onlyfans", "only fans", "stripper", "strippers", "strip club",
  "striptease", "lap dance", "prostitute", "prostitutes", "prostitution", "hooker", "hookers",
  "camgirl", "cam girl", "milf", "dilf", "dildo", "vibrator", "condom", "condoms", "blowjob",
  "handjob", "threesome", "one night stand", "intercourse", "genital", "genitals", "penis",
  "vagina", "boobs", "slut", "sluts", "whore", "whores", "rape", "raped", "rapist", "incest",
  "bestiality", "pedo", "pedophile", "paedophile", "aroused", "arousal", "masturbate",
  "masturbating", "masturbation", "make love", "making love",
];

const MINOR_TERMS = [
  "teen", "teens", "teenage", "teenaged", "teenager", "teenagers", "preteen", "pre teen", "tween",
  "tweens", "underage", "under age", "under 18", "under eighteen", "childlike", "child like",
  "loli", "lolis", "lolita", "lolicon", "shota", "shotacon", "jailbait", "barely legal",
  "schoolgirl", "schoolgirls", "schoolboy", "schoolboys", "school girl", "school boy",
  "high schooler", "high schoolers", "high school student", "still in high school",
  "attends high school", "goes to high school", "middle school", "middle schooler",
  "elementary school", "grade school", "grade schooler", "junior high", "kindergarten",
  "kindergartner", "little girl", "little boy", "young girl", "young boy",
];

// Well-known real people. Single-word entries are limited to names that are unambiguous on their own
// (so "trump card", "musk" the scent or "Adele" the first name stay allowed).
const REAL_PEOPLE = [
  "donald trump", "president trump", "melania trump", "ivanka trump", "joe biden", "barack obama",
  "michelle obama", "kamala harris", "hillary clinton", "bill clinton", "jd vance", "bernie sanders",
  "nancy pelosi", "alexandria ocasio cortez", "vladimir putin", "volodymyr zelensky", "xi jinping",
  "kim jong un", "narendra modi", "emmanuel macron", "keir starmer", "rishi sunak", "boris johnson",
  "justin trudeau", "angela merkel", "king charles", "prince harry", "prince william",
  "meghan markle", "kate middleton", "queen elizabeth", "pope francis", "pope leo",
  "elon musk", "mark zuckerberg", "jeff bezos", "bill gates", "steve jobs", "sam altman",
  "tim cook", "sundar pichai", "jensen huang", "taylor swift", "ariana grande", "billie eilish",
  "olivia rodrigo", "sabrina carpenter", "harry styles", "justin bieber", "selena gomez",
  "lady gaga", "katy perry", "dua lipa", "ed sheeran", "the weeknd", "kanye west", "kim kardashian",
  "kylie jenner", "kendall jenner", "travis scott", "doja cat", "nicki minaj", "cardi b",
  "megan thee stallion", "snoop dogg", "chappell roan", "charli xcx", "bruno mars", "post malone",
  "timothee chalamet", "tom holland", "pedro pascal", "jenna ortega", "sydney sweeney",
  "margot robbie", "ryan gosling", "ryan reynolds", "scarlett johansson", "jennifer lawrence",
  "leonardo dicaprio", "brad pitt", "angelina jolie", "tom cruise", "keanu reeves",
  "chris hemsworth", "chris evans", "robert pattinson", "kristen stewart", "emma watson",
  "daniel radcliffe", "dwayne johnson", "jacob elordi", "austin butler", "florence pugh",
  "anya taylor joy", "paul mescal", "glen powell", "jeremy allen white", "barry keoghan",
  "millie bobby brown", "henry cavill", "idris elba", "will smith", "johnny depp", "amber heard",
  "jennifer aniston", "tom hanks", "morgan freeman", "meryl streep", "cristiano ronaldo",
  "lionel messi", "lebron james", "serena williams", "simone biles", "travis kelce",
  "patrick mahomes", "michael jordan", "tom brady", "caitlin clark", "shohei ohtani",
  "lewis hamilton", "max verstappen", "usain bolt", "mr beast", "kai cenat", "logan paul",
  "jake paul", "andrew tate", "joe rogan", "oprah winfrey", "gordon ramsay", "addison rae",
  "charli damelio",
  "obama", "biden", "putin", "zelensky", "zuckerberg", "bezos", "beyonce", "rihanna", "zendaya",
  "eminem", "kardashian", "mrbeast", "pewdiepie", "ishowspeed", "pokimane", "chalamet", "dicaprio",
];

// " elon ?musk " matches "elon musk", "elon-musk" and "elonmusk", but only on whole words,
// so "victim cooks" never matches "tim cook".
const REAL_PEOPLE_PATTERNS = REAL_PEOPLE.map((name) => new RegExp(` ${name.split(" ").join(" ?")} `));

const UNDER_18 = "(?:[1-9]|1[0-7])";
const NOT_AN_AGE_AFTER = "(?!(?:\\d+|foot|feet|ft|cm|m|in|inch|inches|kg|lb|lbs|stone|of|out|percent|times)\\b)";
const MINOR_AGE_PATTERNS = [
  new RegExp(` ${UNDER_18} ?(?:years?|yrs?) old `),
  new RegExp(` ${UNDER_18} ?(?:yo|y o) `),
  new RegExp(` aged? ${UNDER_18} `),
  new RegExp(` (?:i am|im|i m|she is|shes|she s|he is|hes|he s|they are|theyre|they re) ${UNDER_18} ${NOT_AN_AGE_AFTER}`),
  / (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d+(?:st|nd|rd|th)) grader /,
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/** Lowercase, strip accents (Beyoncé → beyonce). */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** " word word " with every non-alphanumeric run turned into one space, padded for whole-phrase matching. */
function spaced(text: string): string {
  return ` ${text.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Joins runs of single-character tokens: " b d s m " → " bdsm ". */
function joinSpelledOut(text: string): string {
  const out: string[] = [];
  let run = "";
  for (const token of text.trim().split(" ")) {
    if (token.length === 1) {
      run += token;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(token);
  }
  if (run) out.push(run);
  return ` ${out.join(" ")} `;
}

const hasPhrase = (haystack: string, phrase: string) => haystack.includes(` ${phrase} `);

function classify(text: string): RejectReason | null {
  const folded = fold(text);
  const plain = spaced(folded);
  if (MINOR_TERMS.some((t) => hasPhrase(plain, t)) || MINOR_AGE_PATTERNS.some((re) => re.test(plain))) {
    return "minor";
  }

  const deleeted = spaced(folded.replace(/[013457@$!]/g, (c) => LEET[c]));
  const variants = [plain, deleeted, joinSpelledOut(plain), joinSpelledOut(deleeted)];
  if (SEXUAL_TERMS.some((t) => variants.some((v) => hasPhrase(v, t)))) return "sexual";

  const isRealPerson = REAL_PEOPLE_PATTERNS.some((re) => variants.some((v) => re.test(v)));
  return isRealPerson ? "real_person" : null;
}

// Lines a date's model writes can wander into a character's childhood with a number attached ("started at twelve on
// his uncle's lawnmower"). Harmless in a bio, but the show keeps every age on screen adult, so performed lines and
// recaps are held to this too (sheets aren't: a backstory may say "since she was a kid").
const AGE_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen";
const WORK_AGE_WORDS = "five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen";
const CHILD_AGE = `(?:${UNDER_18}|${AGE_WORDS})`;
const NOT_A_TIME = "(?!(?:am|pm|a m|p m|o clock|oclock|sharp|tonight|tomorrow|thirty|fifteen|forty|in the|every|this|on the dot)\\b)";
const CHILDHOOD_AGE_PATTERNS = [
  new RegExp(` (?:when|since|back when) (?:i|he|she|they|you|we) (?:was|were) (?:only |just |about |maybe |like |barely )?${CHILD_AGE} `),
  new RegExp(` (?:age|ages|aged) (?:of )?${CHILD_AGE} `),
  new RegExp(` ${CHILD_AGE} ?(?:years?|yrs?) old `),
  new RegExp(` (?:started|began|learned|learnt|first|working|worked|was) (?:[a-z]+ ){0,3}at (?:${WORK_AGE_WORDS}|[5-9]|1[0-7]) ${NOT_A_TIME}`),
];

/** checkFields, plus no character's age under 18 in passing: for what a date's performers and narrator write. */
export function checkShowText(fields: Record<string, string | readonly string[] | undefined>): SafetyResult {
  const first = checkFields(fields);
  if (!first.ok) return first;
  for (const [field, value] of Object.entries(fields)) {
    const texts = value === undefined ? [] : typeof value === "string" ? [value] : value;
    for (const text of texts) {
      const plain = spaced(fold(text));
      if (CHILDHOOD_AGE_PATTERNS.some((re) => re.test(plain))) return { ok: false, reason: "minor", field };
    }
  }
  return { ok: true };
}

// After dark is held tighter on age than the show: any "was / is / turned <age under 18>" counts, not only the
// "when she was" form, unless what follows makes it a time, an amount or a count ("was ten minutes late").
const NOT_AN_AMOUNT = "(?!(?:minutes?|mins?|seconds?|hours?|days?|weeks?|months?|o clock|oclock|am|pm|a m|p m|dollars?|bucks|pounds?|euros?|percent|times|of (?:us|them|you|those)|people|men|women|feet|foot|inches|miles|km|kilos?)\\b)";
const ADULT_AGE_PATTERNS = [
  new RegExp(` (?:was|is|am|are|were|turned|turns|turning|being|looks|look|looked|seems|seemed) (?:only |just |barely |about |maybe |like |not even |still )?${CHILD_AGE} ${NOT_AN_AMOUNT}`),
  new RegExp(` ${CHILD_AGE} (?:year old|years old|yo|y o)\\b`),
  // The contracted forms, spelled out or in digits: "she's sixteen", "im 15", "they're only fourteen".
  new RegExp(` (?:she s|shes|he s|hes|they re|theyre|i m|im|you re|youre|we re) (?:only |just |barely |about |maybe |like |not even |still )?${CHILD_AGE} ${NOT_AN_AMOUNT}`),
  // A steer or a line that makes someone younger: "make her sixteen", "pretend he's 15", "as if she were twelve".
  new RegExp(` (?:make|makes|made|making|play|plays|playing|pretend|pretends|pretending|act|acts|acting|roleplay|role play) (?:as )?(?:her|him|them|me|you|she s|he s|they re|she is|he is|it)? ?(?:a |an )?(?:${CHILD_AGE}) ${NOT_AN_AMOUNT}`),
  new RegExp(` as if (?:she|he|they|i|you) (?:were|was|is|are) ${CHILD_AGE} `),
];

/**
 * After dark (lib/adult): adult content is allowed there, so this keeps only the two lines that hold everywhere:
 * nobody under 18 (in any form, including an age in passing) and no real, identifiable people.
 */
export function checkAdultText(fields: Record<string, string | readonly string[] | undefined>): SafetyResult {
  for (const [field, value] of Object.entries(fields)) {
    const texts = value === undefined ? [] : typeof value === "string" ? [value] : value;
    for (const text of texts) {
      const folded = fold(text);
      const plain = spaced(folded);
      if (
        MINOR_TERMS.some((t) => hasPhrase(plain, t)) ||
        MINOR_AGE_PATTERNS.some((re) => re.test(plain)) ||
        CHILDHOOD_AGE_PATTERNS.some((re) => re.test(plain)) ||
        ADULT_AGE_PATTERNS.some((re) => re.test(plain))
      ) {
        return { ok: false, reason: "minor", field };
      }
      const deleeted = spaced(folded.replace(/[013457@$!]/g, (c) => LEET[c]));
      const variants = [plain, deleeted, joinSpelledOut(plain), joinSpelledOut(deleeted)];
      if (REAL_PEOPLE_PATTERNS.some((re) => variants.some((v) => re.test(v)))) return { ok: false, reason: "real_person", field };
    }
  }
  return { ok: true };
}

/** Checks each field in order and reports the first one that fails. */
export function checkFields(fields: Record<string, string | readonly string[] | undefined>): SafetyResult {
  for (const [field, value] of Object.entries(fields)) {
    const texts = value === undefined ? [] : typeof value === "string" ? [value] : value;
    for (const text of texts) {
      const reason = classify(text);
      if (reason) return { ok: false, reason, field };
    }
  }
  return { ok: true };
}
