/** Types for scripts/eval/export-preferences.mjs, which stays plain JS so it runs with no build step. */
import type { ObserverInput, ObserverReport } from "../../lib/adult/observer";

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export type PreferenceRecord = {
  kind: "episode" | "after_dark";
  ref_id: string;
  line_index: number;
  votes: { up: number; down: number; voters: number; score: number };
  last_vote: string | null;
  speaker: { side: "a" | "b"; name: string; character_id: string };
  other: { name: string; character_id: string };
  text: string;
  action: string | null;
  emotion: string | null;
  act: number | null;
  why: string | null;
  memory: string | null;
  stage: number | null;
  moved_to: string | null;
  context: { side: "a" | "b"; name: string; text: string }[];
  observer_flags: { check: string; from: number; to: number; note: string }[] | null;
  source: Record<string, unknown>;
};
type Deps = {
  lib?: { observeNight: (input: ObserverInput) => ObserverReport } | null;
  fromDb?: (query: Query, o: { pair: [string, string]; owner?: string | null; nights: "latest" | "all" }) => Promise<ObserverInput[]>;
  since?: string | null;
  kind?: "episode" | "after_dark" | null;
  context?: number;
  observer?: boolean;
};

export function collectPreferences(query: Query, deps?: Deps): Promise<{ records: PreferenceRecord[]; skipped: number; votes: number }>;
export function exportPreferences(opts: Deps & { query: Query; out: string; log?: (m: string) => void }): Promise<{ file: string; count: number; skipped: number; records: PreferenceRecord[] }>;
