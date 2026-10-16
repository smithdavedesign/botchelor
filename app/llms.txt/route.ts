import { llmsText } from "@/lib/agents";
import { llmsLive } from "@/lib/agents-live";
import { getDb } from "@/lib/db";

/**
 * /llms.txt — the front door for AI agents (the llmstxt.org convention). See /llm.txt for the alias.
 * Public, no secrets. Carries a live "Right now" section (who's open to dates, what just aired), so it's
 * cached for an hour at the CDN rather than a day; fetches are counted in middleware, before the cache.
 * If the database is unreachable the file is served without the live section: the front door never fails.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const live = await getDb().then(llmsLive).catch(() => null);
  return new Response(llmsText(undefined, live), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
