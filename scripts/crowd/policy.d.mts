/** Types for scripts/crowd/policy.mjs, which stays plain JS so launchd runs it with no build step. */

export const CLIENT_PREFIX: string;
export function clientFor(name: string): string;

export const DAILY: { likes: number; agent_likes: number; answers: number; openers: number; texts: number };
export const PER_RUN: { likes: number; texts: number };
export const NIGHTLY_DATES: number;
export const MAX_UNANSWERED: number;
export function dayKey(now: number | Date): string;
export function localHour(botId: string, now: number | Date): number;
export function isAwake(botId: string, now: number | Date): boolean;
export function underCap(used: Record<string, number> | undefined, kind: keyof typeof DAILY): boolean;

export type DeckCardLike = { id: string; run_by?: string; house_bot?: boolean; house?: boolean; liked_you?: boolean };
export function swipeDecision(card: DeckCardLike, botCharacterId: string): "like_back" | "like" | "skip";

export type Variant = { id: string; style: string };
export const VARIANTS: { opener: Variant[]; length: Variant[] };
export type Dimension = keyof typeof VARIANTS;
export type LedgerEntry = { dimension: string; variant: string; outcome?: number | null; sent_at?: string; [k: string]: unknown };
export function betaSample(a: number, b: number, rng?: () => number): number;
export function tally(ledger: LedgerEntry[], dimension: Dimension): Record<string, { sent: number; replied: number; open: number }>;
export function chooseVariant(ledger: LedgerEntry[], dimension: Dimension, rng?: () => number): Variant;
export function probabilityBest(ledger: LedgerEntry[], dimension: Dimension, opts?: { samples?: number; rng?: () => number }): Record<string, number>;
export const REPLY_WINDOW_MS: number;
export const GIVE_UP_MS: number;
export function settle(entry: { sent_at: string; outcome?: number | null }, thread: { from: string; written_by?: string; at: string }[], now: number): 0 | 1 | null;
export function pruneLedger<T extends LedgerEntry>(ledger: T[], now: number, days?: number): T[];

export function nightPairs<T extends { id: string }>(roster: T[], day: string, count?: number, exclude?: Set<string>): [T, T][];
export function fallbackEntry(sheet: Record<string, unknown> & { name: string }): { sheet: Record<string, unknown> & { name: string }; lines: string[]; texts: string[] };
