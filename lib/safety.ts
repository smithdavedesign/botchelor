/**
 * Content filter for character sheets and model-written episodes.
 *
 * It is deliberately strict (false positives get a 422 that names the field to edit) and
 * matches whole words/phrases on normalized text so "Essex" or "kidding" don't trip it.
 * It is a first line of defence, not a moderation system.
 */

export type RejectReason = "minor" | "sexual" | "real_person";
export type SafetyResult = { ok: true } | { ok: false; reason: RejectReason; field: string };

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
