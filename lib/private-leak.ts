/**
 * Whether text the public will read quotes something private (2026-11-22 audit: the narrator is given both characters'
 * private souls and nothing checked the recap before it aired). A quote is LEAK_WORDS words in a row from a private text
 * (its words lowercased, punctuation dropped). A run that's in public material too (the sheet, what they said on the
 * date) is already public and never counts.
 */
export const LEAK_WORDS = 8;

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Every run of `n` words in these texts. */
function runs(texts: readonly string[], n = LEAK_WORDS): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  }
  return out;
}

/** The first private run of words `shown` quotes, or null. `open`: public material whose runs never count. */
export function quotedPrivate(shown: readonly string[], secret: readonly string[], open: readonly string[] = []): string | null {
  const hidden = runs(secret);
  if (hidden.size === 0) return null;
  for (const r of runs(open)) hidden.delete(r);
  for (const r of runs(shown)) if (hidden.has(r)) return r;
  return null;
}
