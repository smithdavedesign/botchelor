/** Types for scripts/eval/deck-cf-offline.mjs, which stays plain JS so it runs with no build step. */
import type { DeckData } from "../../lib/outcome-data";
import type { OutcomesReadiness, ReadinessGate } from "../../lib/training-readiness";

export type UserItems = Map<string, Map<string, number>>;
export type ItemModel = { items: Map<string, Map<string, number>>; sim: (i: string, j: string) => number; userItems: UserItems };
export type ModelResult = { hit_rate: Record<string, number | null>; viewers_at: Record<string, number>; catalog_coverage: number | null };
export type DeckEvaluation = {
  cutoff: string | null;
  viewers: number;
  cold_viewers: number;
  user_coverage?: number | null;
  mean_candidates: number | null;
  unscored_current: number;
  models: Record<string, ModelResult>;
};

export const KS: number[];
export const MIN_TEST_VIEWERS: number;
export const WEIGHTS: { like: number; match: number; second: number };
export function loadOutcomeLib(): Promise<Record<string, unknown>>;
export function interactions(data: Pick<DeckData, "swipes" | "matches" | "seconds">, cutoff?: string | null): UserItems;
export function itemModel(userItems: UserItems): ItemModel;
export function cfScore(model: ItemModel, user: string, item: string): number;
export function popularity(userItems: UserItems): Map<string, number>;
export function rank(ids: Iterable<string>, score: (id: string) => number, viewer?: string): string[];
export function hitAt(ranked: string[], positives: Set<string>, k: number): boolean;
export function cutoffFor(swipes: DeckData["swipes"], testShare?: number): string | null;
export function evaluate(data: DeckData, opts?: { testShare?: number; ks?: number[] }): DeckEvaluation;
export function reportLines(result: DeckEvaluation, readiness: Pick<OutcomesReadiness, "ready" | "gates">, gateText: (g: ReadinessGate) => string): { enough: boolean; lines: string[] };
export function parseArgs(argv: string[]): { testShare: number; db?: string; pglite?: string; json?: string };
