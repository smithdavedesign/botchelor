/**
 * After Dark's quality metrics (David, 2026-10-21, after a review of all 977 production lines: the characters lose their
 * sheets, stock romance words everywhere, 23 verbatim and 18 near repeats, 13 unprovoked moves, an invented "Chad", and a
 * memory of two generic sentences). Pure and free, so the observer (scripts/eval/after-dark-observer.mjs), the eval route
 * (/api/jobs/eval-after-dark) and the tests all measure the same thing the same way:
 *
 *  - sheet_detail_rate: the share of a character's lines that use a distinctive word from their own sheet (bio, traits,
 *    want, voice, tells, job and hobbies), stopwords and generic words dropped;
 *  - cliche_rate: stock romance phrases (STOCK_PHRASES) per 100 lines, a phrase from the speaker's own sheet excepted
 *    (a ballroom teacher may say "dance");
 *  - verbatim and near repeats (lib/adult/continuity.ts repeatOf), against the night so far;
 *  - unprovoked moves (lib/adult/observer.ts);
 *  - invented names: a line naming someone who isn't in the scene (lib/adult/guards.ts);
 *  - alternation violations: the same speaker twice in a row;
 *  - memory citations: the share of lines whose private "memory" cites something they can remember, the share citing a
 *    fact (lib/adult/facts.ts), and the citations of something they can't (an id or a quote that isn't in the list);
 *  - refusals: a reply or a line where the model refused, moralised or stepped out of the scene.
 *
 * Prompt v2.1 (David's review of a v2 night, Star Dust × Sable Quist, 2026-10-21: "let's see" in 23 of 59 lines,
 * "surprise" in 19, 26 ending on a question, a limit overridden, two women in "his apartment entrance", whys that only
 * said "Sable is warm") adds, per character and for the scene:
 *
 *  - worn_phrase_rate: the share of lines reusing a phrase (2 to 4 words, phrasesIn) their speaker had already used in
 *    WORN_AT lines tonight, and top_phrases, the phrases each leans on most; worn_phrases_cut, the lines v2.1's guard cut
 *    or dropped for one on the way in;
 *  - question_ending_share: the share of lines whose words end on a question;
 *  - sensory_detail_share: the share of lines with a concrete detail of the place (SENSORY);
 *  - why_restates_trait: private whys that only restate a trait ("Sable is warm"); generic_whys, ones that say nothing of
 *    the line ("the moment" on all six lines of a step);
 *  - sheet_citations: lines whose memory cites one of their own sheet details ([S1]…, shown to a new pair);
 *  - limits and limit_overridden, and wrong_pronouns (lib/adult/craft.ts, through the observer).
 *
 * Prompt v2.2 (Lexi × Dex on prod, 2026-10-22, 298 lines: pie, crust, oven or cream in 137 of them, pottery in 73, her
 * pencil-spinning tell 31 times and during sex, the same action twice in three lines, "almost there" three times, whys
 * like "The climax, the shared moment", and facts cited on lines that don't use them) adds:
 *
 *  - per character, `hook` (the theme word in most of their lines, and its share) and `tell_uses` (lines showing one of
 *    their sheet's tells); for the scene, `tell_uses` and `tell_uses_explicit` (at undressing or sex);
 *  - loose_citations: lines citing a fact they don't use (no distinctive word in common, lib/adult/facts.ts citeMemory);
 *  - generic_whys now counts a fragment too: a why under five words, or with no verb.
 *
 * Heuristics, like lib/quality.ts: a word list can't read a scene. They're for comparing prompts, models and settings over
 * many lines, not for judging one line.
 */
import type { Character } from "../character";
import { publicExtras, TEXT_DETAIL_KEYS } from "../extras";
import { EVERYDAY_WORDS, tokens } from "../quality";
import { placeIn, repeatOf } from "./continuity";
import { strangerIn } from "./guards";
import { STAGES } from "./stages";
// observer.ts reads the drift from here too: each side only calls the other inside functions, so the cycle is harmless.
import { memoryFounded, observeNight, type ObservedSide } from "./observer";

/**
 * Stock romance phrasing: banned in prompt v2 (lib/adult/scenes.ts), counted by cliche_rate, and never a remembered fact
 * (lib/adult/facts.ts). The first group is what the 2026-10-21 review found most (desire 19, dance 18, symphony 16,
 * soul 10, intertwined 5 in 977 lines); the rest is the same register. Matched on whole words, longest first, so
 * "dance of desire" counts once. A literal "dance" isn't here: only the metaphor ("our dance", "this dance").
 */
export const STOCK_PHRASES: readonly string[] = [
  "symphony", "symphonies", "soul", "souls", "soulmate", "soulmates", "intertwined", "intertwine", "intertwining", "entwined",
  "dance of desire", "dance of", "our dance", "this dance", "desire", "desires",
  "tempest", "whirlwind", "ecstasy", "your heart echoes mine", "heart echoes", "hearts echo",
  "melody", "melodies", "crescendo", "lyrics to", "masterpiece", "canvas", "tapestry",
  "burning desire", "fire within", "ignite", "ignites", "insatiable", "primal", "molten", "unbridled", "carnal",
  "sweet torture", "exquisite torture", "pools of", "every fiber", "shivers down", "shiver down", "waves of pleasure", "wave of pleasure",
  "two hearts", "beat as one", "heart and soul", "bliss", "euphoria", "intoxicating", "tantalizing", "tantalising",
  "ravish", "ravishing", "lost in you", "lose ourselves", "make you mine", "claim you as mine", "as old as time",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Longest first, so a phrase inside a longer one isn't counted twice. */
const PATTERNS = [...STOCK_PHRASES].sort((x, y) => y.length - x.length).map((p) => ({ p, re: new RegExp(`\\b${escape(p).replace(/\s+/g, "\\s+")}\\b`, "gi") }));

/** The stock phrases a text uses, each counted once per use, without counting one inside another. */
export function stockPhrasesIn(text: string, except: ReadonlySet<string> = new Set()): string[] {
  const taken: [number, number][] = [];
  const out: string[] = [];
  for (const { p, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const from = m.index ?? 0;
      const to = from + m[0].length;
      if (taken.some(([x, y]) => from < y && to > x)) continue;
      taken.push([from, to]);
      if (!except.has(p)) out.push(p);
    }
  }
  return out;
}

/** A phrase's telling word: its longest one ("dance" in "our dance"). */
const keyWord = (phrase: string) => phrase.split(/\s+/).reduce((x, y) => (y.length > x.length ? y : x), "");

/** The stock phrases a sheet makes its own (its telling word is in the sheet): never a cliché for that character. */
export function ownedPhrases(sheet: string): Set<string> {
  const words = new Set(tokens(sheet));
  return new Set(STOCK_PHRASES.filter((p) => keyWord(p).length >= 4 && words.has(keyWord(p).toLowerCase())));
}

/**
 * The banned list as a prompt shows it: the phrases neither sheet owns, without the variants of one already listed
 * ("souls" after "soul", "dance of" after "dance of desire", "burning desire" once "desire" is there).
 */
export function bannedPhrases(sheets: readonly string[]): string[] {
  const owned = new Set(sheets.flatMap((s) => [...ownedPhrases(s)]));
  const plain = (p: string) => p.split(" ").map((w) => w.replace(/s$/, "")).join(" ");
  const out: string[] = [];
  for (const p of STOCK_PHRASES) {
    if (owned.has(p)) continue;
    const words = p.split(" ");
    const singles = out.filter((q) => !q.includes(" "));
    if (words.length === 1 && singles.some((q) => p.startsWith(q.slice(0, Math.max(4, q.length - 2))))) continue;
    if (words.length > 1 && (out.some((q) => q.includes(p) || plain(q) === plain(p)) || words.some((w) => singles.includes(w)))) continue;
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------------------------------

/** The model stepping out of the scene to refuse it (or to say it's an AI). */
const REFUSAL =
  /\b(?:as an ai\b|an ai(?: language)? model|i(?:'m| am) (?:just |only )?an ai\b|(?:a |an )?language model\b|i (?:can(?:'|no)t|cannot|won't|will not|am unable to|am not able to|'m unable to|'m not able to) (?:help with (?:this|that|your) (?:request|content|scene|story)|assist|comply|fulfil+|continue (?:with )?(?:this|that|the (?:scene|story|request|roleplay))|write (?:this|explicit|sexual)|generate|create (?:this|explicit|sexual) (?:content|scene|story)|engage in (?:this|explicit|sexual) (?:content|roleplay|scene))|against (?:my|the) (?:guidelines|programming|polic(?:y|ies)|content polic(?:y|ies))|content polic(?:y|ies)|(?:i(?:'m| am) )?(?:sorry|afraid),? but i (?:can(?:'|no)t|cannot|won't|will not)|i must (?:decline|refuse)|not (?:appropriate|comfortable) for me to (?:write|continue|generate|describe))/i;
/** Lecturing the reader instead of writing the scene. */
const MORALISING =
  /\b(?:it(?:'s| is) important to (?:remember|note|respect|prioriti[sz]e)|please (?:remember|note) that|(?:healthy|respectful) relationships? (?:is|are|require)|always (?:practi[cs]e) (?:safe|consent)|i (?:encourage|urge) you to)/i;

/** Whether a line or a reply steps out of the scene: "refusal" (it refused), "moralising" (it lectured), or null. */
export function refusalIn(text: string): "refusal" | "moralising" | null {
  const plain = text.replace(/[’‘]/g, "'");
  if (REFUSAL.test(plain)) return "refusal";
  if (MORALISING.test(plain)) return "moralising";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sheet detail
// ---------------------------------------------------------------------------------------------------------------------

/** One character as the metrics read them: the sheet's words, nothing private. */
export type QualitySide = {
  name: string;
  bio?: string | null;
  traits?: readonly string[];
  want?: string | null;
  voice?: string | null;
  tells?: readonly string[];
  /** Their job, hobbies, quirk and the rest of their details (lib/extras.ts), and their public facts. */
  details?: readonly string[];
  catchphrase?: string | null;
  /** As their sheet gives them ("she/her"): the only source for the pronoun checks (lib/adult/craft.ts). */
  pronouns?: string | null;
};

export function sideOfCharacter(c: Character): QualitySide {
  const e = publicExtras(c.extras);
  return {
    name: c.name,
    pronouns: c.pronouns ?? null,
    bio: c.bio,
    traits: c.persona.traits,
    want: c.persona.want,
    voice: c.voice,
    tells: Object.values(e.tells ?? {}).filter((t): t is string => typeof t === "string"),
    details: [
      ...TEXT_DETAIL_KEYS.filter((k) => k !== "catchphrase").map((k) => e[k] ?? ""),
      ...(e.hobbies ?? []),
      ...(e.prompts ?? []).map((p) => p.answer),
      ...(e.facts ?? []).map((f) => `${f.label} ${f.value}`),
    ].filter(Boolean),
    catchphrase: e.catchphrase ?? null,
  };
}

/** An observer's side (scripts/eval/after-dark-observer.mjs reads them from the characters table). */
export const sideOfObserved = (s: ObservedSide): QualitySide => ({ ...s });

/** The sheet as one text: what a stock phrase is checked against, and where the sheet's words come from. */
export const sheetText = (s: QualitySide): string =>
  [s.bio ?? "", ...(s.traits ?? []), s.want ?? "", s.voice ?? "", ...(s.tells ?? []), ...(s.details ?? [])].join(" ");

/**
 * Words that say nothing about who someone is, on a dating show after dark: stopwords, everyday words (lib/quality.ts
 * EVERYDAY_WORDS), the scene's own vocabulary (kiss, skin, night…) and how a voice note talks about talking.
 */
const GENERIC = new Set(
  (
    "a an the and or but if so of to in on at by for with from into over under about as is are was were be been being am i me my mine you your yours " +
    "we us our they them their it its this that these those there here what when where who whom why how which do does did done have has had can could " +
    "would should will just not no yes yeah okay oh well really very too also then than still even only some any all more most much many like know " +
    "think want get got go going make made say said tell told let see look feel thing things one two three four five six seven eight nine ten " +
    "first second third once twice way time right sure maybe actually kind sort little bit lot pretty quite something anything nothing every " +
    "everyone someone anyone tonight today night date dates dating again ever never always now back out up down off own owns his her hers him she " +
    "love loves loving lover heart hearts kiss kisses kissing body bodies touch touches touching smile smiles smiling grin grins eyes eye hand hands " +
    "lips lip skin close closer warm warmth soft softly laugh laughs laughing voice room together people person partner romance romantic sweet " +
    "gentle gently slow slowly fast quick quickly whisper whispers moment night breath breathe neck face hair arms arm chest leans lean pulls pull " +
    "question questions answer answers sentence sentences word words line lines talk talks talking speaks speech tone delivery pause pauses joke " +
    "jokes funny says asks reply replies conversation flirt flirts flirting flirty tease teases teasing someone's everything everybody nobody"
  ).split(/\s+/),
);

/** A word's stem, enough to meet "parties" and "party", "baked" and "bakes" (both sides go through it). */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "");
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length - 3 >= 4 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length - 2 >= 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length >= 5 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** A text's distinctive words, as stems: no stopwords, everyday or generic words, and not the given names. */
export function distinctiveStems(text: string, skip: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(text)) {
    if (t.length < 3 || GENERIC.has(t) || EVERYDAY_WORDS.has(t) || skip.has(t) || /^\d+$/.test(t)) continue;
    const s = stem(t);
    if (s.length >= 3 && !GENERIC.has(s)) out.add(s);
  }
  return out;
}

const nameWords = (...names: string[]) => new Set(names.flatMap((n) => tokens(n)));

/** The distinctive words of a character's own sheet (their name aside). */
export function sheetStems(s: QualitySide): Set<string> {
  return distinctiveStems(sheetText(s), nameWords(s.name));
}

type Line = { who: "a" | "b"; text: string; memory?: string | null; why?: string | null; stage?: number | null };

/** How many of a character's lines use a distinctive word from their own sheet. */
function sheetHits(lines: readonly Pick<Line, "text">[], side: QualitySide, others: readonly string[] = []): number {
  const own = sheetStems(side);
  const skip = nameWords(side.name, ...others);
  return lines.filter((l) => [...distinctiveStems(l.text, skip)].some((w) => own.has(w))).length;
}

/** The share of a character's lines (0..1) that use a distinctive word from their own sheet. 0 with no lines. */
export function sheetDetailRate(lines: readonly Pick<Line, "text">[], side: QualitySide, others: readonly string[] = []): number {
  return lines.length ? round(sheetHits(lines, side, others) / lines.length) : 0;
}

/** Stock phrases per 100 lines, and which ones; a phrase the speaker's own sheet owns doesn't count. */
export function clicheRate(lines: readonly Pick<Line, "text">[], side?: QualitySide): { rate: number; phrases: Record<string, number> } {
  const owned = side ? ownedPhrases(sheetText(side)) : new Set<string>();
  const phrases: Record<string, number> = {};
  let hits = 0;
  for (const l of lines) {
    for (const p of stockPhrasesIn(l.text, owned)) {
      phrases[p] = (phrases[p] ?? 0) + 1;
      hits++;
    }
  }
  return { rate: lines.length ? round((hits / lines.length) * 100) : 0, phrases };
}

// ---------------------------------------------------------------------------------------------------------------------
// Worn phrases, question endings, hooks, sensory detail, whys (prompt v2.1)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Grammatical glue, and the handful of words every line leans on: a phrase made only of these is no tic ("in the",
 * "i want you", "you know"). "let's" isn't here, nor any word with a meaning of its own: "let's see", "main event" and
 * "just the beginning" are what a night wears out.
 */
const GLUE = new Set(
  (
    "a an the and or but nor if so as than then that this these those there here of to in on at by for with from into onto over under " +
    "about up down off out around through across after before behind between toward towards against without within upon " +
    "i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours ourselves " +
    "they them their theirs themselves is are was were be been being am do does did doing done have has had having will would " +
    "shall should can could may might must not no yes yeah oh ah um uh mm mmm hmm okay ok well " +
    "i'm you're he's she's it's we're they're that's there's here's what's who's where's how's i've you've we've they've i'll " +
    "you'll he'll she'll it'll we'll they'll that'll i'd you'd he'd she'd we'd they'd don't doesn't didn't can't couldn't won't " +
    "wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't hadn't ain't what who whom whose which when where why how " +
    "all any some each every both either neither much many more most less few lot lots little bit such own other another same " +
    "just so very too really even still only also again already ever never always now soon maybe perhaps quite rather pretty " +
    "want wanna know think need like love mean get gets got getting go goes going gonna went gone come comes coming came make makes " +
    "made take takes took tell told say says said see saw seen look looks feel feels felt let give gave keep kept put try show find " +
    "hear thing things something anything nothing everything someone anyone everyone nobody one way time right good tonight"
  ).split(/\s+/),
);

/** A phrase its speaker has said in this many lines tonight is worn: v2.1's prompt lists it, and its guard cuts a fourth use. */
export const WORN_AT = 3;
const PHRASE_MIN = 2;
const PHRASE_MAX = 4;

/** The pair's name words, lower-cased: a phrase naming one of them is never a tic of its own ("oh sable"). */
export const phraseNames = (...names: readonly string[]): Set<string> => new Set(names.flatMap((n) => tokens(n)).map((w) => w.replace(/'s$/, "")));

/**
 * The phrases a line says, once each: runs of 2 to 4 words inside one clause of what it says (its *actions* out), none
 * made only of glue (GLUE), none naming one of the pair.
 */
export function phrasesIn(text: string, names: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const said = text.replace(/\*[^*]*\*/g, " ").toLowerCase().replace(/[’‘`]/g, "'");
  for (const clause of said.split(/[.!?,;:…()"“”[\]]+|\s[-–—]+\s|[–—]+/)) {
    const ws = clause
      .split(/[^a-z0-9']+/)
      .map((w) => w.replace(/^'+|'+$/g, ""))
      .filter(Boolean);
    for (let n = PHRASE_MIN; n <= PHRASE_MAX; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const run = ws.slice(i, i + n);
        if (run.every((w) => GLUE.has(w)) || run.some((w) => names.has(w.replace(/'s$/, "")))) continue;
        out.add(run.join(" "));
      }
    }
  }
  return out;
}

/** How many lines say each phrase (phrasesIn), over these lines. */
export function countPhrases(lines: readonly Pick<Line, "text">[], names: ReadonlySet<string> = new Set()): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) for (const p of phrasesIn(l.text, names)) counts.set(p, (counts.get(p) ?? 0) + 1);
  return counts;
}

/** The first phrase a text says that's already worn (said in WORN_AT lines or more), with its count; null when none is. */
export function wornIn(text: string, counts: ReadonlyMap<string, number>, names: ReadonlySet<string> = new Set()): { phrase: string; count: number } | null {
  for (const phrase of phrasesIn(text, names)) {
    const count = counts.get(phrase) ?? 0;
    if (count >= WORN_AT) return { phrase, count };
  }
  return null;
}

export type TopPhrase = { phrase: string; count: number };

/**
 * The phrases said most, at least `min` lines each, most first: a longer phrase over the shorter ones inside it when it's
 * said as often, and the shorter one alone when it's said more ("let's see", not "let's see how" too).
 */
export function topPhrases(counts: ReadonlyMap<string, number>, n = 5, min = 2): TopPhrase[] {
  const sorted = [...counts.entries()]
    .filter(([, k]) => k >= min)
    .sort((x, y) => y[1] - x[1] || y[0].split(" ").length - x[0].split(" ").length || x[0].localeCompare(y[0]));
  const out: TopPhrase[] = [];
  for (const [phrase, count] of sorted) {
    if (out.length >= n) break;
    const inside = (small: string, big: string) => ` ${big} `.includes(` ${small} `);
    if (out.some((q) => inside(q.phrase, phrase) || inside(phrase, q.phrase))) continue;
    out.push({ phrase, count });
  }
  return out;
}

const wordsSaid = (text: string): string[] =>
  text
    .replace(/\*[^*]*\*/g, " ")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);

/** A run this long, shared with one of their show or sample lines, is part of it copied. */
export const COPIED_RUN = 5;

/**
 * The first run of COPIED_RUN words a line says (its actions out) that one of `sources` says too, with a word of its own
 * in it (four letters or more, not glue), or null: a show line or a sample line copied in part (the A/B of 2026-10-21:
 * "Only if you let me hijack the steering wheel first!").
 */
export function copiedRun(text: string, sources: readonly string[], n = COPIED_RUN): string | null {
  const mine = wordsSaid(text);
  if (mine.length < n || !sources.length) return null;
  const runs = new Set<string>();
  for (const s of sources) {
    const ws = wordsSaid(s);
    for (let i = 0; i + n <= ws.length; i++) runs.add(ws.slice(i, i + n).join(" "));
  }
  for (let i = 0; i + n <= mine.length; i++) {
    const run = mine.slice(i, i + n);
    if (run.some((w) => w.length >= 4 && !GLUE.has(w)) && runs.has(run.join(" "))) return run.join(" ");
  }
  return null;
}

/** Whether a line's words end on a question (an action after them aside). */
export function endsOnQuestion(text: string): boolean {
  return /\?\s*$/.test(text.replace(/\*[^*]*\*/g, " ").replace(/["”'’)\]\s]+$/, "").trim());
}

/** The lines a question habit is read over, and the share past which the prompt says to vary it. */
export const QUESTION_WINDOW = 10;
export const QUESTION_SHARE = 0.4;

/** When more than QUESTION_SHARE of a character's last QUESTION_WINDOW lines end on a question: how many, of how many. */
export function questionHabit(lines: readonly Pick<Line, "who" | "text">[], who: "a" | "b"): { questions: number; of: number } | null {
  const theirs = lines.filter((l) => l.who === who).slice(-QUESTION_WINDOW);
  if (theirs.length < 5) return null;
  const questions = theirs.filter((l) => endsOnQuestion(l.text)).length;
  return questions / theirs.length > QUESTION_SHARE ? { questions, of: theirs.length } : null;
}

/** A hook is read over a character's last HOOK_WINDOW lines: a theme word in HOOK_SHARE of them (HOOK_MIN at least). */
export const HOOK_WINDOW = 16;
const HOOK_MIN_LINES = 6;
const HOOK_SHARE = 0.3;
const HOOK_MIN = 4;
/**
 * Words that recur in any scene that goes there, interjections, pet names and bodies: never a theme of their own. (v2.2
 * reads three-letter words too, for "pie", so the short words of an explicit scene are here as well.)
 */
const HOOK_SKIP = new Set(
  (
    "god gods fuck fucking fucked shit damn yes please more harder faster deeper inside wet hard cock pussy breast breasts nipple nipples moan moans moaning groan groans gasp gasps mmm ohh ahh baby babe darling honey sweetheart " +
    "hot sex ass cum hip hips thigh thighs leg legs waist jaw ear ears toe toes rub rubs hug hugs tip tongue mouth throat shoulder shoulders stomach belly naked " +
    "hey wow huh hmm yeah yep nah"
  ).split(" "),
);

export type Hook = { word: string; stem: string; lines: number; of: number };

/**
 * Per theme word (as a stem, so "surprise" and "surprised" are one): how many of these lines say or do it, and the forms
 * it takes. Not their names, the scene's own vocabulary (GENERIC), a place (the threshold check has those) or the words
 * any explicit scene repeats. v2.2: three letters is enough ("pie", 2026-10-22).
 */
function themes(theirs: readonly Pick<Line, "text">[], names: readonly string[]): Map<string, { lines: number; forms: Map<string, number> }> {
  const skip = phraseNames(...names);
  const per = new Map<string, { lines: number; forms: Map<string, number> }>();
  for (const l of theirs) {
    const seen = new Set<string>();
    for (const t of tokens(l.text)) {
      const w = t.replace(/'s$/, "");
      if (w.length < 3 || GENERIC.has(w) || EVERYDAY_WORDS.has(w) || skip.has(w) || HOOK_SKIP.has(w) || /\d/.test(w) || placeIn(w)) continue;
      const s = stem(w);
      if (s.length < 3 || GENERIC.has(s) || skip.has(s) || HOOK_SKIP.has(s)) continue;
      const e = per.get(s) ?? { lines: 0, forms: new Map<string, number>() };
      e.forms.set(w, (e.forms.get(w) ?? 0) + 1);
      if (!seen.has(s)) e.lines++;
      seen.add(s);
      per.set(s, e);
    }
  }
  return per;
}

const mostSaid = (forms: ReadonlyMap<string, number>) => [...forms.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0][0];

/**
 * The theme a character keeps coming back to (Star on control, Sable on surprises, 2026-10-21): a distinctive word in many
 * of their last lines, what they say and do (themes).
 */
export function hooksOf(lines: readonly Pick<Line, "who" | "text">[], who: "a" | "b", names: readonly string[], max = 2): Hook[] {
  const theirs = lines.filter((l) => l.who === who).slice(-HOOK_WINDOW);
  if (theirs.length < HOOK_MIN_LINES) return [];
  const need = Math.max(HOOK_MIN, Math.ceil(theirs.length * HOOK_SHARE));
  return [...themes(theirs, names).entries()]
    .filter(([, e]) => e.lines >= need)
    .sort((x, y) => y[1].lines - x[1].lines || x[0].localeCompare(y[0]))
    .slice(0, max)
    .map(([s, e]) => ({ stem: s, word: mostSaid(e.forms), lines: e.lines, of: theirs.length }));
}

/**
 * Every hook flagged at some point in these lines (hooksOf as each of the speaker's lines came), the first time each
 * was: v2.2 holds a hook to its share once it's been flagged, even after the cuts bring it under the flag again.
 */
export function flaggedHooks(lines: readonly Pick<Line, "who" | "text">[], who: "a" | "b", names: readonly string[]): Hook[] {
  const out = new Map<string, Hook>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].who !== who) continue;
    for (const h of hooksOf(lines.slice(0, i + 1), who, names)) if (!out.has(h.stem)) out.set(h.stem, h);
  }
  return [...out.values()];
}

/**
 * v2.2 (Lexi × Dex, 2026-10-22: Dolphin read "show other sides of them" and wrote pie in 137 of 298 lines anyway): once
 * flagged, a hook is in one of a character's lines in HOOK_EVERY over the chapter at most, and a line past that loses
 * the sentence with it (lib/adult/scenes.ts dropRepeats).
 */
export const HOOK_EVERY = 6;
/** The lines a flagged hook may be in this chapter, with the next one counted: one in HOOK_EVERY, and one at least. */
export const hookAllowance = (theirLines: number): number => Math.max(1, Math.floor((theirLines + 1) / HOOK_EVERY));

/** The theme word in most of a character's lines (themes), and its share of them; null under HOOK_MIN_LINES lines, or none twice. */
export function topHook(theirs: readonly Pick<Line, "text">[], names: readonly string[]): { word: string; share: number } | null {
  if (theirs.length < HOOK_MIN_LINES) return null;
  const [best] = [...themes(theirs, names).entries()].sort((x, y) => y[1].lines - x[1].lines || x[0].localeCompare(y[0]));
  return best && best[1].lines >= 2 ? { word: mostSaid(best[1].forms), share: round(best[1].lines / theirs.length) } : null;
}

/**
 * Whether a text touches a hook: a word whose stem is the hook's, or starts with it ("surpriser" for "surpris"). A
 * three-letter hook only as itself ("pie" isn't "piece").
 */
export function touchesHook(text: string, hook: Pick<Hook, "stem">): boolean {
  return tokens(text).some((t) => {
    const s = stem(t.replace(/'s$/, ""));
    return s === hook.stem || (s.length >= 4 && hook.stem.length >= 4 && (s.startsWith(hook.stem) || hook.stem.startsWith(s)));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Tells, repeated actions and openings, the build-up (prompt v2.2)
// ---------------------------------------------------------------------------------------------------------------------

/** A sheet tell shows in this many of a character's lines a chapter at most, like a catchphrase's once (v2.2: 31 pencil spins). */
export const TELL_CAP = 2;

/**
 * Whether a text shows a tell, by the tell's own words ("spin" and "pencil" in "spin a pencil"): most of them, two at
 * least (all of a one-word tell). A tell with no words of its own is never matched.
 */
export function showsTell(text: string, tell: string): boolean {
  const own = [...distinctiveStems(tell)];
  if (!own.length) return false;
  const said = distinctiveStems(text);
  const need = own.length === 1 ? 1 : Math.max(2, Math.ceil(own.length / 2));
  return own.filter((s) => said.has(s)).length >= need;
}

/** How far back an action can't come again, and an opening (v2.2). */
export const ACTION_WINDOW = 10;
export const OPENING_WINDOW = 4;
const OPENING_WORDS = 4;
/** An action sharing this much of the shorter one's words, in order, is the same action again (four words or more). */
const ACTION_NEAR = 0.75;

/** A line's leading *action*, without its asterisks; "" when it has none. */
export const actionOf = (text: string): string => /^\s*\*([^*]+)\*/.exec(text)?.[1]?.trim() ?? "";

/** The most words two lists share in the same order (not necessarily next to each other). */
function inOrder(x: readonly string[], y: readonly string[]): number {
  const row = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const up = row[j];
      row[j] = x[i - 1] === y[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = up;
    }
  }
  return row[y.length];
}

/**
 * The earlier action this one repeats (v2.2, Lexi × Dex lines 36 and 38: "*Increases his pace, growing larger inside
 * her*" twice): the same words, three or more, or most of the same words in order (ACTION_NEAR), four or more. Null when
 * it's new. The repeat guard reads what they say, so an action was never checked.
 */
export function actionRepeatOf(action: string, earlier: readonly string[]): string | null {
  const mine = wordsSaid(action);
  if (mine.length < 3) return null;
  for (const e of earlier) {
    const theirs = wordsSaid(e);
    if (theirs.length < 3) continue;
    if (theirs.join(" ") === mine.join(" ")) return e;
    const shorter = Math.min(mine.length, theirs.length);
    if (shorter >= 4 && inOrder(mine, theirs) / shorter >= ACTION_NEAR) return e;
  }
  return null;
}

/** How many of a speaker's own last lines a gesture is counted over, and how many uses there make it a tic (#1125). */
export const GESTURE_WINDOW = 12;
export const GESTURE_AT = 2;

/**
 * A gesture this speaker keeps making: a two-word run of their action ("knocks twice", "glasses up") that is in GESTURE_AT
 * or more of their actions over their last GESTURE_WINDOW lines, or null. #1125 (the 2026-10-31-1549 visitor: "pet phrases
 * and gestures repeat"): actionRepeatOf only catches a whole action said again, and never one under three words. Pure.
 */
export function gestureRepeatOf(action: string, mineBefore: readonly string[], names: ReadonlySet<string> = new Set()): string | null {
  if (!action) return null;
  const pairs = (a: string) => new Set([...phrasesIn(a, names)].filter((p) => p.split(" ").length === 2 && p.split(" ").some((w) => w.length >= 4 && !GLUE.has(w))));
  const earlier = mineBefore.slice(-GESTURE_WINDOW).map(actionOf).filter(Boolean).map(pairs);
  for (const p of pairs(action)) if (earlier.filter((e) => e.has(p)).length >= GESTURE_AT) return p;
  return null;
}

/**
 * The opening a line's words share with one of `earlier` (v2.2, lines 37 and 39 opened alike): its first four words said,
 * one of them more than glue ("I want you to" is nobody's tic), or null.
 */
export function openingRepeatOf(text: string, earlier: readonly string[]): string | null {
  const mine = wordsSaid(text).slice(0, OPENING_WORDS);
  if (mine.length < OPENING_WORDS || mine.every((w) => GLUE.has(w))) return null;
  const opening = mine.join(" ");
  return earlier.some((e) => wordsSaid(e).slice(0, OPENING_WORDS).join(" ") === opening) ? opening : null;
}

/** How many of a speaker's own last lines an opening's shape is checked against (#1103). */
export const SHAPE_WINDOW = 3;

/**
 * The shape a line opens with, past any *action*: a trailing-off "…", or a quote of a few words ("'Very warm' is…"); null
 * for anything else. #1103 (the 2026-10-31-1401 visitor: "Nell opens almost every line with '…'. Rafe quotes her back in
 * single quotes and then riffs… three in a row reads as a tic"). Pure.
 */
export function openingShape(text: string): "ellipsis" | "quote" | null {
  const said = text.replace(/^\s*\*[^*]*\*\s*/, "").trimStart();
  if (/^(?:\.{3}|…)/.test(said)) return "ellipsis";
  if (/^['"‘“][^'"‘’“”\n]{2,60}['"’”]/.test(said)) return "quote";
  return null;
}

/** The shape this line opens with when the same speaker opened one of their last SHAPE_WINDOW lines that way too; or null. */
export function shapeRepeatOf(text: string, mineBefore: readonly string[]): "ellipsis" | "quote" | null {
  const shape = openingShape(text);
  return shape && mineBefore.slice(-SHAPE_WINDOW).some((t) => openingShape(t) === shape) ? shape : null;
}

/** The line without its opening "…" (its *action* kept, the next word capitalised). Pure. */
export function withoutLeadingEllipsis(text: string): string {
  const action = /^\s*\*[^*]*\*\s*/.exec(text)?.[0] ?? "";
  const rest = text.slice(action.length).replace(/^\s*(?:\.{3}|…)\s*/, "");
  return `${action}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`.trim();
}

/**
 * A spoken line promised and never given: a line ending on "…and then she whispers." or an action "*leans in and
 * murmurs*" with nothing said after it (#1142, the 2026-10-31-1715 After Dark visitor). The cue's sentence goes; what's
 * left may be empty, and then the line has nothing in it. null when the line doesn't end on a dangling cue. Pure.
 */
const CUE = String.raw`(?:(?:whisper|say|ask|murmur|breathe|mutter|purr|confess|admit)s?|tells? (?:him|her|them))`;
const CUE_IN_ACTION = new RegExp(String.raw`\b${CUE}[^\p{L}\p{N}*]*\*\s*$`, "iu");
const CUE_IN_TEXT = new RegExp(String.raw`\bthen (?:\p{L}+ ){0,2}${CUE}[^\p{L}\p{N}"“”'’]*$`, "iu");
export function withoutDanglingCue(text: string): string | null {
  const t = text.trimEnd();
  const lastSentenceGone = (x: string) => {
    const parts = x.trim().split(/(?<=[.!?…])\s+/);
    parts.pop();
    return parts.join(" ").trim();
  };
  if (CUE_IN_ACTION.test(t)) {
    const m = /\*([^*]*)\*$/.exec(t);
    if (!m) return null;
    const kept = lastSentenceGone(m[1]);
    return [t.slice(0, t.length - m[0].length).trimEnd(), kept ? `*${kept}*` : ""].filter(Boolean).join(" ");
  }
  const tail = t.replace(/^(?:\s*\*[^*]*\*)+/, "");
  if (!tail.trim() || !CUE_IN_TEXT.test(tail)) return null;
  return lastSentenceGone(t);
}

/**
 * Saying the climax is near, out loud: once it's the build-up, again soon after it's a loop (v2.2: "almost there" three
 * times before Lexi × Dex's climax). Not "so close to you", which is only where someone is.
 */
const BUILD_UP =
  /\b(?:almost there|nearly there|so close(?! to\b)|(?:i'm|i am) (?:so |really |getting |almost )?close(?! to\b)|close to (?:coming|cumming|the edge)|(?:right )?on the edge|(?:about to|going to|gonna) (?:come|cum)\b)/;
/** A build-up said by the same speaker within this many lines is cut: the worn-phrase rule, at its second use. */
export const BUILD_UP_WINDOW = 10;

/** The build-up a line says ("almost there"), what it says only (its *actions* out); null when none. */
export function buildUpIn(text: string): string | null {
  const said = text.replace(/\*[^*]*\*/g, " ").toLowerCase().replace(/[’‘`]/g, "'");
  return BUILD_UP.exec(said)?.[0] ?? null;
}

/** A concrete detail of where they are: the light, a sound, a texture, the temperature, a smell or a taste. */
const SENSORY = new Set(
  (
    "lamp lamps lamplight glow glows glowing neon candle candles candlelight moonlight sunlight streetlight streetlights flicker " +
    "flickers flickering shadow shadows dim bulb bulbs glare haze " +
    "hum hums humming buzz buzzes buzzing creak creaks creaking rain thunder music song radio click clicks thud rustle rustles " +
    "rustling whir ticking ticks echo echoes hiss hisses drip drips dripping traffic siren sirens footsteps kettle fridge radiator " +
    "rattle rattles clink clinks " +
    "silk silky velvet satin lace rough wool linen cotton leather denim carpet rug grain stubble glitter sticky damp tile tiles " +
    "cold chill chilly draft draught breeze frost icy steam " +
    "smell smells scent scents perfume cologne smoke smoky coffee vanilla cinnamon incense " +
    "taste tastes wine whiskey bitter mint salt salty sugar"
  ).split(/\s+/),
);

/** Whether a line has a concrete sensory detail (SENSORY), in what it says or does. */
export const sensoryDetail = (text: string): boolean => tokens(text).some((t) => SENSORY.has(t));

/** Words a why can wrap a trait in without saying anything more ("being", "her playful side", "as usual"). */
const WHY_FILLER = new Set(
  (
    "is are was were be being been am feels feel feeling seems seem seeming acts act acting naturally natural nature always just " +
    "really very so too simply typically typical classic true truly in the a an and of as usual personality character trait " +
    "traits self side way she he they it her his their its it's she's he's they're herself himself themselves showing shows show " +
    "own s"
  ).split(/\s+/),
);
/** Personality words a why can restate: not this character's traits, but just as empty. */
const TRAIT_WORDS = new Set(
  (
    "flirty flirtatious playful bold confident curious teasing shy nervous eager excited aroused mysterious mystic mystical " +
    "dominant submissive warm cold sweet honest sincere cheeky mischievous seductive passionate romantic horny intense charming " +
    "witty funny sassy sarcastic dramatic loud quiet calm gentle kind caring loving tender reckless wild adventurous spontaneous " +
    "competitive loyal deadpan dry chaotic generous brave superstitious"
  ).split(/\s+/),
);

/**
 * Whether a private "why" only restates a trait ("Sable is warm", "Star being mystic", "her playful side"): with the names
 * and the filler out, nothing's left but trait words. A why that says what it's about ("Sable is warm, so she offers the
 * last party hat") isn't one.
 */
export function whyRestatesTrait(why: string | null | undefined, side: Pick<QualitySide, "name" | "traits">, otherName = ""): boolean {
  const words = tokens(why ?? "").map((w) => w.replace(/'s$/, ""));
  if (!words.length) return false;
  const names = phraseNames(side.name, otherName);
  const left = words.filter((w) => !names.has(w) && !WHY_FILLER.has(w));
  if (!left.length) return true;
  const traits = [...(side.traits ?? []).flatMap((t) => tokens(t)), ...TRAIT_WORDS].map((t) => stem(t));
  return left.every((w) => {
    const s = stem(w);
    return traits.some((t) => s === t || (t.length >= 4 && s.startsWith(t)));
  });
}

/** Words a why can be made of and still say nothing about this line ("the moment" on all six lines of a step, 2026-10-21). */
const VAGUE_WHY = new Set("moment mood vibe vibes chemistry tension attraction desire lust passion connection spark sparks heat instinct impulse feeling feelings".split(" "));

/** A why shorter than this is a fragment ("his job", "the climax"), too short to say a reason (v2.2). */
const WHY_MIN_WORDS = 5;
/** Words that are a verb wherever they stand: auxiliaries, and a pronoun's contraction ("she's", "they'd"). */
const AUX = new Set(
  (
    "is are was were am be been has have had does do did can could will would shall should may might must isn't aren't wasn't weren't hasn't " +
    "haven't hadn't doesn't don't didn't can't couldn't won't wouldn't shouldn't i'm i've i'd i'll you're you've you'd you'll he's he'd he'll " +
    "she's she'd she'll it's it'd it'll we're we've we'd we'll they're they've they'd they'll that's there's here's what's who's let's"
  ).split(" "),
);
/** Verbs a why reaches for, as they'd be said of the character ("wants", "remembers", "felt"). */
const WHY_VERBS = new Set(
  (
    "wants needs knows feels thinks remembers recalls likes loves hopes tries gives takes makes gets lets keeps says asks tells uses shows sees " +
    "hears finds means brings reminds wonders decides realises realizes notices admits confesses leans reaches holds pulls pushes moves slips " +
    "starts stops turns smiles laughs teases jokes answers matches mirrors echoes returns follows calls deflects softens opens invites offers " +
    "presses tests checks owns craves misses worries trusts fears buys savours savors relishes enjoys refuses " +
    "wanted needed knew felt thought remembered liked loved hoped tried gave took made got let kept said asked told used showed saw heard found " +
    "meant brought came went began left met sat stood ran held put caught taught bought fell"
  ).split(" "),
);
/** Who a why's sentence is about, when it says so with a pronoun: the next word is then its verb, or an adverb before it. */
const SUBJECTS = new Set("i you he she it we they".split(" "));

/**
 * Whether a why says it with a verb: an auxiliary or a contraction, a verb whys use, or a word after its subject that
 * reads as one ("she wants", "Lexi spins", "Dex noticed"). A heuristic: "The climax, the shared moment" has none.
 */
function hasVerb(words: readonly string[], names: ReadonlySet<string>): boolean {
  return words.some((w, i) => {
    if (AUX.has(w) || WHY_VERBS.has(w)) return true;
    const prev = words[i - 1];
    if (prev && SUBJECTS.has(prev)) return true;
    return Boolean(prev && names.has(prev) && /(?:[^s']s|ed)$/.test(w));
  });
}

/**
 * Whether a private "why" is generic: with the filler out, only words like "moment", "mood" or "chemistry" are left; or
 * (v2.2, Lexi × Dex's climax: "The climax, the shared moment") a fragment, under WHY_MIN_WORDS words or with no verb.
 * `names` are the pair's, so "Lexi spins" reads as a sentence.
 */
export function whyIsGeneric(why: string | null | undefined, names: readonly string[] = []): boolean {
  const words = tokens(why ?? "");
  if (!words.length) return false;
  const left = words.filter((w) => !WHY_FILLER.has(w));
  if (left.length > 0 && left.every((w) => VAGUE_WHY.has(w))) return true;
  return words.length < WHY_MIN_WORDS || !hasVerb(words, phraseNames(...names));
}

// ---------------------------------------------------------------------------------------------------------------------
// Topics: their work and hobbies as a running metaphor (prompt v2.4)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Words a bio, a job or a hobby is written in that are no topic of their own: numbers, the calendar, the verbs and
 * adjectives a sheet uses ("runs a tiny bakery", "hosts a podcast"), and what they wear (taken off in a scene, not
 * talked about). With the stopwords, the everyday and generic words, the scene's own vocabulary, trait words and the
 * place's sensory details (grounding the place is asked for every few lines), never a topic word.
 */
const TOPIC_SKIP = (
  // numbers and the calendar
  "eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety " +
  "hundred thousand million dozen day days daily weekly weekend month monthly yearly morning evening afternoon season " +
  "monday tuesday wednesday thursday friday saturday sunday " +
  // the verbs a sheet is written in
  "run runs running ran host hosts hosting spend spends spent teach teaches taught teaching learn learned learning write wrote " +
  "written writing read reading play plays played playing stand stands enter enters use uses using become became try tried " +
  "win wins won ask asked hate hates remember remembers thank thanks throw throws threw thrown catch caught kill kills killed " +
  "return returns returned left lived collect collects collected deliver delivers delivered correct corrects fix fixes fixed " +
  "shift shifts break breaks broke broken bring brings brought buy bought sell sold send sent set sets carry carried pick picked " +
  "drop dropped fill filled follow followed miss missed pass passed pull push raise reach save saved share shared step steps " +
  "turn turned visit wear wore worn wish wonder notice noticed name named order ordered list listed count counted test tested " +
  // the adjectives, and nouns that are anyone's
  "tiny huge giant big large old new young short former retired professional amateur local single entire secret favourite " +
  "favorite worst excellent empty free alive dead far wrong lucky happy sad busy strange weird odd normal simple special certain " +
  "possible impossible terrible awful amazing incredible wonderful lovely famous proud mid whoever whatever whenever wherever " +
  "purpose problem problems town city world table window floor wall corner view top bottom middle piece half inch mile number " +
  "type contact trip record red blue green black white pink purple yellow orange grey gray brown " +
  // what any intimate scene says, and what they wear (taken off, not talked about)
  "taste tastes tasted tasting tight deep perfect beautiful gorgeous pretty stay " +
  "shirt dress skirt jeans trousers pants bra panties underwear lingerie coat jacket sweater jumper hoodie blouse collar button " +
  "zip zipper belt buckle sock shoe boot heels stockings tie apron"
).split(/\s+/);

let topicStop: ReadonlySet<string> | null = null;
/** Every word that's never a topic, as itself and as its stem (built once, on first use). */
const topicStopWords = (): ReadonlySet<string> =>
  (topicStop ??= new Set([...GENERIC, ...EVERYDAY_WORDS, ...GLUE, ...HOOK_SKIP, ...TRAIT_WORDS, ...SENSORY, ...TOPIC_SKIP].flatMap((w) => [w, stem(w)])));

/**
 * A character's topic words, as stems (v2.4; David's Chud × Juniper night on prod, 2026-10-23: in the explicit stages
 * nearly every line turned their sheets into metaphor, her lighthouse logs and his servers, and the hook rule never
 * fired, because the words changed while the topic didn't). The distinctive words of what they do and what they're
 * into: their job, hobbies, quirk, hidden talent, guilty pleasure, catchphrase and bio, public details only (never a
 * private fact). Not their names, a place (the place rules have those), an adverb, or any word TOPIC_SKIP and the
 * stopwords hold. Derived from the sheet every time: no character is written into the code.
 */
export function topicsOf(c: Character | null, names: readonly string[] = []): string[] {
  if (!c) return [];
  const e = publicExtras(c.extras);
  // The words a line of work talks in, though no sheet writes them (2026-10-26: Sweet, an actress, said "performance",
  // "encore", "co-star", "finale" and "curtain call" thirty-odd times in one chapter, and "actress" was the only topic).
  const field = FIELDS.filter(([re]) => re.test(`${e.occupation ?? ""} ${c.bio ?? ""}`)).flatMap(([, words]) => words);
  const sources = [c.bio, e.occupation, ...(e.hobbies ?? []), e.quirk, e.hidden_talent, e.guilty_pleasure, e.catchphrase];
  const skip = phraseNames(c.name, ...names);
  const stop = topicStopWords();
  const out = new Set<string>();
  for (const t of tokens(sources.filter(Boolean).join(" \n "))) {
    const w = t.replace(/'s$/, "");
    if (w.length < 3 || /\d/.test(w) || skip.has(w) || stop.has(w) || (w.length >= 6 && w.endsWith("ly"))) continue;
    const s = stem(w);
    if (s.length >= 3 && !stop.has(s) && !skip.has(s) && !placeIn(w) && !placeIn(s)) out.add(s);
  }
  for (const w of field) out.add(stem(w));
  return [...out];
}

/**
 * A line of work's own vocabulary, by what the sheet calls it: only jargon, never a word a scene uses for itself ("stage",
 * "scene", "set", "act" and "call" stay out).
 */
const FIELDS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/\b(?:actress|actor|acting|theatre|theater|stage actor|film star)\b/i, ["performance", "performer", "encore", "co-star", "costar", "finale", "curtain", "audience", "ovation", "applause", "rehearsal", "premiere", "understudy", "script", "director", "spotlight", "matinee", "intermission"]],
  [/\b(?:umpire|line judge|referee|tennis)\b/i, ["umpire", "referee", "verdict", "rally", "deuce", "tiebreak", "racket", "racquet", "scoreboard", "linesman"]],
  [/\b(?:chef|cook|baker|bakery|pastry)\b/i, ["recipe", "simmer", "garnish", "frosting", "icing", "dough", "pastry", "souffle", "seasoning"]],
  [/\b(?:lawyer|attorney|solicitor|barrister|judge)\b/i, ["objection", "verdict", "testimony", "cross-examine", "sustained", "overruled", "courtroom"]],
  [/\b(?:pilot|flight attendant|airline)\b/i, ["turbulence", "runway", "takeoff", "landing", "cockpit", "altitude", "autopilot", "co-pilot"]],
  [/\b(?:programmer|developer|software|engineer|coder)\b/i, ["debug", "deploy", "server", "compile", "algorithm", "reboot", "bandwidth"]],
  [/\b(?:doctor|nurse|surgeon|medic|paramedic)\b/i, ["diagnosis", "prescription", "symptom", "examination", "vitals"]],
  [/\b(?:firefighter|fireman)\b/i, ["hose", "extinguish", "extinguisher"]],
];

/**
 * Whether a word's stem is a topic's: the same stem, an inflection carrying it on ("lighthouses", "podcasting",
 * "migrations": a topic of five letters or more, up to four more), or a shorter form of a long one ("migrate" for
 * "migration"). Never a short everyday word inside a longer one: "keep" isn't "keeper", "teach" isn't "teacher".
 */
const sameTopic = (s: string, topic: string): boolean =>
  s === topic || (topic.length >= 5 && s.startsWith(topic) && s.length - topic.length <= 4) || (s.length >= 6 && topic.startsWith(s) && topic.length - s.length <= 3);

/** The words in a text (an action, a sentence: all of it) that are one of these topics, as written, lower-cased; [] when none. */
export function topicWordsIn(text: string, topics: readonly string[]): string[] {
  if (!topics.length) return [];
  return tokens(text).filter((t) => {
    const s = stem(t.replace(/'s$/, ""));
    return s.length >= 3 && topics.some((topic) => sameTopic(s, topic));
  });
}

/**
 * The topic words a line says out loud, its *actions* out. A line is on their topic by what it says: the explicit
 * stages' actions are bodies and places ("*shifts closer*", "*climbs onto him*"), and the loop was in the talk ("The
 * 1904 keeper documented…", "the server migration I've been waiting for all week").
 */
export const topicWordsSaid = (text: string, topics: readonly string[]): string[] => topicWordsIn(text.replace(/\*[^*]*\*/g, " "), topics);

/**
 * v2.4: a character's topic words are in one of their lines in this many at most, before undressing, and from undressing
 * on (talk like lovers, not like their job): one in TOPIC_EVERY, one in TOPIC_EVERY_EXPLICIT.
 */
export const TOPIC_EVERY = 6;
export const TOPIC_EVERY_EXPLICIT = 12;
export const topicEvery = (stage: number): number => (stage >= UNDRESSING ? TOPIC_EVERY_EXPLICIT : TOPIC_EVERY);

/**
 * Their lines among the last `every - 1` of theirs that say one of their topic words (topicWordsSaid): their next line
 * may say one only when there are none, so any `every` of their lines in a row have one at most.
 */
export function recentTopicLines<T extends Pick<Line, "who" | "text">>(lines: readonly T[], who: "a" | "b", topics: readonly string[], every: number): T[] {
  if (!topics.length) return [];
  return lines
    .filter((l) => l.who === who)
    .slice(-(every - 1))
    .filter((l) => topicWordsSaid(l.text, topics).length > 0);
}

/** The topic words those recent lines say, the most said first (as written, lower-cased): what the prompt names. */
export function recentTopicWords(lines: readonly Pick<Line, "who" | "text">[], who: "a" | "b", topics: readonly string[], every: number, max = 8): string[] {
  const counts = new Map<string, number>();
  for (const l of recentTopicLines(lines, who, topics, every)) for (const w of new Set(topicWordsSaid(l.text, topics))) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, max).map(([w]) => w);
}

// ---------------------------------------------------------------------------------------------------------------------
// The clinical register, from undressing on (prompt v2.5)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A word in the clinical, report-writing register, by its shape: the abstract endings a manual or an inspection is
 * written in ("structural integrity", "containment", "synchronization", "acoustics", "salinity", "capacity").
 * Morphology, not a vocabulary: no character's words are listed. CLINICAL_EXCEPT holds the words of those shapes that
 * any intimate scene says plainly.
 */
const CLINICAL_SHAPE = /^[a-z]{3,}(?:ity|ities|ation|ations|ition|itions|sion|sions|ment|ments|ance|ence|ics|ology|ural|ical|ization|ient|ency)$/;
const CLINICAL_EXCEPT = new Set(
  (
    "sensation sensations position positions attention tension anticipation intensity pleasure moment moments connection emotion emotions " +
    "passion excitement desire physical permission confession obsession expression attraction affection satisfaction submission domination " +
    "penetration session question questions mention conversation situation decision invitation intention imagination devotion temptation " +
    "patience presence silence absence experience confidence chance dance glance romance distance instance violence sentence balance " +
    "performance surrender reality city pity ability natural vacation nation station ration motion lotion potion notion promotion " +
    "commitment comment comments element apartment basement payment treatment agreement statement entertainment amusement embarrassment " +
    "encouragement punishment torment amazement appointment fragment instrument document government environment equipment " +
    "personality sexuality vulnerability possibility curiosity electricity eternity gravity security insecurity identity " +
    "difference preference reference audience evidence science conscience innocence influence existence violence obedience defiance " +
    "magical musical classical typical tropical cynical practical ancient patient client convenient"
  ).split(/\s+/),
);

/** The clinical-register words a line says out loud, its *actions* out (an action may watch "with clinical detachment"). */
export function clinicalWordsIn(text: string, allowed: readonly string[] = []): string[] {
  const free = new Set(allowed.flatMap((s) => tokens(s)));
  return tokens(text.replace(/\*[^*]*\*/g, " ")).filter((w) => CLINICAL_SHAPE.test(w) && !CLINICAL_EXCEPT.has(w) && !free.has(w));
}

/**
 * v2.5: from undressing on, one of a speaker's lines in CLINICAL_EVERY at most says a clinical-register word (David's
 * Chud × Juniper night, replayed on v2.4: "structural integrity", "the acoustics", "calibration", nearly every line
 * mid-sex). The prompt rations the wry asides to the same share; this holds the register the asides were written in.
 */
export const CLINICAL_EVERY = 6;

/** Their lines among the last CLINICAL_EVERY - 1 of theirs with a clinical word (clinicalWordsIn). */
export function recentClinicalLines<T extends Pick<Line, "who" | "text">>(lines: readonly T[], who: "a" | "b", allowed: readonly string[] = []): T[] {
  return lines
    .filter((l) => l.who === who)
    .slice(-(CLINICAL_EVERY - 1))
    .filter((l) => clinicalWordsIn(l.text, allowed).length > 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// The voice without its subjects, from undressing on (prompt v2.5)
// ---------------------------------------------------------------------------------------------------------------------

/** Words a list item starts on ("the gulls", "her podcast"): a fragment starting on one carries on the clause before it. */
const LIST_START = new Set("the a an her his their my your its our some any every all both".split(" "));
/** Joining words a fragment can start on before its own first word ("and never laughs", "or the sea"). */
const JOINER = /^(?:and|or|but|then|also)\s+/i;
/** The subjects a list names: the last word of each of its "and"/"or" parts ("the sea", "ghosts and the gulls"). */
const subjectsIn = (list: string): string[] => list.split(/\s+(?:and|or)\s+/i).flatMap((part) => tokens(part).slice(-1));
/** The preposition a clause opens a list of subjects with ("drifts toward the sea, ghosts…", "jokes about…"). */
const PREPOSITION = /\s+(?:about|toward|towards|into|of|on|at|for|with|to|from|over|around|like)\s+/i;

/**
 * Whether a fragment of a voice line continues a list from the fragment before it, rather than starting a clause of its
 * own: it starts on a determiner ("the gulls") or on a topic word ("ghosts and the gulls"). A clause starts on its verb
 * or its own subject ("drifts toward the sea", "never laughs at her own jokes", "short sentences").
 */
function continuesList(fragment: string, topics: readonly string[]): boolean {
  const first = tokens(fragment.replace(JOINER, ""))[0] ?? "";
  return LIST_START.has(first) || topicWordsIn(first, topics).length > 0;
}

/**
 * A character's voice without the clauses that name their topics (v2.5; David's Chud × Juniper night, replayed blind on
 * v2.4: Juniper's deadpan "technical" quip came back nearly every line mid-sex, and her house voice says she "drifts
 * toward the sea, ghosts and the gulls"). From undressing on, the prompt gives their voice's rhythm and delivery, not its
 * subjects: "Asks odd, sincere questions, drifts toward the sea, ghosts and the gulls, and never laughs at her own jokes."
 * becomes "Asks odd, sincere questions, and never laughs at her own jokes."
 *
 * Generic: `topics` are the sheet's own topic words (topicsOf). A voice is read a sentence at a time, in fragments
 * between its commas, semicolons and colons. A fragment saying a topic word goes; so does a list it's part of: the
 * clause that opens the list ("drifts toward the sea") and the items after it ("the gulls"), by continuesList. A
 * fragment whose topic is only after an "and" keeps what's before it ("asks odd questions and talks about ghosts" keeps
 * "asks odd questions"). `cut` is the words of the clauses that went, as stems, that aren't a topic already and could be
 * one ("sea"): the budget counts them too, from undressing on.
 */
export function voiceWithoutTopics(voice: string, topics: readonly string[]): { voice: string; cut: string[] } {
  if (!voice.trim() || !topics.length) return { voice, cut: [] };
  const cutWords: string[] = [];
  const sentences = voice.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [voice];
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const end = /[.!?]+$/.exec(sentence)?.[0] ?? "";
    const body = sentence.slice(0, sentence.length - end.length);
    // Fragments and the separator before each (the first has none).
    const parts = body.split(/(\s*[,;:]\s*)/);
    const frags: { sep: string; text: string }[] = [];
    for (let i = 0; i < parts.length; i += 2) frags.push({ sep: i ? parts[i - 1] : "", text: parts[i] });
    const gone = frags.map(() => false);
    const comma = (i: number) => frags[i].sep.trim() === ",";
    frags.forEach((f, i) => {
      if (gone[i] || !topicWordsIn(f.text, topics).length) return;
      if (!continuesList(f.text, topics)) {
        // "asks odd questions and talks about ghosts": what's before the "and" stays, when it names nothing.
        const and = /\s+and\s+/i.exec(f.text);
        const head = and ? f.text.slice(0, and.index) : "";
        if (and && head && !topicWordsIn(head, topics).length && !continuesList(f.text.slice(and.index + and[0].length), topics)) {
          frags[i] = { ...f, text: head };
          return;
        }
        gone[i] = true;
      } else {
        gone[i] = true;
        // A list's items: back through the items before it to the clause that opens it with a preposition ("drifts
        // toward the sea"), which goes too, but for a noun phrase before its preposition ("physical sentences about…").
        // Items with no such clause before them are a list of their own ("easy compliments, dance metaphors"): they stay.
        const items: number[] = [];
        for (let j = i; j > 0 && comma(j); j--) {
          const prev = frags[j - 1].text;
          if (continuesList(prev, topics)) {
            items.push(j - 1);
            continue;
          }
          const prep = PREPOSITION.exec(prev);
          if (prep) {
            const keep = prev.slice(0, prep.index).trim();
            // The subjects listed with a topic are subjects too ("the sea"): they and the item's words are what's cut.
            cutWords.push(...[prev.slice(prep.index + prep[0].length), f.text, ...items.map((k) => frags[k].text)].flatMap(subjectsIn));
            for (const k of items) gone[k] = true;
            if (keep.split(/\s+/).length >= 2 && !topicWordsIn(keep, topics).length) frags[j - 1] = { ...frags[j - 1], text: keep };
            else gone[j - 1] = true;
          }
          break;
        }
      }
      // And on through the items after it ("…, the gulls"), up to a clause of its own ("and never laughs").
      for (let j = i + 1; j < frags.length && comma(j) && !JOINER.test(frags[j].text) && continuesList(frags[j].text, topics); j++) gone[j] = true;
    });
    const kept = frags.filter((_, i) => !gone[i]);
    if (!kept.length) continue;
    let text = kept.map((f, i) => (i ? f.sep : "") + f.text).join("");
    // A sentence that lost its start: no joining word in front, and a capital.
    if (gone[0]) text = text.replace(JOINER, "");
    text = text.replace(/[\s,;:]+$/, "").trim();
    if (!text) continue;
    out.push(`${text[0].toUpperCase()}${text.slice(1)}${end || "."}`);
  }
  const stop = topicStopWords();
  const cut = [...new Set(cutWords.map((w) => w.replace(/'s$/, "")).filter((w) => w.length >= 3 && !stop.has(w) && !LIST_START.has(w)).map(stem))].filter(
    (s) => s.length >= 3 && !stop.has(s) && !placeIn(s) && !topics.some((t) => sameTopic(s, t)),
  );
  return { voice: out.join(" "), cut };
}

/** One character's phrase habits over their lines (after `before`'s): lines reusing a worn phrase, endings on a question, top phrases. */
function phraseHabits(lines: readonly Line[], before: readonly Line[], who: "a" | "b", names: ReadonlySet<string>) {
  const counts = countPhrases(before.filter((l) => l.who === who), names);
  const theirs = lines.filter((l) => l.who === who);
  let worn = 0;
  for (const l of theirs) {
    if (wornIn(l.text, counts, names)) worn++;
    for (const p of phrasesIn(l.text, names)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return { lines: theirs.length, worn, questions: theirs.filter((l) => endsOnQuestion(l.text)).length, top: topPhrases(countPhrases(theirs, names)) };
}

/** The lines (of these) that show one of a character's sheet tells (showsTell). */
const tellLines = <T extends Pick<Line, "text">>(lines: readonly T[], tells: readonly string[] = []): T[] =>
  tells.length ? lines.filter((l) => tells.some((t) => showsTell(l.text, t))) : [];

/**
 * Per character: their lines, how much of their sheet shows, how often they reach for a stock phrase, (v2.1) how often
 * they reuse a worn phrase, end on a question, and which phrases they lean on most, and (v2.2) the theme word in most of
 * their lines with its share, and how many of their lines show one of their tells.
 */
export type Drift = {
  name: string;
  lines: number;
  sheet_detail_rate: number;
  /**
   * v2.5: the same over their lines before undressing only (null when they have none): v2.4+ cuts their sheet's words
   * from undressing on on purpose, so the explicit lines would only pull the rate down (the model simulation reads this).
   */
  sheet_detail_rate_early: number | null;
  cliche_rate: number;
  cliches: Record<string, number>;
  worn_phrase_rate: number;
  question_ending_share: number;
  top_phrases: TopPhrase[];
  hook: { word: string; share: number } | null;
  tell_uses: number;
};

/** Lines from before undressing (a line with no stage counts as early: it was saved before stages were). */
const early = (lines: readonly Line[]): Line[] => lines.filter((l) => (l.stage ?? 0) < STAGES.indexOf("undressing"));

export function driftOf(lines: readonly Line[], a: QualitySide, b: QualitySide, before: readonly Line[] = []): { a: Drift; b: Drift } {
  const names = phraseNames(a.name, b.name);
  const one = (who: "a" | "b"): Drift => {
    const side = who === "a" ? a : b;
    const theirs = lines.filter((l) => l.who === who);
    const c = clicheRate(theirs, side);
    const h = phraseHabits(lines, before, who, names);
    return {
      name: side.name,
      lines: theirs.length,
      sheet_detail_rate: sheetDetailRate(theirs, side, [(who === "a" ? b : a).name]),
      sheet_detail_rate_early: early(theirs).length ? sheetDetailRate(early(theirs), side, [(who === "a" ? b : a).name]) : null,
      cliche_rate: c.rate,
      cliches: c.phrases,
      worn_phrase_rate: h.lines ? round(h.worn / h.lines) : 0,
      question_ending_share: h.lines ? round(h.questions / h.lines) : 0,
      top_phrases: h.top,
      hook: topHook(theirs, [a.name, b.name]),
      tell_uses: tellLines(theirs, side.tells).length,
    };
  };
  return { a: one("a"), b: one("b") };
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------------------------------------------------

/**
 * How one line's private "memory" resolved when it was written (lib/adult/facts.ts citeMemory); null: no note. `sheet`:
 * the sheet details it cited ([S1]…, v2.1's memory for a new pair). `loose` (v2.2): facts it cited that the line doesn't
 * use; a citation of nothing else isn't founded, and is counted apart from the unfounded ones.
 */
export type CitationStatus = { founded: boolean | null; facts: readonly string[]; sheet?: readonly string[]; loose?: readonly string[] };

export type QualityInput = {
  a: QualitySide;
  b: QualitySide;
  lines: readonly Line[];
  /** The night before these lines: repeats count against it too, and the turn-taking starts from its last speaker. */
  before?: readonly Line[];
  /** Every other character's given name, lower-cased (lib/adult/voice.ts castNames): who'd be an invented name. */
  cast?: ReadonlySet<string>;
  /** Per line, in order, how its memory note resolved at write time. Without them, a note is checked against `memories`. */
  citations?: readonly (CitationStatus | null)[];
  memories?: readonly string[];
  /** Refusals the lines can't show: replies with no lines but a refusal, and lines dropped for refusing. */
  refusedElsewhere?: number;
  /** Where the night started (their date's setting), for the move check. */
  start?: string | null;
  /** What the lines can't show either: lines v2.1's guard cut or dropped for reusing a worn phrase (StepFlags.worn_phrases). */
  wornCut?: number;
};

export type SceneQuality = {
  lines: number;
  characters: { a: Drift; b: Drift };
  /** The share of all lines (0..1) that use their own speaker's sheet: both characters, each against their own. */
  sheet_detail_rate: number;
  /** Stock phrases per 100 lines, both characters, and which ones. */
  cliche_rate: number;
  cliches: Record<string, number>;
  /** Lines said before, word for word or nearly (verbatim_repeats + near_repeats). */
  repeats: number;
  verbatim_repeats: number;
  near_repeats: number;
  unprovoked_moves: number;
  invented_names: number;
  invented: { line: number; name: string }[];
  alternation_violations: number;
  /** Lines with a private memory note at all. */
  memory_notes: number;
  /** The share of lines (0..1) whose memory note cites something they can remember. */
  memory_citation_share: number;
  /** The share of lines (0..1) citing a remembered fact (lib/adult/facts.ts). */
  fact_citation_share: number;
  /** Memory notes citing something they can't remember: an id or a quote that isn't in the list. */
  unfounded_citations: number;
  refusals: number;
  /** v2.1: lines whose memory cites one of their own sheet details ([S1]…, shown to a new pair); founded, counted apart. */
  sheet_citations: number;
  /** v2.1: the share of lines (0..1) reusing a phrase their speaker had already said in WORN_AT lines tonight. */
  worn_phrase_rate: number;
  /** v2.1: lines its guard cut or dropped on the way in for reusing a worn phrase. */
  worn_phrases_cut: number;
  /** v2.1: the share of lines (0..1) whose words end on a question. */
  question_ending_share: number;
  /** v2.1: the share of lines (0..1) with a concrete detail of the place: light, sound, texture, temperature (SENSORY). */
  sensory_detail_share: number;
  /**
   * v2.1: private whys that only restate a trait ("Sable is warm"), and whys that say nothing of the line ("the moment");
   * v2.2: or are a fragment (under five words, or no verb: "The climax, the shared moment").
   */
  why_restates_trait: number;
  generic_whys: number;
  /** v2.1: limits voiced ("slow down", "wait", "not yet"…), and the ones the other side went past before a yes (lib/adult/craft.ts). */
  limits: number;
  limit_overridden: number;
  /** v2.1: lines with a possessive that fits neither character's pronouns, on a place or a body ("his apartment", both she/her). */
  wrong_pronouns: number;
  /** v2.2: lines whose memory cites a fact the line doesn't use (no distinctive word in common), not founded. */
  loose_citations: number;
  /** v2.2: lines showing one of their speaker's sheet tells, and the ones of those at undressing or sex. */
  tell_uses: number;
  tell_uses_explicit: number;
};

/** "undressing" (STAGES): from here on a tell is out of place (v2.2). */
const UNDRESSING = STAGES.indexOf("undressing");

export function sceneQuality(input: QualityInput): SceneQuality {
  const lines = input.lines;
  const before = input.before ?? [];
  const n = lines.length;
  const drift = driftOf(lines, input.a, input.b, before);
  // A cliché per character excepts their own sheet; the total is the two characters' together.
  const cliches: Record<string, number> = {};
  for (const d of [drift.a, drift.b]) for (const [p, k] of Object.entries(d.cliches)) cliches[p] = (cliches[p] ?? 0) + k;
  const clicheHits = Object.values(cliches).reduce((x, y) => x + y, 0);

  let verbatim = 0;
  let near = 0;
  const said = before.map((l) => l.text);
  for (const l of lines) {
    const rep = repeatOf(l.text, said);
    if (rep?.kind === "verbatim") verbatim++;
    else if (rep) near++;
    said.push(l.text);
  }

  const side = (s: QualitySide): ObservedSide => ({
    name: s.name,
    catchphrase: s.catchphrase ?? null,
    traits: [...(s.traits ?? [])],
    tells: [...(s.tells ?? [])],
    voice: s.voice ?? null,
    want: s.want ?? null,
    pronouns: s.pronouns ?? null,
  });
  const observed = observeNight({ a: side(input.a), b: side(input.b), start: input.start ?? null, memories: [], chapters: [{ chapter: 1, source: "scene", id: "measured", lines: [...lines], set_place: null, place: null }] });

  const invented: { line: number; name: string }[] = [];
  if (input.cast) {
    lines.forEach((l, i) => {
      const who = strangerIn(l.text, { a: input.a.name, b: input.b.name, cast: input.cast! });
      if (who) invented.push({ line: i, name: who });
    });
  }

  let alternation = 0;
  let last = before.at(-1)?.who ?? null;
  for (const l of lines) {
    if (l.who === last) alternation++;
    last = l.who;
  }

  let notes = 0;
  let founded = 0;
  let withFacts = 0;
  let unfounded = 0;
  let loose = 0;
  let sheetCited = 0;
  const corpus = (i: number) => [...(input.memories ?? []), ...before.map((l) => l.text), ...lines.slice(0, i).map((l) => l.text)].join("\n");
  lines.forEach((l, i) => {
    const c = input.citations?.[i];
    const note = l.memory?.trim();
    if (!note && !c?.facts.length) return;
    notes++;
    const ok = c ? c.founded !== false : memoryFounded(note ?? "", corpus(i));
    // v2.2: a fact cited on a line that doesn't use it is loose: never founded, and not an unfounded one either.
    if (c?.loose?.length) loose++;
    if (ok) founded++;
    else if (!c?.loose?.length) unfounded++;
    if (c?.facts.length) withFacts++;
    // A sheet detail ([S2]): as resolved at write time, else by its label.
    if (c ? c.sheet?.length : /(?<!['’])\bS\s?-?\d{1,2}\b/.test(note ?? "")) sheetCited++;
  });
  const tells = (who: "a" | "b") => tellLines(lines.filter((l) => l.who === who), (who === "a" ? input.a : input.b).tells);
  const told = [...tells("a"), ...tells("b")];

  const refusalLines = lines.filter((l) => refusalIn(l.text)).length;
  // The share of all lines that use their own speaker's sheet (each character's lines against their own).
  const ownSheet =
    sheetHits(lines.filter((l) => l.who === "a"), input.a, [input.b.name]) + sheetHits(lines.filter((l) => l.who === "b"), input.b, [input.a.name]);
  const names = phraseNames(input.a.name, input.b.name);
  const worn = (phraseHabits(lines, before, "a", names).worn + phraseHabits(lines, before, "b", names).worn) / Math.max(1, n);
  const questions = lines.filter((l) => endsOnQuestion(l.text)).length;
  const restated = lines.filter((l) => whyRestatesTrait(l.why, l.who === "a" ? input.a : input.b, (l.who === "a" ? input.b : input.a).name)).length;
  return {
    lines: n,
    characters: drift,
    sheet_detail_rate: n ? round(ownSheet / n) : 0,
    cliche_rate: n ? round((clicheHits / n) * 100) : 0,
    cliches,
    repeats: verbatim + near,
    verbatim_repeats: verbatim,
    near_repeats: near,
    unprovoked_moves: observed.summary.unprovoked_moves,
    invented_names: invented.length,
    invented,
    alternation_violations: alternation,
    memory_notes: notes,
    memory_citation_share: n ? round(founded / n) : 0,
    fact_citation_share: n ? round(withFacts / n) : 0,
    unfounded_citations: unfounded,
    refusals: refusalLines + (input.refusedElsewhere ?? 0),
    sheet_citations: sheetCited,
    worn_phrase_rate: n ? round(worn) : 0,
    worn_phrases_cut: input.wornCut ?? 0,
    question_ending_share: n ? round(questions / n) : 0,
    sensory_detail_share: n ? round(lines.filter((l) => sensoryDetail(l.text)).length / n) : 0,
    why_restates_trait: restated,
    generic_whys: lines.filter((l) => whyIsGeneric(l.why, [input.a.name, input.b.name])).length,
    limits: observed.summary.limits,
    limit_overridden: observed.summary.limit_overridden,
    wrong_pronouns: observed.summary.wrong_pronouns,
    loose_citations: loose,
    tell_uses: told.length,
    tell_uses_explicit: told.filter((l) => (l.stage ?? 0) >= UNDRESSING).length,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
