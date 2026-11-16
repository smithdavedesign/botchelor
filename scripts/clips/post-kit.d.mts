/** Types for scripts/clips/post-kit.mjs, plain JS so it runs with no build step. */
export type PostEpisode = {
  id: string;
  venue?: string | null;
  setting?: string | null;
  ending?: string | null;
  best_line?: string | null;
  transcript?: { side?: string; dialogue?: string; who?: string }[];
  characters?: { id?: string; name: string; portrait?: string | null; credit?: { handle: string; name: string } }[];
};
export type Reveal = { mark: string; label: string; line: string | null; by: string | null };
export const CARD_SECONDS: { hook: number; reveal: number; end: number };
export const DATE_SECONDS: number;
export function placeOf(e: PostEpisode): string | null;
export function hookFor(e: PostEpisode, override?: string | null): string;
export function revealFor(e: PostEpisode): Reveal;
export function postCaption(e: PostEpisode, opts?: { hook?: string | null; tags?: string }): string;
/** One line per character credited to its creator (the episode JSON's opt-in `credit`), deduplicated by id. */
export function creditLines(characters: PostEpisode["characters"]): string[];
export function cardHtml(kind: "hook" | "reveal" | "end", data: { e: PostEpisode; base: string; hook: string; reveal: Reveal }): string;

/** The kit's audio from the recording's: shifted past the hook card, padded to the end (pure). */
export function voiceShiftFilter(hookSeconds: number, dateSeconds: number, totalSeconds: number): string;
