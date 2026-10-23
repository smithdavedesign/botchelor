/** Types for scripts/eval/build-training-set.mjs, which stays plain JS so it runs with no build step. */
import type { Query } from "./export-preferences.mjs";
import type { FineTuneReadiness, ReadinessGate } from "../../lib/training-readiness";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type SftRecord = { messages: ChatMessage[] };
export type DpoRecord = { prompt: ChatMessage[]; chosen: string; rejected: string };
export type Split = "train" | "valid";
export type TrainingSetCounts = {
  dates: number;
  lines: number;
  sft: Record<Split, number>;
  dpo: Record<Split, number> & { critic: number; votes: number };
  /** Kept SFT lines by who wrote them (episodes.turn_meta: show, byok, agent). */
  by: Record<string, number>;
  dropped: { flagged_or_revised: number; dealbreaker_words: number; cross_split: number; bad_line: number; chosen_net_down: number; same_text: number };
};
export type TrainingSet = {
  sft: Record<Split, SftRecord[]>;
  dpo: Record<Split, DpoRecord[]>;
  counts: TrainingSetCounts;
  split: { seed: string; eval_share: number; train_characters: number; valid_characters: number };
  readiness: FineTuneReadiness;
};
/** lib/training-set.ts, as the script uses it. */
export type TrainingLib = Record<string, unknown> & { gateText: (g: ReadinessGate) => string };

export const DEFAULT_SEED: string;
export const DEFAULT_EVAL_SHARE: number;
export function loadTrainingLib(): Promise<TrainingLib>;
export function hash32(s: string): number;
export function splitOf(characterId: string, seed?: string, share?: number): Split;
export function libDb(query: Query): { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export function buildTrainingSet(query: Query, deps?: { lib?: unknown; seed?: string; evalShare?: number }): Promise<TrainingSet>;
export function writeTrainingSet(dir: string, set: TrainingSet, opts?: { now?: Date }): string[];
export function readinessLines(r: FineTuneReadiness, gateText: (g: ReadinessGate) => string): string[];
export function parseArgs(argv: string[]): { out: string; seed: string; evalShare: number; allowSmall: boolean; db?: string; pglite?: string };
