/** Types for scripts/eval/local-judge.mjs, which stays plain JS so the eval scripts run with no build step. */

export const DEFAULT_JUDGE_BASE: string;
export const DEFAULT_LITELLM_CONFIG: string;

export class LocalJudgeError extends Error {
  constructor(message: string, opts?: { fatal?: boolean });
  fatal: boolean;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LocalJudge = {
  model: string;
  complete(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string>;
};

export function isLocalUrl(url: string): boolean;
export function checkLocalAlias(configText: string | null | undefined, alias: string): { ok: boolean; reason: string | null; deployments?: { model: string | null; api_base: string | null }[] };
export function checkLocalResponse(headers: Headers | Record<string, string | undefined> | null | undefined): { ok: boolean; reason: string | null };
export function litellmKey(env?: Record<string, string | undefined>): string | null;
export function createLocalJudge(opts: {
  baseUrl?: string;
  key?: string | null;
  model: string;
  configText?: string | null;
  configPath?: string;
  fetchImpl?: typeof fetch;
  probeMs?: number;
  timeoutMs?: number;
}): Promise<LocalJudge>;
