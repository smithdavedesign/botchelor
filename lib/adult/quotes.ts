/**
 * Quoted lines in a Direct steer (David, 2026-10-23): when a steer puts words in quotes ("…" or “…”), attributed or not,
 * the right character says them nearly as written, lightly fitted to their voice and the moment (a name, a word or a
 * tense may change; never the meaning, or how explicit it is). Everything else in the steer is still acted out in their
 * own words (lib/adult/stage-floor.ts withoutSteerCopy, which now reads the steer without its quotes).
 *
 * Pure and free: the quotes found in a steer and who says each (steerQuotes), the steer without them (withoutQuotes),
 * and whether a line said one (quoteKept, quotesKept: most of its words, about 70%, in a line by the right speaker).
 */
import { editDistance, givenName } from "./guards";

export type SteerQuote = { text: string; who: "a" | "b" | null };
export type QuoteCheck = SteerQuote & { kept: boolean; by: "a" | "b" | null; line: number | null };

/** The share of a quote's words a line has to say for it to count as said (near-verbatim). */
export const QUOTE_KEPT_SHARE = 0.7;

const QUOTE = /"([^"]{1,300})"|“([^”]{1,300})”/g;

const lower = (s: string) => s.toLowerCase().normalize("NFKC");

/** The words a passage says, lightly stemmed so a tense or a plural doesn't count as a change ("needed", "needs" → "need"). */
export function quoteTokens(s: string): string[] {
  return (lower(s).replace(/[’]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [])
    .map((w) => w.replace(/'s$/, "").replace(/^'+|'+$/g, ""))
    .filter(Boolean)
    .map((w) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w));
}

/** The words a name can be written as in a steer: its first word and the name it goes by, lower-cased. */
const nameForms = (name: string): string[] => [...new Set([name.split(/\s+/)[0], givenName(name)].map((w) => lower(w)).filter((w) => w.length >= 2))];

/** Whether a word is one of these names, or a slip of one ("Dorain" for "Dorian": a letter or two swapped or missed). */
function isName(word: string, forms: readonly string[]): boolean {
  const w = lower(word).replace(/'s$/, "");
  return forms.some((f) => {
    if (w === f) return true;
    if (f.length < 4 || Math.abs(w.length - f.length) > 1 || w[0] !== f[0]) return false;
    if (editDistance(w, f) <= 1) return true;
    // A swap of two neighbouring letters.
    return w.length === f.length && [...w].sort().join("") === [...f].sort().join("") && [...w].filter((ch, i) => ch !== f[i]).length === 2;
  });
}

type Who = { a: string; b: string };
type Pronouns = { a?: string | null; b?: string | null };

/** Who a stretch of the steer names, the last mention winning (or the first, reading forward); null when nobody. */
function namedIn(text: string, names: Who, pronouns: Pronouns, last: boolean): "a" | "b" | null {
  const forms = { a: nameForms(names.a), b: nameForms(names.b) };
  const words = text.match(/[\p{L}']+/gu) ?? [];
  const order = last ? [...words].reverse() : words;
  // The closest subject: a name, or "she"/"he" when only one of them goes by it ("kisses her and says" names nobody by "her").
  for (const w of order) {
    const a = isName(w, forms.a);
    const b = isName(w, forms.b);
    if (a !== b) return a ? "a" : "b";
    const p = lower(w);
    const kind = p === "he" ? "he" : p === "she" ? "she" : null;
    if (!kind) continue;
    const fits = (["a", "b"] as const).filter((x) => (pronouns[x] ?? "").trim().toLowerCase().startsWith(kind));
    if (fits.length === 1) return fits[0];
  }
  return null;
}

/**
 * The quoted lines in a steer, in order, each with who says it: the name (or a pronoun only one of them goes by) closest
 * before it since the last quote, else one just after it ("…", says Rafe); null when the steer doesn't say.
 */
export function steerQuotes(steer: string | null, names: Who, pronouns: Pronouns = {}): SteerQuote[] {
  if (!steer) return [];
  const found = [...steer.matchAll(QUOTE)].map((m) => ({ text: (m[1] ?? m[2] ?? "").trim(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  return found
    .map((q, i) => {
      const before = steer.slice(i ? found[i - 1].end : 0, q.start);
      const after = steer.slice(q.end, found[i + 1]?.start ?? steer.length).slice(0, 40);
      // v2.6 (Chud × Juniper: '"Do as you are told" he shoves…' went to nobody, and Juniper said it): a quote that opens
      // the steer, followed straight away by a name or a pronoun only one of them goes by, is that one's.
      const subject = !before.trim() ? /^\s*[,.]?\s*([\p{L}']+)/u.exec(after)?.[1] : undefined;
      const who =
        namedIn(before, names, pronouns, true) ??
        (/^\s*[,.]?\s*(?:says|said|asks|asked|whispers|moans|tells|groans|growls|gasps)\b/i.test(after) ? namedIn(after, names, pronouns, false) : null) ??
        (subject ? namedIn(subject, names, pronouns, false) : null);
      return { text: q.text, who };
    })
    .filter((q) => quoteTokens(q.text).length > 0);
}

/** Every quoted span in a text, as written ("…" or “…”). */
export const quotedSpans = (text: string): string[] => [...text.matchAll(QUOTE)].map((m) => (m[1] ?? m[2] ?? "").trim()).filter(Boolean);

/** The steer without its quoted lines: what's left to act out in their own words (and to hold the no-copy rule to). */
export const withoutQuotes = (steer: string | null): string | null => {
  if (!steer) return steer;
  const rest = steer.replace(QUOTE, " ").replace(/\s+/g, " ").trim();
  return rest;
};

/** What a line says aloud: its text without the *action*. */
const spoken = (text: string) => text.replace(/\*[^*]*\*/g, " ");

/** The share of a quote's words a passage says (each word counted as often as the quote has it). */
export function quoteOverlap(quote: string, passage: string): number {
  const want = quoteTokens(quote);
  if (!want.length) return 0;
  const have = new Map<string, number>();
  for (const w of quoteTokens(passage)) have.set(w, (have.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      hit++;
      have.set(w, n - 1);
    }
  }
  return hit / want.length;
}

/** Whether a line says the quote nearly as written: QUOTE_KEPT_SHARE of its words, out loud. */
export const saysQuote = (quote: string, text: string): boolean => quoteOverlap(quote, spoken(text)) >= QUOTE_KEPT_SHARE;

/** Each quote, and whether one of these lines said it: by its speaker when the steer named one, else by either. */
export function quotesKept(quotes: readonly SteerQuote[], lines: readonly { who: "a" | "b"; text: string }[]): QuoteCheck[] {
  return quotes.map((q) => {
    const i = lines.findIndex((l) => (q.who === null || l.who === q.who) && saysQuote(q.text, l.text));
    return { ...q, kept: i >= 0, by: i >= 0 ? lines[i].who : null, line: i >= 0 ? i : null };
  });
}

/** Whether a line carries one of the steer's quotes (so the repeat critics leave it be: the steer asked for those words). */
export const carriesQuote = (quotes: readonly SteerQuote[], line: { who: "a" | "b"; text: string }): boolean =>
  quotes.some((q) => (q.who === null || q.who === line.who) && saysQuote(q.text, line.text));
