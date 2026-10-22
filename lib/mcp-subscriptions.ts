/**
 * Resource subscriptions for the MCP server (spec: resources/subscribe + notifications/resources/updated).
 *
 * The HTTP transport this server runs on returns one JSON response per request and never pushes
 * `notifications/resources/updated` on its own; the subscription store is in-memory, scoped by session_id, and
 * every subscribe reply says so (`_meta.botchelor/pushed: false`). When an SSE/streamable transport lands, the
 * same store feeds the stream — nothing in the subscription contract changes.
 *
 * We still track subscriptions so:
 *  - clients that read `_meta.pending_updates` on tool replies learn when a subscribed resource has moved on;
 *  - the admin page can see what agents are watching;
 *  - the moment SSE is wired, pushes come from this same table.
 */

import { queueFor } from "./mcp-stream";

type SessionId = string;
type ResourceUri = string;

/** Per-session set of subscribed URIs. */
const SUBS: Map<SessionId, Set<ResourceUri>> = new Map();
/** URIs with pending updates per session (set when a resource would have emitted an update). */
const PENDING: Map<SessionId, Set<ResourceUri>> = new Map();

/** The URIs this server supports subscribing to. Everything else is refused (nothing silently accepted). */
export const SUBSCRIBABLE: readonly ResourceUri[] = [
  "botchelor://feed/airing", // the next episodes to air
  "botchelor://docs/llms-full", // regenerated on new episodes
] as const;

export function isSubscribable(uri: string): boolean {
  return (SUBSCRIBABLE as readonly string[]).includes(uri);
}

export function subscribe(sessionId: SessionId, uri: ResourceUri): boolean {
  if (!sessionId || !isSubscribable(uri)) return false;
  const set = SUBS.get(sessionId) ?? new Set();
  set.add(uri);
  SUBS.set(sessionId, set);
  return true;
}

export function unsubscribe(sessionId: SessionId, uri: ResourceUri): boolean {
  const set = SUBS.get(sessionId);
  if (!set) return false;
  const had = set.delete(uri);
  if (!set.size) SUBS.delete(sessionId);
  return had;
}

/**
 * Record that a URI has moved on, for every session subscribed to it. Called by the writer, not the reader.
 * Pushes a `notifications/resources/updated` to any open SSE stream for that session (lib/mcp-stream.ts); the
 * `_meta.botchelor/pending_updates` ride-along is kept for clients that don't use the stream.
 */
export function markResourceUpdated(uri: ResourceUri): number {
  let hits = 0;
  for (const [sid, uris] of SUBS) {
    if (uris.has(uri)) {
      const pending = PENDING.get(sid) ?? new Set();
      pending.add(uri);
      PENDING.set(sid, pending);
      queueFor(sid, { jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri } });
      hits++;
    }
  }
  return hits;
}

/**
 * Drain pending updates for a session (idempotent: calling drains them). Tool replies include these in `_meta`
 * so a client gets the signal on its next request, even without SSE.
 */
export function drainPending(sessionId: SessionId): ResourceUri[] {
  const set = PENDING.get(sessionId);
  if (!set || !set.size) return [];
  const list = [...set];
  PENDING.delete(sessionId);
  return list;
}

/** For tests: forget every subscription. */
export function resetSubscriptionsForTests(): void {
  SUBS.clear();
  PENDING.clear();
}

export function listSubscriptionsForTests(): { sessions: number; subscriptions: number; pending: number } {
  let subscriptions = 0;
  let pending = 0;
  for (const s of SUBS.values()) subscriptions += s.size;
  for (const p of PENDING.values()) pending += p.size;
  return { sessions: SUBS.size, subscriptions, pending };
}
