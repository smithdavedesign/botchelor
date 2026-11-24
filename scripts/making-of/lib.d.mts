/** Types for scripts/making-of/lib.mjs, which stays plain JS so collect.mjs runs with no build step. */
export const TIME_ZONE: string;
export type Commit = { sha: string; iso: string; day: string; subject: string; pr: number | null; title: string };
export function pacificDay(iso: string): string;
export function pacificTime(iso: string): string;
export function prOf(subject: string, body?: string): { pr: number; title: string } | null;
export function parseFirstParent(text: string): Commit[];
export function parseShotLog(text: string): Map<string, { status: "A" | "M"; path: string }[]>;
export function openPageSafe(path: string): boolean;
export function shotKind(path: string): { base: string; kind: "desktop" | "phone" | "other" };
export function prsPerDay(commits: Pick<Commit, "day" | "pr">[], first: string, last: string): { day: string; prs: number }[];
