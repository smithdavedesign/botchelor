/** Types for scripts/eval/export-preferences.mjs, which stays plain JS so it runs with no build step. */
export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export type PreferenceRecord = {
  kind: "episode";
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
  moved_to: string | null;
  context: { side: "a" | "b"; name: string; text: string }[];
  source: Record<string, unknown>;
};
/** lib/ml-consent.ts, or the part of it the gates read. */
export type ConsentModule = {
  consentedOwnerSql: (ownerExpr: string, atExpr: string) => string;
  consentedCharactersSql: (a: string, b: string, atExpr: string) => string;
  airedPublicSql: (e: string) => string;
};
type Deps = {
  /** lib/ml-consent.ts; loaded through Vite's module runner when not given (loadConsent). */
  consent?: ConsentModule | null;
  since?: string | null;
  context?: number;
  /** Default true: only public, aired, ready, unhidden, non-After-Dark dates. Tests only, never a CLI flag. */
  publicOnly?: boolean;
  /** Default true: both characters the show's own or their owners opted in, and only opted-in voters' votes. Tests only. */
  consentOnly?: boolean;
};

/** A lib/ module (path relative to the repo root) through Vite's module runner. */
export function loadLib<T = Record<string, unknown>>(rel: string): Promise<T>;
export function loadConsent(): Promise<ConsentModule>;
export function parseArgs(argv: string[]): { out: string; since?: string; context: number; db?: string; pglite?: string };
export function collectPreferences(query: Query, deps?: Deps): Promise<{ records: PreferenceRecord[]; skipped: number; excluded: number; votes: number }>;
export function exportPreferences(
  opts: Deps & { query: Query; out: string; log?: (m: string) => void },
): Promise<{ file: string; count: number; skipped: number; excluded: number; records: PreferenceRecord[] }>;
