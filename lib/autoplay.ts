/**
 * Which clips in a grid play by themselves (David, 2026-11-18: "on showcase pages, videos should play on hover or
 * automatically preferably"): app/useInViewAutoplay.ts watches the clips; this decides. Pure, so it's tested alone.
 */

/** At most this many play at once: a wide screen of tiles stays smooth, and a phone's data and battery last. */
export const MAX_PLAYING = 6;
/** How much of a clip is on screen before it plays: mostly, as the touch screens' grid already did. */
export const IN_VIEW = 0.6;

export type AutoplayTile<K> = {
  key: K;
  /** How much of it is on screen, 0 to 1. */
  ratio: number;
  /** Still blurred (the grid's veil, or After Dark's privacy blur until it's tapped), or paused by the person: left alone. */
  skip: boolean;
};

/** The clips to play, in page order: those mostly in view and not skipped, the most visible first, at most `max`. */
export function whichPlay<K>(tiles: readonly AutoplayTile<K>[], max: number = MAX_PLAYING): K[] {
  return tiles
    .map((t, i) => ({ ...t, i }))
    .filter((t) => t.ratio >= IN_VIEW && !t.skip)
    .sort((a, b) => b.ratio - a.ratio || a.i - b.i)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.i - b.i)
    .map((t) => t.key);
}
