/** Types for scripts/loop/post-ratings.mjs, which stays plain JS so the loop runs it with no build step. */

export type RunRatings = { run: string; sha: string | null; at: string; overall_avg: number | null; mcp_avg: number | null; visitors: number };

export function parseReport(text: string): { overall: number | null; mcp: number | null };
export function runRatings(runDir: string): RunRatings;
