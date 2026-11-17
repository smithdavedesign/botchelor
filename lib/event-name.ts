/**
 * An engagement event's name, as the server stores it (lib/engagement.ts) and the browser sends it (app/engagement.ts):
 * lower-case letters, digits and underscores, starting with a letter, at most 40 characters.
 *
 * A control's `data-track` value is the event's name, and nearly all of them are written with hyphens
 * ("character-follow", "chat-text-someone"). Until 2026-11-16 the browser sent them as written and the server's rule
 * turned every one away without a word: 123 of 129 names, none of them ever stored. Both sides now pass a name through
 * `eventName` first, so a hyphen is an underscore and nothing is dropped for its spelling. tests/event-names.test.ts
 * reads every `data-track` value in the source and holds it to this rule. A leaf: no imports, so the browser loads it.
 */
export const EVENT_NAME = /^[a-z][a-z0-9_]{1,39}$/;

/** The name as stored: hyphens become underscores, at most 40 characters. Null when it still isn't a name we keep. */
export function eventName(raw: string): string | null {
  const name = raw.replace(/-/g, "_").slice(0, 40);
  return EVENT_NAME.test(name) ? name : null;
}
