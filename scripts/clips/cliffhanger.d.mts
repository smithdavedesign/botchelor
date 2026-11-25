/** Types for scripts/clips/cliffhanger.mjs, plain JS so it runs with no build step. */
import type { DailyEpisode, Report } from "./daily-episode.mjs";
import type { Beat, CutCharacter, CutEpisode, Edl } from "./episode-cut.mjs";

export type CliffEpisode = DailyEpisode & { date_number?: number | null; film?: CliffFilm | null };
export type Kept = { line: number; keep: number[] };
export type Pair = { hook: Kept; reply: Kept; how: "best" | "best last" | "question" | "pair" };
/** A date on film as its JSON carries it (lib/date-film-shared.ts DateFilm). */
export type CliffFilm = { scenes?: { src: string; caption?: string }[]; confessionals?: { character_id: string; src: string; seconds: number; line: string }[] };
export type FilmClip = { src: string; seconds: number; line: string };
export type FilmSceneRef = { src: string; caption: string };
export type CliffEdl = Edl & { format: "cliffhanger"; pick: Pair["how"]; scenes?: FilmSceneRef[]; segments: (Edl["segments"][number] & { ask?: boolean; clip?: FilmClip })[] };
export type Shot = { kind: "scene" | "clip"; file: string; at: number; secs: number };
export type Face = { file: string; kind: "loop" | "still"; from: string };
export type FaceChoice = { url: string; kind: "loop" | "still"; from: string };
export type Tile = { x: number; y: number; w: number; h: number };
export type PrevKit = { day: number; episode: string; dir: string; date: string | null };

export const CLIFF: { min: number; max: number; fit: number };
export const HOOK_CHARS: number;
export const HOOK_MIN: number;
export const REPLY_CHARS: number;
export const ENDING_TALK: RegExp;
export function tellsEnding(text: string | null | undefined): boolean;
export const AFTER_TALK: RegExp;
export function tellsAfter(text: string | null | undefined): boolean;
export const CONFESSIONAL_MAX_S: number;
export function pickConfessional(e: CliffEpisode): ({ side: "a" | "b" } & FilmClip) | null;
export function filmScenes(e: CliffEpisode): FilmSceneRef[];
export function ordinalWord(n: number): string;
export function setupLine(e: Pick<CliffEpisode, "date_number">): string;
export function nextDateOption(e: Pick<CliffEpisode, "date_number">): string;
export const ASK_CTA: string;
export function askCopy(e: Pick<CliffEpisode, "date_number">): { title: string; options: string[]; cta: string; say: string };
export function keepHead(text: string, max?: number): number[];
export function keepTail(text: string, max?: number): number[];
export function pickPair(e: CliffEpisode): Pair;
export const TITLE_MAX: number;
export function optionsLine(e: Pick<CliffEpisode, "date_number">): string;
export function cliffTitle(e: Pick<CliffEpisode, "characters" | "date_number">, n?: number): string;
export function cliffhangerEdl(e: CliffEpisode, opts?: { n?: number; film?: boolean }): CliffEdl;
export function cutText(edl: CliffEdl, episodes: CutEpisode[]): string;
export function spoilerHits(text: string, e: Pick<CutEpisode, "ending" | "why">, report?: Report | null): string[];
export function previousKit(postsDir: string, before?: number): PrevKit | null;
export function answerLine(prev: Pick<CutEpisode, "ending" | "why" | "characters">, opts?: { daysAgo?: number | null }): string | null;
export function daysBefore(date: string | null | undefined, now?: Date): number | null;
export function yesterdaysAnswer(postsDir: string, opts: { before: number; episode: string; base: string; now?: Date }): Promise<string | null>;
export function cliffCaption(e: CutEpisode, edl: Pick<CliffEdl, "question">, opts?: { base?: string; answer?: string | null }): string;
export const CLIFF_FRAME: { css: { width: number; height: number }; scale: number; out: { width: number; height: number }; fps: number };
export const TILES: readonly Tile[];
export const CARD_OVERLAP: { line: number; ask: number };
export const STILL_ZOOM: { from: number; to: number };
export const SHOT_AREA: Tile;
export const SCENE_ZOOM: { from: number; to: number };
export function baseHtml(e: CutEpisode, opts: { base: string }): string;
export function layerHtml(beat: Beat, opts: { e: CutEpisode; n?: number; shown?: number | null; plain?: boolean }): string;
export function cliffArgs(input: {
  background: string;
  faces: (Pick<Face, "file" | "kind"> | null)[];
  shots?: Shot[];
  tops: { file: string; secs: number }[];
  voices: ({ file: string; at: number } | null)[];
  total: number;
  out: string;
}): string[];
export function cliffSeconds(beats: Pick<Beat, "kind" | "voiced" | "secs">[], voiceSecs: number[], fixed?: (number | undefined)[]): number[];
export function fileKind(bytes: Uint8Array): "mp4" | "webp" | "png" | "jpg" | null;
export function filmMedia(src: string, opts: { base: string; dir: string; name: string; want: "clip" | "scene"; headers?: Record<string, string> }): Promise<string | null>;
export function shotPlan(beats: Pick<Beat, "kind">[], opts: { starts: number[]; seconds: number[]; clipAt?: number; clip?: string | null; scenes?: string[] }): Shot[];
export const HOUSE_LOOPS: Readonly<Record<string, string>>;
export function faceChoices(c: CutCharacter, kit: { loop?: string | null } | null): FaceChoice[];
export function faceMedia(c: CutCharacter, opts: { base: string; dir: string; headers?: Record<string, string> }): Promise<Face | null>;
export function renderCliffhanger(
  edl: CliffEdl,
  e: CutEpisode,
  opts: {
    base: string;
    out: string;
    n?: number;
    caption: string;
    checklist: (info: { total: number; voices: string; faces: string[] }) => string[];
    log?: (m: string) => void;
  },
): Promise<{ total: number; seconds: number[]; voices: string; faces: string[]; film: { open: boolean; scenes: number } }>;
export function buildCliffhanger(e: CliffEpisode, opts: { base: string; posts: string; out: string; day: number; log?: (m: string) => void }): Promise<{ total: number; answer: string | null; film: { open: boolean; scenes: number } }>;
