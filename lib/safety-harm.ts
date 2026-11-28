/**
 * The lines that hold on every surface, the PG show and After Dark alike (David, 2026-11-28): no hate or -isms (racism,
 * sexism, homophobia, transphobia, religious and ethnic hate, ableist slurs), no telling anyone to hurt or kill
 * themselves, no threats of real violence, and no personal info (a phone number, an email address, a street address).
 * Insults and trash talk are allowed: villains and show drama need them ("you're a snake", "I can't stand you").
 *
 * Found in testing (2026-11-27): a sheet with a racist bio and "immigrants" as its dealbreaker saved and booked dates, and
 * texts and confessionals with "kill yourself", slurs and phone numbers went straight through. lib/safety.ts runs these
 * inside its own checks, so every surface that already checks its text (sheets, texts, confessionals, the market, tips,
 * letters, clubs, chats, MCP tools) gets them. Whole words and phrases on normalised text, like the rest of the filter:
 * deterministic, free, no model call.
 */

import type { HarmReason } from "./safety-reasons";
import { escapeRegExp } from "./text";

export type HarmMatch = { reason: HarmReason; phrase: string };

// Slurs, matched as whole words on the normalised text (and its de-leeted and spelled-out forms). Left out on purpose
// because they're ordinary words too: "coon" (Maine coon), "fag" (a cigarette in the UK), "chink" (in the armour),
// "retard" (French for late), "jap", "cracker", "negro" (Spanish and Portuguese for black).
const SLURS = [
  "nigger", "niggers", "nigga", "niggas", "niggaz", "nigguh", "niglet", "sand nigger", "porch monkey", "jigaboo", "jiggaboo",
  "golliwog", "chinky", "gook", "gooks", "zipperhead", "zipperheads", "slant eye", "slant eyes", "slanty",
  "chinaman", "spic", "spics", "wetback", "wetbacks", "beaner", "beaners", "kike", "kikes", "yid", "yids",
  "raghead", "ragheads", "towelhead", "towelheads", "camel jockey", "paki", "pakis", "gyppo", "gyppos", "pikey", "pikeys",
  "faggot", "faggots", "fagot", "dyke", "dykes", "tranny", "trannies", "trannys", "shemale", "shemales",
  "retarded", "mongoloid", "mongoloids",
];

// Hate slogans and symbols.
const SLOGANS = [
  "heil hitler", "sieg heil", "white power", "white pride", "1488", "14 88", "fourteen words", "master race", "race traitor",
  "race traitors", "white genocide", "great replacement", "subhuman", "subhumans", "sub human", "untermensch", "gas the jews",
  "go back to your country", "go back to your own country", "go back where you came from", "go back to where you came from",
];

// A group of people by race, ethnicity, nationality, religion, sexuality, gender identity or disability: a plural noun or
// "<adjective> people". Plural nouns only, so "no Chinese food", "a Mexican dinner" or "no trans fats" never reads as one.
const GROUP_ADJ =
  "black|white|brown|asian|chinese|japanese|korean|indian|mexican|latino|latina|latinx|hispanic|arab|african|middle eastern|" +
  "jewish|muslim|christian|catholic|hindu|sikh|buddhist|trans|transgender|nonbinary|non binary|disabled|autistic|immigrant|foreign|romani";
const GROUP_NOUN =
  "immigrants|migrants|refugees|foreigners|illegals|illegal aliens|muslims|moslems|jews|christians|catholics|hindus|sikhs|" +
  "buddhists|blacks|asians|mexicans|latinos|latinas|hispanics|arabs|africans|indians|pakistanis|gypsies|transgenders|" +
  "transsexuals|cripples|the disabled|people of colou?r";
// The groups a dealbreaker can't rule out. Not men, women, gay or straight: who someone dates is theirs to say.
const DATING_GROUP = `(?:(?:${GROUP_ADJ}) (?:people|folk|folks|men|women|guys|girls|persons|immigrants)|${GROUP_NOUN})`;
// The same, plus sexuality, for what can't be said about a group anywhere.
const GROUP = `(?:${DATING_GROUP}|(?:gay|lesbian|bisexual|queer) (?:people|folk|folks|men|women|guys|girls|persons)|whites|gays|lesbians|homosexuals|queers|bisexuals)`;
const GENDER = "(?:women|men|girls|females|males|guys)";

const DEMEAN =
  "animals|vermin|rats|cockroaches|roaches|parasites|subhuman|sub human|inferior|scum|trash|garbage|filth|disgusting|evil|" +
  "criminals|terrorists|rapists|savages|a disease|a plague|a cancer|the problem|ruining (?:this|our|the) country|invading|" +
  "not (?:real )?people|not human|mentally ill|abominations?|an abomination|degenerates?|groomers|pedophiles|paedophiles|" +
  "dogs|apes|monkeys|stupid|dumb|lesser|worthless|less than|a mistake|unnatural|freaks";
const DEMEAN_GENDER =
  "inferior|subhuman|property|objects|worthless|less than|lesser|stupider|not people|not human|a mistake|only good for|" +
  "meant to serve|born to serve|whores|sluts|incapable";
const DET = "(?:(?:all|the|those|these|most|filthy|dirty|stinking|stupid|damn|fucking|every|any|you) )*";
const ARE = "(?:are|r|is|were) (?:(?:all|just|nothing but|basically|a bunch of|such|so|literally|naturally|born) )*";

const HATE_PATTERNS = [
  // "immigrants are vermin", "all Muslims are terrorists", "gay people are an abomination".
  new RegExp(` ${DET}${GROUP} ${ARE}(?:${DEMEAN}) `),
  // "women are inferior", "men are only good for…". Not "the girls are taking over the dance floor".
  new RegExp(` ${DET}${GENDER} ${ARE}(?:${DEMEAN_GENDER}) `),
  // "dirty immigrants", "filthy Jews".
  new RegExp(` (?:filthy|dirty|stinking|stinky|disgusting|fucking|damn|bloody) ${GROUP} `),
  // "I hate immigrants", "I hate women"; but "I can't stand men who chew loudly" is a dealbreaker, not hate.
  new RegExp(` (?:hate|hates|hated|despise|despises|detest|detests|loathe|loathes) ${DET}(?:${GROUP}|${GENDER}) (?!(?:who|that|which|when|with|in|on|at|like|chewing|talking|being|ghosting|lying) )`),
  // "deport them all", "gas the Jews", "kill all gays", "kill all men".
  new RegExp(` (?:kill|deport|ban|gas|exterminate|eradicate|wipe out|get rid of|lynch|hang|shoot|burn|purge|cleanse) ${DET}${GROUP} `),
  / (?:kill|exterminate|eradicate) all (?:women|men) /,
  // Ruling a race, religion or nationality out of dating: "no Asians", "won't date Black women", "not into Muslims".
  new RegExp(` (?:no|not|never|nope to|wont date|won t date|will not date|would never date|wouldnt date|wouldn t date|refuse to date|don t date|dont date|do not date|not into|not dating|never dating|anyone but|anything but|except) (?:(?:any|all|the|with) )*${DATING_GROUP} `),
  / (?:a |the )?wom[ae]n s place is (?:in the kitchen|in the home|at home|barefoot) /,
  / wom[ae]n (?:belong|belongs) (?:in the kitchen|at home|barefoot) /,
  / wom[ae]n (?:should|shouldn t|shouldnt|should not) (?:not )?(?:vote|work|have rights|be allowed to|speak|be equal) /,
  / (?:being )?(?:gay|trans|transgender|queer|bi) is (?:a sin|a disease|an illness|a mental illness|wrong|unnatural|disgusting|an abomination) /,
];

// A dealbreaker that is nothing but a group: "immigrants", "Black people", "no Muslims". The sheet's dealbreaker is shown
// on dates and quizzed on, so a group on its own there rules a whole people out.
const DEALBREAKER_FILLER = /^(?: (?:no|any|all|the|dating|being|someone|somebody|anyone|people|who|is|are|s|re|a|an|being|with|from|or|and|nor|ever|literally|just|definitely|absolutely))* /;
const DEALBREAKER_GROUP = new RegExp(`^ ${DATING_GROUP}(?: (?:or|and) ${DATING_GROUP})* $`);

// Telling someone to hurt or kill themselves. Not the idioms: "don't kill yourself over it", "you'll kill yourself
// laughing", "shoot yourself in the foot", "I could just die of embarrassment".
const SELF_HARM_PATTERNS = [
  /(?<! (?:don t|dont|do not|not|never|didn t|didnt|won t|wont|ll|you ll|you will)) (?:kill|hang|shoot|off|end|unalive|neck|rope|delete) (?:your ?self|yourselves|urself|ur self|yaself) (?!(?:laughing|over|working|trying|in the foot|for (?:it|this|that|work|me|us)|with work|to)\b)/,
  / kys /,
  / (?:go|please|pls|plz) (?:and )?(?:die|drown|jump off a (?:bridge|cliff|building)) (?!(?:of|from|laughing|happy|trying)\b)/,
  / just (?:die|drown) already /,
  / (?:hope|wish) (?:you|u) (?:die|get cancer|get hit by a|drown|choke and die|rot) (?!(?:of|laughing|happy)\b)/,
  / (?:you|u) (?:should|deserve to|ought to|need to) (?:die|be dead|not exist|not be alive|kill your ?self|hurt your ?self) /,
  / (?:drink|go drink) bleach /,
  / (?:slit|cut|slash) (?:your|ur) (?:wrists?|throat) /,
  / (?:nobody|no one|noone) would (?:miss|care if) (?:you|u) /,
  / (?:the )?world (?:would be|d be) better (?:off )?without (?:you|u) /,
  / die in a (?:fire|hole|ditch) /,
];

// Threats of real violence at a person: "I'll kill you", "I know where you live". Trash talk passes (David: villains
// need it), and so does play: "I could kill for a coffee", "you're killing me", "I'll murder you at karaoke", "I'll shoot
// you a text".
const THREAT_PATTERNS = [
  / (?:i ll|ill|i will|i m going to|im going to|i m gonna|im gonna|i am going to|i am gonna|we ll|we will|we re going to|we re gonna) (?:(?:fucking|really|actually|literally|personally|come and|come|find you and|hunt you down and) )*(?:kill|murder|stab|shoot|strangle|rape|behead|torture|break your (?:legs?|neck|jaw)) (?:you|u|your family|your kids|your wife|your husband)(?: |$)(?!(?:in|at|on|a|an|with|over)\b)/,
  / i know where (?:you|u) (?:live|work|sleep) /,
  / (?:i ll|ill|i will|i m going to|im going to|i m gonna|im gonna) (?:find|hunt) (?:you|u) (?:down|and (?:kill|hurt|end)) /,
  / (?:shoot up|bomb|blow up) (?:the|your|this|that|a) (?:school|office|church|mosque|synagogue|temple|clinic|mall|concert) /,
];

// Personal info. On the folded text with its punctuation, since an email or a phone number is mostly punctuation.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/;
const EMAIL_SPELLED = / [a-z0-9._]+ (?:at|@) (?:gmail|googlemail|yahoo|hotmail|outlook|icloud|aol|proton|protonmail|msn|gmx|yandex) (?:dot )?(?:com|net|org|co uk|me|ru|de|fr) /;
// A phone number, in the shapes people write one: +44 7700 900123, +1 (555) 123-4567, (555) 123-4567, 555.123.4567,
// 07700 900123, or a local 555-1234. Not a date ("2026-10-21"), a decimal, an IP address or an id: those either have the
// wrong shape or run into letters, dots or more digits.
const EDGE_BEFORE = "(?<![\\w.,:/+-])";
const EDGE_AFTER = "(?![\\w,:/-]|\\.\\d)";
const PHONE = new RegExp(
  `${EDGE_BEFORE}(?:\\+\\d{1,3}[\\s.-]?(?:\\(\\d{1,5}\\)|\\d{1,5})(?:[\\s.-]?\\d{2,5}){1,4}|\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]\\d{4}|\\(\\d{3}\\)\\d{3}\\d{4}|0\\d{2,4}[\\s-]\\d{3,4}[\\s-]?\\d{3,4})${EDGE_AFTER}`,
  "g",
);
const LOCAL_PHONE = new RegExp(`${EDGE_BEFORE}\\d{3}[.-]\\d{4}${EDGE_AFTER}`);
const NUMBER_LEADIN = / (?:(?:my|his|her|their|our) (?:number|phone|cell|mobile|whatsapp|telegram|signal) (?:number )?(?:is|s)|(?:call|text|ring|whatsapp) (?:me )?(?:at |on )?) \d{7}/;
// Whole words only: "st" and "dr" are a saint and a doctor as often as a street ("my 2 favourite Dr Who episodes").
const STREET_SUFFIX = "street|avenue|ave|road|rd|lane|boulevard|blvd|drive|terrace|crescent|highway";
const NOT_A_STREET_WORD =
  "(?!(?:the|a|an|of|on|to|from|in|at|down|up|along|across|off|by|for|and|or|with|my|your|our|their|his|her|best|worst|favou?rite|great|good|bad|hour|minute|mile|miles?|km|kilometres?|kilometers?|minutes?|mins?|hours?|hrs?|blocks?|steps?|doors?|houses?|times?|years?|days?|weeks?|months?|people|friends|kids|cats|dogs|more|other|different|new|old|long|short)\\b)";
const ADDRESS = [
  // Not a year or a decade: "a 1960s film street", "2023 Shinjuku street".
  new RegExp(` (?!(?:1[89]|20)\\d\\d)\\d{1,5}[a-h]? (?:${NOT_A_STREET_WORD}[a-z]{2,} ){1,3}(?:${STREET_SUFFIX}) (?!(?:trips?|rage|map|maps|test|tests|show|race|races|runner|kill|block|portraits?|photography|photos?|art|style|food|smarts?|lights?|level|view|cred|fashion|wear|signs?|vendors?|performers?|party|parties|corner|scene|cats?|dogs?)\\b)`),
  / (?:my|his|her|their|our) (?:home |house |street |postal |mailing )?address (?:is|s) /,
  / (?:apt|apartment|unit|flat|suite) (?:no |number |#)?\d+[a-z]? (?:at |on )?\d{1,5} /,
  / (?:zip|zip code|postcode|post code|postal code) (?:is |s )?(?:\d{5}|[a-z]{1,2}\d[a-z\d]? ?\d[a-z]{2}) /,
];

// A date or a timestamp ("2026-10-21") is digits and dashes too.
const DATE_LIKE = /^(?:1[89]|20)\d\d[\s./-]\d{1,2}[\s./-]\d{1,2}/;

function phone(folded: string): string | null {
  for (const m of folded.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "").length;
    if (digits >= 10 && digits <= 15 && !DATE_LIKE.test(m[0])) return m[0];
  }
  const local = LOCAL_PHONE.exec(folded)?.[0];
  return local && !DATE_LIKE.test(local) ? local : null;
}

const termsRe = (terms: readonly string[]) => new RegExp(` (?:${terms.map(escapeRegExp).join("|")}) `);
const SLUR_RE = termsRe(SLURS);
const SLOGAN_RE = termsRe(SLOGANS);
// One quick "anything at all?" per family, so the common case (nothing) costs a few regex tests: every public sheet is
// checked again each time it's shown (lib/pg-public.ts).
const ANY_HATE = new RegExp(HATE_PATTERNS.map((r) => `(?:${r.source})`).join("|"));
const ANY_THREAT = new RegExp([...SELF_HARM_PATTERNS, ...THREAT_PATTERNS].map((r) => `(?:${r.source})`).join("|"));

const first = (patterns: readonly RegExp[], texts: readonly string[]): string | null => {
  for (const re of patterns) for (const t of texts) {
    const m = re.exec(t);
    if (m) return m[0].trim();
  }
  return null;
};

/**
 * The first hate, threat or personal info in a text, or null.
 * `folded`: lower-cased and accent-stripped, punctuation kept. `variants`: the spaced forms lib/safety.ts already makes
 * (plain first, then de-leeted and spelled-out), each padded with a space at both ends.
 */
export function harmMatch(folded: string, variants: readonly string[]): HarmMatch | null {
  const plain = variants[0];
  const slur = first([SLUR_RE, SLOGAN_RE], variants);
  if (slur) return { reason: "hate", phrase: slur };
  if (ANY_HATE.test(plain)) {
    const hit = first(HATE_PATTERNS, [plain]);
    if (hit) return { reason: "hate", phrase: hit };
  }
  if (ANY_THREAT.test(plain)) {
    const hit = first(SELF_HARM_PATTERNS, [plain]) ?? first(THREAT_PATTERNS, [plain]);
    if (hit) return { reason: "threat", phrase: hit };
  }
  const email = EMAIL.exec(folded)?.[0] ?? EMAIL_SPELLED.exec(plain)?.[0]?.trim();
  if (email) return { reason: "personal_info", phrase: email };
  const tel = phone(folded) ?? NUMBER_LEADIN.exec(plain)?.[0]?.trim();
  if (tel) return { reason: "personal_info", phrase: tel };
  const address = first(ADDRESS, [plain]);
  if (address) return { reason: "personal_info", phrase: address };
  return null;
}

/** A dealbreaker that is only a group of people ("immigrants", "no Asians or Muslims"), on the spaced plain text. */
export function dealbreakerGroupOnly(plain: string): string | null {
  const rest = plain.replace(DEALBREAKER_FILLER, " ");
  return DEALBREAKER_GROUP.test(rest) ? rest.trim() : null;
}

// A real person described rather than named (2026-11-28, the simulation): "the Tesla CEO", "the current US president".
// Sheets and After Dark only: in a text or a chat, "I'd never vote for the current president" is ordinary talk.
const REAL_PERSON_DESCRIBED = [
  / (?:the )?(?:current |former |ex |sitting )?(?:us|u s|american|french|british|uk|russian|chinese|canadian|german|indian|ukrainian|israeli|italian|brazilian|mexican|japanese|korean|north korean) (?:president|prime minister|pm|chancellor|first lady|vice president|dictator|supreme leader) /,
  / (?:the )?(?:king|queen|prince|princess|crown prince|crown princess) of (?:england|the uk|britain|great britain|the united kingdom|spain|sweden|denmark|norway|the netherlands|belgium|monaco|jordan|saudi arabia|thailand|japan) /,
  / the (?:current )?pope /,
  / (?:ceo|founder|co founder|owner|boss|chairman) of (?:tesla|spacex|amazon|meta|facebook|apple|microsoft|google|alphabet|openai|anthropic|twitter|x corp|nvidia|netflix|tiktok|bytedance|oracle|berkshire hathaway) /,
  / (?:the )?(?:tesla|spacex|amazon|meta|facebook|apple|microsoft|google|openai|twitter|nvidia|netflix|tiktok) (?:ceo|founder|co founder|billionaire|owner|boss|chairman) /,
  / (?:based on|inspired by|modeled on|modelled on|a copy of|a version of|is actually|is secretly|played by) (?:a |an )?(?:real|real life|irl|actual) (?:person|celebrity|celeb|influencer|streamer|youtuber|athlete|politician|actor|actress|singer|rapper|popstar|pop star|someone|human) /,
  / (?:a |the )?(?:member|lead singer|frontman|frontwoman|singer|rapper|dancer|maknae) (?:of|from|in) (?:bts|blackpink|one direction|twice|stray kids|newjeans|seventeen|exo|coldplay|maroon 5|the beatles|the rolling stones|metallica|arctic monkeys|the 1975|fifth harmony|little mix|spice girls|backstreet boys|nsync|jonas brothers) /,
  / (?:singer|rapper|popstar|pop star|artist) (?:who|that) (?:sang|sings|wrote|released|performed) (?:shake it off|anti hero|blank space|cruel summer|bad guy|thank u next|levitating|hotline bling|god s plan|gods plan|single ladies|halo|umbrella|bad romance|poker face|despacito|shape of you|uptown funk|espresso|good 4 u|drivers license|flowers|as it was|blinding lights|watermelon sugar|wrecking ball|firework|hello) /,
];

/**
 * A real person described rather than named, on the spaced plain text; or null. (Franchise characters are
 * lib/franchises.ts's, refused on every save: app/api/characters.)
 */
export function notOriginalMatch(plain: string): string | null {
  return first(REAL_PERSON_DESCRIBED, [plain]);
}
