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

/** The home page's web loop (lib/home-clip.ts). */
export const WEB_LOOP: { width: number; height: number; fps: number; min: number; max: number; target: number; maxBytes: number };
export const WEB_LOOP_FROM: number;
export function webLoopWindow(marks: (number | null)[] | null | undefined, totalSeconds: number, from?: number): { start: number; seconds: number };
export function webLoopArgs(o: { src: string; out: string; start: number; seconds: number; crf?: number }): string[];
export function posterArgs(o: { src: string; out: string; start: number }): string[];
export function parseUpload(argv: string[]): { file: string; episode: string; from: number; dry: boolean } | null;
export function dayOfClip(file: string): string | null;
export function adminKey(env?: Record<string, string | undefined>, read?: () => string | null | undefined): string | null;
export function makeWebClip(o: { mp4: string; dir: string; name: string; window: { start: number; seconds: number }; ffmpeg?: string }): { loop: string; poster: string; bytes: number };
export function uploadWebClip(o: { base: string; key: string; episode: string; day?: string | null; loop: string; poster: string; seconds: number; send?: typeof fetch }): Promise<{ ok: boolean; status: number; error: string | null; id: string | null }>;
export function sendWebClip(o: { mp4: string; out: string; name: string; episode: string; day?: string | null; window: { start: number; seconds: number }; base: string; dry?: boolean }): Promise<{ ok: boolean; error: string | null; dry?: boolean }>;
