/**
 * The words a page uses for a character in running text, from their pronouns (lib/rules.ts PRONOUNS): "he/him" gives
 * he, him, his; "she/her" she, her, her; "they/them", or none given, they, them, their. `plural` is for the verb after
 * the subject ("he likes", "they like"). The 2026-11-22 audit found pages saying "Barnaby remembers what you tell them"
 * and "it always likes back" about characters whose pronouns were he/him. Pure.
 */
export type PronounForms = { subj: string; obj: string; poss: string; plural: boolean };

export function pronounForms(pronouns: string | null | undefined): PronounForms {
  const p = (pronouns ?? "").trim().toLowerCase();
  if (p.startsWith("he")) return { subj: "he", obj: "him", poss: "his", plural: false };
  if (p.startsWith("she")) return { subj: "she", obj: "her", poss: "her", plural: false };
  return { subj: "they", obj: "them", poss: "their", plural: true };
}

/** A verb after the subject: `verb(f, "likes", "like")` is "likes" for he and she, "like" for they. */
export const verb = (f: PronounForms, singular: string, plural: string): string => (f.plural ? plural : singular);

/** The first letter upper-case: "he" → "He". */
export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
