import { mcpDiscovery } from "@/lib/agents-full";
import { requestBase } from "@/lib/site";

/** /.well-known/mcp.json — where an agent looking for an MCP server here finds it, and its docs. */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return new Response(JSON.stringify(mcpDiscovery(requestBase(req)), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "access-control-allow-origin": "*",
    },
  });
}
