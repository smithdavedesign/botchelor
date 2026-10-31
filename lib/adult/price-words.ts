/**
 * How After Dark says a price (#1005; David, 2026-10-30): "included" for what a subscription covers, "free" for an
 * admin, otherwise the bought tokens. No server imports, so the theater and the Make tab use it too.
 */
export const tokensWord = (n: number) => `${n} token${n === 1 ? "" : "s"}`;

export function priceWords(tokens: number, included = false): string {
  if (included) return "included";
  return tokens === 0 ? "free" : tokensWord(tokens);
}

/** "2 of 3 clips left this month": a subscriber's included clips where clips are offered; null when there's no allowance. */
export function includedClipsWords(left: number | null | undefined, of: number): string | null {
  if (left === null || left === undefined || of <= 0) return null;
  return `${left} of ${of} clip${of === 1 ? "" : "s"} left this month`;
}
