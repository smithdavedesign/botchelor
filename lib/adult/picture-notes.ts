/**
 * What a scene's picture_note is (#1115: a missing face or body read "The last picture didn't come through", and the
 * note stayed after both were set): a setup step still to do, a status line, or a picture that really failed. Pure, so
 * the page can word each and drop a setup note the pair's live readiness has made stale.
 */
export const SETUP_NOTE_PREFIX = "No pictures until they're set up:";
const STATUS_PREFIXES = ["Pictures and clips are off until", "This chapter's pictures are drawn"];

export type PictureNoteKind = "setup" | "status" | "failure";

export function pictureNoteKind(note: string): PictureNoteKind {
  if (note.startsWith(SETUP_NOTE_PREFIX)) return "setup";
  return STATUS_PREFIXES.some((p) => note.startsWith(p)) ? "status" : "failure";
}

/**
 * The Studio step for what a character still needs (#1207: the note named what was missing but not where to do it): the
 * Recast section for a face, Body reference for a body. The Studio opens its Identity tab on these anchors.
 */
export function setupStep(r: { face: boolean; body: boolean; studio: string }): { href: string; label: string } | null {
  if (!r.face) return { href: `${r.studio}#recast`, label: "Pick a face" };
  if (!r.body) return { href: `${r.studio}#body-reference`, label: "Set a body reference" };
  return null;
}
