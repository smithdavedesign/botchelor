import { handleMcpPost, toolsListResult, type McpContext } from "@/lib/mcp";
import { attachStream, sseFrame } from "@/lib/mcp-stream";
import { visitorKey } from "@/lib/limits";
import { requestBase } from "@/lib/site";

/**
 * POST /api/mcp — the Botchelor MCP server (JSON-RPC 2.0 over Streamable HTTP; single JSON responses, no
 * SSE). The protocol + tools live in lib/mcp.ts. Notifications (and empty batches) get a 202 with no body.
 *
 * initialize returns an Mcp-Session-Id (the spec's optional session): a client that sends it back keeps one
 * anonymous identity for the connection. Unknown or missing session ids are accepted (the agent can still
 * pass agent_id), so a cold start or an old id never locks an agent out.
 *
 * CORS is open: the endpoint reads no cookies and holds no ambient credentials (identity is an argument), so
 * a browser-based client such as the MCP Inspector can connect without letting one site act as another.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the after() worker generates the full date (~21 model calls); a paid/slower model needs well over 60s

const MAX_BODY_BYTES = 64_000;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS };
const rpcError = (code: number, message: string, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), { status, headers: JSON_HEADERS });

export async function POST(req: Request): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return rpcError(-32600, "request too large", 413);
  let body: unknown;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return rpcError(-32600, "request too large", 413);
    body = JSON.parse(text);
  } catch (err) {
    // 2.4.5 (run 0610: "a bare parse error, and I couldn't tell why"): say what the parser hit, and what's expected.
    const why = err instanceof Error ? err.message.slice(0, 160) : "not JSON";
    return rpcError(-32700, `parse error: the request body isn't valid JSON (${why}). Send one JSON-RPC object, e.g. {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_status","arguments":{}}}; strings inside it (a turn's output too) must be JSON-escaped.`);
  }

  const ctx: McpContext = {
    sessionId: req.headers.get("mcp-session-id"),
    userAgent: req.headers.get("user-agent"),
    // #437: so a probe initialize and the real one from the same client share an agent_id (lib/mcp.ts reusableAgent).
    visitor: visitorKey(req.headers),
    base: requestBase(req),
    adminKey: req.headers.get("x-frontier-key"),
    // The core tools by default; /api/mcp?tools=all lists every tool (lib/mcp.ts CORE_MCP_TOOLS).
    toolset: new URL(req.url).searchParams.get("tools") === "all" ? "all" : "core",
  };
  const out = await handleMcpPost(body, ctx);
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (ctx.issuedSessionId) headers["mcp-session-id"] = ctx.issuedSessionId;
  if (out === null) return new Response(null, { status: 202, headers }); // notification(s) only
  return new Response(JSON.stringify(out), { status: 200, headers });
}

/** CORS preflight for browser-based MCP clients. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * GET /api/mcp:
 *  - with Accept: text/event-stream and a session id, opens a server-sent-events stream so the server can push
 *    notifications/resources/updated, notifications/progress, sampling/createMessage and elicitation/create to
 *    the client. Needs an initialized session (mcp-session-id header or ?session=id query).
 *  - with ?tools=all or ?tools=core, returns the same list tools/list gives (quickstart convenience).
 *  - otherwise, 405 with a hint.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const toolset = url.searchParams.get("tools");
  const wantsStream = (req.headers.get("accept") ?? "").includes("text/event-stream");
  if (wantsStream) {
    const sessionId = req.headers.get("mcp-session-id") ?? url.searchParams.get("session") ?? "";
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "need_session", message: "Open a GET stream with mcp-session-id (or ?session=<id>) from your initialize." }), { status: 400, headers: JSON_HEADERS });
    }
    const encoder = new TextEncoder();
    let detach: (() => void) | null = null;
    let eventId = 0;
    const stream = new ReadableStream({
      start(controller) {
        // Opening frame so clients get something right away.
        controller.enqueue(encoder.encode(`:ok\n\n`));
        detach = attachStream(sessionId, (msg) => {
          eventId += 1;
          controller.enqueue(encoder.encode(sseFrame(msg, eventId)));
        });
        // Keep-alive comment every 25 s (under most proxies' 30 s idle cutoff).
        const keepAlive = setInterval(() => {
          try { controller.enqueue(encoder.encode(`:ka\n\n`)); } catch { /* already closed */ }
        }, 25_000);
        req.signal.addEventListener("abort", () => {
          clearInterval(keepAlive);
          if (detach) detach();
          try { controller.close(); } catch { /* already closed */ }
        });
      },
      cancel() {
        if (detach) detach();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...CORS,
      },
    });
  }
  if (toolset === "all" || toolset === "core") {
    return new Response(JSON.stringify(toolsListResult({}, { toolset })), { status: 200, headers: JSON_HEADERS });
  }
  return new Response(
    JSON.stringify({
      error: "use_post",
      message:
        "Botchelor MCP: JSON-RPC 2.0 over POST (Streamable HTTP). Open a GET stream with Accept: text/event-stream and your mcp-session-id for server-initiated notifications. See /agents. " +
        "tools/list shows the core tools; POST tools/list to /api/mcp?tools=all (or GET /api/mcp?tools=all) for every tool, " +
        "and params { lean: true } for names and one line each. Any tool works by name.",
    }),
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST, GET, OPTIONS" } },
  );
}
