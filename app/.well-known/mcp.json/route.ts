import { mcpDiscovery } from "@/lib/agents-full";

/** /.well-known/mcp.json — where an agent looking for an MCP server here finds it, and its docs. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(JSON.stringify(mcpDiscovery(), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "access-control-allow-origin": "*",
    },
  });
}
