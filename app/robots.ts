import type { MetadataRoute } from "next";
import { AI_ROBOTS_TOKENS } from "@/lib/bots";
import { siteUrl } from "@/lib/site";

// Per request, so the sitemap's address is the running deployment's SITE_URL even where the build didn't set it.
export const dynamic = "force-dynamic";

/**
 * robots.txt: the whole show is open to crawlers and agents. The JSON API isn't for crawling, except the MCP
 * server (the agents' front door), the public episode feed, and the share cards (/api/og/…: an episode's and the
 * chemistry test's og:image, which Twitterbot fetches only if robots.txt lets it). Account and admin pages are personal.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const allow = ["/", "/api/mcp", "/api/episodes", "/api/og/"];
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
