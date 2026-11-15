/** Types for scripts/clips/daily-clip.mjs, which stays plain JS so launchd runs it with no build step. */

export type FeedEpisode = {
  id: string;
  revealed?: boolean;
  ending?: string;
  best_line?: string | null;
  transcript?: unknown[];
  characters?: { name: string }[];
};
/** `prefer`: the episodes the day's story is about (the producer's beat, GET /api/story). */
export function pickClip<T extends FeedEpisode>(episodes: T[], opts?: { clipped?: Set<string>; prefer?: Set<string> }): T | null;
/** The show's story by episode id (the logline each aired date played under); empty when there is none. */
export function fetchStory(base: string, headers?: Record<string, string>): Promise<Map<string, string>>;
export function captionFor(e: FeedEpisode, base: string, logline?: string | null): string;
export function chromiumPath(): string;
