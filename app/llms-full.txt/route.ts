import { llmsFullText } from "@/lib/agents-full";

/** /llms-full.txt — the long form of /llms.txt: every MCP tool, prompt and resource, generated from the server. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(llmsFullText(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
