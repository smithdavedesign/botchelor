/**
 * Autoplay (David, 2026-10-22: "the full conversation is auto, no human intervention"): the scene writes itself, step
 * after step, with no one pressing Next, in the theater and on the page alike. It rests by itself when the chapter fills
 * (CHAPTER_LINES, filed as a saved night: a whole night, start to finish), when a step brings nothing new (so a run of
 * dropped lines can't spend forever), or when a step fails (the error says why).
 */

/** Why autoplay stops after this step, or null to carry on. */
export function autoplayStop(before: { chapter: number }, after: { chapter: number }, added: number): string | null {
  if (after.chapter > before.chapter) return `Chapter ${before.chapter} is done and filed under Their nights. Autoplay has stopped: switch it on again for the next chapter.`;
  if (added <= 0) return "Nothing new came through that time, so autoplay has stopped. Switch it on again to carry on.";
  return null;
}

/** On the page, where a step's lines land at once: a pause to read them before the next ones are written. */
export const AUTOPLAY_PAGE_PAUSE_MS = 4000;

/** In the theater: the next lines are written while this many are still to play, so the stage never sits waiting. */
export const AUTOPLAY_THEATER_AHEAD = 3;
