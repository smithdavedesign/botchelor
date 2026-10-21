/** Types for scripts/loop/crowd.mjs, which stays plain JS so the loop's arena runs it with no build step. */

export type CrowdEntry = {
  sheet: Record<string, unknown> & { name: string };
  lines: string[];
  texts: string[];
};
export type CrowdAgentDef = { client: string; version: string; characters: CrowdEntry[] };
export type Couple = { pair: [number, number]; answers: [boolean | null, boolean | null]; texts: number };

export const CROWD: CrowdAgentDef[];
export const COUPLES: Couple[];
export function hash(s: string): number;

type Step = Record<string, unknown> & { episode_id: string; turn?: number; of?: number; act_index?: number; ending?: string };
export type TurnOutput = { dialogue: string; action: string; emotion: string; interest_signal: number; accept_move?: boolean };
export function scriptedTurn(step: Step, me: CrowdEntry, opts?: { them?: string; used?: string[]; attempt?: number }): TurnOutput;
export function scriptedRecap(
  step: Step,
  opts: { a: string; b: string; lines?: { name: string; text: string }[]; venue?: string | null; dateNumber?: number },
): { setting: string; goals: string[]; scenes: string[]; twist: string; finale: string; best_line: string; confessionals: string[] };
export function scriptedText(me: CrowdEntry, opts?: { them?: string; thread?: { from: string; text: string }[]; invite?: boolean }): string | null;

/** Sends one JSON-RPC message as the given session and user agent; returns the response and the session to use next. */
export type Transport = (
  body: Record<string, unknown>,
  sessionId: string | null,
  userAgent: string,
) => Promise<{ json: unknown; sessionId: string | null | undefined }>;
export function httpTransport(base: string): Transport;

export type CrowdAgent = {
  def: CrowdAgentDef;
  sessionId: string | null;
  userAgent: string;
  chars: { id: string; name: string; entry: CrowdEntry }[];
  tool(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
};
export type CrowdWorld = {
  agents: number;
  characters: number;
  dates_finished: number;
  dates_in_progress: number;
  matches: number;
  matches_agreed: number;
  texts: number;
  texts_waiting: number;
};
export type CrowdStats = { likes: number; answers: number; texts: number; turns: number; recaps: number; booked: number };

export function seedCrowd(
  transport: Transport,
  opts?: { agents?: number; secondDates?: number; log?: (m: string) => void },
): Promise<{ agents: CrowdAgent[]; world: CrowdWorld }>;
export function runCrowd(
  agents: CrowdAgent[],
  opts?: { until?: number; books?: number; log?: (m: string) => void; fastMs?: number; slowMs?: number; soloMs?: number },
): { stats: CrowdStats; stop(): void; done: Promise<unknown> };
export function crowdRound(agents: CrowdAgent[], opts?: { books?: number; log?: (m: string) => void }): Promise<CrowdStats>;
