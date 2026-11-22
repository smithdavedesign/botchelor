/**
 * A character's tells as their page shows them (lib/extras.ts TELLS). The page used to set the form's label straight
 * before the creator's words, as one sentence: "When they're nervous, they" + "wind his pocket watch repeatedly". It
 * only read right for a they/them character whose tell was a bare verb phrase. In production most tells are written
 * otherwise: about half name the character as he or she ("…his pocket watch") and a quarter are whole sentences ("He
 * fusses with his lapel pin."), so the page said "they … his" and "When they're nervous, they He fusses…" (the
 * 2026-11-22 audit).
 *
 * Now the heading says the feeling in the character's own pronouns ("When he's nervous") and the tell is a sentence
 * of its own, keeping the creator's words:
 *  - written as a sentence (a capital first, or a lower-case "his eyes…", "a faint…"): as written, capitalised;
 *  - a body part first ("eyes light up"): theirs, "His eyes light up.";
 *  - a verb in the -s or -ed form first ("goes quiet", "sighed"): the subject before it, "He goes quiet." For they/them
 *    the -s form takes their first name ("Sam goes quiet"), as "they goes" isn't English;
 *  - an -ing form first ("humming…"): "He's humming…";
 *  - a bare verb first ("wind his pocket watch"): "He'll wind his pocket watch."
 * A tell cut off at TELL_MAX ends at a sentence (lib/whole-sentences.ts). Pure.
 */
import { TELL_MAX, TELLS, type CharacterExtras, type TellId } from "./extras";
import { plainVerb } from "./personality";
import { capital, pronounForms, verb, type PronounForms } from "./pronoun-forms";
import { endsWhole, wholeSentences } from "./whole-sentences";

const HEADING: Record<TellId, (f: PronounForms) => string> = {
  nervous: (f) => `When ${f.subj}${verb(f, "'s", "'re")} nervous`,
  smitten: (f) => `When ${f.subj} ${verb(f, "likes", "like")} someone`,
  bored: (f) => `When ${f.subj}${verb(f, "'s", "'re")} bored`,
  annoyed: (f) => `When something annoys ${f.obj}`,
};

/** "When he's nervous": a tell's heading in the character's own pronouns. */
export const tellHeading = (id: TellId, pronouns: string | null | undefined): string => HEADING[id](pronounForms(pronouns));

/** Words that start a sentence that already has its subject, or no need of one: "a faint smile…", "his eyes…". */
const OPENS =
  /^(?:a|an|the|his|her|hers|their|its|my|your|one|some|every|each|all|no|he|she|they|i|it|you|we|there|this|that|these|those|both|any|when|whenever|if|as|with|without|in|on|at|after|before|while|then|suddenly)\b/i;
/** Parts of them that come first in a tell: "eyes light up" is "His eyes light up". Not ones that are verbs too (smile). */
const PARTS =
  /^(?:voice|gaze|eyes?|hands?|cheeks?|face|ears?|accent|shoulders?|fingers?|feet|foot|legs?|knees?|eyebrows?|brows?|jaw|lips?|mouth|tail|wings?|hair|nose|breathing|handwriting|speech|sentences|jokes|puns|stories|answers|tone|pitch|vocabulary|antennae?|circuits|gears|tentacles|whiskers|fur|scales|feathers|freckles|heart|pulse)\b/i;
/** After a part's word, one of these makes it a verb: "hands you a stone", "eyes him up". */
const OBJECT = /^(?:you|him|her|them|me|us|someone|everyone|a|an|the|his|their|over|back|out|up)$/i;
/** Bare verbs that end in -ing: "bring a gift" is not "He's bring…". */
const BARE_ING = new Set(["bring", "sing", "ring", "fling", "cling", "sting", "swing", "spring", "string", "wring", "sling", "ping", "wing"]);
/** Verbs that end in -ly: "reply" is a verb, "quietly" is not. */
const VERB_LY = new Set(["reply", "apply", "rely", "supply", "fly", "ally", "tally", "rally", "bully"]);

/** A tell as a sentence of its own (see the module note). `name`: the character's name, for "Sam goes quiet". */
export function tellSentence(value: string, pronouns: string | null | undefined, name: string): string {
  const v = wholeSentences(value.trim().replace(/\s+/g, " "), TELL_MAX);
  const f = pronounForms(pronouns);
  const stop = (s: string) => (endsWhole(s) ? s : `${s}.`);
  const words = v.split(" ");
  // One word ("ughhh…") or a sentence of its own: as written.
  if (!v || words.length < 2 || !/^\p{Ll}/u.test(v) || OPENS.test(v)) return stop(capital(v));
  if (PARTS.test(v) && !OBJECT.test(words[1].replace(/[^\p{L}]/gu, ""))) return stop(`${capital(f.poss)} ${v}`);
  // The verb: the first word after any -ly adverbs ("quietly rearranges the plan"); of a hyphenated one, its last part
  // ("re-aligns", "over-explain").
  const at = words.findIndex((w, i) => i === words.length - 1 || !(/^\p{Ll}+ly$/u.test(w) && !VERB_LY.has(w)));
  const word = (words[at] ?? "").toLowerCase().replace(/[^\p{L}'-]/gu, "").split("-").pop() ?? "";
  const subject = capital(f.subj);
  if (plainVerb(word) !== word) return stop(f.plural ? `${name.trim().split(/\s+/)[0]} ${v}` : `${subject} ${v}`);
  if (/[^e]ed$/.test(word)) return stop(`${subject} ${v}`);
  if (/ing$/.test(word) && !BARE_ING.has(word)) return stop(`${subject}${verb(f, "'s", "'re")} ${v}`);
  return stop(`${subject}'ll ${v}`);
}

/** The page's rows: [heading, sentence] for each tell filled in, in the form's order. */
export function tellRows(tells: CharacterExtras["tells"], pronouns: string | null | undefined, name: string): [string, string][] {
  return TELLS.flatMap((t) => {
    const value = tells?.[t.id]?.trim();
    return value ? [[tellHeading(t.id, pronouns), tellSentence(value, pronouns, name)] as [string, string]] : [];
  });
}
