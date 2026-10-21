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
 * Heuristics, like lib/quality.ts: a word list can't read a scene. They're for comparing prompts, models and settings over
 * many lines, not for judging one line.
 */
import type { Character } from "../character";
import { publicExtras, TEXT_DETAIL_KEYS } from "../extras";
import { EVERYDAY_WORDS, tokens } from "../quality";
import { repeatOf } from "./continuity";
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
};

export function sideOfCharacter(c: Character): QualitySide {
  const e = publicExtras(c.extras);
  return {
    name: c.name,
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

type Line = { who: "a" | "b"; text: string; memory?: string | null };

/** The share of a character's lines (0..1) that use a distinctive word from their own sheet. 0 with no lines. */
export function sheetDetailRate(lines: readonly Pick<Line, "text">[], side: QualitySide, others: readonly string[] = []): number {
  if (!lines.length) return 0;
  const own = sheetStems(side);
  const skip = nameWords(side.name, ...others);
  const hits = lines.filter((l) => [...distinctiveStems(l.text, skip)].some((w) => own.has(w))).length;
  return round(hits / lines.length);
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

/** Per character: their lines, how much of their sheet shows, and how often they reach for a stock phrase. */
export type Drift = { name: string; lines: number; sheet_detail_rate: number; cliche_rate: number; cliches: Record<string, number> };

export function driftOf(lines: readonly Line[], a: QualitySide, b: QualitySide): { a: Drift; b: Drift } {
  const one = (who: "a" | "b"): Drift => {
    const side = who === "a" ? a : b;
    const theirs = lines.filter((l) => l.who === who);
    const c = clicheRate(theirs, side);
    return { name: side.name, lines: theirs.length, sheet_detail_rate: sheetDetailRate(theirs, side, [(who === "a" ? b : a).name]), cliche_rate: c.rate, cliches: c.phrases };
  };
  return { a: one("a"), b: one("b") };
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------------------------------------------------

/** How one line's private "memory" resolved when it was written (lib/adult/facts.ts citeMemory); null: no note. */
export type CitationStatus = { founded: boolean | null; facts: readonly string[] };

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
};

export type SceneQuality = {
  lines: number;
  characters: { a: Drift; b: Drift };
  /** Stock phrases per 100 lines, both characters, and which ones. */
  cliche_rate: number;
  cliches: Record<string, number>;
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
};

export function sceneQuality(input: QualityInput): SceneQuality {
  const lines = input.lines;
  const before = input.before ?? [];
  const n = lines.length;
  const drift = driftOf(lines, input.a, input.b);
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

  const side = (s: QualitySide): ObservedSide => ({ name: s.name, catchphrase: s.catchphrase ?? null, traits: [...(s.traits ?? [])], tells: [...(s.tells ?? [])], voice: s.voice ?? null, want: s.want ?? null });
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
  });

  const refusalLines = lines.filter((l) => refusalIn(l.text)).length;
  return {
    lines: n,
    characters: drift,
    cliche_rate: n ? round((clicheHits / n) * 100) : 0,
    cliches,
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
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
