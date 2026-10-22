/**
 * Server-Sent Events plumbing for the MCP server. A per-session message queue, one open stream per session.
 *
 * This is the transport piece that unlocks the server-to-client half of the spec: `notifications/progress`,
 * `notifications/resources/updated`, `sampling/createMessage`, `elicitation/create`. A tool handler pushes a
 * message via `queueFor(sessionId, …)` and the GET /api/mcp stream for that session drains it.
 *
 * In-memory, process-local — fine for a single-region Vercel deployment with modest traffic (the whole product
 * is at ~40 web visitors a week today). Multi-region or long-lived workers want a Redis-backed queue; the
 * contract this module exposes doesn't change.
 */

export type OutgoingMessage = { jsonrpc: "2.0"; method: string; params?: Record<string, unknown> };

type SessionId = string;

/** Pending outbound messages per session. A session with no open stream still accumulates (bounded). */
const QUEUES: Map<SessionId, OutgoingMessage[]> = new Map();
/** Open stream writers, one per session. A second GET for the same session replaces the first. */
const WRITERS: Map<SessionId, (msg: OutgoingMessage) => void> = new Map();
/** The limit a queue grows to before we drop the oldest. Keeps a disconnected session from leaking memory. */
const MAX_QUEUED = 100;

/** Push a message to a session. Delivers right away if the stream is open; otherwise queues. */
export function queueFor(sessionId: SessionId, msg: OutgoingMessage): void {
  if (!sessionId) return;
  const writer = WRITERS.get(sessionId);
  if (writer) {
    try {
      writer(msg);
      return;
    } catch {
      // Writer failed; fall through to queue.
    }
  }
  const q = QUEUES.get(sessionId) ?? [];
  q.push(msg);
  while (q.length > MAX_QUEUED) q.shift();
  QUEUES.set(sessionId, q);
}

/** Attach a stream to a session: the writer is called for every outbound message. Returns a detach function. */
export function attachStream(sessionId: SessionId, writer: (msg: OutgoingMessage) => void): () => void {
  // Drain anything queued before this stream opened.
  const pending = QUEUES.get(sessionId) ?? [];
  QUEUES.delete(sessionId);
  for (const m of pending) {
    try {
      writer(m);
    } catch {
      // If the writer throws here, the stream will clean itself up through its abort signal.
    }
  }
  // A second attach for the same session wins; the previous writer is dropped silently.
  WRITERS.set(sessionId, writer);
  return () => {
    if (WRITERS.get(sessionId) === writer) WRITERS.delete(sessionId);
  };
}

/** For tests: forget every queue and writer. */
export function resetStreamsForTests(): void {
  QUEUES.clear();
  WRITERS.clear();
}

export function streamStateForTests(): { queues: number; writers: number } {
  return { queues: QUEUES.size, writers: WRITERS.size };
}

/** Build an SSE wire message for one JSON-RPC frame. */
export function sseFrame(msg: OutgoingMessage, id?: string | number): string {
  const data = JSON.stringify(msg);
  return `${id !== undefined ? `id: ${id}\n` : ""}data: ${data}\n\n`;
}
