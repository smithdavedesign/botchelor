/** Types for scripts/crowd/prod-crowd.mjs, which stays plain JS so launchd runs it with no build step. */

export const DEFAULT_HOME: string;
export class Paused extends Error {}

export type Transport = (body: unknown, sessionId: string | null, userAgent: string) => Promise<{ json: unknown; sessionId: string | null }>;
export type Bot = { id: string; owner: string; name: string };
export type CrowdStats = {
  bots: number;
  awake: number;
  turns: number;
  like_backs: number;
  likes: number;
  answers: number;
  openers: number;
  texts: number;
  dates_started: number;
  errors: number;
};
export function runCrowdPass(opts: {
  transport: Transport;
  roster: Bot[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ledger: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brain: any;
  now?: number;
  log?: (m: string) => void;
  budgetMs?: number;
  nightHourUtc?: number;
  nightlyDates?: number;
  rng?: () => number;
  awake?: (botId: string, now: number) => boolean;
}): Promise<CrowdStats>;
