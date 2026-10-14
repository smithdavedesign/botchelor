/**
 * Deterministic "does this sound like two real people?" metrics for a date's conversation. No model call, so
 * they're free to run on every generated date and on every eval run. Each one is aimed at a specific tell
 * from the date-quality audit (docs/date-quality.md):
 *
 *  - profile_reading: a character says something about the other they could only know from the other's
 *    profile ("A lighthouse keeper with eleven podcast listeners?") — on a blind date you know what you can
 *    see and what they've told you, nothing else.
 *  - self_labels: a character announces its own trait words ("I'm so deadpan") instead of showing them.
 *  - misgendered: a line refers to the other with words that contradict their pronouns ("tough guy").
 *  - abrupt_flips: one side's interest swings by half the scale between its consecutive lines (the
 *    "I'm out" cliff that happens when the ending only shows up in the last act).
 *  - repeated_openers: a speaker starts lines the same way ("Honestly, …", "Okay, …").
 *  - question_rate / responsiveness: real first dates are mostly questions and follow-ups, not quip
 *    ping-pong; a reply should pick up something the other actually said.
 *  - distinctness: two different people use different words.
 *  - grounding: a character's own life (bio, want, soul, voice) shows through in what it says.
 *
 * They are heuristics (a word list can't read irony), so they're for comparing versions over many dates, not
 * for judging a single line. The rubric judge (lib/judge.ts) covers what words can't.
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

/** Everything a character's sheet says about it, as one text (for grounding and for what the other can't know). */
function sheetText(c: Character): string {
  const soul = c.soul && !c.soul.local_only ? Object.values({ ...c.soul, local_only: "", signals: "" }).join(" ") : "";
  return [c.bio, c.persona.want, c.persona.traits.join(" "), c.look.appearance ?? "", soul, c.voice ?? ""].join(" ");
}

export type QualityMetrics = {
  turns: number;
  avg_words: number;
  /** Standard deviation of words per line: 0 means every line is the same length (quip ping-pong). */
  length_spread: number;
  question_rate: number;
  responsiveness: number;
  profile_reading: number;
  self_labels: number;
  misgendered: number;
  abrupt_flips: number;
  repeated_openers: number;
  distinctness: number;
  grounding: [number, number];
  /** 0..100: one headline number combining the above (higher is more genuine). */
  index: number;
};

export type QualityContext = {
  /** Each side's pronouns ("she/her", "he/him", "they/them"); a misgendering check runs only when known. */
  pronouns?: [string | null | undefined, string | null | undefined];
  /** Text both characters can see or were told (the venue, the setting): words from it are not "leaks". */
  shared?: string;
};

/** Scores one conversation. Pure: same transcript and characters, same numbers. */
export function transcriptQuality(transcript: Turn[], characters: [Character, Character], ctx: QualityContext = {}): QualityMetrics {
  const n = transcript.length;
  const sideIndex = (t: Turn) => (t.side === "a" ? 0 : 1);
  const shared = new Set(contentWords(ctx.shared ?? "", 3));

  // What each side could NOT know about the other on a blind date: the other's profile words, minus anything
  // visible (their look), shared (the venue) or also in the speaker's own sheet.
  const secretWords = characters.map((other, i) => {
    const self = characters[i === 0 ? 1 : 0];
    const own = new Set(contentWords(sheetText(self), 3));
    const visible = new Set([...contentWords(other.look.appearance ?? "", 3), ...tokens(other.name)]);
    return new Set(
      contentWords(`${other.bio} ${other.persona.want}`, 5).filter((w) => !own.has(w) && !visible.has(w) && !shared.has(w)),
    );
  });
  const secretGrams = characters.map((other) => ngrams(tokens(`${other.bio} ${other.persona.want}`), 4));

  const wordsPerLine = transcript.map((t) => tokens(t.dialogue).length);
  const avg = n ? wordsPerLine.reduce((x, y) => x + y, 0) / n : 0;
  const spread = n ? Math.sqrt(wordsPerLine.reduce((x, w) => x + (w - avg) ** 2, 0) / n) : 0;

  let profileReading = 0;
  let selfLabels = 0;
  let misgendered = 0;
  let abrupt = 0;
  let repeated = 0;
  let responsive = 0;
  let replies = 0;
  const openers: [Set<string>, Set<string>] = [new Set(), new Set()];
  const lastInterest: [number | null, number | null] = [null, null];
  const sideWords: [Set<string>, Set<string>] = [new Set(), new Set()];
  const grounded: [number, number] = [0, 0];
  const linesBy: [number, number] = [0, 0];
  const ownWords = characters.map((c) => new Set(contentWords(sheetText(c), 5)));

  transcript.forEach((t, i) => {
    const s = sideIndex(t);
    const o = s === 0 ? 1 : 0;
    const other = characters[o];
    const self = characters[s];
    const line = t.dialogue;
    const lineTokens = tokens(line);
    const lineContent = new Set(contentWords(line));
    linesBy[s]++;
    lineContent.forEach((w) => sideWords[s].add(w));

    // What the other has said so far is fair game; their profile is not.
    const saidByOther = new Set(transcript.slice(0, i).filter((x) => sideIndex(x) === o).flatMap((x) => tokens(x.dialogue)));
    const saidGrams = ngrams(transcript.slice(0, i).filter((x) => sideIndex(x) === o).flatMap((x) => tokens(x.dialogue)), 4);
    const leakedWord = [...contentWords(line, 5)].some((w) => secretWords[o].has(w) && !saidByOther.has(w));
    const leakedGram = [...ngrams(lineTokens, 4)].some((g) => secretGrams[o].has(g) && !saidGrams.has(g));
    const traitAlt = other.persona.traits.map((x) => x.toLowerCase().replace(/[^a-z' -]/g, "")).filter(Boolean).join("|");
    const labelled =
      traitAlt.length > 0 &&
      new RegExp(`\\b(you're|you are|youre|your)\\s+(?:so\\s+|very\\s+|such\\s+an?\\s+|whole\\s+)?(${traitAlt})\\b`, "i").test(line) &&
      !other.persona.traits.some((x) => saidByOther.has(x.toLowerCase()));
    if (leakedWord || leakedGram || labelled) profileReading++;

    const ownAlt = self.persona.traits.map((x) => x.toLowerCase().replace(/[^a-z' -]/g, "")).filter(Boolean).join("|");
    if (ownAlt && new RegExp(`\\b(i'm|i am|im)\\s+(?:so\\s+|very\\s+|pretty\\s+|really\\s+|just\\s+|an?\\s+)?(${ownAlt})\\b`, "i").test(line)) selfLabels++;

    const pron = (ctx.pronouns?.[o] ?? "").toLowerCase();
    if ((pron.startsWith("she") && MASCULINE.test(line)) || (pron.startsWith("he") && FEMININE.test(line))) misgendered++;

    const prev = lastInterest[s];
    if (prev !== null && Math.abs(t.interest - prev) >= 0.5) abrupt++;
    lastInterest[s] = t.interest;

    const opener = lineTokens.slice(0, 2).join(" ");
    if (opener && openers[s].has(opener)) repeated++;
    if (opener) openers[s].add(opener);

    const before = transcript[i - 1];
    if (before && sideIndex(before) === o) {
      replies++;
      const theirs = new Set(contentWords(before.dialogue));
      if ([...lineContent].some((w) => theirs.has(w)) || /\?\s*$/.test(before.dialogue.trim())) responsive++;
    }

    if ([...contentWords(line, 5)].some((w) => ownWords[s].has(w))) grounded[s]++;
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
        1 - Math.min(1, (selfLabels / n) * 3),
        misgendered ? 0 : 1,
        1 - Math.min(1, abrupt / 2),
        1 - Math.min(1, (repeated / n) * 3),
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
    misgendered,
    abrupt_flips: abrupt,
    repeated_openers: repeated,
    distinctness: r2(distinctness),
    grounding: [r2(grounding[0]), r2(grounding[1])],
    index,
  };
}
