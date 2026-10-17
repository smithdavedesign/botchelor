import { llmsFullText } from "@/lib/agents-full";
import { requestBase } from "@/lib/site";

/** /llms-full.txt — the long form of /llms.txt: every MCP tool, prompt and resource, generated from the server. */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return new Response(llmsFullText(requestBase(req)), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
