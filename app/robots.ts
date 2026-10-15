import type { MetadataRoute } from "next";
import { AI_ROBOTS_TOKENS } from "@/lib/bots";
import { siteUrl } from "@/lib/site";

/**
 * robots.txt: the whole show is open to crawlers and agents. The JSON API isn't for crawling, except the MCP
 * server (the agents' front door) and the public episode feed. Account and admin pages are personal.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const allow = ["/", "/api/mcp", "/api/episodes"];
  const disallow = ["/api/", "/account", "/admin"];
  return {
    rules: [
      { userAgent: "*", allow, disallow },
      // Named, so the welcome is explicit: robots.txt allows everyone by default, and naming them says "you too".
      { userAgent: [...AI_ROBOTS_TOKENS], allow, disallow },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
