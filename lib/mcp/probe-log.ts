/**
 * MCP registries and liveness checkers (glama, mcpbeat, histor, rokmcp, …) connect every few minutes around the clock and
 * only shake hands: initialize and the list methods, never a tool. Each handshake wrote its session and call rows at once,
 * so the database (Neon, which sleeps after 5 idle minutes) never slept: awake 22 of 24 hours on 2026-11-01, about 8 of
 * them for these checkers alone, which kept botchelor off Neon's free plan.
 *
 * Their handshakes now leave the database alone. The rows they'd have written wait here, in memory and in order, and are
 * written (with their real times) the next time something else needs the database anyway: any other MCP call, or the
 * monitor's hourly health check. A restart loses at most the waiting rows, which are analytics only.
 */
import { detectBot } from "../bots";
import type { Db } from "../db";
import { isOurs } from "../our-traffic";

/** Methods that answer from constants: a checker calling only these needs nothing from the database. */
const HANDSHAKE = new Set(["initialize", "ping", "tools/list", "resources/list", "resources/templates/list", "prompts/list", "logging/setLevel"]);
/** What registries and checkers call themselves (initialize's clientInfo.name): "rokmcp-probe", "mcplantern-check", …, never
 * just a name with "probe" in it (#437's tests call an ordinary agent "probe-client"). */
const CHECKER_CLIENT = /[-_ ](probe|check)$|inspector|crawler|catalog|registry|collector|liveness|scanner|indexer|^glama|^mcpbeat|^histor|^talaria|^moonglade/i;
/** Their user agents, by the crawler convention: an info link ("+https://…/bot") or a bot/crawler word. */
const CHECKER_UA = /\+https?:\/\/|\bbot\b|crawler|spider|liveness|probe/i;

const MAX_WAITING = 5_000;
const MAX_SESSIONS = 5_000;

type Write = (db: Db) => Promise<unknown>;
const cache = globalThis as typeof globalThis & { __botchelorProbeLog?: { writes: Write[]; sessions: Set<string> } };
const state = () => (cache.__botchelorProbeLog ??= { writes: [], sessions: new Set() });

/** A checker's initialize: named like a registry or checker, never our own traffic, never an agent acting for a person. */
export function isCheckerClient(clientName: string | null | undefined, userAgent: string | null | undefined): boolean {
  if (isOurs(clientName ?? null, userAgent ?? null)) return false;
  // ChatGPT-User, Claude-User and the like carry a "+https://" link too, but they're an agent working for someone.
  if (detectBot(userAgent)?.kind === "agent") return false;
  return CHECKER_CLIENT.test(clientName ?? "") || CHECKER_UA.test(userAgent ?? "");
}

/** This message can be answered and logged without the database right now. */
export function isCheckerHandshake(
  method: string,
  c: { clientName?: string | null; userAgent?: string | null; sessionId?: string | null },
): boolean {
  if (!HANDSHAKE.has(method)) return false;
  // After initialize a client sends only its session id (glama's user agent is just "node"), so that's remembered.
  if (method !== "initialize") return Boolean(c.sessionId && state().sessions.has(c.sessionId));
  return isCheckerClient(c.clientName, c.userAgent);
}

/** Remember a checker's session, so its next handshake messages are recognised too. */
export function noteCheckerSession(sessionId: string): void {
  const { sessions } = state();
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.values().next().value as string);
  sessions.add(sessionId);
}

/** Keep a write for later. Past MAX_WAITING (no other traffic for a long time) the newest are dropped. */
export function deferWrite(write: Write): void {
  const { writes } = state();
  if (writes.length < MAX_WAITING) writes.push(write);
}

export const waitingWrites = (): number => state().writes.length;

/** Write what's waiting, in order. One that fails is skipped (analytics are best effort). Returns how many ran. */
export async function flushCheckerLog(db: Db): Promise<number> {
  const writes = state().writes.splice(0);
  for (const write of writes) await write(db).catch(() => {});
  return writes.length;
}

/** Tests only. */
export function resetCheckerLogForTests(): void {
  cache.__botchelorProbeLog = { writes: [], sessions: new Set() };
}
