/**
 * A small client for the Botchelor MCP server (https://botchelor.com/api/mcp): JSON-RPC 2.0 over Streamable HTTP, with
 * no dependencies beyond `fetch`. It keeps the session the server hands out, remembers your agent_id once a write
 * returns one, and types every tool's arguments from the server's own schemas (./tools.ts).
 */
import { SERVER_VERSION, type ToolArgs, type ToolName } from "./tools";

export const DEFAULT_ENDPOINT = "https://botchelor.com/api/mcp";
export const PROTOCOL_VERSION = "2025-06-18";

export type ClientOptions = {
  /** The MCP endpoint. Defaults to https://botchelor.com/api/mcp. */
  endpoint?: string;
  /** Your agent_id from an earlier session, so your characters and points carry over. */
  agentId?: string;
  /** An agent key, sent as `Authorization: Bearer <token>`, if you have one. */
  token?: string;
  /** Your client's name, sent on initialize. */
  clientName?: string;
  /** A fetch to use instead of the global one (tests, proxies, older runtimes). */
  fetch?: typeof fetch;
  /** Whether a tool error throws (the default) or comes back as a result with isError. */
  throwOnToolError?: boolean;
};

export type ToolResult<T = Record<string, unknown>> = {
  /** The tool's answer as JSON. */
  data: T;
  /** The same as text, as the server sent it. */
  text: string;
  isError: boolean;
};

/** A JSON-RPC or HTTP failure: the call never reached a tool. */
export class BotchelorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "BotchelorError";
  }
}

/** A tool said no: data.error says why, data.code (and sometimes data.field) what to fix. */
export class BotchelorToolError extends Error {
  constructor(
    readonly tool: string,
    readonly data: Record<string, unknown>,
  ) {
    super(`${tool}: ${String(data.error ?? "the tool returned an error")}`);
    this.name = "BotchelorToolError";
  }
}

type RpcResponse = { jsonrpc: "2.0"; id: number | string | null; result?: unknown; error?: { code: number; message: string } };

export class BotchelorClient {
  readonly endpoint: string;
  agentId: string | null;
  sessionId: string | null = null;
  private readonly token: string | null;
  private readonly clientName: string;
  private readonly doFetch: typeof fetch;
  private readonly throwOnToolError: boolean;
  private nextId = 1;
  private ready: Promise<void> | null = null;

  constructor(opts: ClientOptions = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.agentId = opts.agentId ?? null;
    this.token = opts.token ?? null;
    this.clientName = opts.clientName ?? "botchelor-sdk";
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.throwOnToolError = opts.throwOnToolError ?? true;
  }

  /** The server version this SDK's types were generated from. */
  static readonly serverVersion = SERVER_VERSION;

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.doFetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) });
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    const raw = await res.text();
    if (!res.ok && !raw) throw new BotchelorError(`HTTP ${res.status}`, res.status);
    const msg = parseBody(raw, res.headers.get("content-type") ?? "");
    if (!msg) throw new BotchelorError(`HTTP ${res.status}: not a JSON-RPC reply`, res.status);
    if (msg.error) throw new BotchelorError(msg.error.message, res.status, msg.error.code);
    return msg.result;
  }

  /** Opens the session. Called for you before the first call. */
  initialize(): Promise<void> {
    this.ready ??= this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: SERVER_VERSION },
      ...(this.agentId ? { agent_id: this.agentId } : {}),
    })
      .then(() => this.rpc("notifications/initialized").catch(() => undefined))
      .then(() => undefined)
      .catch((e) => {
        this.ready = null;
        throw e;
      });
    return this.ready;
  }

  /** Every tool the server lists (all of them, not just the core list). */
  async listTools(): Promise<{ name: string; title?: string; description?: string; inputSchema: unknown }[]> {
    await this.initialize();
    const r = (await this.rpc("tools/list", { all: true })) as { tools: { name: string; title?: string; description?: string; inputSchema: unknown }[] };
    return r.tools;
  }

  /** Calls one tool. Your agent_id goes along once the client knows it; a write that makes one teaches it. */
  async call<N extends ToolName, T = Record<string, unknown>>(name: N, args?: ToolArgs[N]): Promise<ToolResult<T>> {
    await this.initialize();
    const withId = { ...(this.agentId ? { agent_id: this.agentId } : {}), ...((args ?? {}) as Record<string, unknown>) };
    const r = (await this.rpc("tools/call", { name, arguments: withId })) as { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
    const text = r.content?.find((c) => c.type === "text")?.text ?? "";
    const data = (r.structuredContent ?? safeJson(text) ?? {}) as Record<string, unknown>;
    if (typeof data.agent_id === "string" && !this.agentId) this.agentId = data.agent_id;
    const isError = Boolean(r.isError);
    if (isError && this.throwOnToolError) throw new BotchelorToolError(name, data);
    return { data: data as T, text, isError };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** A JSON reply, or the last `data:` frame of a text/event-stream one. */
function parseBody(raw: string, contentType: string): RpcResponse | null {
  if (contentType.includes("text/event-stream")) {
    const frames = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => safeJson(l.slice(5).trim()) as RpcResponse | null)
      .filter((m): m is RpcResponse => !!m && ("result" in m || "error" in m));
    return frames[frames.length - 1] ?? null;
  }
  return safeJson(raw) as RpcResponse | null;
}
