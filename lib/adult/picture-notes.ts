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
