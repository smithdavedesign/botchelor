/** Types for scripts/sim-after-dark.mjs, which stays plain JS so it runs with no build step. */

export type NightLine = { chapter: number | null; who: "a" | "b"; text: string; why?: string | null; memory?: string | null; [k: string]: unknown };
export type NightNotes = {
  a?: { id: string; name: string };
  b?: { id: string; name: string };
  current?: { chapter?: number; lines?: Omit<NightLine, "chapter">[]; steps?: NightStep[] } | null;
  nights?: { chapter?: number; lines?: Omit<NightLine, "chapter">[]; steps?: NightStep[] }[];
};
export type NightStep = { id?: string; flags?: Record<string, unknown>; dropped?: unknown[] };
export type StepRow = { step: number; error?: string; added?: number; stage?: number; chapter?: number };
export type ObserverReport = { lines?: number; findings?: { check: string }[]; summary?: Record<string, unknown> };
export type ScorePart = { value: number; points: number; of: number };

export const NEW_CHARACTER: Record<string, unknown> & { name: string };
export const STEERS: Record<number, string>;
export function nightLines(notes: NightNotes | null): NightLine[];
export function guardTotals(notes: NightNotes | null): Record<string, number>;
export function scoreNight(report: ObserverReport | null, steps: StepRow[], all?: NightLine[]): { score: number; breakdown: Record<string, ScorePart> };
