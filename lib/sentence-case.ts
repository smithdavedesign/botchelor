/**
 * Sentence case for a title the show wrote (docs/glossary.md: every heading, title, button and tab is in sentence case).
 * Episode titles were asked for in Title Case until 2026-11-22, so the stored ones read "Four AM At The Diner" beside
 * headings like "Recent episodes". `sentenceCase` shows them as "Four AM at the diner" without touching the stored text.
 *
 * Only a title in Title Case changes: one with a small word capitalised after its first word ("Winds Of Change"), or
 * with at least two other words and every one of them capitalised ("Golden Hour Countdown"). A title already in
 * sentence case ("First date at a sticky dive bar", "Midnight with Rafe") is left as it is, so a name in it survives.
 * Kept as written in any case: the first word, the first word after a colon, acronyms (AM, OC), "I", words with a
 * capital inside them (McQueen), any word of the names passed (the two daters'), and any word the context (the date's
 * setting) capitalises mid-sentence: "Front Row Roast In Marseille" keeps Marseille, from "a Marseille-style bar". Pure.
 */

/** The words a Title Case writer may or may not capitalise: articles, conjunctions, short prepositions. */
const SMALL = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "with", "from", "into", "onto", "over", "than", "vs"]);

/** A word's letters without the punctuation around it: `“Four` → `Four`, `Diner,` → `Diner`. */
const core = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const startsUpper = (s: string) => /^\p{Lu}/u.test(s);
const isAcronym = (s: string) => s.length >= 2 && /^[\p{Lu}\p{N}]+$/u.test(s) && /\p{Lu}/u.test(s);
const innerCapital = (s: string) => /^.+\p{Lu}/u.test(s) && /\p{Ll}/u.test(s);

/**
 * A phrase set inside a sentence, its first letter lower-case: "Sable's real dealbreaker was Checking the time." read as
 * a stray capital (the 2026-11-22 audit). An acronym, "I", or a word with a capital inside it keeps its case.
 */
export function midSentence(text: string): string {
  const c = core(text.trimStart().split(/\s+/)[0] ?? "");
  if (!c || !startsUpper(c) || isAcronym(c) || c === "I" || /^I['’]/u.test(c) || innerCapital(c)) return text;
  return text.replace(c, c.charAt(0).toLowerCase() + c.slice(1));
}

/** Whether the title reads as Title Case (see the module note). */
export function isTitleCase(title: string): boolean {
  const words = title.trim().split(/\s+/).slice(1).map(core).filter((w) => /^\p{L}/u.test(w));
  if (words.some((w) => SMALL.has(w.toLowerCase()) && startsUpper(w) && !isAcronym(w))) return true;
  const big = words.filter((w) => !SMALL.has(w.toLowerCase()));
  return big.length >= 2 && big.every((w) => startsUpper(w));
}

/** The words running text capitalises mid-sentence (not after . ! ? or a colon): names, places, eras. */
export function properWords(text: string | null | undefined): string[] {
  const out: string[] = [];
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  words.forEach((word, i) => {
    if (i === 0 || /[.!?:]["'”’)]*$/.test(words[i - 1])) return;
    for (const part of word.split("-").map(core)) if (startsUpper(part) && !SMALL.has(part.toLowerCase())) out.push(part);
  });
  return out;
}

/**
 * The title in sentence case, when it was written in Title Case; otherwise unchanged. Null and undefined pass through.
 * `names`: the daters' (their words keep their capitals); `context`: the date's setting (see properWords).
 */
export function sentenceCase<T extends string | null | undefined>(title: T, names: readonly (string | null | undefined)[] = [], context: string | null = null): T {
  if (!title || !isTitleCase(title)) return title;
  const keep = new Set([...names.flatMap((n) => (n ? n.split(/[\s-]+/).map(core).filter(Boolean) : [])), ...properWords(context)]);
  const lower = (part: string) => {
    const c = core(part);
    if (!c || !startsUpper(c) || isAcronym(c) || c === "I" || /^I['’]/u.test(c) || innerCapital(c) || keep.has(c)) return part;
    return part.replace(c, c.charAt(0).toLowerCase() + c.slice(1));
  };
  const words = title.trim().split(/\s+/);
  // A title's first word, or the first after a colon, keeps its capital; the rest of a hyphenated word doesn't ("Mid-air").
  const opens = (i: number) => i === 0 || /:$/.test(words[i - 1]);
  return words.map((word, i) => word.split("-").map((part, j) => (j === 0 && opens(i) ? part : lower(part))).join("-")).join(" ") as T;
}
