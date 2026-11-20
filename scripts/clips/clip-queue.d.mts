/** Types for scripts/clips/clip-queue.mjs, plain JS so launchd runs it with no build step. */
import type { DailyEpisode } from "./daily-episode.mjs";
import type { Edl, renderCut } from "./episode-cut.mjs";

export type ClaimedClip = { id: string; attempt: number; episode_id: string; character_id: string; side: "a" | "b"; credit: string; caption: string; episode: DailyEpisode };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const POLL_SECONDS: number;
export const MAX_PER_RUN: number;
export const KEYCHAIN_SERVICE: string;
export function workerSecret(env?: Record<string, string | undefined>, read?: () => string | null): string | null;
export function creditCard(credit: string): Edl["segments"][number];
export function requestEdl(e: DailyEpisode, req: Pick<ClaimedClip, "credit">): Edl;
export function retryable(stage: "edit" | "render", message: string): boolean;
export function doneForm(o: { id: string; attempt: number; seconds: number; clip: Uint8Array; poster?: Uint8Array | null }): FormData;
export function claim(base: string, secret: string, f?: Fetch): Promise<ClaimedClip | null>;
export function reportFailure(base: string, secret: string, o: { id: string; attempt: number; error: unknown; retry: boolean }, f?: Fetch, log?: (m: string) => void): Promise<void>;
export function processOne(o: { base: string; secret: string; f?: Fetch; render?: typeof renderCut; log?: (m: string) => void }): Promise<"none" | "done" | "failed">;
