/** Types for scripts/switches.mjs, which stays plain JS so it runs with no build step. */
export type SwitchRow = { name: string; kind: "on" | "off" | "value"; files: string[]; docs: string[]; spec: string[] };

export const DOC: string;
export const BEGIN: string;
export const END: string;
export function scanSwitches(root?: string): SwitchRow[];
export function renderSwitches(rows: SwitchRow[]): string;
export function updatedDoc(root?: string): string;
