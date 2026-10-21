/** Types for scripts/eval/observer-nightly.mjs, which stays plain JS so it runs with no build step. */
import type { ObserverInput, ObserverReport } from "../../lib/adult/observer";

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export type ChangedPair = { owner: string; a: string; b: string; changed_at: string; scene_changed: boolean; nights_changed: number };
export type NightlyEntry = Omit<ChangedPair, "owner"> & {
  owner: string;
  pair?: string;
  chapters?: { chapter: number; id: string; source: "night" | "scene"; lines: number }[];
  report?: ObserverReport;
  error?: string;
};
export type NightlySummary = {
  pairs: number;
  observed: number;
  errors: number;
  chapters: number;
  lines: number;
  findings: number;
  unprovoked_moves: number;
  agreed_moves: number;
  refused_moves: number;
  my_place_when_there: number;
  verbatim_repeats: number;
  near_repeats: number;
  unfounded_memories: number;
  lines_with_why: number;
  share_memory: number | null;
  share_trait: number | null;
  share_moment: number | null;
  worst: { pair: string; findings: number }[];
};
export type QualityRow = { kind: "after_dark_observer"; label: string; sha: string | null; at: string; metrics: NightlySummary };

export function selectChangedPairs(query: Query, opts: { since: string; owner?: string | null }): Promise<ChangedPair[]>;
export function summarize(entries: NightlyEntry[]): NightlySummary;
export function runNightly(opts: {
  query: Query;
  lib: { observeNight: (input: ObserverInput) => ObserverReport };
  fromDb?: (query: Query, o: { pair: [string, string]; owner?: string | null; nights: "latest" | "all" }) => Promise<ObserverInput[]>;
  now?: Date;
  hours?: number;
  owner?: string | null;
  outDir?: string;
  post?: ((row: QualityRow) => Promise<unknown>) | null;
  emit?: ((status: string, message: string) => Promise<void>) | null;
  sha?: string | null;
  log?: (m: string) => void;
  write?: boolean;
}): Promise<{ file: string | null; out: { date: string; ran_at: string; since: string; hours: number; sha: string | null; summary: NightlySummary; pairs: NightlyEntry[] }; summary: NightlySummary; posted: unknown; message: string }>;
export function poster(opts: { site: string; password: string | null; fetchImpl?: typeof fetch; log?: (m: string) => void }): (row: QualityRow) => Promise<{ ok: boolean; status?: number; why?: string }>;
export function emitter(bin?: string): (status: string, message: string) => Promise<void>;
