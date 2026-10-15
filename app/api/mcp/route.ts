import { handleMcpPost, type McpContext } from "@/lib/mcp";

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
  } catch {
    return rpcError(-32700, "parse error");
  }

  const ctx: McpContext = { sessionId: req.headers.get("mcp-session-id"), userAgent: req.headers.get("user-agent") };
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

/** No server-initiated stream: GET returns 405 (spec-compliant for a server without SSE). */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      error: "use_post",
      message: "Botchelor MCP: JSON-RPC 2.0 over POST (Streamable HTTP). No SSE stream. Start with an initialize request; see /agents.",
    }),
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST, OPTIONS" } },
  );
}
