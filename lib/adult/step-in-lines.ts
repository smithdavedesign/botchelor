/**
 * Step in's own net over the lines that never move (lib/adult/step-in.ts; docs/after-dark.md "Step in").
 *
 * After Dark's text check (lib/safety.ts checkAdultText) was written for two characters the show already knows: both
 * adults, never family, with a steer typed about them. It reads roleplay phrasing ("pretend you're my sister", "the
 * teacher and his student"). In Step in the viewer is one of the two, and says who they are, so a line can cross the
 * same lines just by saying so: "You're my daughter." and "I'm a kid." both pass checkAdultText. This is the net for
 * that, held on every line of both sides (what the viewer writes, what the character says, the opening, the persona,
 * the notes kept as memory), on top of checkAdultText and never instead of it:
 *
 *  - family: no family word at all, in any sense (the narrator's guard already holds After Dark's prose to this), no
 *    step-family, nobody "related";
 *  - young: nobody who is or reads young (a kid, a child, a teen, a minor, "so young", "just turned 18");
 *  - school: no school, student, teacher, tutor, classroom, campus or dorm;
 *  - babysitter: no babysitter or nanny;
 *  - cant_say_no: nobody drunk, passed out, held, locked in, or told they can't leave or refuse;
 *  - paid: nobody paid for it.
 *
 * Deliberately wide: it refuses "my mother called" and "like a kid in a candy store" along with what it's for, and
 * says which word it was so the line can be said another way. A missed line is worse than a refused one here.
 * Whole words and phrases on the normalised text; pure and client-safe.
 */

export type StepInNeverWhy = "family" | "young" | "school" | "babysitter" | "cant_say_no" | "paid";
/** Which line a text crosses, and the word or phrase of ours it matched (one of this file's own, safe to say back). */
export type StepInNever = { why: StepInNeverWhy; word: string };

/** What each line is, in words for the person who typed it (as lib/adult/scenes.ts linesCrossed says After Dark's). */
export const STEP_IN_NEVER_SAID: Record<StepInNeverWhy, string> = {
  family: "no family or step-family, in fact or in play",
  young: "nobody under 18, or anyone who reads young",
  school: "no school, students or teachers",
  babysitter: "no babysitter or nanny",
  cant_say_no: "both always willing: nobody drunk, held, or kept from saying no or leaving",
  paid: "nobody paid for it",
};

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** The text as the patterns read it: lower case, no accents, apostrophes and punctuation as spaces, one space between words. */
function plain(text: string, deleet = false): string {
  let t = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (deleet) t = t.replace(/[013457@$]/g, (c) => LEET[c]);
  return ` ${t.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const word = (list: string) => new RegExp(`(?<= )(?:${list})(?= )`);

const KIN =
  "mom|moms|mommy|mum|mums|mummy|mama|momma|mother|mothers|dad|dads|daddy|papa|father|fathers|brother|brothers|sister|sisters|sibling|siblings|daughter|daughters|son|sons|aunt|aunts|auntie|aunty|uncle|uncles|niece|nieces|nephew|nephews|cousin|cousins|grandma|grandpa|granny|grandmother|grandfather|granddaughter|grandson|grandchild|grandchildren|parent|parents|stepfamily|incest|incestuous";
const STEP_KIN = "mom|mum|mommy|mummy|mother|dad|daddy|father|sister|sis|brother|bro|son|daughter|sibling|siblings|kid|kids|child|children|parent|parents|family";
const YOUNG =
  "kid|kids|kiddo|kiddie|child|children|childlike|toddler|toddlers|infant|infants|teen|teens|teenage|teenaged|teenager|teenagers|preteen|preteens|tween|tweens|adolescent|adolescents|juvenile|juveniles|youngster|youngsters|underage|underaged|schoolgirl|schoolgirls|schoolboy|schoolboys|jailbait|lolita|loli|lolicon|shota|pubescent|prepubescent|puberty";
/** What "a minor" may come before and still be the adjective ("a minor detail"). Anything else is a person. */
const MINOR_THINGS =
  "detail|details|issue|issues|problem|problems|thing|things|point|points|setback|setbacks|inconvenience|key|chord|scale|league|leagues|injury|injuries|change|changes|role|roles|adjustment|adjustments|miracle|miracles|scandal|crisis|obstacle|obstacles|hiccup|hiccups|flaw|flaws|complaint|complaints|annoyance|quibble|matter|matters|mistake|mistakes|delay|delays|disaster|emergency|character|characters|celebrity|part|parts";
const SCHOOL =
  "student|students|pupil|pupils|teacher|teachers|schoolteacher|professor|professors|tutor|tutors|tutoring|tutored|headmaster|headmistress|classroom|classrooms|classmate|classmates|schoolmate|schoolmates|homework|homeroom|detention|campus|dorm|dorms|dormitory|schoolwork|schooldays|schoolyard|semester|freshman|freshmen|sophomore|sophomores|coed|coeds|cheerleader|cheerleaders|prom|recess|playground|kindergarten|kindergartner|daycare|preschool|schooling";
/** Schools that are plainly an adult's ("law school", "old-school"): the word before "school". */
const ADULT_SCHOOLS =
  "old|law|med|medical|grad|graduate|art|film|business|culinary|cooking|dance|drama|nursing|driving|flight|trade|vet|beauty|bartending|night|music|language|ski|surf|riding|flying|acting|design|fashion|pastry|clown|charm|finishing";
const SITTER = "babysit|babysits|babysat|babysitting|babysitter|babysitters|nanny|nannies|childminder|governess";
const DRUNK = "drunk|drunken|drunker|tipsy|intoxicated|inebriated|plastered|sloshed|roofied|sedated|comatose|unconscious|incapacitated";
const THEM = "you|me|her|him|them";
const STOP = String.raw`stop(?! \w+ing )`;
const GET_AWAY = "get away(?! with )";
const PAID_WORDS = "prostitute|prostitutes|prostitution|hooker|hookers|gigolo|streetwalker|brothel";

const PATTERNS: readonly [StepInNeverWhy, RegExp][] = [
  ["family", word(KIN)],
  ["family", new RegExp(`(?<= )step ?(?:${STEP_KIN})(?= )`)],
  ["family", / (?:family member|family members|blood relative|blood relatives|blood related|related by blood|next of kin) /],
  ["family", / (?:we re|we are|you re|you are|i m|i am|she s|he s|they re) (?:\w+ )?(?:family|related|kin) /],
  ["family", / related to (?:you|me|each other|her|him) /],
  ["young", word(YOUNG)],
  // "minor" the person ("I'm a minor", "any minors"), never the adjective ("a minor detail", "something minor").
  ["young", / minors /],
  ["young", new RegExp(` (?:a|an|the|any|no|another|this|that|as|being|of|with|for) minor (?!(?:${MINOR_THINGS}) )`)],
  ["young", / under age /],
  ["young", / (?:so|too|very|really|awfully|pretty|that|how|this) young /],
  ["young", / look(?:s|ed|ing)? (?:\w+ )?young /],
  ["young", / young (?:girl|girls|boy|boys|thing|things|one|ones|lady|ladies|looking) /],
  ["young", / little (?:girl|girls|boy|boys|one|ones) /],
  ["young", / younger than (?:you|i|she|he|they) look/],
  ["young", / young for (?:your|my|her|his) age /],
  ["young", / barely (?:legal|18|eighteen|an adult|of age) /],
  ["young", / (?:just|only|barely|newly) (?:turned )?(?:18|eighteen) /],
  ["young", / not (?:yet |even |quite )?(?:18|eighteen|of age|an adult|legal) /],
  ["young", / (?:still|only|just) a (?:girl|boy|kid|child|baby) /],
  ["young", / (?:like|as) a (?:little )?(?:kid|child|baby|schoolgirl|schoolboy) /],
  ["school", word(SCHOOL)],
  ["school", new RegExp(`(?<= )(?<!(?:${ADULT_SCHOOLS}) )schools? (?!(?:of thought|night) )`)],
  ["babysitter", word(SITTER)],
  ["babysitter", / au pair /],
  ["cant_say_no", word(DRUNK)],
  ["cant_say_no", / (?:passed|passes|passing|black|blacked|blacks) out /],
  ["cant_say_no", / (?:too|so|really|very|blackout) (?:wasted|hammered|high|stoned|out of it) /],
  // Not the idioms: "get away with that" is about a cheek going unanswered, "couldn't stop smiling" about a grin.
  ["cant_say_no", new RegExp(` (?:you|she|he|they) (?:can t|cannot|couldn t|aren t allowed to|are not allowed to|isn t allowed to|is not allowed to|don t get to|doesn t get to|have no right to|has no right to) (?:leave|go|say no|refuse|${STOP}|escape|${GET_AWAY}|walk away) `)],
  ["cant_say_no", new RegExp(` (?:won t|will not|wouldn t|not going to|never) let (?:${THEM}) (?:leave|go|${STOP}|say no|escape|${GET_AWAY}|walk away) `)],
  ["cant_say_no", new RegExp(` not letting (?:${THEM}) (?:leave|go|${STOP}|escape|${GET_AWAY}) `)],
  ["cant_say_no", / (?:captive|captives|hostage|hostages|prisoner|prisoners) /],
  ["cant_say_no", new RegExp(` lock(?:s|ed|ing)? (?:${THEM}) (?:in|up|inside) `)],
  ["cant_say_no", / (?:whether|if) (?:you|she|he) (?:want|wants|like|likes) (?:it|to) or not /],
  ["cant_say_no", / (?:no|without a|without any) (?:choice|say) in (?:this|it|the matter) /],
  ["cant_say_no", / or (?:you re|you are|i m|i am|she s|he s) fired /],
  ["cant_say_no", / (?:your|my|her|his) job depends on /],
  ["paid", word(PAID_WORDS)],
  ["paid", / (?:escort service|escort agency|call girl|call girls|rent boy|sex worker|sex workers|sugar baby|sugar babies) /],
  ["paid", new RegExp(` (?:pay|pays|paid|paying) (?:${THEM}) (?:for (?:it|this|that|sex|the night|tonight|your time|my time)|to (?:sleep|strip|kiss|touch|stay|undress)) `)],
  ["paid", new RegExp(` paid for (?:${THEM}|sex|the night) `)],
  ["paid", / for (?:money|cash) /],
  ["paid", / by the hour /],
  ["paid", / (?:how much|what) (?:do you|does she|does he) charge /],
  ["paid", new RegExp(` (?:hire|hired|hires|hiring|rent|rented|rents|renting|buy|bought|buys|buying) (?:${THEM}) for (?:the night|tonight|an hour) `)],
];

/**
 * The line of Step in's a text crosses, or null. Read as written and with digits read as letters ("d4ddy"), so a
 * spelling trick doesn't pass. Not a replacement for checkAdultText: both run, that one first.
 */
export function stepInNever(text: string | null | undefined): StepInNever | null {
  if (!text?.trim()) return null;
  for (const t of [plain(text), plain(text, true)]) {
    for (const [why, re] of PATTERNS) {
      const hit = re.exec(t)?.[0].trim();
      if (hit) return { why, word: hit };
    }
  }
  return null;
}

/** The first of several texts that crosses a line (a persona's three lines, a card's fields). */
export function stepInNeverIn(texts: readonly (string | null | undefined)[]): StepInNever | null {
  for (const t of texts) {
    const hit = stepInNever(t);
    if (hit) return hit;
  }
  return null;
}
