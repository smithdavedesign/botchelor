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
 * Heuristics, like lib/quality.ts: a word list can't read a scene. They're for comparing prompts, models and settings over
 * many lines, not for judging one line.
 */
import type { Character } from "../character";
import { publicExtras, TEXT_DETAIL_KEYS } from "../extras";
import { EVERYDAY_WORDS, tokens } from "../quality";
import { placeIn, repeatOf } from "./continuity";
import { strangerIn } from "./guards";
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
/** Words that recur in any scene that goes there, interjections and pet names: never a theme of their own. */
const HOOK_SKIP = new Set(
  "god gods fuck fucking fucked shit damn yes please more harder faster deeper inside wet hard cock pussy breast breasts nipple nipples moan moans moaning groan groans gasp gasps mmm ohh ahh baby babe darling honey sweetheart".split(
    " ",
  ),
);

export type Hook = { word: string; stem: string; lines: number; of: number };

/**
 * The theme a character keeps coming back to (Star on control, Sable on surprises, 2026-10-21): a distinctive word (as a
 * stem, so "surprise" and "surprised" are one) in many of their last lines, what they say and do. Not their names, the
 * scene's own vocabulary (GENERIC), a place (the threshold check has those) or the words any explicit scene repeats.
 */
export function hooksOf(lines: readonly Pick<Line, "who" | "text">[], who: "a" | "b", names: readonly string[], max = 2): Hook[] {
  const theirs = lines.filter((l) => l.who === who).slice(-HOOK_WINDOW);
  if (theirs.length < HOOK_MIN_LINES) return [];
  const skip = phraseNames(...names);
  const per = new Map<string, { lines: number; forms: Map<string, number> }>();
  for (const l of theirs) {
    const seen = new Set<string>();
    for (const t of tokens(l.text)) {
      const w = t.replace(/'s$/, "");
      if (w.length < 4 || GENERIC.has(w) || EVERYDAY_WORDS.has(w) || skip.has(w) || HOOK_SKIP.has(w) || /\d/.test(w) || placeIn(w)) continue;
      const s = stem(w);
      if (s.length < 4 || GENERIC.has(s) || skip.has(s)) continue;
      const e = per.get(s) ?? { lines: 0, forms: new Map<string, number>() };
      e.forms.set(w, (e.forms.get(w) ?? 0) + 1);
      if (!seen.has(s)) e.lines++;
      seen.add(s);
      per.set(s, e);
    }
  }
  const need = Math.max(HOOK_MIN, Math.ceil(theirs.length * HOOK_SHARE));
  return [...per.entries()]
    .filter(([, e]) => e.lines >= need)
    .sort((x, y) => y[1].lines - x[1].lines || x[0].localeCompare(y[0]))
    .slice(0, max)
    .map(([s, e]) => ({ stem: s, word: [...e.forms.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0][0], lines: e.lines, of: theirs.length }));
}

/** Whether a text touches a hook: a word whose stem is the hook's, or starts with it ("surpriser" for "surpris"). */
export function touchesHook(text: string, hook: Pick<Hook, "stem">): boolean {
  return tokens(text).some((t) => {
    const s = stem(t.replace(/'s$/, ""));
    return s === hook.stem || (s.length >= 4 && (s.startsWith(hook.stem) || hook.stem.startsWith(s)));
  });
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

/** Whether a private "why" is generic: with the filler out, only words like "moment", "mood" or "chemistry" are left. */
export function whyIsGeneric(why: string | null | undefined): boolean {
  const left = tokens(why ?? "").filter((w) => !WHY_FILLER.has(w));
  return left.length > 0 && left.every((w) => VAGUE_WHY.has(w));
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

/**
 * Per character: their lines, how much of their sheet shows, how often they reach for a stock phrase, and (v2.1) how often
 * they reuse a worn phrase, end on a question, and which phrases they lean on most.
 */
export type Drift = {
  name: string;
  lines: number;
  sheet_detail_rate: number;
  cliche_rate: number;
  cliches: Record<string, number>;
  worn_phrase_rate: number;
  question_ending_share: number;
  top_phrases: TopPhrase[];
};

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
      cliche_rate: c.rate,
      cliches: c.phrases,
      worn_phrase_rate: h.lines ? round(h.worn / h.lines) : 0,
      question_ending_share: h.lines ? round(h.questions / h.lines) : 0,
      top_phrases: h.top,
    };
  };
  return { a: one("a"), b: one("b") };
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------------------------------------------------

/**
 * How one line's private "memory" resolved when it was written (lib/adult/facts.ts citeMemory); null: no note. `sheet`:
 * the sheet details it cited ([S1]…, v2.1's memory for a new pair).
 */
export type CitationStatus = { founded: boolean | null; facts: readonly string[]; sheet?: readonly string[] };

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
  /** v2.1: private whys that only restate a trait ("Sable is warm"), and whys that say nothing of the line ("the moment"). */
  why_restates_trait: number;
  generic_whys: number;
  /** v2.1: limits voiced ("slow down", "wait", "not yet"…), and the ones the other side went past before a yes (lib/adult/craft.ts). */
  limits: number;
  limit_overridden: number;
  /** v2.1: lines with a possessive that fits neither character's pronouns, on a place or a body ("his apartment", both she/her). */
  wrong_pronouns: number;
};

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
  let sheetCited = 0;
  const corpus = (i: number) => [...(input.memories ?? []), ...before.map((l) => l.text), ...lines.slice(0, i).map((l) => l.text)].join("\n");
  lines.forEach((l, i) => {
    const c = input.citations?.[i];
    const note = l.memory?.trim();
    if (!note && !c?.facts.length) return;
    notes++;
    const ok = c ? c.founded !== false : memoryFounded(note ?? "", corpus(i));
    if (ok) founded++;
    else unfounded++;
    if (c?.facts.length) withFacts++;
    // A sheet detail ([S2]): as resolved at write time, else by its label.
    if (c ? c.sheet?.length : /(?<!['’])\bS\s?-?\d{1,2}\b/.test(note ?? "")) sheetCited++;
  });

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
    generic_whys: lines.filter((l) => whyIsGeneric(l.why)).length,
    limits: observed.summary.limits,
    limit_overridden: observed.summary.limit_overridden,
    wrong_pronouns: observed.summary.wrong_pronouns,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
