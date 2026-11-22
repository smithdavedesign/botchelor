/**
 * Text that stops mid-sentence, shown so it doesn't (the 2026-11-22 audit). Characters made elsewhere and sent to us cut
 * at our field limits read "Carries a device that faintly hums and" or "…says 'Sorry, was that rude? The translator" on
 * their pages: in production 103 public characters' looks, 30 voices, 28 wants and dozens of tells ended that way. The
 * stored words are the creator's and stay as they are; a page shows them ending where a sentence does.
 *
 * Only text that runs to within a few characters of its field's limit counts as cut, so a short phrase that simply has
 * no full stop ("tea blending") is left alone. A cut one ends at its last whole sentence when that keeps most of it,
 * else before a clause the cut broke into ("…the other person, as if they are the only" → "…the other person."), else
 * with "…". A quote it opened and never closed is closed. Pure.
 */

/** Ends like a sentence: . ! ? or …, perhaps inside a quote, bracket or emphasis. */
const ENDS = /[.!?…]["'”’)\]*_]*$/u;
/** How near its limit a text must run before a missing full stop means it was cut. */
const NEAR = 8;

/** Whether the text ends like a sentence. */
export const endsWhole = (text: string): boolean => ENDS.test(text.trim());

/** The text with a quote it opened and didn't close, closed: "says 'Sorry, was that rude?" → "…rude?'". */
export function closeQuotes(text: string): string {
  let out = text;
  if ((out.match(/"/g) ?? []).length % 2 === 1) out += '"';
  if ((out.match(/“/g) ?? []).length > (out.match(/”/g) ?? []).length) out += "”";
  // A single quote opens after a space or bracket and closes before one; an apostrophe sits inside a word ("it's").
  for (const [open, close] of [["'", "'"], ["‘", "’"]] as const) {
    const opener = [...out.matchAll(new RegExp(`(?:^|[\\s(])${open}(?=\\p{L})`, "gu"))].pop();
    if (!opener) continue;
    const after = out.slice((opener.index ?? 0) + opener[0].length);
    if (!new RegExp(`${close}(?!\\p{L})`, "u").test(after)) out += close;
  }
  return out;
}

/**
 * The text as a page shows it: unchanged unless it was cut mid-sentence at `max`, the field's limit (see the module
 * note). Null and empty pass through.
 */
export function wholeSentences<T extends string | null | undefined>(text: T, max: number): T {
  if (!text) return text;
  const t = text.trim();
  if (t.length < max - NEAR) return text;
  if (endsWhole(t)) return closeQuotes(t) as T;
  // The last sentence end with another sentence after it, if most of the text comes before it.
  let cut = -1;
  for (const m of t.matchAll(/[.!?…]["'”’)]*(?=\s+["'“‘(]?\p{Lu})/gu)) cut = (m.index ?? 0) + m[0].length;
  if (cut >= t.length * 0.3) return closeQuotes(t.slice(0, cut)) as T;
  // Else before the clause the cut broke into, if that's well past the middle.
  const clause = [...t.matchAll(/,\s+(?:as if|as though|like|and|then|while|which|followed by|causing|until|before|after|but|so|with)\b/giu)].pop();
  if (clause && (clause.index ?? 0) >= t.length * 0.5) return closeQuotes(`${t.slice(0, clause.index)}.`) as T;
  return closeQuotes(`${t.replace(/[\s,;:–—-]+$/u, "")}…`) as T;
}
