/** Types for scripts/crowd/weekly-report.mjs, which stays plain JS so launchd runs it with no build step. */

export const WINNER_AT: number;
export const ENOUGH_PER_ARM: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildReport(opts: { ledger: any[]; server: any | null; engagement?: any | null; now?: Date; rng?: () => number }): string;

/** The "By channel" section lines from an engagement report (its `sources` rows); [] when there is none. */
export function channelLines(engagement: any): string[];
