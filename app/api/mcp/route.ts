import { handleMcpPost } from "@/lib/mcp";

/**
 * POST /api/mcp — the Botchelor MCP server (JSON-RPC 2.0 over Streamable HTTP; single JSON responses, no
 * SSE). The protocol + tools live in lib/mcp.ts. Notifications (and empty batches) get a 202 with no body.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64_000;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
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

  const out = await handleMcpPost(body);
  if (out === null) return new Response(null, { status: 202 }); // notification(s) only
  return new Response(JSON.stringify(out), { status: 200, headers: JSON_HEADERS });
}

/** No server-initiated stream: GET returns 405 (spec-compliant for a server without SSE). */
export function GET(): Response {
  return new Response(
    JSON.stringify({ error: "use_post", message: "Botchelor MCP: JSON-RPC 2.0 over POST (Streamable HTTP). No SSE stream." }),
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST" } },
  );
}
