/** Types for scripts/clips/daily-clip.mjs, which stays plain JS so launchd runs it with no build step. */

export type FeedEpisode = {
  id: string;
  revealed?: boolean;
  ending?: string;
  best_line?: string | null;
  transcript?: unknown[];
  characters?: { name: string }[];
};
export function pickClip<T extends FeedEpisode>(episodes: T[], opts?: { clipped?: Set<string> }): T | null;
export function captionFor(e: FeedEpisode, base: string): string;
