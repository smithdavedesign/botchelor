/** Types for scripts/eval/chemistry-model.mjs, which stays plain JS so it runs with no build step. */
import type { FirstDate } from "../../lib/outcome-data";
import type { OutcomesReadiness, ReadinessGate } from "../../lib/training-readiness";

export type Logistic = { w: number[]; b: number };
export type FeatureSpace = { traits: string[]; formats: string[]; kinds: string[]; names: string[] };
export type Signals = (sheet: { traits: readonly string[]; voice?: string | null }) => Record<"warmth" | "openness" | "guardedness" | "humor", number>;
export type ChemistryLib = {
  sheetSignals: Signals;
  buildTraitStats: (dates: { a: readonly string[]; b: readonly string[]; second: boolean }[]) => unknown;
  compatibility: (stats: never, a: readonly string[], b: readonly string[]) => { rate: number };
};
export type ChemistryResult = {
  outcome: "booked" | "ending";
  train: { n: number; positives: number };
  test: { n: number; positives: number };
  base_rate: number | null;
  features: number;
  auc: { model: number | null; chemistry_on_record: number | null; base_rate: number | null };
  log_loss: { model: number | null; base_rate: number | null };
  top_features: { name: string; weight: number }[];
};

export const MIN_PER_CLASS: number;
export const MIN_TRAIT_COUNT: number;
export const AXES: string[];
export function loadOutcomeLib(): Promise<Record<string, unknown>>;
export function sigmoid(z: number): number;
export function fitLogistic(X: number[][], y: number[], opts?: { l2?: number; lr?: number; iters?: number }): Logistic;
export function predictLogistic(m: Logistic, x: number[]): number;
export function auc(scores: number[], labels: (number | boolean)[]): number | null;
export function logLoss(ps: number[], ys: (number | boolean)[]): number | null;
export function standardizer(X: number[][]): { mean: number[]; sd: number[]; apply: (x: number[]) => number[] };
export function featureSpace(train: FirstDate[], opts?: { minTraitCount?: number }): FeatureSpace;
export function featurize(d: FirstDate, space: FeatureSpace, signals: Signals): number[];
export function timeSplit<T extends { at: string }>(dates: T[], testShare?: number): { train: T[]; test: T[] };
export function evaluateChemistry(dates: FirstDate[], lib: ChemistryLib, opts?: { outcome?: "booked" | "ending"; testShare?: number; minTraitCount?: number }): ChemistryResult;
export function reportLines(r: ChemistryResult, readiness: Pick<OutcomesReadiness, "ready" | "gates">, gateText: (g: ReadinessGate) => string): { enough: boolean; lines: string[] };
export function parseArgs(argv: string[]): { outcome: "booked" | "ending"; testShare: number; db?: string; pglite?: string; json?: string };
