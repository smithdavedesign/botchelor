/** Types for scripts/clips/weekly-recap.mjs, plain JS so it runs with no build step. */
import type { DailyEpisode } from "./daily-episode.mjs";
import type { Edl } from "./episode-cut.mjs";

export type RecapWeek = { id: string; label?: string | null; from?: string; to?: string; complete?: boolean };
export type RecapDate = { id: string; grade?: string | null; aired_at?: string | null; title?: string | null; names?: [string, string]; ending?: string | null };
export type RecapEpisode = DailyEpisode & { aired_at?: string | null };

export const RECAP_DATES: number;
export const RECAP_MIN_DATES: number;
export const RECAP_TARGET: number;
export const RECAP_TITLE_SECONDS: number;
export const RECAP_ENDING_SECONDS: number;
export const RECAP_LINE_CHARS: number;
export const RECAP_MARK: string;
export function mondayOf(now: Date): string;
export function defaultWeek(now?: Date): string;
export function weekdayOf(airedAt: string | null | undefined): string | null;
export function recapLine(e: RecapEpisode): { line: number; keep: number[]; text: string } | null;
export function recapSay(ending: string, grade: string | null | undefined): string;
export function recapEdl(week: RecapWeek, dates: RecapDate[], episodes: RecapEpisode[], opts?: { max?: number; target?: number }): { edl: Edl & { week: string }; episodes: RecapEpisode[]; seconds: number };
export function recapCaption(week: RecapWeek, edl: Edl, episodes: RecapEpisode[], dates: RecapDate[], base?: string): string;
export function recapChecklist(week: RecapWeek, edl: Edl, episodes: RecapEpisode[], opts: { base?: string; total: number; beats: number; voices: string }): string[];
export function fetchWeek(base: string, which: string, headers?: Record<string, string>): Promise<{ week: Required<RecapWeek>; dates: RecapDate[] }>;
export function recapPosterArgs(opts: { src: string; out: string }): string[];
export function uploadRecap(opts: { base: string; key: string; week: string; video: string; poster: string; seconds: number; episodes: string[]; send?: typeof fetch }): Promise<{ ok: boolean; status: number; error: string | null; page: string | null }>;
export function releaseRecap(dir: string, cuts: string, week: string): string;
