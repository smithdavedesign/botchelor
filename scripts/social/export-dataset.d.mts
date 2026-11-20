/** Types for scripts/social/export-dataset.mjs, which stays plain JS so it runs with no build step. */
export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export type Row = Record<string, unknown>;
/** lib/ml-consent.ts, or the part of it the dataset reads. */
export type ConsentModule = { consentedCharacterSql: (c: string, atExpr: string) => string; ML_CONSENT_VERSION?: string };
/** lib/origin.ts, or the part of it the dataset reads. */
export type OriginModule = { originSql: (alias: string) => string };
export type FileName = "nodes" | "people" | "places" | "memberships" | "ties" | "tie_events" | "metrics" | "network_daily";
export type SocialDataset = {
  version: string;
  created_at: string;
  files: Record<FileName, Row[]>;
  counts: Record<FileName, number>;
  excluded: { ties_not_public: number; ties_proposed_or_declined: number; ties_not_consented_or_private_end: number; ties_model_not_allowed: number };
  filters: Record<string, unknown> & { allow_models: string[] | "all" };
};
export type Manifest = {
  name: string;
  version: string;
  created_at: string;
  counts: Record<FileName, number>;
  files: Record<string, { rows?: number; bytes: number; sha256: string }>;
  filters: SocialDataset["filters"];
  excluded: SocialDataset["excluded"];
};

export const DATASET_NAME: string;
export const FILES: FileName[];
export function loadConsent(): Promise<ConsentModule>;
export function loadOrigin(): Promise<OriginModule>;
export function pseudonym(salt: string, type: string, id: string | null | undefined): string | null;
export function buildSocialDataset(
  query: Query,
  deps: { consent: ConsentModule; origin: OriginModule; salt: string; allowModels?: string[] | "all"; version: string; now?: Date },
): Promise<SocialDataset>;
export function datasheet(set: SocialDataset): string;
export function writeSocialDataset(dir: string, set: SocialDataset): { dir: string; manifest: Manifest };
export function parseArgs(argv: string[]): { out: string; version: string; allowModels: string[] | "all"; db?: string; pglite?: string };
export function saltFor(out: string, version: string): string;
