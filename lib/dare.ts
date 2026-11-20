/**
 * "Dare a friend's OC" (2026-11-20, David: "build 1-3", the ideas doc's top pick). The end of a creator's own date is
 * the one moment with feeling, and the "date my OC" link (lib/date-invites.ts) already turns a click into a match with
 * the date agreed, but it lived on the character page, where a first-timer never looks. The verdict card now leads its
 * shares with a dare: the character's own date link, tagged with the date it just went on, and words that ask a friend
 * to send their OC next. The friend's landing (app/date/[code]) says who dared them and offers the date to watch first.
 *
 * Pure and client-safe: the words and the link's shape. The link itself is made by POST /api/date-links (owner only,
 * never a private, house or taken character), so a dare can't do anything a date link couldn't already.
 */

/** The query key a dare adds to a date link: the episode it came from. */
export const DARE_PARAM = "dare";

/** An episode id as the site makes them (a UUID or a short token): anything else is ignored, never echoed. */
const EPISODE_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** The episode id a landing's `?dare=` names, or null when it's missing or malformed. */
export function dareEpisodeId(raw: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = v?.trim();
  return t && EPISODE_ID.test(t) ? t : null;
}

/** The shared link: the character's date link with the dare's episode on it (keeps its own ?ref=invite). */
export function dareUrl(dateLinkUrl: string, episodeId: string): string {
  const id = dareEpisodeId(episodeId);
  if (!id) return dateLinkUrl;
  const u = new URL(dateLinkUrl);
  u.searchParams.set(DARE_PARAM, id);
  return u.toString();
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** What the share sheet says with the link: no spoiler of how the date ended, just the dare. */
export function dareText(you: string, partner: string): string {
  return `${firstOf(you)} just went on a blind date with ${firstOf(partner)} on Botchelor. I dare your OC to go on one with ${firstOf(you)}:`;
}

/** The share sheet's title. */
export function dareTitle(you: string): string {
  return `A blind date dare from ${firstOf(you)}`;
}

/**
 * Whether a landing may show the dare's date (pure): it has to be a date the invite's own character was on, and one a
 * stranger could open anyway (not private), so a crafted `?dare=` never shows someone else's date or a private one.
 */
export function dareShowable(ep: { character_a: string; character_b: string; visibility: string } | null | undefined, inviteCharacterId: string): boolean {
  if (!ep) return false;
  if (ep.visibility === "private") return false;
  return ep.character_a === inviteCharacterId || ep.character_b === inviteCharacterId;
}
