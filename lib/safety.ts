/**
 * Content filter for character sheets and model-written episodes.
 *
 * It is deliberately strict (false positives get a 422 that names the field to edit) and
 * matches whole words/phrases on normalized text so "Essex" or "kidding" don't trip it.
 * It is a first line of defence, not a moderation system.
 */

import { isNotEnglish } from "./language";

/**
 * `unread`: text in another language the show's model couldn't translate for the check just now (lib/language-check.ts;
 * try again). `language`: After Dark is English-only until its checks are proven in other languages (David, 2026-10-31).
 */
export type RejectReason = "minor" | "sexual" | "real_person" | "innuendo" | "unread" | "language";
/** After Dark's themes that never happen (checkAdultText): family and step-family, teacher and student, school, age-play. */
export type ExcludedTheme = "family" | "teacher_student" | "school" | "age_play" | "non_consent" | "bestiality" | "sexual_violence";
export type SafetyResult = { ok: true } | { ok: false; reason: RejectReason; field: string; theme?: ExcludedTheme; /** `unread`: the language it's in. */ language?: string };

/** What a refused character sheet is told: /create's save (POST /api/characters) and the OC chemistry test say the same. */
export const CHARACTER_REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
  innuendo: "Keep the character sheet free of innuendo.",
  unread: "We couldn't check a sheet in that language just now. Try again in a minute.",
  language: "After Dark is English-only for now.",
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

// A thing's age, said right before the thing ("a sixteen-year-old fountain", "a twelve year old whisky"), isn't a
// person's (#1210; David, 2026-11-01: allow it for a short list of things, everything else stays refused). Only these
// words, only straight after "<age> year old": never a pet, a doll, a photo or anything a person could be.
const THINGS = "fountain|house|home|building|bridge|tower|church|chapel|barn|cabin|hotel|bar|pub|restaurant|cafe|bakery|shop|store|theater|theatre|tree|oak|vine|garden|wine|whisky|whiskey|scotch|bourbon|rum|cognac|port|brandy|car|truck|van|bike|motorcycle|boat|ship|clock|piano|guitar|violin|cello|record|book|map|coat|jacket|recipe|painting|statue|sculpture|rug|sofa|couch|table|machine|laptop|computer|phone";
const A_THINGS_AGE = `(?!(?:${THINGS})s? )`;
const UNDER_18 = "(?:[1-9]|1[0-7])";
const NOT_AN_AGE_AFTER = "(?!(?:\\d+|foot|feet|ft|cm|m|in|inch|inches|kg|lb|lbs|stone|of|out|percent|times)\\b)";
const MINOR_AGE_PATTERNS = [
  new RegExp(` ${UNDER_18} ?(?:years?|yrs?) old ${A_THINGS_AGE}`),
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

  const isRealPerson = REAL_PEOPLE_PATTERNS.some((re) => variants.some((v) => re.test(v))) || UNNAMED_LOOKALIKE.some((re) => re.test(plain));
  return isRealPerson ? "real_person" : null;
}

/**
 * A real person without a name (2026-10-25, a sheet said "she looks exactly like someone famous"): a famous person's
 * double is still a real person's face. On the normalised text.
 */
const UNNAMED_LOOKALIKE = [
  / (?:looks?|looking|resembles?|resembling) (?:exactly |just |almost |a lot |identical )*like (?:a |an |some |someone |somebody )?(?:famous|celebrity|celebrities|real|well known) /,
  / (?:celebrity|celeb|famous|movie star|pop star) (?:look ?alike|lookalike|double|doppelganger|twin|clone) /,
  / (?:look ?alike|lookalike|doppelganger|double) of (?:a |an |some |someone )?(?:famous|celebrity|real) /,
  / (?:famous|celebrity|real) \w+ s (?:double|doppelganger|lookalike|look alike|twin) /,
];

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
  new RegExp(` ${CHILD_AGE} ?(?:years?|yrs?) old ${A_THINGS_AGE}`),
  new RegExp(` (?:started|began|learned|learnt|first|working|worked|was) (?:[a-z]+ ){0,3}at (?:${WORK_AGE_WORDS}|[5-9]|1[0-7]) ${NOT_A_TIME}`),
];

// #474: the show's rule is "no sexual content, nudity or innuendo; at most a hug or a kiss on the cheek" (lib/showrunner.ts,
// lib/conversation.ts). The word list above catches the explicit; these catch the stock innuendo lines that carry no
// explicit word ("is that a barometer in your pocket or are you just pleased to see me", "that's what she said"). Whole
// phrases only, on the same normalised text, so an ordinary line ("I got lucky with the weather", "my place has a view")
// never trips it. Deterministic and free, like the rest of this file: no model call.
const INNUENDO_PATTERNS = [
  / in (?:your|my) (?:pocket|pants|trousers) or (?:are|am) (?:you|i) (?:just |simply |merely )?(?:happy|pleased|glad|excited|thrilled) to see /,
  / is that (?:an?|the|your) (?:[a-z]+ ){0,3}in your (?:pocket|pants|trousers) /,
  / (?:just )?(?:happy|pleased|glad) to see me or (?:is that|was that|are you) /,
  / that s what (?:she|he) said /,
  / thats what (?:she|he) said /,
  / netflix and chill /,
  / wink wink /,
  / nudge nudge /,
  / (?:get|getting|got) lucky tonight /,
  / (?:take|taking|took) (?:this|it|things|us) (?:to the bedroom|upstairs to bed|to bed) /,
  / (?:get|getting) (?:you|me|her|him|them) into bed /,
  / between the sheets /,
  / under the covers with /,
  / (?:sleep|sleeping|slept) with (?:you|me|her|him|them) /,
  / (?:sleep|sleeping) together /,
  / spend the night together /,
  / friends with benefits /,
  / booty call /,
  / walk of shame /,
  / hanky panky /,
  / rock your world /,
  / (?:do|did|doing) the deed /,
  / (?:bedroom eyes|in the sack) /,
];

/** checkFields, plus no character's age under 18 in passing, and no innuendo (#474): for what a date's performers and narrator write. */
export function checkShowText(fields: Record<string, string | readonly string[] | undefined>): SafetyResult {
  const first = checkFields(fields);
  if (!first.ok) return first;
  for (const [field, value] of Object.entries(fields)) {
    const texts = value === undefined ? [] : typeof value === "string" ? [value] : value;
    for (const text of texts) {
      const plain = spaced(fold(text));
      if (CHILDHOOD_AGE_PATTERNS.some((re) => re.test(plain))) return { ok: false, reason: "minor", field };
      if (INNUENDO_PATTERNS.some((re) => re.test(plain))) return { ok: false, reason: "innuendo", field };
    }
  }
  return { ok: true };
}

// After dark is held tighter on age than the show: any "was / is / turned <age under 18>" counts, not only the
// "when she was" form, unless what follows makes it a time, an amount or a count ("was ten minutes late").
const NOT_AN_AMOUNT = "(?!(?:minutes?|mins?|seconds?|hours?|days?|weeks?|months?|o clock|oclock|am|pm|a m|p m|dollars?|bucks|pounds?|euros?|percent|times|of (?:us|them|you|those|the|my|your|his|her|their|our|these)|people|men|women|ladies|guys|couples|lovers|strangers|friends|drinks|shots|glasses|rounds|feet|foot|inches|miles|km|kilos?|floors|blocks|steps)\\b)";
// "One" and "two" are a count far more often than an age ("she's one hot woman", "he's one of a kind", "there are two
// ladies watching", "as if they were two strangers"), so after these verbs they count only at the end of a clause or
// running on into an age's own words ("she's two.", "he is one and a half", "she's two now"): ONE_OR_TWO_AGE_PATTERNS,
// on each clause. Every other age under 18 counts wherever what follows isn't an amount.
const OLDER_CHILD_AGE = `(?:${UNDER_18}|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)`;
const SAYS_AN_AGE = [
  " (?:was|is|am|are|were|turned|turns|turning|being|looks|look|looked|seems|seemed) (?:only |just |barely |about |maybe |like |not even |still )?",
  // The contracted forms, spelled out or in digits: "she's sixteen", "im 15", "they're only fourteen".
  " (?:she s|shes|he s|hes|they re|theyre|i m|im|you re|youre|we re) (?:only |just |barely |about |maybe |like |not even |still )?",
  // A steer or a line that makes someone younger: "make her sixteen", "pretend he's 15", "as if she were twelve".
  " (?:make|makes|made|making|play|plays|playing|pretend|pretends|pretending|act|acts|acting|roleplay|role play) (?:as )?(?:her|him|them|me|you|she s|he s|they re|she is|he is|it)? ?(?:a |an )?",
  " as if (?:she|he|they|i|you) (?:were|was|is|are) ",
];
const ADULT_AGE_PATTERNS = [
  ...SAYS_AN_AGE.map((says) => new RegExp(`${says}${OLDER_CHILD_AGE} ${NOT_AN_AMOUNT}`)),
  new RegExp(` ${CHILD_AGE} (?:year old|years old|yo|y o)\\b(?! (?:${THINGS})s? )`),
];
const ONE_OR_TWO_AGE_PATTERNS = SAYS_AN_AGE.map(
  (says) => new RegExp(`${says}(?:one|two) (?=$|(?:and|or|but|maybe|now|today|already|years?|yrs?|yo|y o)\\b)`),
);

/** A text's clauses, each spaced like the whole, so a clause ends where its sentence or comma does ("she's two."). */
const clausesOf = (folded: string) => folded.split(/[.,!?;:()…—–"“”\n]+/).map(spaced);

// After Dark's themes that never happen (David's lines, 2026-10-22: no school settings, no "teen", no age-play; no
// step-family, incest or teacher/student roleplay). On the same normalised text as everything above. Whole phrases, so a
// ballroom instructor's beginners' class, "my sister set us up", "old school" or "let's play a little game" pass, while
// any roleplay of family, a teacher or a pupil, a school setting or an age-play term is refused, in a steer, a line, a
// suggestion, a whisper or a scenario alike. "schoolgirl", "barely legal" and the like are already minor terms above.
const KIN = "sister|sis|brother|bro|mom|mum|mommy|mummy|mother|dad|daddy|father|daughter|son|sibling|siblings|parent|parents|aunt|auntie|uncle|cousin|niece|nephew|grandma|grandpa|grandmother|grandfather";
const ROLE = "pretend|pretends|pretending|play|plays|playing|roleplay|roleplays|roleplaying|role play|role playing|act|acts|acting|be";
const EXCLUDED_THEMES: [ExcludedTheme, RegExp][] = [
  ["family", new RegExp(` step ?(?:${KIN}|family|kid|kids|child|children) `)],
  ["family", / incest\w* /],
  ["family", new RegExp(` (?:${ROLE}) (?:like )?(?:you re |youre |you are |i m |im |i am |she s |shes |he s |hes |that )?(?:my|your|her|his|our) (?:${KIN}) `)],
  ["family", / (?:call me|calls me|calling me|yes|please|who s your|whos your) (?:daddy|mommy|mummy) /],
  ["family", / (?:daddy|mommy|mummy) s (?:girl|boy|good girl|good boy|little) /],
  ["teacher_student", / (?:teacher|professor|tutor|headmaster|headmistress|principal) and (?:his |her |the |a )?(?:student|pupil) /],
  ["teacher_student", / (?:student|pupil) and (?:his |her |the |a )?(?:teacher|professor|tutor|headmaster|headmistress|principal) /],
  ["teacher_student", / (?:my|your) (?:teacher|professor|headmaster|headmistress|principal) /],
  ["teacher_student", / (?:naughty|bad|good|dirty|favorite|favourite) (?:student|pupil) /],
  ["teacher_student", new RegExp(` (?:${ROLE}) (?:the |a |my |your )?(?:teacher|professor|student|pupil|headmaster|headmistress) `)],
  ["teacher_student", / detention /],
  ["school", / school (?:uniform|uniforms|girl|girls|boy|boys|bus|yard|kid|kids|dance|locker) /],
  ["school", / (?:high|middle|grade|primary|elementary|secondary|boarding|prep|catholic) school /],
  ["school", / (?:classroom|classrooms|homeroom|schoolyard|playground|prom night|principal s office) /],
  ["age_play", / (?:age ?play|ageplay|ddlg|mdlg|cgl|abdl|diaper|diapers|pacifier|binky|little one) /],
  ["age_play", new RegExp(` (?:${ROLE})\\b[a-z ]{0,24}\\b(?:younger|underage|a kid|a child|a minor) `)],
  // 2026-10-24 (docs/after-dark-legal-review.md "Content lines", David's OK): every adult processor and card network bans
  // these in text as well as pictures, roleplayed or not. Phrases, so "she pins him to the wall", "a dog-eared book",
  // "the sleepy bar" or "she bit her lip until it bled" pass.
  ["non_consent", / (?:rape|raped|rapes|raping|rapist|rapey|molest\w*|sexual assault|sexually assault\w*|non ?con|non ?consensual|non ?consent|cnc|no means yes|free use) /],
  ["non_consent", / (?:against (?:her|his|their|my|your) will|without (?:her|his|their|my|your) consent|(?:says|said|saying|screams|screamed|begs|begged) no but) /],
  ["non_consent", / (?:drugged|drugging|drugs her|drugs him|roofie\w*|spiked (?:her|his) drink) /],
  ["non_consent", / (?:while|as) (?:she|he|they) (?:s |is |are |was |were )?(?:asleep|sleeping|unconscious|passed out|blacked out) /],
  ["non_consent", / (?:asleep|sleeping|unconscious|passed out|blacked out) (?:sex|fuck\w*|girl|woman|man|guy|body) /],
  ["non_consent", / (?:forced|force|forces|forcing) (?:her|him|them|me|you) (?:to )?(?:have sex|fuck|suck|strip|kneel|submit|take it|swallow) /],
  ["non_consent", / (?:kidnap\w*|abduct\w*|captive sex|sex slave|blackmail\w* (?:her|him|them) into) /],
  ["bestiality", / (?:bestiality|beastiality|zoophil\w*) /],
  ["bestiality", / (?:fuck\w*|sex with|mount\w*|knotted by|bred by|breeding with|rides|riding|sucks|sucking) (?:a |an |the |his |her |their |my |your )?(?:dog|dogs|horse|horses|stallion|animal|animals|pony|goat|pig|beast|wolf|wolves) /],
  ["sexual_violence", / (?:snuff|necrophil\w*|corpse|mutilat\w*|dismember\w*|disembowel\w*|gore|guro|tortur\w*) /],
  ["sexual_violence", / (?:knife|blood|gun|needle) play /],
  ["sexual_violence", / (?:choke|chokes|choking|strangle\w*) (?:her|him|them|me|you) (?:to death|until (?:she|he|they) (?:dies|die|passes out|pass out|blacks out|black out)|unconscious) /],
  ["sexual_violence", / (?:kill|kills|killing|murder\w*|stab\w*) (?:her|him|them|me|you) (?:while|during|after|as) /],
];

/** The excluded theme a text plays, or null (After Dark only: the show is held to checkFields and checkShowText). */
export function excludedTheme(text: string): ExcludedTheme | null {
  const plain = spaced(fold(text));
  for (const [theme, re] of EXCLUDED_THEMES) if (re.test(plain)) return theme;
  return null;
}

/**
 * After dark (lib/adult): adult content is allowed there, so this keeps only the lines that hold everywhere: nobody
 * under 18 (in any form, including an age in passing, and nothing that suggests one: no school setting, no age-play), no
 * family or step-family and no teacher/student roleplay, no non-consent, bestiality or sexual violence (excludedTheme),
 * and no real, identifiable people.
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
        ADULT_AGE_PATTERNS.some((re) => re.test(plain)) ||
        clausesOf(folded).some((clause) => ONE_OR_TWO_AGE_PATTERNS.some((re) => re.test(clause)))
      ) {
        return { ok: false, reason: "minor", field };
      }
      const theme = excludedTheme(text);
      if (theme) return { ok: false, reason: theme === "school" || theme === "age_play" ? "minor" : "sexual", field, theme };
      const deleeted = spaced(folded.replace(/[013457@$!]/g, (c) => LEET[c]));
      const variants = [plain, deleeted, joinSpelledOut(plain), joinSpelledOut(deleeted)];
      if (REAL_PEOPLE_PATTERNS.some((re) => variants.some((v) => re.test(v)))) return { ok: false, reason: "real_person", field };
      // These lists read English: until they're proven in other languages, After Dark is English-only (David, 2026-10-31).
      if (isNotEnglish(text)) return { ok: false, reason: "language", field };
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

// The PG Studio's own words (an owner's words for a picture of their character, shown to anyone): the show's check, plus
// what a show picture must not ask for even when the words aren't sexual on their own (underwear, sheer, topless…).
// Swimwear words pass: the picture's check makes swimwear away from a beach "suggestive", never PG.
const PG_PICTURE_TERMS = [
  "lingerie", "underwear", "undies", "bra", "bras", "bralette", "panties", "panty", "knickers", "thong", "thongs", "g string",
  "garter", "garters", "stockings and suspenders", "corset", "negligee", "teddy lingerie", "boudoir", "topless", "bottomless",
  "shirtless and wet", "see through", "seethrough", "sheer top", "sheer dress", "transparent top", "nipple", "nipples",
  "cleavage", "underboob", "sideboob", "busty", "booty", "butt", "buttocks", "ass", "crotch", "groin", "bulge", "thighs apart",
  "spread legs", "legs spread", "bent over", "on all fours", "seductive", "sultry", "provocative", "suggestive", "risque",
  "racy", "naughty", "steamy", "pin up", "pinup", "oiled", "wet t shirt", "body paint", "bodypaint", "censored",
  "covering herself", "covering himself", "towel only", "in a towel", "bath", "bathtub", "shower", "in bed", "bedroom",
];

/** "looks like Taylor Swift", "dressed as Keanu Reeves": a picture made to look like a real, named person. */
const LOOKALIKE = /\b(?:looks? like|looking like|resembl(?:e|es|ing)|look ?-?alike(?: of)?|dressed (?:up )?as|cosplay(?:ing)? as|in the likeness of|the face of)\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+/u;

/**
 * The PG Studio's word check (the plan's pgWordsOk): the show's check (no sex, no minors, no named real people, no
 * innuendo), the picture terms above, and no "looks like <Name Surname>". Fails on the first field that crosses one.
 */
export function checkPgPictureText(fields: Record<string, string | readonly string[] | undefined>): SafetyResult {
  const show = checkShowText(fields);
  if (!show.ok) return show;
  for (const [field, value] of Object.entries(fields)) {
    const texts = value === undefined ? [] : typeof value === "string" ? [value] : value;
    for (const text of texts) {
      if (LOOKALIKE.test(text)) return { ok: false, reason: "real_person", field };
      const plain = spaced(fold(text));
      if (PG_PICTURE_TERMS.some((t) => hasPhrase(plain, t))) return { ok: false, reason: "sexual", field };
    }
  }
  return { ok: true };
}
