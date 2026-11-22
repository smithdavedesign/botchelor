import type { MetadataRoute } from "next";
import { AI_ROBOTS_TOKENS, RSC_PREFETCH } from "@/lib/bots";
import { siteUrl } from "@/lib/site";

// Per request, so the sitemap's address is the running deployment's SITE_URL even where the build didn't set it.
export const dynamic = "force-dynamic";

/**
 * robots.txt: the whole show is open to crawlers and agents. The JSON API isn't for crawling, except the MCP
 * server (the agents' front door), the public episode feed, and the share cards (/api/og/…: an episode's and the
 * chemistry test's og:image, which Twitterbot fetches only if robots.txt lets it), and the pictures (/api/assets/…:
 * every portrait on a character page; blocking them hid the faces from Google's renderer and Image search, 147 URLs
 * in Search Console 2026-11-15). Their After Dark teasers stay blocked: an nsfw asset redirects a stranger to its
 * blurred teaser (lib/asset-gate.ts), and the longer, more specific Disallow wins over the Allow. The show's other
 * media on public pages are open too (2026-11-22 audit: Google rendered them blank), each PG only: the character
 * photos (/api/shots/…, ready only after the show's PG check, lib/show-shots.ts), the home video (/api/home-clip/…, a
 * date that aired publicly, lib/home-clip.ts) and the cast intros (/api/cast-intro/…, from the approved PG portrait,
 * lib/cast-intros.ts). Account and admin pages are personal. The framework's prefetch requests (`?_rsc=`, lib/bots.ts
 * RSC_PREFETCH) were half of Googlebot's crawl in 2026-11 and are never pages, so crawlers skip them.
 *
 * So are /create's pre-filled addresses (`/create?say=…`, `?name=…`, `?meet=…`: one for every character the free tools
 * make up and one for every character on the site, so there's no end to them). Each is the same form with a box filled
 * in, and each was a full render: ClaudeBot fetched about 235 of them in 47 minutes on 2026-11-22. /create stays open.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const allow = ["/", "/api/mcp", "/api/episodes", "/api/og/", "/api/assets/", "/api/shots/", "/api/home-clip/", "/api/cast-intro/"];
  const disallow = ["/api/", "/api/assets/*/teaser", "/account", "/admin", RSC_PREFETCH, "/create?"];
  return {
    rules: [
      { userAgent: "*", allow, disallow },
      // Named, so the welcome is explicit: robots.txt allows everyone by default, and naming them says "you too".
      { userAgent: [...AI_ROBOTS_TOKENS], allow, disallow },
    ],
    // No `Host:` line: only Yandex ever read it (and dropped it in 2018); Search Console flagged it "Rule ignored by
    // Googlebot" (2026-11-19). The canonical address is each page's canonical link.
    sitemap: `${base}/sitemap.xml`,
  };
}
