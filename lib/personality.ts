/**
 * Personality that reacts to the date (David, 2026-10-15: "give our AI characters more room to grow and be
 * unique"). A character's tells (lib/extras.ts TELLS) are habits that slip out when it feels a certain way:
 * nervous, smitten, bored, annoyed. Handing the model all four as a list makes it recite them; handing it the
 * ONE that fits how this act is going for this character makes the personality respond to the date.
 *
 * Which one fits comes from the engine's already-decided outcome, act by act, exactly like the beat sheet
 * (lib/beats.ts): first-meeting nerves in act one; then how this side really feels about the other, which the
 * engine settled (wants another date, tripped dealbreaker, the ending). So a tell can only ever perform the
 * decided date, never change it. Pure and deterministic; prompts only, never the engine.
 */
import type { Character } from "./character";
import type { Outcome } from "./engine";
import { tellLabel, type TellId } from "./extras";

/** The tell that fits this side in this act of the decided date. */
export function tellMoment(outcome: Outcome, side: 0 | 1, act: number): TellId {
  if (act === 0) return "nervous"; // first meeting: everyone's a little nervous
  const mine = outcome.sides[side];
  if (mine.wants_another) return outcome.ending === "disaster" && act === 2 ? "nervous" : "smitten";
  if (mine.dealbreaker_hit || outcome.ending === "disaster") return "annoyed";
  return "bored";
}

/** This side's tell for this act, as the model reads it ("When you're nervous, you over-explain the menu."); null when it has none for that feeling. */
export function currentTell(c: Character, outcome: Outcome, side: 0 | 1, act: number): string | null {
  const id = tellMoment(outcome, side, act);
  const does = c.extras.tells?.[id]?.trim();
  return does ? `${secondPerson(tellLabel(id))} ${youAgree(plainVerb(ownPronounsToYou(does, c.pronouns)))}` : null;
}

/** After "she" became "you": "you isn't" → "you aren't", "you has" → "you have" (run 4: "a wristwatch you isn't wearing"). */
export function youAgree(text: string): string {
  const fix: Record<string, string> = { "is": "are", "isn't": "aren't", "was": "were", "wasn't": "weren't", "has": "have", "hasn't": "haven't", "does": "do", "doesn't": "don't" };
  return text.replace(/\byou (is|isn't|was|wasn't|has|hasn't|does|doesn't)\b/gi, (_m, v: string) => `you ${fix[v.toLowerCase()]}`);
}

/**
 * Creators often write a tell as "she does it" ("taps her pencil"); after "you" the verb needs its plain form
 * ("you tap your pencil"). Only the first word, and only when it reads as a third-person-singular verb.
 */
export function plainVerb(phrase: string): string {
  const m = /^(\s*)([A-Za-z]+)(.*)$/s.exec(phrase);
  if (!m) return phrase;
  const [, lead, word, rest] = m;
  const lower = word.toLowerCase();
  const irregular: Record<string, string> = { has: "have", is: "are", does: "do", goes: "go", was: "were" };
  let base = irregular[lower];
  if (!base) {
    if (/[^aeiou]ies$/.test(lower)) base = lower.slice(0, -3) + "y";
    else if (/(ches|shes|sses|xes|zes)$/.test(lower)) base = lower.slice(0, -2);
    else if (/[^s]s$/.test(lower) && !/(ss|us|is)$/.test(lower) && lower.length > 3) base = lower.slice(0, -1);
    else return phrase;
  }
  return `${lead}${word[0] === word[0].toUpperCase() ? base[0].toUpperCase() + base.slice(1) : base}${rest}`;
}

/**
 * Creators often write a tell about their character in the third person ("lower his voice"). Spoken to the
 * character itself, its OWN pronouns become "you"/"your" ("lower your voice"). Only that character's own
 * gendered pronouns are touched: "they/their" might mean the other person, so it's left as written.
 */
export function ownPronounsToYou(text: string, pronouns: string | null): string {
  const p = (pronouns ?? "").toLowerCase();
  const map: Record<string, string> = p.startsWith("he")
    ? { his: "your", him: "you", himself: "yourself", "he's": "you're", he: "you" }
    : p.startsWith("she")
      ? { hers: "yours", her: "your", herself: "yourself", "she's": "you're", she: "you" }
      : {};
  const words = Object.keys(map);
  if (!words.length) return text;
  return text.replace(new RegExp(`\\b(${words.join("|")})\\b`, "gi"), (w) => map[w.toLowerCase()] ?? w);
}

/** "When they're nervous, they…" → "When you're nervous, you" (the actor is spoken to in the second person). */
function secondPerson(label: string): string {
  return label
    .replace(/…$/, "")
    .replace(/\bthey're\b/g, "you're")
    .replace(/\bthey\b/g, "you")
    .replace(/\bthem\b/g, "you")
    .trim();
}

/** All of a character's tells, for the director (who plans the whole date): "When they're nervous, they over-explain the menu." */
export function allTells(c: Character): string[] {
  return Object.entries(c.extras.tells ?? {})
    .filter(([, v]) => v?.trim())
    .map(([id, v]) => `${tellLabel(id).replace(/…$/, "")} ${v!.trim()}`);
}
