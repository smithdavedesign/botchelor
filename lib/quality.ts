/**
 * Deterministic "does this sound like two real people?" checks for a date's conversation. No model call, so
 * they're free on every generated date: the per-line checks drive the turn critic (lib/conversation.ts sends a
 * flagged line back once with a note), and the per-date metrics feed the eval (lib/eval.ts) and the
 * date_quality log. Each check is aimed at a specific tell from the date-quality audit (docs/date-quality.md):
 *
 *  - profile_reading: saying something about the other they could only know from the other's profile
 *    ("A lighthouse keeper with eleven podcast listeners?") — on a blind date you know what you can see and
 *    what they've told you, nothing else. Includes labelling them with their trait words ("your deadpan").
 *  - self_labels: announcing your own trait words ("I'm so deadpan") instead of showing them.
 *  - self_quotes: reciting your own private notes — your dealbreaker, agenda or soul — out loud
 *    ("If you interrupt this conversation before the twist…").
 *  - misgendered: referring to the other with words that contradict their pronouns ("tough guy").
 *  - abrupt_flips: one side's interest swinging by half the scale between its consecutive lines.
 *  - repeated_openers: a speaker starting lines the same way ("Honestly, …").
 *  - repeated_actions: a stage direction the date has already used ("adjusts reading glasses" again, or the
 *    other character copying "brushes dumpling dust off knee"). They show in the chat, so a loop is visible.
 *  - name_tics: saying the other's name in line after line ("Oh, Orin…", "…, Orin!"); people rarely do.
 *  - question_rate / responsiveness: real first dates are mostly questions and follow-ups, not quip
 *    ping-pong; a reply should pick up something the other actually said.
 *  - distinctness: two different people use different words.
 *  - grounding: a character's own life (bio, want, soul, voice) shows through in what it says.
 *
 * They're heuristics (a word list can't read irony): good for comparing versions over many dates and for a
 * cheap second draft, not for judging a single line on its own. The rubric judge (lib/judge.ts) covers the rest.
 */
import type { Character } from "./character";
import type { Turn } from "./conversation";

const STOPWORDS = new Set(
  (
    "a an the and or but if so of to in on at by for with from into over under about as is are was were be been being am " +
    "i im i'm me my mine you your you're youre yours we us our they them their it its it's this that these those there here " +
    "what when where who whom why how which do does did done doing have has had having can could would should will just " +
    "not no yes yeah okay ok oh well really very too also then than still even only some any all more most much many " +
    "like know think want get got go going gonna make made say said tell told let lets let's see look feel thing things " +
    "one two way time right sure maybe actually honestly kind sort little bit lot pretty quite something anything nothing " +
    "every everyone someone anyone tonight today night date first again ever never always now back out up down off"
  ).split(/\s+/),
);

/** Lowercased word tokens (letters, digits, inner apostrophes). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/** Meaningful words: not stopwords, at least `min` letters. */
export function contentWords(text: string, min = 4): string[] {
  return tokens(text).filter((w) => w.length >= min && !STOPWORDS.has(w));
}

const ngrams = (ws: string[], n: number): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
};

const MASCULINE = /\b(he|him|his|himself|guy|dude|bro|sir|mister|gentleman|fella)\b/i;
const FEMININE = /\b(she|her|hers|herself|lady|ma'am|gal|woman)\b/i;

const soulText = (c: Character): string =>
  c.soul && !c.soul.local_only
    ? [c.soul.values, c.soul.insecurities, c.soul.humor, c.soul.boundaries, c.soul.romantic, c.soul.communication].join(" ")
    : "";

/** Everything a character's sheet says about it, as one text (for grounding and for what the other can't know). */
function sheetText(c: Character): string {
  return [c.bio, c.persona.want, c.persona.traits.join(" "), c.look.appearance ?? "", soulText(c), c.voice ?? ""].join(" ");
}

const traitPattern = (traits: readonly string[]) =>
  traits.map((x) => x.toLowerCase().replace(/[^a-z' -]/g, "").trim()).filter(Boolean).join("|");

export type QualityContext = {
  /** Each side's pronouns ("she/her", "he/him", "they/them"); the misgendering check runs only when known. */
  pronouns?: [string | null | undefined, string | null | undefined];
  /** Text both characters can see or were told (the venue, the setting): words from it are never "leaks". */
  shared?: string;
  /** Extra private text per side beyond the sheet — this date's secret agenda and the owner's note. */
  secrets?: [string[], string[]];
};

export type LineIssues = {
  profile_reading: boolean;
  self_label: boolean;
  self_quote: boolean;
  misgendered: boolean;
  repeated_opener: string | null;
  /** The earlier stage direction this line's action repeats, if any. */
  repeated_action: string | null;
  name_tic: boolean;
  /**
   * The image this line keeps circling, if it's just re-riding a motif the date has already leaned on (a word
   * seen in two-plus earlier lines) while saying nothing of its own and asking nothing — the "everyone riffs
   * on the rain/tempo and no one says anything real" failure. Null when the line adds something or asks.
   */
  motif_fixation: string | null;
  /** A phrase from the speaker's own "never says" list that this line uses, if any. */
  never_said: string | null;
  /** The line repeats one of the speaker's own sample lines, or its own line from an earlier date (a 4-word run). */
  sample_echo: boolean;
};

/** The never-say phrase a line uses, matched on whole words (case-insensitive), or null. */
export function neverSaid(text: string, never: readonly string[] | undefined): string | null {
  const said = ` ${tokens(text).join(" ")} `;
  for (const phrase of never ?? []) {
    const words = tokens(phrase).join(" ");
    if (words && said.includes(` ${words} `)) return phrase;
  }
  return null;
}

/** A stage direction's meaningful words ("pulls the blanket tighter" → pulls, blanket, tighter). */
const actionWords = (action: string) => contentWords(action, 3);

/**
 * The tells in ONE line, given the conversation before it. Used by the turn critic (to send a line back once
 * with a note) and, summed over a date, by transcriptQuality.
 */
export function lineIssues(
  before: Turn[],
  line: Turn,
  characters: [Character, Character],
  ctx: QualityContext = {},
): LineIssues {
  const s = line.side === "a" ? 0 : 1;
  const o = s === 0 ? 1 : 0;
  const self = characters[s];
  const other = characters[o];
  const text = line.dialogue;
  const lineTokens = tokens(text);
  const shared = new Set(contentWords(ctx.shared ?? "", 3));

  // What the other has said so far is fair game; their profile is not.
  const theirLines = before.filter((t) => t.side !== line.side);
  const saidByOther = new Set(theirLines.flatMap((t) => tokens(t.dialogue)));
  const saidGrams = ngrams(theirLines.flatMap((t) => tokens(t.dialogue)), 4);
  const ownSheet = new Set(contentWords(sheetText(self), 3));
  const visible = new Set([...contentWords(other.look.appearance ?? "", 3), ...tokens(other.name)]);
  const secretWords = new Set(
    contentWords(`${other.bio} ${other.persona.want}`, 5).filter((w) => !ownSheet.has(w) && !visible.has(w) && !shared.has(w)),
  );
  const secretGrams = ngrams(tokens(`${other.bio} ${other.persona.want}`), 4);
  const leakedWord = contentWords(text, 5).some((w) => secretWords.has(w) && !saidByOther.has(w));
  const leakedGram = [...ngrams(lineTokens, 4)].some((g) => secretGrams.has(g) && !saidGrams.has(g));
  const theirTraits = traitPattern(other.persona.traits);
  const labelled =
    theirTraits.length > 0 &&
    new RegExp(`\\b(you're|you are|youre|your)\\s+(?:so\\s+|very\\s+|such\\s+an?\\s+|whole\\s+)?(${theirTraits})\\b`, "i").test(text) &&
    !other.persona.traits.some((x) => saidByOther.has(x.toLowerCase()));

  const ownTraits = traitPattern(self.persona.traits);
  const selfLabel =
    ownTraits.length > 0 &&
    new RegExp(`\\b(i'm|i am|im)\\s+(?:so\\s+|very\\s+|pretty\\s+|really\\s+|just\\s+|an?\\s+)?(${ownTraits})\\b`, "i").test(text);

  // Reciting your own private notes: a 3-word run from your dealbreaker, soul, agenda or the owner's note.
  const myPrivate = [self.dealbreaker, soulText(self), ...(ctx.secrets?.[s] ?? [])].filter(Boolean);
  const privateGrams = new Set(myPrivate.flatMap((p) => [...ngrams(contentWords(p, 3), 2)]));
  const selfQuote = [...ngrams(contentWords(text, 3), 2)].some((g) => privateGrams.has(g));

  const pron = (ctx.pronouns?.[o] ?? other.pronouns ?? "").toLowerCase();
  const misgendered = (pron.startsWith("she") && MASCULINE.test(text)) || (pron.startsWith("he") && FEMININE.test(text));

  const mine = before.filter((t) => t.side === line.side);
  const opener = lineTokens.slice(0, 2).join(" ");
  const usedBefore = mine.map((t) => tokens(t.dialogue).slice(0, 2).join(" "));
  const repeated = opener && lineTokens.length > 2 && usedBefore.includes(opener) ? opener : null;

  // A stage direction repeats when it shares a two-word run with any earlier one, either side's ("adjusts
  // shirt cuff" → "adjusts shirt collar"). One-word actions ("smiles") are too common to count.
  const act = actionWords(line.action);
  const actGrams = ngrams(act, 2);
  const repeatedAction = actGrams.size
    ? before.find((t) => [...ngrams(actionWords(t.action), 2)].some((g) => actGrams.has(g)))?.action ?? null
    : null;

  // The other's first name in this line AND in this speaker's previous line.
  const theirName = tokens(other.name)[0] ?? "";
  const says = (t: string) => theirName.length > 1 && tokens(t).includes(theirName);
  const lastMine = mine.at(-1);
  const nameTic = says(text) && lastMine !== undefined && says(lastMine.dialogue);

  // Motif fixation: the line keeps riding an image the date has already circled (a content word seen in two-plus
  // earlier lines, either speaker) while engaging with nothing — it brings none of the speaker's own life, asks
  // no question, and doesn't pick up anything the line before it actually said. That last guard is the point:
  // normal topic continuity (you answer with a word they just used) is fine; drifting onto a pretty image and
  // saying nothing real is the "everyone riffs on the rain/tempo" loop to break. Can't fire before the third line.
  const motifCounts = new Map<string, number>();
  for (const t of before) for (const w of new Set(contentWords(t.dialogue, 5))) motifCounts.set(w, (motifCounts.get(w) ?? 0) + 1);
  const overused = contentWords(text, 5).find((w) => (motifCounts.get(w) ?? 0) >= 2) ?? null;
  const groundsSelf = contentWords(text, 5).some((w) => ownSheet.has(w));
  const prevLine = before.at(-1);
  const prevWords = prevLine && prevLine.side !== line.side ? new Set(contentWords(prevLine.dialogue, 4)) : new Set<string>();
  const picksUpPrev = contentWords(text, 4).some((w) => prevWords.has(w));
  const motifFixation = overused && !groundsSelf && !picksUpPrev && !text.includes("?") ? overused : null;

  // The voice kit (lib/extras.ts): a sample line is a register to match, not a script to read out. The same goes
  // for its own lines from earlier dates (lib/memory.ts memorable_lines): remembered, not re-performed word for word.
  const sampleGrams = new Set(
    [...Object.values(self.extras?.lines ?? {}), ...(self.memory?.memorable_lines ?? [])].flatMap((l) => [...ngrams(tokens(l ?? ""), 4)]),
  );
  const sampleEcho = sampleGrams.size > 0 && [...ngrams(lineTokens, 4)].some((g) => sampleGrams.has(g));

  return {
    profile_reading: leakedWord || leakedGram || labelled,
    self_label: selfLabel,
    self_quote: selfQuote,
    misgendered,
    repeated_opener: repeated,
    repeated_action: repeatedAction,
    name_tic: nameTic,
    motif_fixation: motifFixation,
    never_said: neverSaid(text, self.extras?.never_says),
    sample_echo: sampleEcho,
  };
}

export type QualityMetrics = {
  turns: number;
  avg_words: number;
  /** Standard deviation of words per line: near 0 means every line is the same length (quip ping-pong). */
  length_spread: number;
  question_rate: number;
  responsiveness: number;
  profile_reading: number;
  self_labels: number;
  self_quotes: number;
  misgendered: number;
  abrupt_flips: number;
  repeated_openers: number;
  repeated_actions: number;
  name_tics: number;
  /** Lines that used a phrase the speaker would never say, or read out one of its own sample lines. */
  voice_breaks: number;
  distinctness: number;
  grounding: [number, number];
  /** 0..100: one headline number combining the above (higher is more genuine). */
  index: number;
};

/** Scores one conversation. Pure: same transcript and characters, same numbers. */
export function transcriptQuality(transcript: Turn[], characters: [Character, Character], ctx: QualityContext = {}): QualityMetrics {
  const n = transcript.length;
  const wordsPerLine = transcript.map((t) => tokens(t.dialogue).length);
  const avg = n ? wordsPerLine.reduce((x, y) => x + y, 0) / n : 0;
  const spread = n ? Math.sqrt(wordsPerLine.reduce((x, w) => x + (w - avg) ** 2, 0) / n) : 0;

  let profileReading = 0, selfLabels = 0, selfQuotes = 0, misgendered = 0, abrupt = 0, repeated = 0, repeatedActions = 0, nameTics = 0, voiceBreaks = 0;
  let responsive = 0, replies = 0;
  const lastInterest: [number | null, number | null] = [null, null];
  const sideWords: [Set<string>, Set<string>] = [new Set(), new Set()];
  const grounded: [number, number] = [0, 0];
  const linesBy: [number, number] = [0, 0];
  const ownWords = characters.map((c) => new Set(contentWords(sheetText(c), 5)));

  transcript.forEach((t, i) => {
    const s = t.side === "a" ? 0 : 1;
    const issues = lineIssues(transcript.slice(0, i), t, characters, ctx);
    if (issues.profile_reading) profileReading++;
    if (issues.self_label) selfLabels++;
    if (issues.self_quote) selfQuotes++;
    if (issues.misgendered) misgendered++;
    if (issues.repeated_opener) repeated++;
    if (issues.repeated_action) repeatedActions++;
    if (issues.name_tic) nameTics++;
    if (issues.never_said || issues.sample_echo) voiceBreaks++;

    const content = new Set(contentWords(t.dialogue));
    linesBy[s]++;
    content.forEach((w) => sideWords[s].add(w));
    const prev = lastInterest[s];
    if (prev !== null && Math.abs(t.interest - prev) >= 0.5) abrupt++;
    lastInterest[s] = t.interest;

    const previous = transcript[i - 1];
    if (previous && previous.side !== t.side) {
      replies++;
      const theirs = new Set(contentWords(previous.dialogue));
      if ([...content].some((w) => theirs.has(w)) || /\?\s*$/.test(previous.dialogue.trim())) responsive++;
    }
    if (contentWords(t.dialogue, 5).some((w) => ownWords[s].has(w))) grounded[s]++;
  });

  const union = new Set([...sideWords[0], ...sideWords[1]]);
  const both = [...sideWords[0]].filter((w) => sideWords[1].has(w)).length;
  const distinctness = union.size ? 1 - both / union.size : 0;
  const questionRate = n ? transcript.filter((t) => t.dialogue.includes("?")).length / n : 0;
  const responsiveness = replies ? responsive / replies : 0;
  const grounding: [number, number] = [linesBy[0] ? grounded[0] / linesBy[0] : 0, linesBy[1] ? grounded[1] / linesBy[1] : 0];

  // The headline: each component on 0..1 (1 = genuine), averaged.
  const parts = n
    ? [
        1 - Math.min(1, (profileReading / n) * 3),
        1 - Math.min(1, ((selfLabels + selfQuotes) / n) * 3),
        misgendered ? 0 : 1,
        1 - Math.min(1, abrupt / 2),
        1 - Math.min(1, ((repeated + repeatedActions + nameTics) / n) * 3),
        Math.min(1, questionRate / 0.35),
        responsiveness,
        distinctness,
        (grounding[0] + grounding[1]) / 2,
        Math.min(1, spread / 6),
      ]
    : [0];
  const index = Math.round((parts.reduce((x, y) => x + y, 0) / parts.length) * 100);

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    turns: n,
    avg_words: r2(avg),
    length_spread: r2(spread),
    question_rate: r2(questionRate),
    responsiveness: r2(responsiveness),
    profile_reading: profileReading,
    self_labels: selfLabels,
    self_quotes: selfQuotes,
    misgendered,
    abrupt_flips: abrupt,
    repeated_openers: repeated,
    repeated_actions: repeatedActions,
    name_tics: nameTics,
    voice_breaks: voiceBreaks,
    distinctness: r2(distinctness),
    grounding: [r2(grounding[0]), r2(grounding[1])],
    index,
  };
}
