/** Types for scripts/clips/daily-episode.mjs, plain JS so it runs with no build step. */
import type { CutEpisode, Edl } from "./episode-cut.mjs";

export type DailyEpisode = CutEpisode & { best_line?: string | null; featurable?: boolean | null };
export type DayStory = { day?: string | null; tonight?: string | null; logline?: string | null; episodes?: { id: string; day?: string; logline?: string | null }[] } | null;

export const TARGET_SECONDS: number;
export const BEFORE: number;
export const LINE_CHARS: number;
export const WORDS_PER_SECOND: number;
export const SERIES_MARK: string;
export function estimateSeconds(text: string): number;
export function unwrapLogline(raw: string | null | undefined): string | null;
export function storyLine(logline: string | null | undefined): string | null;
export function bestLineIndex(e: DailyEpisode): number | null;
export function keepFor(text: string, phrase: string | null | undefined): number[];
export function keepShort(text: string): number[] | null;
export function tonightLine(tonight: string | null | undefined): string | null;
export function isVote(tonight: string | null | undefined): boolean;
export function autoEdl(e: DailyEpisode, opts?: { story?: DayStory; n?: number; label?: string | null; kicker?: string; card?: Edl["segments"][number] | null }): Edl;
export function dailyCaption(e: DailyEpisode, edl: Edl, opts?: { story?: DayStory; n?: number; base?: string }): string;
export function fetchDayStory(base: string, headers?: Record<string, string>): Promise<DayStory>;
export function nextDayNumber(postsDir: string): number;
export function buildDailyEpisode(id: string, opts?: { out?: string | null; n?: number | null }): Promise<string>;
