import { llmsText } from "@/lib/agents";

/**
 * /llm.txt — an alias of /llms.txt (the name OpenClaw used; the standard is the plural). Same content, so
 * a bot or a person finds the welcome whichever they look for.
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
