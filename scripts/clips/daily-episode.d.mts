/** Types for scripts/clips/daily-episode.mjs, plain JS so it runs with no build step. */
import type { CutEpisode, Edl } from "./episode-cut.mjs";

export type DailyEpisode = CutEpisode & { best_line?: string | null; featurable?: boolean | null };
export type DayStory = { day?: string | null; tonight?: string | null; logline?: string | null; episodes?: { id: string; day?: string; logline?: string | null }[] } | null;

export type Report = { grade: string; subjects: { label: string; grade: string }[] };

export const TARGET_SECONDS: number;
export const SILENT_SECONDS_REPORT: number;
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
export function reportFromOg(title: string | null | undefined, description: string | null | undefined): Report | null;
export function reportFromHtml(html: string | null | undefined): Report | null;
export function spokenGrade(grade: string): string;
export function standoutSubject(subjects: Report["subjects"] | null | undefined): { label: string; grade: string } | null;
export function reportSay(ending: string, report: Report): string;
export function fetchReport(base: string, id: string, headers?: Record<string, string>): Promise<Report | null>;
export function autoEdl(e: DailyEpisode, opts?: { story?: DayStory; n?: number; report?: Report | null }): Edl;
export function dailyCaption(e: DailyEpisode, edl: Edl, opts?: { story?: DayStory; n?: number; base?: string }): string;
export function fetchDayStory(base: string, headers?: Record<string, string>): Promise<DayStory>;
export function nextDayNumber(postsDir: string): number;
export const EPISODE_FORMATS: readonly ["cliffhanger", "full"];
export function askForFilm(
  id: string,
  base: string,
  opts?: { key?: string | null; fetchImpl?: typeof fetch; env?: Record<string, string | undefined>; timeoutMs?: number },
): Promise<{ ok: boolean; why: string | null; made?: string; film?: unknown }>;
export function episodeFormat(asked: string | null | undefined, env?: Record<string, string | undefined>): "cliffhanger" | "full";
export function buildDailyEpisode(id: string, opts?: { out?: string | null; n?: number | null; format?: string | null }): Promise<string>;
