/** Types for scripts/clips/voice.mjs, which stays plain JS so launchd runs it with no build step. */

export const VOICES: { she: string[]; he: string[]; they: string[] };
export const TEMPO_MAX: number;
export const CUT_FADE_S: number;
export type VoicePlan = { index: number; start: number; tempo: number; trimTo: number | null };
export function voiceFor(c: { id: string; pronouns?: string | null }): string;
export function sayable(text: string): string;
export function fitPlan(marks: number[], durations: number[], end?: number): VoicePlan[];
export function mixArgs(plan: VoicePlan[], total: number): string;
export function veniceKey(): string | null;
export function soundSeconds(file: string): number;
export function speakLines(lines: { side: "a" | "b"; text: string }[], characters: { id: string; pronouns?: string | null }[], dir: string, opts?: { log?: (s: string) => void }): Promise<{ files: (string | null)[]; engine: "kokoro" | "say" }>;
export function voiceTrack(input: { lines: { side: "a" | "b"; text: string }[]; characters: { id: string; pronouns?: string | null }[]; marks: number[]; totalSeconds: number; dir: string; log?: (s: string) => void }): Promise<{ track: string; engine: "kokoro" | "say"; spoken: number }>;
