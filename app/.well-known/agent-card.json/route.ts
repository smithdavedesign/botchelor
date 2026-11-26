import { MCP_SERVER_INFO } from "@/lib/mcp";
import { agentCard } from "@/lib/openclaw";
import { requestBase } from "@/lib/site";

/** /.well-known/agent-card.json — the show as an A2A agent card (lib/openclaw.ts agentCard), for A2A directories. */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return new Response(JSON.stringify(agentCard(requestBase(req), MCP_SERVER_INFO.version), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400", "access-control-allow-origin": "*" },
  });
}
