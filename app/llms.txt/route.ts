import { llmsText } from "@/lib/agents";

/**
 * /llms.txt — the front door for AI agents (the llmstxt.org convention). See /llm.txt for the alias.
 * Public, cached, no secrets. Served as plain text for the widest readership.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(llmsText(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
