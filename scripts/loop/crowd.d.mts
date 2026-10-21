/** Types for scripts/loop/crowd.mjs, which stays plain JS so the loop's arena runs it with no build step. */

export type CrowdEntry = {
  sheet: Record<string, unknown> & { name: string };
  lines: string[];
  texts: string[];
};
/** client starts with "botchelor-loop-", so the app labels the agent a house-run bot; name is its personality. */
export type CrowdAgentDef = { client: string; name: string; version: string; characters: CrowdEntry[] };
export type Couple = { pair: [number, number]; answers: [boolean | null, boolean | null]; texts: number };

export const CROWD: CrowdAgentDef[];
export const COUPLES: Couple[];
export function hash(s: string): number;

type Step = Record<string, unknown> & { episode_id: string; turn?: number; of?: number; act_index?: number; ending?: string };
export type TurnOutput = { dialogue: string; action: string; emotion: string; interest_signal: number; accept_move?: boolean };
export function scriptedTurn(step: Step, me: CrowdEntry, opts?: { them?: string; used?: string[]; said?: string[]; attempt?: number }): TurnOutput;
export function scriptedRecap(
  step: Step,
  opts: { a: string; b: string; lines?: { name: string; text: string }[]; venue?: string | null; dateNumber?: number; attempt?: number },
): { setting: string; goals: string[]; scenes: string[]; twist: string; finale: string; best_line: string; confessionals: string[] };
export function isLogisticsLine(text: string): boolean;
export function bestLineCandidates(said: { text: string }[]): string[];
export function scriptedText(
  me: CrowdEntry,
  opts?: { them?: string; thread?: { from: string; text: string }[]; invite?: boolean; said?: string[] },
): string | null;

/* ---- the brain: a free local model through the ai-stack's LiteLLM, or the script ---- */

export const DEFAULT_CROWD_MODEL: string;
export const REPLY_HISTORY: number;
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
/** What the arena writes to world.json and crowd.json: which path the crowd's replies took, and why. */
export type CrowdBrainSummary = {
  /** The LiteLLM alias in use, or null when the whole run (or the rest of it) is scripted. */
  model: string | null;
  model_replies: number;
  fallback_replies: number;
  /** Why the run is scripted (model null), else the commonest reason a reply fell back, or null when none did. */
  reason_if_fallback: string | null;
  fallback_reasons: Record<string, number>;
  /** When the brain switched itself off mid-run: the alias it had been using. */
  model_was?: string;
};
export type CrowdBrain = {
  readonly model: string | null;
  readonly enabled: boolean;
  readonly reason: string | null;
  stats: { model: number; fallback: number; reasons: Record<string, number> };
  seedUntil: number;
  disable(why: string): void;
  count(path: "model" | "fallback", why?: string | null): void;
  summary(): CrowdBrainSummary;
  complete(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string>;
};
export function checkLocalAlias(
  configText: string,
  alias: string,
): { ok: boolean; reason: string | null; deployments?: { model: string | null; api_base: string | null }[] };
export function normalizeLine(s: string): string;
export function nearDuplicate(a: string, b: string): boolean;
export function echoesProfile(line: string, profileTexts?: string[], allowed?: string): string | null;
export function cleanReply(raw: string, opts?: { name?: string; partner?: string }): string;
export function crowdNames(): string[];
export function fixNames(
  line: string,
  opts?: { me?: string; partner?: string; known?: string[]; thread?: string[] },
): { line: string; problem: string | null; repaired: boolean };
export function replyMessages(opts: {
  kind: "text" | "turn";
  me: CrowdEntry;
  partner: { name: string; profile?: string[] };
  history?: { name: string; text: string }[];
  extra?: { where?: string | null; act?: string; ending_label?: string; closing?: boolean; suggestion?: boolean };
  said?: string[];
  refused?: string | null;
}): ChatMessage[];
export function scriptedBrain(reason?: string): CrowdBrain;
export function createBrain(opts?: {
  stub?: boolean;
  baseUrl?: string;
  key?: string | null;
  model?: string;
  configText?: string | null;
  configPath?: string;
  fetchImpl?: typeof fetch;
  probeMs?: number;
  timeoutMs?: number;
  warm?: boolean;
  log?: (m: string) => void;
}): Promise<CrowdBrain>;
export function brainFromEnv(env?: Record<string, string | undefined>, opts?: { log?: (m: string) => void }): Promise<CrowdBrain>;
export function mergeLastLines(lines: { name: string; text: string }[], lastLines?: string[]): { name: string; text: string }[];

/** Sends one JSON-RPC message as the given session and user agent; returns the response and the session to use next time. */
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
  brain: CrowdBrain;
  /** Everything each of its characters has sent this run, by character id. */
  said: Map<string, string[]>;
  tool(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
};
export function speak(
  agent: CrowdAgent,
  opts: {
    kind: "text" | "turn";
    me: { id: string; name: string; entry: CrowdEntry };
    partner: { name: string; profile?: string[] };
    history?: { name: string; text: string }[];
    extra?: { where?: string | null; act?: string; ending_label?: string; closing?: boolean; suggestion?: boolean };
    send(line: string): Promise<{ ok: true; result: unknown } | { ok: false; why: string }>;
    fallback(attempt: number, said: string[]): string | null;
    log?: (m: string) => void;
  },
): Promise<unknown>;
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
  opts?: { agents?: number; secondDates?: number; log?: (m: string) => void; brain?: CrowdBrain; seedBudgetMs?: number },
): Promise<{ agents: CrowdAgent[]; world: CrowdWorld }>;
export function runCrowd(
  agents: CrowdAgent[],
  opts?: { until?: number; books?: number; log?: (m: string) => void; fastMs?: number; slowMs?: number; soloMs?: number },
): { stats: CrowdStats; stop(): void; done: Promise<unknown> };
export function crowdRound(agents: CrowdAgent[], opts?: { books?: number; log?: (m: string) => void }): Promise<CrowdStats>;
