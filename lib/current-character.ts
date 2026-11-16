/**
 * "The character I'm working with" (David, 2026-11-16: "both chat and studio can change based on the character you
 * select (user might have multiple) ... make it seamless"). Someone with several characters picks one on Chat, the
 * Studio, Matches or the swipe deck; the choice is remembered, so the next of those doors opens on the same one.
 *
 *  - The address wins: `?character=<id>` is the choice on that page (the back button and a shared link behave).
 *  - Without one, the remembered choice (a cookie, this browser only), when it is still one of theirs.
 *  - Without that, the page's own default (the newest, or the one with news).
 *
 * Chat is the exception by design: it opens on every thread, and a face there only filters. It still remembers the
 * face picked, so the Studio opens on it. A leaf: no imports, so a client component may read the cookie's name.
 */
export const CHARACTER_COOKIE = "bz_char";
/** A year: it's a convenience, renewed whenever a character is picked. */
export const CHARACTER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The remembered character's id from the request's cookies, or null (never trusted as theirs: `pickCharacter` checks). */
export function rememberedCharacter(store: { get(name: string): { value: string } | undefined }): string | null {
  const v = store.get(CHARACTER_COOKIE)?.value ?? "";
  return ID.test(v) ? v : null;
}

/**
 * Which of `mine` a page is about: the one asked for in the address, else the remembered one, else `fallback` (the
 * page's own default), else the first. Null only when they have none.
 */
export function pickCharacter<T extends { id: string }>(mine: readonly T[], asked: string | null | undefined, remembered: string | null | undefined, fallback?: T | null): T | null {
  if (!mine.length) return null;
  return mine.find((c) => c.id === asked) ?? mine.find((c) => c.id === remembered) ?? fallback ?? mine[0];
}
