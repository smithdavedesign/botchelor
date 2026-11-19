/**
 * "The character I'm working with" (David, 2026-11-16: "both chat and studio can change based on the character you
 * select (user might have multiple) ... make it seamless"). Since 2026-11-18 (David: "instead of having a switch drop
 * down for each page we keep a small icon ... with who's currently browsing") it has one home: the face in the header
 * (app/CharacterPicker.tsx), on every page, for anyone with a character. The pages that are about one character (My
 * studio, Matches, the deck, the Characters cards' "Send {mine}") follow it and no longer carry a switcher of their own.
 *
 *  - The address wins: `?character=<id>` is the choice on that page (the back button and a shared link behave), and the
 *    header follows it (app/RememberCharacter.tsx announces it).
 *  - Without one, the remembered choice (a cookie, this browser only), when it is still one of theirs.
 *  - Without that, the page's own default (the newest, or on the deck the newest that can swipe).
 *
 * Chat is the exception by design: it opens on every thread, and "Just {name}" only filters. A leaf: no imports, so a
 * client component may read the cookie's name.
 */
export const CHARACTER_COOKIE = "bz_char";
/** A year: it's a convenience, renewed whenever a character is picked. */
export const CHARACTER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Said on `window` when the character changes (a page about one, or a pick in the header): the header's face follows. */
export const CHARACTER_EVENT = "bz:character";
/** Said on `window` by a heading's name (app/SwitchCharacter.tsx): the header's picker, wherever it shows, opens. */
export const PICKER_OPEN_EVENT = "bz:pick-character";
/**
 * The address's own choice of character, which a pick in the header replaces rather than leaves behind: `character`
 * (My studio, Matches, the deck, Chat's "Just {name}") and `send` (a card's "Send {mine}" landing on a character).
 */
export const PICKED_PARAMS = ["character", "send"] as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The remembered character's id from the request's cookies, or null (never trusted as theirs: `pickCharacter` checks). */
export function rememberedCharacter(store: { get(name: string): { value: string } | undefined }): string | null {
  const v = store.get(CHARACTER_COOKIE)?.value ?? "";
  return ID.test(v) ? v : null;
}

/** The remembered id from `document.cookie`'s string, or null: the header reads it after the page's first paint. */
export function rememberedFromCookieString(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== CHARACTER_COOKIE) continue;
    let v = rest.join("=");
    try {
      v = decodeURIComponent(v);
    } catch {
      return null;
    }
    return ID.test(v) ? v : null;
  }
  return null;
}

/**
 * Which of `mine` a page is about: the one asked for in the address, else the remembered one, else `fallback` (the
 * page's own default), else the first. Null only when they have none.
 */
export function pickCharacter<T extends { id: string }>(mine: readonly T[], asked: string | null | undefined, remembered: string | null | undefined, fallback?: T | null): T | null {
  if (!mine.length) return null;
  return mine.find((c) => c.id === asked) ?? mine.find((c) => c.id === remembered) ?? fallback ?? mine[0];
}

/**
 * Where a pick in the header takes the page at `href` (a path with its query): the same page with the address's
 * choice (PICKED_PARAMS) swapped for the new one and back on its first page, or null when the address names nobody and
 * the page only needs to be read again (it follows the cookie). The hash stays.
 */
export function pickedHref(href: string, id: string): string | null {
  const url = new URL(href, "https://botchelor.invalid");
  const named = PICKED_PARAMS.filter((p) => url.searchParams.has(p));
  if (!named.length) return null;
  for (const p of named) url.searchParams.set(p, id);
  url.searchParams.delete("page");
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Remembers `id` in this browser and says so on the page (CHARACTER_EVENT), so the header's face follows. Browser only;
 * a browser without cookies keeps each page's own default.
 */
export function rememberCharacterInBrowser(id: string): void {
  if (!ID.test(id)) return;
  try {
    document.cookie = `${CHARACTER_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${CHARACTER_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // No cookies here: every page still has its own default.
  }
  window.dispatchEvent(new CustomEvent<string>(CHARACTER_EVENT, { detail: id }));
}
