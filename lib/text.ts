/** Small text helpers, one copy each for the whole site. */

/** The text with every character a regular expression reads specially escaped, so a pattern matches it literally. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
