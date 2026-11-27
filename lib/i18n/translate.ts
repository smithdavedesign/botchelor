/**
 * Translating a string (docs/i18n.md). The key is the English itself, so the code reads as it always did and a string
 * nobody has translated yet shows in English rather than as a key. `{name}` in a string is filled from `vars`.
 *
 * Shared by the server and the browser.
 */
import type { Locale } from "./locales";

export type Messages = Readonly<Record<string, string>>;
export type Vars = Readonly<Record<string, string | number>>;
export type T = (english: string, vars?: Vars) => string;

const fill = (s: string, vars?: Vars): string => (vars ? s.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole)) : s);

/** A translator over one language's messages. */
export function translator(messages: Messages): T {
  return (english, vars) => fill(messages[english] ?? english, vars);
}

/** English, which needs no messages. */
export const english: T = (s, vars) => fill(s, vars);

/**
 * Marks a string in a list or a table for translation where it's shown (`t(link.label)`), so the catalog check
 * (tests/i18n.test.ts) finds it. Returns it unchanged.
 */
export const msg = <S extends string>(english: S): S => english;

/** `msg` for a string written outside a client component but shown by one, so it goes in the catalog's `client` half. */
export const clientMsg = msg;

/** Each language's catalog, in two halves: what the browser needs, and the rest (rendered on the server only). */
export type Catalog = { client: Messages; server: Messages };
export type Catalogs = Record<Exclude<Locale, "en">, Catalog>;
