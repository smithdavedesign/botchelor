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

/* ----------------------------------- server-to-client request/response ----------------------------------- */

/**
 * sampling/createMessage and elicitation/create are server-initiated requests over SSE. Each has a request id,
 * the client responds with a JSON-RPC Response bearing the same id over POST, and we resolve the pending
 * promise. If the client never answers (closed stream, no SSE, no sampling capability), the request times out.
 */
type PendingRequest = { resolve: (value: unknown) => void; reject: (err: Error) => void; createdAt: number };
const PENDING: Map<string, PendingRequest> = new Map();
let nextRequestId = 1;

/** Default per-request timeout; the client's model may need a few seconds to respond. */
export const SERVER_REQUEST_TIMEOUT_MS = 30_000;

type ServerRequestOpts = { sessionId: string; method: string; params: Record<string, unknown>; timeoutMs?: number };

/**
 * Send a server-to-client request on the given session's SSE stream and wait for the response. Returns the
 * response's `result`. Throws if there's no open stream or if the request times out. Spec-compliant request ids
 * are strings or numbers; we use strings prefixed with `s:` to keep server ids out of the client-id namespace.
 */
export async function requestFromClient<T = unknown>(opts: ServerRequestOpts): Promise<T> {
  if (!opts.sessionId) throw new Error("requestFromClient: missing sessionId");
  const requestId = `s:${nextRequestId++}`;
  const timeoutMs = opts.timeoutMs ?? SERVER_REQUEST_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      PENDING.delete(requestId);
      reject(new Error(`${opts.method} timed out after ${timeoutMs}ms (client didn't respond on the SSE stream).`));
    }, timeoutMs);
    PENDING.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer);
        PENDING.delete(requestId);
        resolve(value as T);
      },
      reject: (err) => {
        clearTimeout(timer);
        PENDING.delete(requestId);
        reject(err);
      },
      createdAt: Date.now(),
    });
    const writer = WRITERS.get(opts.sessionId);
    if (!writer) {
      PENDING.delete(requestId);
      clearTimeout(timer);
      reject(new Error(`${opts.method}: no open SSE stream for this session. The client must open GET /api/mcp with text/event-stream.`));
      return;
    }
    // Spec: server-to-client request shape is { jsonrpc, id, method, params }. OutgoingMessage carries method+params; the id goes on the wire frame.
    try {
      writer({ jsonrpc: "2.0", method: opts.method, params: { ...opts.params, _requestId: requestId } });
    } catch (err) {
      PENDING.delete(requestId);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Resolve a pending server-to-client request from a client-sent POST. The client echoes the server's request
 * id back on its JSON-RPC Response; this looks it up and settles the promise. Returns true when the id was
 * known; false means a stale or unknown response (which is ignored, as the spec requires).
 */
export function resolveServerRequest(id: string | number | null | undefined, result: unknown, error: unknown): boolean {
  if (typeof id !== "string" || !id.startsWith("s:")) return false;
  const pending = PENDING.get(id);
  if (!pending) return false;
  if (error) pending.reject(error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error)));
  else pending.resolve(result);
  return true;
}

/** For tests: forget every pending request. */
export function resetPendingForTests(): void {
  for (const p of PENDING.values()) p.reject(new Error("test reset"));
  PENDING.clear();
  nextRequestId = 1;
}

export function pendingCountForTests(): number {
  return PENDING.size;
}

/**
 * sampling/createMessage: ask the client's LLM to produce a message. Spec params are `messages`, `maxTokens`,
 * `systemPrompt`, `temperature`, `includeContext`, `stopSequences`, `modelPreferences`, `metadata`.
 */
export async function requestSampling(
  sessionId: string,
  params: {
    messages: { role: "user" | "assistant"; content: { type: "text"; text: string } }[];
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    includeContext?: "none" | "thisServer" | "allServers";
    modelPreferences?: { hints?: { name?: string }[]; costPriority?: number; speedPriority?: number; intelligencePriority?: number };
  },
  opts: { timeoutMs?: number } = {},
): Promise<{ role: "assistant"; content: { type: "text"; text: string }; model: string; stopReason?: string }> {
  return requestFromClient({ sessionId, method: "sampling/createMessage", params, timeoutMs: opts.timeoutMs });
}

/**
 * elicitation/create (2025-11-01 spec addition): ask the user for structured input mid-tool. Params are a
 * `message` and a `requestedSchema` (a JsonSchema fragment); the client prompts the user and returns an
 * `action` ("accept" | "decline" | "cancel") and, on accept, `content` matching the schema.
 */
export async function requestElicitation(
  sessionId: string,
  params: { message: string; requestedSchema: Record<string, unknown> },
  opts: { timeoutMs?: number } = {},
): Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }> {
  return requestFromClient({ sessionId, method: "elicitation/create", params, timeoutMs: opts.timeoutMs });
}
