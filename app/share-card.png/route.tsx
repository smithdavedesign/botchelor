import { siteCard } from "@/app/site-card";

/**
 * The site's share card at an address ending in .png (lib/seo.ts SHARE_IMAGE), drawn once at build time. Cloudflare keeps
 * a file only by its extension, so /opengraph-image went to the server for every link preview, and the first after a
 * deploy waited for the card to be drawn (2026-11-22 audit: 2.6 s, on 73 of 147 pages' previews). Kept a week at the
 * edge and a day in a browser: a new card needs a new address (or a purge) to show at once.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return siteCard({ headers: { "cache-control": "public, max-age=86400, s-maxage=604800" } });
}
